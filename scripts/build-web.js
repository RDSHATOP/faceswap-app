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
  'workflow-flux2-headswap.json',
  'models-manifest.json',
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const f of FILES) {
  fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
}
fs.cpSync(path.join(ROOT, 'fonts'), path.join(OUT, 'fonts'), { recursive: true });

// version.json — источник версии для установленной копии (рядом с server.js нет package.json)
const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ version: pkgVersion }, null, 2) + '\n');

console.log('dist-web собран:', OUT);
for (const f of fs.readdirSync(OUT)) console.log(' -', f);
