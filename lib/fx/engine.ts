import {
  COPY_FRAG,
  DISPLAY_FRAG,
  FLOW_BLOCK_FRAG,
  FLOW_UPSCALE_FRAG,
  FULLSCREEN_VERT,
  SCENE_FRAG,
  SHARPEN_FRAG,
  TEMPORAL_FRAG,
  UPSCALE_FRAG,
  VIDEO_LOW_FRAG,
} from './shaders';

export type FxSource = 'game' | 'video';

export type FxOptions = {
  /** Where the frames come from: the built-in procedural scene or the user's video. */
  source: FxSource;
  /** Where motion vectors come from: engine G-buffer, optical flow, or none. */
  flow: 'auto' | 'optical' | 'none';
  /** Cost/quality of the block-matching optical flow (video mode). */
  flowQuality: 'fast' | 'balanced' | 'accurate';
  /** Internal render resolution as a fraction of the output resolution (0.25 – 1). */
  renderScale: number;
  /** Spatial upscaler (Catmull-Rom reconstruction). */
  upscale: boolean;
  /** Temporal reconstruction with motion vectors. */
  temporal: boolean;
  /** Contrast adaptive sharpening. */
  sharpen: boolean;
  /** Frame generation: interpolate between real frames. */
  frameGen: boolean;
  /** Show the low-res pixels without filtering (debug). */
  pixelView: boolean;
  /** "Heavy game" simulation: real frames are produced at this rate. */
  sceneFpsCap: number;
  /** 0..1 split position, or -1 for a full-screen BazarFX image. */
  split: number;
  paused: boolean;
};

export const DEFAULT_OPTIONS: FxOptions = {
  source: 'game',
  flow: 'auto',
  flowQuality: 'balanced',
  renderScale: 0.5,
  upscale: true,
  temporal: true,
  sharpen: true,
  frameGen: true,
  pixelView: false,
  sceneFpsCap: 30,
  split: 0.5,
  paused: false,
};

export type FxStats = {
  sceneFps: number;
  presentFps: number;
  generatedShare: number;
  cpuMs: number;
  gpuMs: number | null;
  lowW: number;
  lowH: number;
  fullW: number;
  fullH: number;
  scenePixelsPct: number;
  /** false, пока не пришёл первый кадр видео/сцены */
  ready: boolean;
};

type Program = {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
};

type Target = {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
};

