// FaceSwap local app — сервер без зависимостей (Node 18+)
// Статика + API для ComfyUI (upload / prompt / history / view)

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Запуск команды с захватом stdout (для диагностики системы)
function runCmd(file, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout: ' + file)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(file + ' exit ' + code + ': ' + (err || out).slice(0, 200)));
    });
  });
}

// ---------- Конфигурация ----------
function argValue(name, dflt) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const HOST = argValue('--host', process.env.HOST || '127.0.0.1');
const PORT = parseInt(argValue('--port', process.env.PORT || '7100'), 10);
const ROOT = __dirname;
// Пользовательские данные: по умолчанию рядом с сервером (dev),
// в установленном приложении Tauri передаёт FACESWAP_DATA_DIR (%LOCALAPPDATA%\FaceSwap\data)
const DATA_DIR = process.env.FACESWAP_DATA_DIR || ROOT;
const RESULTS_DIR = path.join(DATA_DIR, 'results');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const WORKFLOW_FILE = path.join(ROOT, 'workflow-flux2-headswap.json');

// ---------- Конфиг ----------
// config.json рядом с сервером: { "comfyDir": "...", "comfyPort": 8199 }
const CONFIG_FILE = path.join(ROOT, 'config.json');
const DEFAULT_COMFY_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'FaceSwap', 'comfyui')
  : path.join(ROOT, 'comfyui');

function loadConfig() {
  const cfg = { comfyDir: null, comfyPort: 8199 };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (parsed.comfyDir) cfg.comfyDir = parsed.comfyDir;
      if (parsed.comfyPort) cfg.comfyPort = parseInt(parsed.comfyPort, 10) || cfg.comfyPort;
    }
  } catch (e) {
    console.error('[config] не прочитан config.json:', e.message);
  }
  // путь из config.json действителен только если там реально лежит ComfyUI
  if (cfg.comfyDir && !fs.existsSync(path.join(cfg.comfyDir, 'ComfyUI', 'main.py'))) {
    cfg.comfyDir = null;
  }
  if (!cfg.comfyDir) {
    // автоопределение: рядом с приложением «установленный» ComfyUI,
    // иначе уже существующий portable на Z (машина разработчика)
    const bundled = path.join(ROOT, 'comfyui');
    const dev = 'Z:\\Comfy\\ComfyUI_windows_portable';
    cfg.comfyDir = fs.existsSync(path.join(bundled, 'ComfyUI', 'main.py')) ? bundled
      : fs.existsSync(path.join(dev, 'ComfyUI', 'main.py')) ? dev
      : bundled;
  }
  return cfg;
}

const config = loadConfig();
const COMFY_DIR = config.comfyDir;

// Версия приложения (из package.json) и репозиторий релизов
const APP_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
})();
const RELEASES_REPO = (process.env.FACESWAP_RELEASES_REPO || 'RDSHATOP/faceswap-app').trim(); // "owner/repo"
const COMFY_PORT = config.comfyPort;
const COMFY_URL = (process.env.COMFY_URL || `http://127.0.0.1:${COMFY_PORT}`).replace(/\/+$/, '');
const COMFY_PY = path.join(COMFY_DIR, 'python_embeded', 'python.exe');
// user-directory ComfyUI (весь пользовательский контент ComfyUI — в папке данных)
const COMFY_USER_DIR = process.env.FACESWAP_COMFY_USER_DIR || path.join(ROOT, 'comfy-user');

