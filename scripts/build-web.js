// Сборка веб-ресурсов для Tauri/установщика: копирует статику в dist-web/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist-web');

const FILES = [
  'index.html',
  'app.js',
  'styles.css',
  'workflow-face-swap.json',
  'models-manifest.json',
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const f of FILES) {
  fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
}
fs.cpSync(path.join(ROOT, 'fonts'), path.join(OUT, 'fonts'), { recursive: true });

console.log('dist-web собран:', OUT);
for (const f of fs.readdirSync(OUT)) console.log(' -', f);