const CAMERA_SPEED = 9.0; // world units per second
const VELOCITY_RANGE = 0.09;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Не удалось создать shader');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown compile error';
    gl.deleteShader(shader);
    throw new Error(`Ошибка компиляции шейдера:\n${log}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, fragSrc: string, vertSrc = FULLSCREEN_VERT): Program {
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('Не удалось создать program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown link error';
    throw new Error(`Ошибка линковки программы:\n${log}`);
  }
  const uniforms = new Map<string, WebGLUniformLocation>();
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const loc = gl.getUniformLocation(program, info.name);
    if (loc) uniforms.set(info.name.replace(/\[0\]$/, ''), loc);
  }
  return { program, uniforms };
}

function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  filter: number,
  wrap: number,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Не удалось создать texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return tex;
}

function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  filter: number = gl.LINEAR,
  wrap: number = gl.CLAMP_TO_EDGE,
): Target {
  const tex = createTexture(gl, width, height, filter, wrap);
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('Не удалось создать framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
  }
  return { fbo, tex, width, height };
}

function deleteTarget(gl: WebGL2RenderingContext, target: Target | null) {
  if (!target) return;
  gl.deleteFramebuffer(target.fbo);
  gl.deleteTexture(target.tex);
}

function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/**
 * BazarFX renderer.
 *
 * Pipeline: low-res scene (+motion vectors, +jitter) → spatial reconstruction →
 * temporal accumulation → adaptive sharpening → presentation / frame generation.
 */
export class BazarFX {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private options: FxOptions;

  private sceneProgram: Program;
  private videoProgram: Program;
  private flowProgram: Program;
  private flowUpscaleProgram: Program;
  private upscaleProgram: Program;
  private copyProgram: Program;
  private temporalProgram: Program;
  private sharpenProgram: Program;
  private displayProgram: Program;

  private sceneTarget: Target | null = null;
  private sceneVelocity: WebGLTexture | null = null;
  private sceneFbo: WebGLFramebuffer | null = null;

  private videoTexture: WebGLTexture | null = null;
  private neutralVelocity: WebGLTexture | null = null;
  private video: HTMLVideoElement | null = null;
  private lastVideoTime = -1;
  private videoFrameInterval = 0;
  private videoFramePending = false;
  private videoRVFC = 0;
  private lowColorTarget: Target | null = null;
  private lowPrevTarget: Target | null = null;
  private flowTarget: Target | null = null;
  private flowBlurTarget: Target | null = null;
  private flowGridW = 1;
  private flowGridH = 1;
  private lowPrevValid = false;

  private upTarget: Target | null = null;
  private history: [Target | null, Target | null] = [null, null];
  private historyIndex = 0;
  private historyValid = false;
  private finals: [Target | null, Target | null] = [null, null];
  private finalIndex = 0;
  private hasPreviousFrame = false;
  private prevFinalTarget: Target | null = null;

  private lowW = 1;
  private lowH = 1;
  private fullW = 1;
  private fullH = 1;
  private cssW = 640;
  private cssH = 360;
  private cssDpr = 1;

  private raf = 0;
  private running = false;
  private lastSceneTime = 0;
  private camZ = 0;
  private startTime = 0;
  private frameIndex = 0;
  private pausedAt = 0;

  private timerExt: any = null;
  private query: WebGLQuery | null = null;
  private pendingQuery: WebGLQuery | null = null;
  private gpuMs: number | null = null;

  private stats: FxStats = {
    sceneFps: 0,
    presentFps: 0,
    generatedShare: 0,
    cpuMs: 0,
    gpuMs: null,
    lowW: 1,
    lowH: 1,
    fullW: 1,
    fullH: 1,
    scenePixelsPct: 0,
    ready: false,
  };

  private sceneFrameCount = 0;
  private sceneFramesTotal = 0;
  private presentCount = 0;
  private generatedCount = 0;
  private statWindowStart = 0;
  private cpuAccum = 0;
  private cpuSamples = 0;

  onStats?: (stats: FxStats) => void;
  onError?: (message: string) => void;

  constructor(canvas: HTMLCanvasElement, options: Partial<FxOptions> = {}) {
    this.canvas = canvas;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      throw new Error(
        'WebGL2 недоступен на этом устройстве/браузере. Нужен Chrome/Edge/Firefox последних версий или Android 8+.',
      );
    }
    this.gl = gl;
    gl.getExtension('EXT_color_buffer_float');
    this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    this.sceneProgram = createProgram(gl, SCENE_FRAG);
    this.videoProgram = createProgram(gl, VIDEO_LOW_FRAG);
    this.flowProgram = createProgram(gl, FLOW_BLOCK_FRAG);
    this.flowUpscaleProgram = createProgram(gl, FLOW_UPSCALE_FRAG);
    this.upscaleProgram = createProgram(gl, UPSCALE_FRAG);
    this.copyProgram = createProgram(gl, COPY_FRAG);
    this.temporalProgram = createProgram(gl, TEMPORAL_FRAG);
    this.sharpenProgram = createProgram(gl, SHARPEN_FRAG);
    this.displayProgram = createProgram(gl, DISPLAY_FRAG);

    // The fullscreen triangle needs no attributes, but some drivers want a VAO.
    gl.bindVertexArray(gl.createVertexArray());
  }

  getOptions(): FxOptions {
    return { ...this.options };
  }

  setOptions(next: Partial<FxOptions>) {
    const prev = this.options;
    this.options = { ...prev, ...next };

    if (
      prev.renderScale !== this.options.renderScale ||
      prev.temporal !== this.options.temporal ||
      prev.frameGen !== this.options.frameGen
    ) {
      this.historyValid = false;
      this.hasPreviousFrame = false;
    }
    if (prev.paused !== this.options.paused) {
      this.historyValid = false;
      this.hasPreviousFrame = false;
    }
    if (prev.renderScale !== this.options.renderScale) {
      this.applySize();
    }
    if (prev.flowQuality !== this.options.flowQuality) {
      this.applySize();
    }
    if (prev.source !== this.options.source || prev.flow !== this.options.flow) {
      this.historyValid = false;
      this.hasPreviousFrame = false;
      this.sceneFramesTotal = 0;
      this.lowPrevValid = false;
      this.lastVideoTime = -1;
    }
  }

  /**
   * Подключает видео как источник кадров. Видео трактуется как «кадр игры в
   * низком разрешении»: оно сжимается в lowRes и дальше идёт по пайплайну.
   * Передайте null, чтобы вернуться к процедурной сцене.
   */
  setVideo(video: HTMLVideoElement | null) {
    this.cancelVideoCallback();
    this.video = video;
    this.videoFramePending = false;
    this.lastVideoTime = -1;
    this.registerVideoCallback();
    this.videoFrameInterval = 0;
    this.lowPrevValid = false;
    this.historyValid = false;
    this.hasPreviousFrame = false;
    this.sceneFramesTotal = 0;
    this.options = { ...this.options, source: video ? 'video' : 'game' };
  }

  /** true, если видео уже даёт кадры и их можно прогонять через пайплайн. */
  hasVideoFrame(): boolean {
    return !!this.video && this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  private registerVideoCallback() {
    const video = this.video as (HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
    }) | null;
    if (!video || typeof video.requestVideoFrameCallback !== 'function') return;
    this.videoRVFC = video.requestVideoFrameCallback((_now, meta) => {
      const t = typeof meta?.mediaTime === 'number' ? meta.mediaTime : this.video?.currentTime ?? 0;
      if (this.consumeVideoTimestamp(t)) {
        this.videoFramePending = true;
      }
      this.registerVideoCallback();
    });
  }

  private cancelVideoCallback() {
    const video = this.video as (HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void }) | null;
    if (video && typeof video.cancelVideoFrameCallback === 'function' && this.videoRVFC) {
      video.cancelVideoFrameCallback(this.videoRVFC);
    }
    this.videoRVFC = 0;
  }

  /** Обновляет интервал между кадрами видео; false — если это разрыв/seek. */
  private consumeVideoTimestamp(t: number): boolean {
    const delta = t - this.lastVideoTime;
    const discontinuity = this.lastVideoTime < 0 || delta <= 0 || delta > 0.35;
    if (discontinuity) {
      this.historyValid = false;
      this.hasPreviousFrame = false;
      this.sceneFramesTotal = 0;
      this.lowPrevValid = false;
    } else {
      this.videoFrameInterval =
        this.videoFrameInterval > 0 ? this.videoFrameInterval * 0.8 + delta * 0.2 : delta;
    }
    this.lastVideoTime = t;
    return !discontinuity;
  }

  /** Забирает флаг «пришёл новый кадр видео». */
  private consumeVideoFrame(): boolean {
    const video = this.video;
    if (!video || !this.hasVideoFrame()) {
      this.videoFramePending = false;
      return false;
    }
    const hasRVFC = typeof (video as any).requestVideoFrameCallback === 'function';
    if (hasRVFC) {
      const pending = this.videoFramePending;
      this.videoFramePending = false;
      return pending;
    }
    // Fallback: сравниваем currentTime (для MediaStream не работает, но там rVFC есть)
    const t = video.currentTime;
    if (t === this.lastVideoTime) return false;
    this.consumeVideoTimestamp(t);
    return true;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number) {
    this.cssW = cssWidth;
    this.cssH = cssHeight;
    this.cssDpr = dpr;
    this.applySize();
  }

  /** Recomputes the render resolution (called on resize and when renderScale changes). */
  private applySize() {
    const maxDim = 1920;
    const width = Math.max(320, Math.min(maxDim, Math.round(this.cssW * Math.min(this.cssDpr, 2))));
    const height = Math.max(180, Math.round((width * this.cssH) / Math.max(this.cssW, 1)));

    const scale = Math.min(1, Math.max(0.15, this.options.renderScale));
    const lowW = Math.max(160, Math.round(width * scale));
    const lowH = Math.max(90, Math.round(height * scale));

    const same =
      width === this.fullW && height === this.fullH && lowW === this.lowW && lowH === this.lowH && this.sceneTarget;
    if (same) return;

    this.fullW = width;
    this.fullH = height;
    this.lowW = lowW;
    this.lowH = lowH;
    this.canvas.width = width;
    this.canvas.height = height;

    this.rebuildTargets();
  }

  private rebuildTargets() {
    const gl = this.gl;

    deleteTarget(gl, this.sceneTarget);
    deleteTarget(gl, this.upTarget);
    deleteTarget(gl, this.history[0]);
    deleteTarget(gl, this.history[1]);
    deleteTarget(gl, this.finals[0]);
    deleteTarget(gl, this.finals[1]);
    deleteTarget(gl, this.lowColorTarget);
    deleteTarget(gl, this.lowPrevTarget);
    deleteTarget(gl, this.flowTarget);
    deleteTarget(gl, this.flowBlurTarget);
    if (this.sceneFbo) gl.deleteFramebuffer(this.sceneFbo);
    if (this.sceneVelocity) gl.deleteTexture(this.sceneVelocity);

    // Scene target: colour + velocity (MRT, no depth buffer needed).
    const color = createTexture(gl, this.lowW, this.lowH, gl.LINEAR, gl.CLAMP_TO_EDGE);
    const velocity = createTexture(gl, this.lowW, this.lowH, gl.LINEAR, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('Не удалось создать scene framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, velocity, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    const sceneStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (sceneStatus !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`MRT framebuffer incomplete: 0x${sceneStatus.toString(16)}`);
    }

    this.sceneTarget = { fbo, tex: color, width: this.lowW, height: this.lowH };
    this.sceneVelocity = velocity;
    this.sceneFbo = fbo;

    // Video-mode buffers: low-res colour, its previous frame and the flow field.
    const step = this.flowParams().step;
    this.flowGridW = Math.max(8, Math.ceil(this.lowW / step));
    this.flowGridH = Math.max(8, Math.ceil(this.lowH / step));
    this.lowColorTarget = createTarget(gl, this.lowW, this.lowH);
    this.lowPrevTarget = createTarget(gl, this.lowW, this.lowH);
    this.flowTarget = createTarget(gl, this.flowGridW, this.flowGridH);
    this.flowBlurTarget = createTarget(gl, this.lowW, this.lowH);
    this.lowPrevValid = false;

    this.upTarget = createTarget(gl, this.fullW, this.fullH);
    this.history = [createTarget(gl, this.fullW, this.fullH), createTarget(gl, this.fullW, this.fullH)];
    this.finals = [createTarget(gl, this.fullW, this.fullH), createTarget(gl, this.fullW, this.fullH)];
    this.prevFinalTarget = null;
    this.sceneFramesTotal = 0;
    this.historyIndex = 0;
    this.finalIndex = 0;
    this.historyValid = false;
    this.hasPreviousFrame = false;

    for (const target of [this.history[0], this.history[1], this.finals[0], this.finals[1], this.lowPrevTarget]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    for (const target of [this.flowTarget, this.flowBlurTarget]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.clearColor(0.5, 0.5, 0.5, 1); // нулевой поток
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startTime = performance.now();
    this.lastSceneTime = 0;
    this.statWindowStart = performance.now();
    this.statWindowStart = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.cancelVideoCallback();
  }

  destroy() {
    this.stop();
    const gl = this.gl;
    deleteTarget(gl, this.sceneTarget);
    deleteTarget(gl, this.upTarget);
    deleteTarget(gl, this.history[0]);
    deleteTarget(gl, this.history[1]);
    deleteTarget(gl, this.finals[0]);
    deleteTarget(gl, this.finals[1]);
    deleteTarget(gl, this.lowColorTarget);
    deleteTarget(gl, this.lowPrevTarget);
    deleteTarget(gl, this.flowTarget);
    deleteTarget(gl, this.flowBlurTarget);
    if (this.videoTexture) gl.deleteTexture(this.videoTexture);
    if (this.neutralVelocity) gl.deleteTexture(this.neutralVelocity);
    if (this.sceneFbo) gl.deleteFramebuffer(this.sceneFbo);
    if (this.sceneVelocity) gl.deleteTexture(this.sceneVelocity);
    for (const p of [
      this.sceneProgram,
      this.videoProgram,
      this.flowProgram,
      this.flowUpscaleProgram,
      this.upscaleProgram,
      this.copyProgram,
      this.temporalProgram,
      this.sharpenProgram,
      this.displayProgram,
    ]) {
      gl.deleteProgram(p.program);
    }
  }

  private tick = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    if (!this.sceneTarget) return;

    if (this.options.paused) {
      if (!this.pausedAt) this.pausedAt = now;
      return;
    }
    if (this.pausedAt) {
      this.lastSceneTime = now;
      this.pausedAt = 0;
    }

    let phase = 0;
    let generated = false;

    if (this.options.source === 'video' && this.video) {
      const video = this.video;
      const newFrame = this.consumeVideoFrame();

      if (newFrame) {
        this.renderSceneFrame(now);
        this.lastSceneTime = now;
        this.present(0);
      } else if (
        this.options.frameGen &&
        this.hasPreviousFrame &&
        !video.paused &&
        this.videoFrameInterval > 0
      ) {
        const interval = this.videoFrameInterval * 1000;
        const since = now - this.lastSceneTime;
        if (since < interval * 2.0) {
          phase = Math.min(0.95, Math.max(0.05, since / interval));
          this.present(phase);
          generated = true;
        } else {
          this.present(0); // видео буферизуется — держим последний кадр
        }
      } else {
        this.present(0); // пауза или выключенная генерация: просто показываем кадр
      }
    } else {
      const cap = this.options.sceneFpsCap > 0 ? this.options.sceneFpsCap : 0;
      const interval = cap > 0 ? 1000 / cap : 0;
      const sinceScene = now - this.lastSceneTime;

      if (!cap || sinceScene >= interval - 0.5) {
        this.renderSceneFrame(now);
        this.lastSceneTime = now;
        this.present(0);
      } else if (this.options.frameGen && this.hasPreviousFrame) {
        phase = Math.min(0.95, Math.max(0.05, sinceScene / interval));
        this.present(phase);
        generated = true;
      } else {
        return; // hold the last image
      }
    }

    this.presentCount++;
    if (generated) this.generatedCount++;

    if (this.statWindowStart === 0) {
      this.statWindowStart = now;
      this.sceneFrameCount = 0;
      this.presentCount = 0;
      this.generatedCount = 0;
      return;
    }

    const elapsed = now - this.statWindowStart;
    if (elapsed >= 500) {
      const sceneFps = (this.sceneFrameCount / elapsed) * 1000;
      const presentFps = (this.presentCount / elapsed) * 1000;
      const generatedShare = this.presentCount > 0 ? this.generatedCount / this.presentCount : 0;
      const cpuMs = this.cpuSamples > 0 ? this.cpuAccum / this.cpuSamples : 0;

      this.stats = {
        sceneFps: Math.round(sceneFps * 10) / 10,
        presentFps: Math.round(presentFps * 10) / 10,
        generatedShare: Math.round(generatedShare * 100),
        cpuMs: Math.round(cpuMs * 100) / 100,
        gpuMs: this.gpuMs,
        lowW: this.lowW,
        lowH: this.lowH,
        fullW: this.fullW,
        fullH: this.fullH,
        scenePixelsPct: Math.round((this.lowW * this.lowH * 1000) / (this.fullW * this.fullH)) / 10,
        ready: true,
      };
      this.onStats?.({ ...this.stats });

      this.statWindowStart = now;
      this.sceneFrameCount = 0;
      this.presentCount = 0;
      this.generatedCount = 0;
      this.cpuAccum = 0;
      this.cpuSamples = 0;
    }
  };

  private startQuery() {
    if (!this.timerExt) return;
    const gl = this.gl;
    if (this.query) return;
    this.query = gl.createQuery();
    gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, this.query);
  }

  private endQuery() {
    if (!this.timerExt || !this.query) return;
    const gl = this.gl;
    gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
    this.pendingQuery = this.query;
    this.query = null;
  }

  private pollQuery() {
    if (!this.timerExt || !this.pendingQuery) return;
    const gl = this.gl;
    const available = gl.getQueryParameter(this.pendingQuery, gl.QUERY_RESULT_AVAILABLE);
    const disjoint = gl.getParameter(this.timerExt.GPU_DISJOINT_EXT);
    if (available && !disjoint) {
      const ns = gl.getQueryParameter(this.pendingQuery, gl.QUERY_RESULT);
      this.gpuMs = Math.round((ns / 1e6) * 100) / 100;
      gl.deleteQuery(this.pendingQuery);
      this.pendingQuery = null;
    } else if (disjoint) {
      gl.deleteQuery(this.pendingQuery);
      this.pendingQuery = null;
    }
  }

  private bindTexture(unit: number, tex: WebGLTexture | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  private setUniforms(program: Program, values: Record<string, number | number[] | boolean>) {
    const gl = this.gl;
    for (const [name, value] of Object.entries(values)) {
      const loc = program.uniforms.get(name);
      if (!loc) continue;
      if (typeof value === 'number') gl.uniform1f(loc, value);
      else if (typeof value === 'boolean') gl.uniform1f(loc, value ? 1 : 0);
      else if (value.length === 2) gl.uniform2f(loc, value[0], value[1]);
      else if (value.length === 3) gl.uniform3f(loc, value[0], value[1], value[2]);
      else if (value.length === 4) gl.uniform4f(loc, value[0], value[1], value[2], value[3]);
    }
  }

  private drawQuad() {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  private renderSceneFrame(now: number) {
    const gl = this.gl;
    const t0 = performance.now();
    this.startQuery();
    this.pollQuery();

    this.frameIndex++;

    // ---- 1. scene at low resolution (движок или видео) ------------------
    if (this.options.source === 'video' && this.video) {
      this.renderVideoLowRes();
    } else {
      this.renderProceduralLowRes(now);
    }

    const lowTexture = this.lowTexture();
    const velocityTexture = this.velocityTexture();

    // ---- 2. spatial reconstruction --------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.upTarget!.fbo);
    gl.viewport(0, 0, this.fullW, this.fullH);
    if (this.options.upscale) {
      gl.useProgram(this.upscaleProgram.program);
      this.bindTexture(0, lowTexture);
      gl.uniform1i(this.upscaleProgram.uniforms.get('tLow') ?? null, 0);
      this.setUniforms(this.upscaleProgram, {
        uLowRes: [this.lowW, this.lowH],
        uSharpClamp: 0,
      });
    } else {
      gl.useProgram(this.copyProgram.program);
      this.bindTexture(0, lowTexture);
      gl.uniform1i(this.copyProgram.uniforms.get('tSrc') ?? null, 0);
    }
    this.drawQuad();

    // ---- 3. temporal accumulation ---------------------------------------
    const writeIndex = this.historyIndex;
    const readIndex = 1 - writeIndex;
    let shaded: Target = this.upTarget!;

    if (this.options.temporal) {
      const write = this.history[writeIndex]!;
      const read = this.history[readIndex]!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
      gl.viewport(0, 0, this.fullW, this.fullH);
      gl.useProgram(this.temporalProgram.program);
      this.bindTexture(0, this.upTarget!.tex);
      this.bindTexture(1, read.tex);
      this.bindTexture(2, velocityTexture);
      gl.uniform1i(this.temporalProgram.uniforms.get('tCurrent') ?? null, 0);
      gl.uniform1i(this.temporalProgram.uniforms.get('tHistory') ?? null, 1);
      gl.uniform1i(this.temporalProgram.uniforms.get('tVelocity') ?? null, 2);
      this.setUniforms(this.temporalProgram, {
        uFullRes: [this.fullW, this.fullH],
        uLowRes: [this.lowW, this.lowH],
        uAlpha: 0.15,
        uHistoryValid: this.historyValid ? 1 : 0,
      });
      this.drawQuad();
      this.historyIndex = readIndex;
      shaded = write;
      this.historyValid = true;
    }

    // ---- 4. adaptive sharpening -----------------------------------------
    const finalWrite = this.finals[this.finalIndex]!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, finalWrite.fbo);
    gl.viewport(0, 0, this.fullW, this.fullH);
    if (this.options.sharpen) {
      gl.useProgram(this.sharpenProgram.program);
      this.bindTexture(0, shaded.tex);
      gl.uniform1i(this.sharpenProgram.uniforms.get('tSrc') ?? null, 0);
      this.setUniforms(this.sharpenProgram, {
        uFullRes: [this.fullW, this.fullH],
        uStrength: this.options.temporal ? 0.45 : 0.7,
      });
    } else {
      gl.useProgram(this.copyProgram.program);
      this.bindTexture(0, shaded.tex);
      gl.uniform1i(this.copyProgram.uniforms.get('tSrc') ?? null, 0);
    }
    this.drawQuad();

    // swap the frame-generation buffers
    const prevFinal = this.finals[this.finalIndex]!;
    this.finalIndex = 1 - this.finalIndex;
    this.prevFinalTarget = prevFinal;

    this.sceneFrameCount++;
    this.sceneFramesTotal++;
    this.hasPreviousFrame = this.sceneFramesTotal > 1;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const cpuMs = performance.now() - t0;
    this.cpuAccum += cpuMs;
    this.cpuSamples++;
    this.endQuery();
  }

  private lowTexture(): WebGLTexture {
    if (this.options.source === 'video' && this.lowColorTarget) return this.lowColorTarget.tex;
    return this.sceneTarget!.tex;
  }

  private velocityTexture(): WebGLTexture {
    if (this.options.flow === 'none') return this.neutralVelocityTexture();
    if (this.options.source === 'video') return this.flowBlurTarget!.tex;
    return this.sceneVelocity!;
  }

  private neutralVelocityTexture(): WebGLTexture {
    if (!this.neutralVelocity) {
      const gl = this.gl;
      this.neutralVelocity = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.neutralVelocity);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    return this.neutralVelocity;
  }

  private renderProceduralLowRes(now: number) {
    const gl = this.gl;
    const dt = this.lastSceneTime > 0 ? Math.min(0.1, (now - this.lastSceneTime) / 1000) : 1 / 60;
    this.camZ += CAMERA_SPEED * dt;

    const jitterOn = this.options.temporal;
    const jitterX = jitterOn ? halton(this.frameIndex, 2) - 0.5 : 0;
    const jitterY = jitterOn ? halton(this.frameIndex, 3) - 0.5 : 0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget!.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, this.lowW, this.lowH);
    gl.useProgram(this.sceneProgram.program);
    this.setUniforms(this.sceneProgram, {
      uResolution: [this.lowW, this.lowH],
      uJitter: [jitterX, jitterY],
      uCamZ: this.camZ,
      uTime: (now - this.startTime) / 1000,
      uCamMove: CAMERA_SPEED * dt,
    });
    this.drawQuad();
  }

  /**
   * Видео -> низкое разрешение + (опционально) оптический поток между кадрами.
   * Это и есть «внешний» режим: игра рисует кадр, мы его апскейлим и дорисовываем.
   */
  private flowParams(): { step: number; search: number; taps: number } {
    switch (this.options.flowQuality) {
      case 'fast':
        return { step: 4, search: 3, taps: 1 };
      case 'accurate':
        return { step: 2, search: 5, taps: 2 };
      default:
        return { step: 3, search: 4, taps: 1 };
    }
  }

  private renderVideoLowRes() {
    const gl = this.gl;
    const video = this.video!;
    if (!this.videoTexture) {
      this.videoTexture = createTexture(gl, 1, 1, gl.LINEAR, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch {
      return; // кадр ещё не декодирован
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // «cover»-фит видео в кадр полотна
    const videoAspect = video.videoWidth / Math.max(1, video.videoHeight);
    const canvasAspect = this.lowW / Math.max(1, this.lowH);
    let fitX = 1;
    let fitY = 1;
    if (videoAspect > canvasAspect) {
      fitX = canvasAspect / videoAspect;
    } else {
      fitY = videoAspect / canvasAspect;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lowColorTarget!.fbo);
    gl.viewport(0, 0, this.lowW, this.lowH);
    gl.useProgram(this.videoProgram.program);
    this.bindTexture(0, this.videoTexture);
    gl.uniform1i(this.videoProgram.uniforms.get('tVideo') ?? null, 0);
    this.setUniforms(this.videoProgram, {
      uFitScale: [fitX, fitY],
      uFitOffset: [(1 - fitX) * 0.5, (1 - fitY) * 0.5],
      uLowResDarken: 0,
    });
    this.drawQuad();

    // оптический поток
    if (this.options.flow !== 'none' && this.lowPrevValid) {
      // блочный поиск на грубой сетке
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.flowTarget!.fbo);
      gl.viewport(0, 0, this.flowGridW, this.flowGridH);
      gl.useProgram(this.flowProgram.program);
      this.bindTexture(0, this.lowColorTarget!.tex);
      this.bindTexture(1, this.lowPrevTarget!.tex);
      gl.uniform1i(this.flowProgram.uniforms.get('tCur') ?? null, 0);
      gl.uniform1i(this.flowProgram.uniforms.get('tPrev') ?? null, 1);
      const params = this.flowParams();
      this.setUniforms(this.flowProgram, {
        uLowRes: [this.lowW, this.lowH],
        uStep: params.step,
        uSearch: params.search,
        uTaps: params.taps,
        uVelRange: VELOCITY_RANGE,
      });
      this.drawQuad();

      // апскейл + сглаживание до lowRes
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.flowBlurTarget!.fbo);
      gl.viewport(0, 0, this.lowW, this.lowH);
      gl.useProgram(this.flowUpscaleProgram.program);
      this.bindTexture(0, this.flowTarget!.tex);
      gl.uniform1i(this.flowUpscaleProgram.uniforms.get('tFlow') ?? null, 0);
      this.setUniforms(this.flowUpscaleProgram, { uLowRes: [this.lowW, this.lowH] });
      this.drawQuad();
    }

    // сохраняем текущий кадр как предыдущий
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lowPrevTarget!.fbo);
    gl.viewport(0, 0, this.lowW, this.lowH);
    gl.useProgram(this.copyProgram.program);
    this.bindTexture(0, this.lowColorTarget!.tex);
    gl.uniform1i(this.copyProgram.uniforms.get('tSrc') ?? null, 0);
    this.drawQuad();
    this.lowPrevValid = true;
  }

  private present(phase: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.fullW, this.fullH);
    gl.useProgram(this.displayProgram.program);

    const current = this.finals[this.finalIndex]!;
    const previous = this.prevFinalTarget ?? current;

    const lowTexture = this.lowTexture();
    this.bindTexture(0, lowTexture);
    this.bindTexture(1, current.tex);
    this.bindTexture(2, previous.tex);
    this.bindTexture(3, this.velocityTexture());
    this.bindTexture(4, lowTexture);

    const u = this.displayProgram.uniforms;
    gl.uniform1i(u.get('tRaw') ?? null, 0);
    gl.uniform1i(u.get('tCurrent') ?? null, 1);
    gl.uniform1i(u.get('tPrevious') ?? null, 2);
    gl.uniform1i(u.get('tVelocity') ?? null, 3);
    gl.uniform1i(u.get('tLowRaw') ?? null, 4);

    this.setUniforms(this.displayProgram, {
      uPhase: phase,
      uSplit: this.options.split,
      uPixelView: this.options.pixelView ? 1 : 0,
    });

    this.drawQuad();
  }
}

export { VELOCITY_RANGE };