for (const d of [RESULTS_DIR, UPLOADS_DIR, COMFY_USER_DIR]) fs.mkdirSync(d, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

// ---------- Утилиты ----------
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req, limit = 150 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Слишком большой запрос (лимит 150 МБ)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function serveFile(res, filePath) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      sendJson(res, 404, { error: 'Не найдено' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// dataURL -> {buffer, ext}
function decodeDataUrl(dataUrl) {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) throw new Error('Ожидалось изображение (PNG/JPEG/WebP в base64)');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  return { buffer: Buffer.from(m[2], 'base64'), ext };
}

// ---------- ComfyUI клиент ----------
async function comfyFetch(urlPath, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(COMFY_URL + urlPath, { ...options, signal: ctrl.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* не JSON */ }
    return { status: r.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function comfyOnline() {
  try {
    const r = await comfyFetch('/system_stats');
    const v = r.json && r.json.system && r.json.system.comfyui_version;
    return r.status === 200 ? (v || true) : false;
  } catch {
    return false;
  }
}

async function reactorInstalled() {
  try {
    const r = await comfyFetch('/object_info/ReActorFaceSwap');
    return !!(r.json && r.json.ReActorFaceSwap);
  } catch {
    return false;
  }
}

async function uploadToComfy(buffer, filename) {
  const form = new FormData();
  form.append('image', new Blob([buffer]), filename);
  form.append('overwrite', 'true');
  const r = await comfyFetch('/upload/image', { method: 'POST', body: form });
  if (r.status !== 200 || !r.json || !r.json.name) {
    throw new Error('ComfyUI не принял файл: ' + (r.text || r.status).slice(0, 300));
  }
  return r.json.name;
}

async function queueWorkflow(targetName, donorName) {
  const tpl = JSON.parse(fs.readFileSync(WORKFLOW_FILE, 'utf8'));
  const wf = JSON.parse(JSON.stringify(tpl));
  const seed = Math.floor(Math.random() * 281474976710655); // 48 бит, как в ComfyUI
  for (const node of Object.values(wf)) {
    const inputs = node.inputs || {};
    for (const key of Object.keys(inputs)) {
      if (inputs[key] === '__TARGET_IMG__') inputs[key] = targetName;
      if (inputs[key] === '__DONOR_IMG__') inputs[key] = donorName;
      if (inputs[key] === '__SEED__') inputs[key] = seed;
    }
  }
  const r = await comfyFetch('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: wf }),
  });
  if (r.status !== 200 || !r.json || !r.json.prompt_id) {
    let msg = 'ComfyUI отклонил задачу';
    if (r.json && r.json.error) {
      const e = r.json.error;
      msg = `${e.type || 'error'}: ${(e.message || '')}`;
      if (e.node_errors) {
        const details = Object.entries(e.node_errors)
          .map(([nid, ne]) => `узел ${nid}: ${(ne.class_type || '?')} — ${(ne.errors || []).map((x) => x.message).join('; ')}`)
          .join(' | ');
        if (details) msg += ' | ' + details.slice(0, 500);
      }
    } else if (r.text) {
      msg += ': ' + r.text.slice(0, 300);
    }
    const err = new Error(msg);
    err.stage = 'prompt';
    throw err;
  }
  return r.json.prompt_id;
}

async function waitResult(promptId, timeoutMs = 300000) {
  const start = Date.now();
  for (;;) {
    if (Date.now() - start > timeoutMs) throw new Error('Таймаут ожидания ComfyUI (5 мин)');
    const r = await comfyFetch('/history/' + promptId);
    if (r.status === 200 && r.json && r.json[promptId]) {
      const outputs = r.json[promptId].outputs || {};
      for (const out of Object.values(outputs)) {
        if (out.images && out.images.length) return out.images[0];
      }
      const status = r.json[promptId].status;
      if (status && status.status_str === 'error') {
        throw new Error('ComfyUI завершил задачу с ошибкой (см. comfyui.log)');
      }
      throw new Error('Задача завершена, но изображение не найдено в выводе');
    }
    await new Promise((s) => setTimeout(s, 1000));
  }
}

async function fetchImage(imageInfo) {
  const qs = `filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder || '')}&type=${encodeURIComponent(imageInfo.type || 'output')}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(`${COMFY_URL}/view?${qs}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error('Не удалось скачать результат из ComfyUI (' + r.status + ')');
    return Buffer.from(await r.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Фаза 2: установка ReActor и моделей по манифесту ----------
const MANIFEST_FILE = path.join(ROOT, 'models-manifest.json');
const setupJob = {
  state: 'idle', // idle | running | done | error
  phase: '',     // download | verify | node | done
  current: '',
  percent: 0,
  message: '',
  error: null,
  needsRestart: false,
  startedAt: null,
  finishedAt: null,
};

function loadManifest() {
  const m = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  // локальные дополнения (кастомные модели, тесты)
  try {
    const local = JSON.parse(fs.readFileSync(path.join(ROOT, 'models-manifest.local.json'), 'utf8'));
    if (Array.isArray(local.models)) m.models = (m.models || []).concat(local.models);
  } catch { /* файла нет — нормально */ }
  return m;
}

const splitPath = (p) => p.split(/[\\/]/).filter(Boolean);

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

async function downloadFile(url, dest, total, onProgress) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10 * 60 * 1000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok || !r.body) throw new Error('HTTP ' + r.status + ' при скачивании ' + url);
    const reader = r.body.getReader();
    const out = fs.createWriteStream(dest + '.part');
    let got = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out.write(Buffer.from(value));
        got += value.length;
        if (onProgress && total) onProgress(got / total);
      }
    } finally {
      out.end();
    }
    await new Promise((res, rej) => out.on('finish', res).on('error', rej));
    fs.renameSync(dest + '.part', dest);
    return got;
  } finally {
    clearTimeout(timer);
  }
}

function unzip(zipFile, destDir) {
  return new Promise((resolve, reject) => {
    const q = (s) => s.replace(/'/g, "''");
    const ps = `Expand-Archive -LiteralPath '${q(zipFile)}' -DestinationPath '${q(destDir)}' -Force`;
    const child = spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Expand-Archive exit ' + code + ': ' + err.slice(0, 200)))
    );
  });
}

function pipInstall(reqFile, cwd) {
  return new Promise((resolve, reject) => {
    setupJob.message = 'Устанавливаю зависимости ReActor (pip, может занять несколько минут)';
    const child = spawn(COMFY_PY, ['-m', 'pip', 'install', '-r', reqFile], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    child.stdout.on('data', (d) => { tail = (tail + d).slice(-400); });
    child.stderr.on('data', (d) => { tail = (tail + d).slice(-400); });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('pip install завершился с кодом ' + code + ': ' + tail.slice(0, 300)))
    );
  });
}

