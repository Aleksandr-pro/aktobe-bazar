// Смоук-тест движка BazarFX без браузера.
//
// Компилирует lib/fx/*.ts во временную папку, подсовывает движку мок WebGL2 и
// прогоняет несколько кадров в режимах «сцена», «видео» и «бенчмарк». Ловит
// падения в логике пайплайна (null-мишени, забытые биндинги, ошибки в ветках
// источника кадров), которые иначе видны только в браузере.
//
// Запуск: npm run check:engine

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bazarfx-'));

execFileSync(
  'npx',
  [
    'tsc',
    'lib/fx/engine.ts',
    'lib/fx/shaders.ts',
    '--outDir',
    outDir,
    '--module',
    'esnext',
    '--target',
    'es2020',
    '--moduleResolution',
    'node',
    '--skipLibCheck',
  ],
  { cwd: root, stdio: 'inherit' },
);

// Node ESM требует расширение в относительных импортах
for (const file of fs.readdirSync(outDir)) {
  const p = path.join(outDir, file);
  const src = fs.readFileSync(p, 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.js'");
  fs.writeFileSync(p, src);
}

// ---------- мок WebGL2 ----------
const constants = new Map();
let nextConst = 1;
const constFor = (name) => {
  if (!constants.has(name)) constants.set(name, nextConst++);
  return constants.get(name);
};

const calls = { drawArrays: 0, bindFramebuffer: 0, texImage2D: 0, useProgram: 0 };

function createGL() {
  const target = {
    FRAMEBUFFER_COMPLETE: constFor('FRAMEBUFFER_COMPLETE'),
    drawArrays: () => {
      calls.drawArrays++;
    },
    bindFramebuffer: () => {
      calls.bindFramebuffer++;
    },
    texImage2D: () => {
      calls.texImage2D++;
    },
    useProgram: () => {
      calls.useProgram++;
    },
    getShaderParameter: () => true,
    getProgramParameter: (p, param) => (param === constFor('ACTIVE_UNIFORMS') ? 3 : true),
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getActiveUniform: (p, i) => ({ name: ['uResolution', 'uAlpha', 'tCur'][i % 3], type: 1, size: 1 }),
    getUniformLocation: () => ({ loc: true }),
    checkFramebufferStatus: () => constFor('FRAMEBUFFER_COMPLETE'),
    getExtension: (name) => (name === 'EXT_disjoint_timer_query_webgl2' ? { TIME_ELAPSED_EXT: constFor('TIME_ELAPSED_EXT'), GPU_DISJOINT_EXT: constFor('GPU_DISJOINT_EXT') } : null),
    getQueryParameter: () => 1_000_000,
    getParameter: () => false,
    createQuery: () => ({ q: true }),
    createTexture: () => ({ tex: true }),
    createFramebuffer: () => ({ fbo: true }),
    createShader: () => ({ shader: true }),
    createProgram: () => ({ program: true }),
    createVertexArray: () => ({ vao: true }),
  };

  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return constFor(prop);
      // любой неизвестный метод — no-op
      return () => undefined;
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    },
  });
}

// В браузере цикл запускается через requestAnimationFrame — в тесте крутим его сами
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const canvas = { width: 0, height: 0, getContext: () => gl };
const gl = createGL();

// ---------- гоняем движок ----------
const { BazarFX } = await import(pathToFileURL(path.join(outDir, 'engine.js')).href);

const engine = new BazarFX(canvas, { renderScale: 0.5, sceneFpsCap: 0, frameGen: true, split: 0.5 });
engine.resize(1280, 720, 1);
engine.start();

let t = 0;
const step = (frames, dt = 16) => {
  for (let i = 0; i < frames; i++) {
    t += dt;
    engine.tick(t);
  }
};

step(4);
if (calls.drawArrays === 0) throw new Error('Движок не нарисовал ни одного кадра в режиме сцены');

const beforeVideo = calls.drawArrays;
const video = {
  readyState: 4,
  videoWidth: 1920,
  videoHeight: 1080,
  currentTime: 0,
  paused: false,
  play: async () => {},
};
engine.setVideo(video);
for (let i = 0; i < 4; i++) {
  video.currentTime += 1 / 30;
  video.requestVideoFrameCallback = undefined;
  step(1);
}
if (calls.drawArrays === beforeVideo) throw new Error('Режим видео не отрисовал ни одного кадра');

engine.setVideo(null);
step(3);

const result = await engine.benchmark(2);
if (!(result.nativeMs >= 0) || !(result.fxMs >= 0)) throw new Error('Бенчмарк вернул некорректные значения');

engine.destroy();
fs.rmSync(outDir, { recursive: true, force: true });

console.log('ok   кадров отрисовано:', calls.drawArrays);
console.log('ok   смена источника (сцена ↔ видео) прошла без ошибок');
console.log(`ok   бенчмарк: native=${result.nativeMs} мс, fx=${result.fxMs} мс, ${result.lowW}×${result.lowH} → ${result.fullW}×${result.fullH}`);
console.log('\nДвижок прошёл смоук-тест.');
