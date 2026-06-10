// cache-bust.js — corre no build do Netlify (ver netlify.toml).
// Substitui todos os parâmetros ?v=... nos ficheiros HTML pelo hash do commit,
// para que cada deploy invalide automaticamente a cache dos browsers.
const fs = require('fs');
const path = require('path');

const hash = (process.env.COMMIT_REF || String(Date.now())).slice(0, 10);
const root = __dirname;
const htmlFiles = fs.readdirSync(root).filter(f => f.endsWith('.html'));

let changed = 0;
for (const f of htmlFiles) {
  const file = path.join(root, f);
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/\?v=[A-Za-z0-9._-]+/g, `?v=${hash}`);
  if (out !== src) {
    fs.writeFileSync(file, out);
    changed++;
    console.log(`cache-bust: ${f} → ?v=${hash}`);
  }
}
console.log(`cache-bust: ${changed} ficheiro(s) atualizado(s)`);