// ---------- Фаза 2.5: супервизия процесса ComfyUI ----------
// ComfyUI — управляемый дочерний процесс приложения:
//  - watchdog каждые 15 с: если ComfyUI был запущен приложением и пропал — переподнимаем;
//  - повторные падения подряд → экспоненциальная пауза до 5 мин, счётчик сбрасывается при успехе;
//  - при закрытии приложения ComfyUI завершается (можно оставить: KEEP_COMFY_ON_EXIT=1).
const comfySupervisor = {
  managed: false,      // ComfyUI запущен (или должен работать) под контролем приложения
  child: null,         // ссылка на процесс
  stopping: false,     // идёт осознанная остановка
  failures: 0,         // падения подряд
  nextRetryAt: 0,      // не переподнимать раньше этой метки
};

function startComfyProcess() {
  const child = spawn(COMFY_PY, [
    '-s', 'ComfyUI\\main.py',
    '--windows-standalone-build',
    '--port', String(COMFY_PORT),
    '--user-directory', COMFY_USER_DIR,
    '--disable-assets',
  ], {
    cwd: COMFY_DIR,
    detached: true,
    stdio: 'ignore',
  });
  comfySupervisor.managed = true;
  comfySupervisor.child = child;
  child.on('error', (err) => console.error('[comfy-start]', err.message));
  child.on('exit', (code) => {
    if (comfySupervisor.child !== child) return; // устаревший процесс
    comfySupervisor.child = null;
    if (comfySupervisor.stopping) return;
    comfySupervisor.failures++;
    const pause = Math.min(5000 * Math.pow(2, comfySupervisor.failures - 1), 5 * 60 * 1000);
    comfySupervisor.nextRetryAt = Date.now() + pause;
    console.log('[supervisor] ComfyUI завершился (код ' + code + '), перезапуск через ' + Math.round(pause / 1000) + ' с');
  });
  child.unref();
}

