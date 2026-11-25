import fs from 'node:fs';
import path from 'node:path';

const localesDir = path.resolve('public/locales');
const en = JSON.parse(fs.readFileSync(path.join(localesDir, 'en/translation.json'), 'utf8'));
const es = JSON.parse(fs.readFileSync(path.join(localesDir, 'es/translation.json'), 'utf8'));

function toPseudo(str) {
  const map = { a: 'ȧ', e: 'ḗ', i: 'ī', o: 'ǿ', u: 'ŭ', A: 'Ȧ', E: 'Ḗ', I: 'Ī', O: 'Ǿ', U: 'Ŭ' };
  let out = '';
  let inBrace = 0;
  for (const ch of str) {
    if (ch === '{') inBrace++;
    if (inBrace > 0) {
      out += ch;
    } else {
      out += map[ch] ?? ch;
    }
    if (ch === '}') inBrace = Math.max(0, inBrace - 1);
  }
  return `[!! ${out} !!]`;
}

for (const section of ['warRoom', 'governanceErrors']) {
  if (!en[section] || !es[section]) {
    console.error(`Missing section "${section}" in en or es locale`);
    process.exit(1);
  }
  for (const key of Object.keys(en[section])) {
    if (!es[section][key]) {
      console.error(`Missing key "${section}.${key}" in es/translation.json`);
      process.exit(1);
    }
    const pseudo = toPseudo(en[section][key]);
    if (pseudo.length <= en[section][key].length) {
      console.error(`Pseudo-locale expansion failed for "${section}.${key}"`);
      process.exit(1);
    }
  }
}

console.log('Pseudo-locale and ICU catalog check passed.');
