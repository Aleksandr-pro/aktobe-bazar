// Проверка шейдеров Android-пайплайна (FxRenderer.java) на синтаксис.
// Шейдеры там собраны из Java-строк, поэтому сначала склеиваем литералы.
// Запуск: npm run check:shaders:android
import { parser } from '@shaderfrog/glsl-parser';
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'integrations/android/app/src/main/java/kz/bazar/fx/FxRenderer.java');
const src = fs.readFileSync(file, 'utf8');

// private static final String NAME = "" ... ;
const re = /private static final String (\w+) =([\s\S]*?);\n/g;
const literal = /"((?:[^"\\]|\\.)*)"/g;

let match;
let ok = true;
let count = 0;

while ((match = re.exec(src))) {
  const [, name, body] = match;
  let code = '';
  let lit;
  literal.lastIndex = 0;
  while ((lit = literal.exec(body))) {
    code += lit[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (!code.includes('#version')) continue; // VERT и прочие не-шейдеры
  count++;
  try {
    parser.parse(code, { quiet: true });
    console.log(`ok   ${name.padEnd(16)} ${String(code.split('\n').length).padStart(3)} строк`);
  } catch (e) {
    ok = false;
    console.error(`FAIL ${name}: ${e.message.split('\n').slice(0, 3).join(' | ')}`);
  }
}

if (count === 0) {
  console.error('Шейдеры не найдены в FxRenderer.java');
  process.exit(1);
}
console.log(ok ? `\nВсе ${count} шейдеров Android-пайплайна разобраны без ошибок.` : '\nЕсть ошибки в шейдерах.');
process.exit(ok ? 0 : 1);