async function supervisorTick() {
  if (!comfySupervisor.managed || comfySupervisor.stopping) return;
  if (comfySupervisor.child) return; // процесс жив — он сам отслеживается через 'exit'
  if (Date.now() < comfySupervisor.nextRetryAt) return;
  if (await comfyOnline()) {
    // ComfyUI оказался жив (например, запущен вручную) — считаем управляемым
    comfySupervisor.failures = 0;
    return;
  }
  console.log('[supervisor] ComfyUI недоступен, переподнимаю (попытка ' + (comfySupervisor.failures + 1) + ')');
  try { startComfyProcess(); } catch (e) { console.error('[supervisor]', e.message); }
}
setInterval(supervisorTick, 15000).unref();

// Считаем запуск успешным, как только ComfyUI отвечает
setInterval(async () => {
  if (comfySupervisor.managed && !comfySupervisor.stopping && await comfyOnline()) {
    if (comfySupervisor.failures > 0) console.log('[supervisor] ComfyUI работает, счётчик падений сброшен');
    comfySupervisor.failures = 0;
  }
}, 30000).unref();

// Политика при закрытии приложения: по умолчанию ComfyUI завершается вместе с ним
function shutdownApp() {
  if (process.env.KEEP_COMFY_ON_EXIT === '1' || !comfySupervisor.child) process.exit(0);
  comfySupervisor.stopping = true;
  console.log('[supervisor] Завершаю ComfyUI вместе с приложением (KEEP_COMFY_ON_EXIT=1 чтобы оставить)');
  try { process.kill(comfySupervisor.child.pid); } catch { /* уже умер */ }
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdownApp);
process.on('SIGTERM', shutdownApp);

