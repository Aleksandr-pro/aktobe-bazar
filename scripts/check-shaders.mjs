// Проверка всех GLSL ES 3.00 шейдеров BazarFX на синтаксис.
// Запуск: npm run check:shaders
import { parser } from '@shaderfrog/glsl-parser';
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'lib/fx/shaders.ts');
const src = fs.readFileSync(file, 'utf8');
const re = /export const (\w+) = `([\s\S]*?)`;/g;

let match;
let ok = true;
let count = 0;

while ((match = re.exec(src))) {
  const [, name, code] = match;
  count++;
  try {
    parser.parse(code, { quiet: true });
    const lines = code.split('\n').length;
    console.log(`ok   ${name.padEnd(18)} ${String(lines).padStart(3)} строк`);
  } catch (e) {
    ok = false;
    console.error(`FAIL ${name}: ${e.message.split('\n').slice(0, 3).join(' | ')}`);
  }
}

if (count === 0) {
  console.error('Не найдено ни одного шейдера в lib/fx/shaders.ts');
  process.exit(1);
}

console.log(ok ? `\nВсе ${count} шейдеров разобраны без ошибок.` : '\nЕсть ошибки в шейдерах.');
process.exit(ok ? 0 : 1);