async function killOurComfy() {
  comfySupervisor.stopping = true; // осознанная остановка — не считаем падением
  await new Promise((resolve) => {
    const q = COMFY_USER_DIR.replace(/'/g, "''");
    const ps = `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*${q}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
    const c = spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
    c.on('exit', () => resolve());
  });
  // ждём освобождения порта (не дольше 20 сек)
  for (let i = 0; i < 20; i++) {
    if (!(await comfyOnline())) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  comfySupervisor.stopping = false;
}

async function runSetup() {
  if (setupJob.state === 'running') return;
  setupJob.state = 'running';
  setupJob.error = null;
  setupJob.percent = 0;
  setupJob.needsRestart = false;
  setupJob.startedAt = Date.now();
  const m = loadManifest();
  try {
    // 1. Модели: пропуск установленных, докачка битых, проверка SHA-256
    for (const model of m.models || []) {
      const dir = path.join(COMFY_DIR, ...splitPath(model.dir));
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, model.name);
      if (fs.existsSync(dest)) {
        setupJob.phase = 'verify';
        setupJob.current = model.name;
        setupJob.message = 'Проверяю ' + model.name;
        if ((await sha256File(dest)) === model.sha256) continue; // на месте и целая
        fs.rmSync(dest, { force: true }); // битая — перекачаем
      }
      setupJob.phase = 'download';
      setupJob.current = model.name;
      setupJob.percent = 0;
      setupJob.message = 'Скачиваю ' + model.name + ' (~' + Math.round((model.size || 0) / 1048576) + ' МБ)';
      await downloadFile(model.url, dest, model.size || 0, (p) => { setupJob.percent = Math.round(p * 100); });
      const h = await sha256File(dest);
      if (h !== model.sha256) throw new Error('SHA-256 не сошёлся для ' + model.name + ' (получен ' + h + ')');
    }
    // 2. Нода ReActor: zip -> custom_nodes -> pip requirements
    const rn = m.reactorNode;
    if (rn && !fs.existsSync(path.join(COMFY_DIR, ...splitPath(rn.marker)))) {
      setupJob.phase = 'node';
      setupJob.current = 'ComfyUI-ReActor';
      setupJob.message = 'Скачиваю ноду ReActor';
      const tmpZip = path.join(DATA_DIR, 'tmp-reactor.zip');
      const tmpDir = path.join(DATA_DIR, 'tmp-reactor-extract');
      fs.rmSync(tmpDir, { recursive: true, force: true });
      await downloadFile(rn.zipUrl, tmpZip, 0, null);
      await unzip(tmpZip, tmpDir);
      const target = path.join(COMFY_DIR, ...splitPath(rn.targetDir));
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(path.join(tmpDir, rn.innerDir), target);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(tmpZip, { force: true });
      const req = path.join(target, 'requirements.txt');
      if (rn.pipRequirements && fs.existsSync(req)) await pipInstall(req, target);
      setupJob.needsRestart = true;
    }
    setupJob.state = 'done';
    setupJob.phase = 'done';
    setupJob.percent = 100;
    setupJob.message = 'Установка завершена.';
    if (await comfyOnline()) {
      setupJob.needsRestart = !(await reactorInstalled());
    }
    if (setupJob.needsRestart) setupJob.message += ' Требуется перезапуск ComfyUI.';
  } catch (e) {
    setupJob.state = 'error';
    setupJob.error = e.message;
  } finally {
    setupJob.finishedAt = Date.now();
  }
}

// ---------- Фаза 3: проверка системы ----------
async function detectGpu() {
  // 1) nvidia-smi — точные данные, если драйвер отвечает
  try {
    const out = await runCmd('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader']);
    const line = out.trim().split('\n')[0];
    const m = line.match(/^(.*),\s*(\d+)\s*MiB/i);
    if (m) return { name: m[1].trim(), vramMb: parseInt(m[2], 10), source: 'nvidia-smi' };
  } catch { /* переходим к резервным вариантам */ }
  // 2) реестр Windows — точный объём VRAM (WMI AdapterRAM обрезается uint32)
  let vramBytes = null;
  try {
    const ps = "Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | Where-Object { $_.DriverDesc -match 'NVIDIA' } | Select-Object -First 1 -ExpandProperty 'HardwareInformation.qwMemorySize'";
    const out = await runCmd('powershell', ['-NoProfile', '-Command', ps]);
    const v = parseInt(out.trim(), 10);
    if (v > 0) vramBytes = v;
  } catch { /* нет реестра — не страшно */ }
  // 3) WMI — хотя бы имя карты
  try {
    const ps = "Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'NVIDIA' } | Select-Object -First 1 -ExpandProperty Name";
    const name = (await runCmd('powershell', ['-NoProfile', '-Command', ps])).trim();
    if (name) {
      return { name, vramMb: vramBytes ? Math.round(vramBytes / 1048576) : null, source: 'wmi+registry' };
    }
  } catch { /* нет видеокарты NVIDIA */ }
  return null;
}

async function systemCheck() {
  const gpu = await detectGpu();
  const totalRamGb = Math.round(os.totalmem() / 1073741824);
  let diskFreeGb = null;
  try {
    const drive = /^[A-Za-z]:/.test(COMFY_DIR) ? COMFY_DIR[0].toUpperCase() : 'C';
    const out = await runCmd('powershell', ['-NoProfile', '-Command',
      `Get-PSDrive -Name '${drive}' -ErrorAction SilentlyContinue | ForEach-Object { [math]::Round($_.Free / 1GB, 1) }`]);
    diskFreeGb = parseFloat(out.trim());
    if (isNaN(diskFreeGb)) diskFreeGb = null;
  } catch { /* размер диска не критичен */ }

  const vramGb = gpu && gpu.vramMb ? Math.round(gpu.vramMb / 1024) : null;
  const isFlux2 = fs.existsSync(path.join(COMFY_DIR, 'models', 'diffusion_models', 'flux-2-klein-9b-fp8.safetensors'));
  const diskNeed = isFlux2 ? 45 : 15;
  const checks = [
    { id: 'os', ok: true, label: 'Операционная система', detail: 'Windows ' + os.release() },
    {
      id: 'gpu', ok: !!gpu, label: 'Видеокарта NVIDIA',
      detail: gpu ? gpu.name : 'не найдена — приложение работает только с NVIDIA',
    },
    {
      id: 'vram', ok: !!gpu && (vramGb === null || vramGb >= 4),
      label: 'Видеопамять ≥ 4 ГБ',
      detail: gpu ? (vramGb === null ? 'объём определить не удалось' : vramGb + ' ГБ') : '—',
    },
    { id: 'ram', ok: totalRamGb >= 8, label: 'Оперативная память ≥ 8 ГБ', detail: totalRamGb + ' ГБ' },
    {
      id: 'disk', ok: diskFreeGb === null || diskFreeGb >= diskNeed,
      label: 'Свободное место ≥ ' + diskNeed + ' ГБ (диск ' + (/^[A-Za-z]:/.test(COMFY_DIR) ? COMFY_DIR.slice(0, 2) : 'C:') + ')',
      detail: diskFreeGb === null ? 'не удалось определить' : diskFreeGb + ' ГБ',
    },
  ];
  const failed = checks.filter((c) => !c.ok).map((c) => c.id);
  return {
    ok: failed.length === 0,
    failed,
    checks,
    gpu: gpu ? { name: gpu.name, vramGb, source: gpu.source } : null,
  };
}

// ---------- Маршруты ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    // API: статус
    if (p === '/api/status' && req.method === 'GET') {
      const version = await comfyOnline();
      const reactor = version ? await reactorInstalled() : false;
      sendJson(res, 200, {
        appVersion: APP_VERSION,
        comfy: { online: !!version, version: typeof version === 'string' ? version : null, url: COMFY_URL },
        reactor,
        comfyDir: COMFY_DIR,
        canStart: fs.existsSync(COMFY_PY),
        supervisor: {
          managed: comfySupervisor.managed,
          running: !!comfySupervisor.child,
          failures: comfySupervisor.failures,
        },
      });
      return;
    }

    // API: запустить ComfyUI
    if (p === '/api/start-comfyui' && req.method === 'POST') {
      if (await comfyOnline()) {
        sendJson(res, 200, { started: false, message: 'ComfyUI уже запущен' });
        return;
      }
      if (!fs.existsSync(COMFY_PY)) {
        sendJson(res, 404, { error: 'Не найден ComfyUI: ' + COMFY_DIR + ' (настройте comfyDir в config.json)' });
        return;
      }
      // Запускаем выделенный экземпляр ComfyUI: свой порт, свой user-directory,
      // assets отключены — ни блокировок БД, ни конфликтов с чужим ComfyUI.
      startComfyProcess();
      sendJson(res, 200, { started: true, message: 'Запускаю ComfyUI… подождите ~30 секунд' });
      return;
    }

    // API: проверка обновлений (GitHub Releases)
    if (p === '/api/update/check' && req.method === 'GET') {
      const result = { current: APP_VERSION, latest: null, updateAvailable: false, url: null, error: null };
      if (RELEASES_REPO) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 10000);
          const r = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
            headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'faceswap-app' },
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          if (r.status === 200) {
            const data = await r.json();
            const latest = String(data.tag_name || '').replace(/^v/, '');
            result.latest = latest || null;
            result.url = data.html_url || null;
            const parse = (v) => String(v || '').split('.').map((x) => parseInt(x, 10) || 0);
            const cur = parse(APP_VERSION), lat = parse(latest);
            for (let i = 0; i < Math.max(cur.length, lat.length); i++) {
              const a = cur[i] || 0, b = lat[i] || 0;
              if (b > a) { result.updateAvailable = true; break; }
              if (b < a) break;
            }
          } else if (r.status === 404) {
            result.error = 'релизы не найдены';
          } else {
            result.error = 'GitHub ответил ' + r.status;
          }
        } catch (e) {
          result.error = 'нет связи с GitHub';
        }
      } else {
        result.error = 'репозиторий релизов не настроен';
      }
      sendJson(res, 200, result);
      return;
    }

    // API: проверка системы (GPU, VRAM, RAM, диск)
    if (p === '/api/system/check' && req.method === 'GET') {
      sendJson(res, 200, await systemCheck());
      return;
    }

    // API: статус установки (ReActor + модели + состояние задачи)
    if (p === '/api/setup/status' && req.method === 'GET') {
      const m = loadManifest();
      const models = (m.models || []).map((mod) => {
        const dest = path.join(COMFY_DIR, ...splitPath(mod.dir), mod.name);
        return { name: mod.name, ok: fs.existsSync(dest) };
      });
      const reactorNode = m.reactorNode
        ? fs.existsSync(path.join(COMFY_DIR, ...splitPath(m.reactorNode.marker)))
        : true;
      sendJson(res, 200, {
        job: { ...setupJob },
        reactorNode,
        models,
      });
      return;
    }

    // API: запустить установку
    if (p === '/api/setup/install' && req.method === 'POST') {
      if (!fs.existsSync(COMFY_PY)) {
        sendJson(res, 404, { error: 'Не найден ComfyUI: ' + COMFY_DIR });
        return;
      }
      runSetup();
      sendJson(res, 200, { started: true, job: { ...setupJob } });
      return;
    }

    // API: перезапуск выделенного ComfyUI (нужен после установки ноды)
    if (p === '/api/restart-comfyui' && req.method === 'POST') {
      await killOurComfy();
      startComfyProcess();
      sendJson(res, 200, { ok: true, message: 'Перезапускаю ComfyUI…' });
      return;
    }

    // API: face swap
    if (p === '/api/swap' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const { target, donor } = body;
      const targetIndex = Math.max(0, parseInt(body.targetIndex ?? 0, 10) || 0);
      const donorIndex = Math.max(0, parseInt(body.donorIndex ?? 0, 10) || 0);
      if (!target || !donor) {
        sendJson(res, 400, { error: 'Нужны два изображения: целевое и фото донора' });
        return;
      }
      const t0 = Date.now();
      const t = decodeDataUrl(target);
      const d = decodeDataUrl(donor);
      const stamp = Date.now();
      const tLocal = path.join(UPLOADS_DIR, `target_${stamp}.${t.ext}`);
      const dLocal = path.join(UPLOADS_DIR, `donor_${stamp}.${d.ext}`);
      fs.writeFileSync(tLocal, t.buffer);
      fs.writeFileSync(dLocal, d.buffer);

      const targetName = await uploadToComfy(t.buffer, `faceswap_target_${stamp}.${t.ext}`);
      const donorName = await uploadToComfy(d.buffer, `faceswap_donor_${stamp}.${d.ext}`);

      const promptId = await queueWorkflow(targetName, donorName);
      const imageInfo = await waitResult(promptId, 15 * 60 * 1000); // Flux2: загрузка моделей + 15 шагов
      const imgBuffer = await fetchImage(imageInfo);

      const outName = `faceswap_${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}_${promptId.slice(0, 8)}.png`;
      fs.writeFileSync(path.join(RESULTS_DIR, outName), imgBuffer);

      sendJson(res, 200, {
        ok: true,
        filename: outName,
        url: '/results/' + encodeURIComponent(outName),
        dataUrl: 'data:image/png;base64,' + imgBuffer.toString('base64'),
        elapsedMs: Date.now() - t0,
      });
      return;
    }

    // API: история результатов
    if (p === '/api/results' && req.method === 'GET') {
      const files = fs.readdirSync(RESULTS_DIR)
        .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
        .map((f) => {
          const st = fs.statSync(path.join(RESULTS_DIR, f));
          return { name: f, mtime: st.mtimeMs, url: '/results/' + encodeURIComponent(f) };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 24);
      sendJson(res, 200, { results: files });
      return;
    }

    // Статика: результаты
    if (p.startsWith('/results/')) {
      const name = decodeURIComponent(p.slice('/results/'.length));
      const safe = path.basename(name);
      serveFile(res, path.join(RESULTS_DIR, safe));
      return;
    }

    // Статика: корень проекта (index.html, app.js, styles.css, шрифты)
    if (req.method === 'GET') {
      let rel = p === '/' ? '/index.html' : p;
      const filePath = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
      if (!filePath.startsWith(ROOT)) {
        sendJson(res, 403, { error: 'Запрещено' });
        return;
      }
      serveFile(res, filePath);
      return;
    }

    sendJson(res, 404, { error: 'Не найдено' });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error('[error]', msg);
    sendJson(res, 500, { error: msg, stage: err.stage || null });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`FaceSwap app: http://${HOST}:${PORT}`);
  console.log(`ComfyUI: ${COMFY_URL}`);
});
