// FaceSwap app — логика интерфейса
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const els = {
    statusDot: $('statusDot'),
    statusText: $('statusText'),
    reactorWarning: $('reactorWarning'),
    comfyOffline: $('comfyOffline'),
    comfyUrl: $('comfyUrl'),
    startComfyBtn: $('startComfyBtn'),
    startComfyMsg: $('startComfyMsg'),
    slotTarget: $('slotTarget'),
    slotDonor: $('slotDonor'),
    fileTarget: $('fileTarget'),
    fileDonor: $('fileDonor'),
    targetIndex: $('targetIndex'),
    donorIndex: $('donorIndex'),
    swapBtn: $('swapBtn'),
    progress: $('progress'),
    progressText: $('progressText'),
    errorBox: $('errorBox'),
    resultEmpty: $('resultEmpty'),
    resultImage: $('resultImage'),
    resultImg: $('resultImg'),
    downloadBtn: $('downloadBtn'),
    againBtn: $('againBtn'),
    resultMeta: $('resultMeta'),
    history: $('history'),
    installBtn: $('installBtn'),
    setupProgress: $('setupProgress'),
    setupFill: $('setupFill'),
    setupText: $('setupText'),
    restartBtn: $('restartBtn'),
    setupNote: $('setupNote'),
    syscheck: $('syscheck'),
    checkList: $('checkList'),
    checkHint: $('checkHint'),
  };

  // ---------- Проверка системы (фаза 3) ----------
  async function loadSystemCheck() {
    try {
      const r = await fetch('/api/system/check');
      const s = await r.json();
      if (s.ok) {
        els.syscheck.hidden = true;
        return;
      }
      els.syscheck.hidden = false;
      els.checkList.innerHTML = '';
      for (const c of s.checks) {
        const li = document.createElement('li');
        li.className = 'check-item ' + (c.ok ? 'ok' : 'fail');
        const mark = document.createElement('span');
        mark.className = 'mark';
        mark.textContent = c.ok ? '✓' : '✕';
        const label = document.createElement('span');
        label.textContent = c.label;
        const detail = document.createElement('span');
        detail.className = 'detail';
        detail.textContent = '— ' + c.detail;
        li.appendChild(mark);
        li.appendChild(label);
        li.appendChild(detail);
        els.checkList.appendChild(li);
      }
      const hints = [];
      if (s.failed.includes('gpu') || s.failed.includes('vram')) {
        hints.push('Видеокарта NVIDIA с 4+ ГБ VRAM обязательна: автоматическая установка компонентов без неё не поможет.');
      }
      if (s.failed.includes('ram')) {
        hints.push('Мало оперативной памяти — закройте лишние программы перед свапом.');
      }
      if (s.failed.includes('disk')) {
        hints.push('Освободите место на диске или смените comfyDir в config.json на диск со свободными 15+ ГБ.');
      }
      els.checkHint.innerHTML = hints.join('<br>');
    } catch { /* диагностика не критична */ }
  }

  let setupTimer = null;

  async function pollSetup() {
    try {
      const r = await fetch('/api/setup/status');
      const s = await r.json();
      renderSetup(s.job);
      if (s.job && s.job.state === 'running') return;
      clearInterval(setupTimer);
      setupTimer = null;
      if (s.job && s.job.state === 'done') {
        if (s.job.needsRestart) {
          els.restartBtn.hidden = false;
          els.setupNote.textContent = 'Нода установлена. Перезапустите ComfyUI, чтобы она загрузилась.';
        } else {
          els.setupNote.textContent = 'Готово — можно делать swap.';
          refreshStatus();
          loadSystemCheck();
        }
      }
    } catch { /* polling не критичен */ }
  }

  function renderSetup(job) {
    if (!job || job.state === 'idle') {
      els.setupProgress.hidden = true;
      return;
    }
    els.installBtn.hidden = true;
    els.setupProgress.hidden = false;
    if (job.state === 'running') {
      els.setupFill.style.width = (job.percent || 0) + '%';
      els.setupText.textContent = (job.message || 'Работаю…') + (job.percent ? ' — ' + job.percent + '%' : '');
    } else if (job.state === 'error') {
      els.setupFill.style.width = '0%';
      els.setupText.textContent = 'Ошибка: ' + (job.error || 'неизвестная');
      els.installBtn.hidden = false;
      els.installBtn.textContent = 'Повторить установку';
    }
  }

  els.installBtn.addEventListener('click', async () => {
    els.setupNote.textContent = '';
    try {
      await fetch('/api/setup/install', { method: 'POST' });
      if (!setupTimer) setupTimer = setInterval(pollSetup, 1500);
      pollSetup();
    } catch (err) {
      els.setupNote.textContent = 'Не удалось начать установку: ' + err.message;
    }
  });

  els.restartBtn.addEventListener('click', async () => {
    els.restartBtn.disabled = true;
    try {
      await fetch('/api/restart-comfyui', { method: 'POST' });
      els.setupNote.textContent = 'Перезапускаю… подождите ~15 секунд';
      let tries = 0;
      const t = setInterval(async () => {
        tries++;
        await refreshStatus();
        if (state.reactor || tries > 12) {
          clearInterval(t);
          els.restartBtn.disabled = false;
          els.setupNote.textContent = state.reactor ? 'ReActor загружен — можно делать swap.' : 'ReActor всё ещё не виден, смотрите comfyui.log';
        }
      }, 4000);
    } catch (err) {
      els.restartBtn.disabled = false;
      els.setupNote.textContent = 'Ошибка перезапуска: ' + err.message;
    }
  });

  const state = {
    target: null, // {dataUrl, name}
    donor: null,
    reactor: false,
    comfyOnline: false,
    busy: false,
  };

  // ---------- Статус ComfyUI ----------
  async function refreshStatus() {
    try {
      const r = await fetch('/api/status');
      const s = await r.json();
      state.comfyOnline = !!(s.comfy && s.comfy.online);
      state.reactor = !!s.reactor;

      els.comfyUrl.textContent = (s.comfy && s.comfy.url || '127.0.0.1:8199').replace(/^https?:\/\//, '');

      if (!state.comfyOnline) {
        els.statusDot.className = 'status-dot offline';
        els.statusText.textContent = 'ComfyUI офлайн';
        els.comfyOffline.hidden = false;
        els.reactorWarning.hidden = true;
      } else {
        els.comfyOffline.hidden = true;
        els.startComfyMsg.textContent = '';
        if (state.reactor) {
          els.statusDot.className = 'status-dot online';
          els.statusText.textContent = 'ComfyUI ' + (s.comfy.version || '') + ' · ReActor готов';
          els.reactorWarning.hidden = true;
        } else {
          els.statusDot.className = 'status-dot offline';
          els.statusText.textContent = 'ComfyUI ' + (s.comfy.version || '') + ' · нет ReActor';
          els.reactorWarning.hidden = false;
        }
      }
      updateSwapButton();
    } catch {
      els.statusDot.className = 'status-dot offline';
      els.statusText.textContent = 'Сервер приложения недоступен';
    }
  }

  function updateSwapButton() {
    els.swapBtn.disabled = state.busy || !state.target || !state.donor || !state.comfyOnline || !state.reactor;
  }

  // ---------- Слоты загрузки ----------
  function setupSlot(slot, fileInput, key) {
    const empty = slot.querySelector('.slot-empty');
    const filled = slot.querySelector('.slot-filled');
    const img = filled.querySelector('img');
    const remove = filled.querySelector('.slot-remove');

    function setFile(file) {
      if (!file) return;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        showError('Нужен файл PNG, JPEG или WebP');
        return;
      }
      if (file.size > 30 * 1024 * 1024) {
        showError('Файл больше 30 МБ — уменьшите фото');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        state[key] = { dataUrl: reader.result, name: file.name };
        img.src = reader.result;
        empty.hidden = true;
        filled.hidden = false;
        hideError();
        updateSwapButton();
      };
      reader.readAsDataURL(file);
    }

    slot.addEventListener('click', (e) => {
      if (e.target === remove || remove.contains(e.target)) return;
      fileInput.click();
    });
    slot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener('change', () => setFile(fileInput.files[0]));

    ['dragenter', 'dragover'].forEach((ev) =>
      slot.addEventListener(ev, (e) => { e.preventDefault(); slot.classList.add('dragover'); })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      slot.addEventListener(ev, (e) => { e.preventDefault(); slot.classList.remove('dragover'); })
    );
    slot.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      setFile(file);
    });

    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      state[key] = null;
      fileInput.value = '';
      img.removeAttribute('src');
      empty.hidden = false;
      filled.hidden = true;
      updateSwapButton();
    });
  }

  setupSlot(els.slotTarget, els.fileTarget, 'target');
  setupSlot(els.slotDonor, els.fileDonor, 'donor');

  // ---------- Ошибки и прогресс ----------
  function showError(msg) {
    els.errorBox.textContent = msg;
    els.errorBox.hidden = false;
  }
  function hideError() {
    els.errorBox.hidden = true;
    els.errorBox.textContent = '';
  }
  function setProgress(on, text) {
    els.progress.hidden = !on;
    if (text) els.progressText.textContent = text;
  }

  // ---------- Swap ----------
  els.swapBtn.addEventListener('click', async () => {
    if (state.busy || !state.target || !state.donor) return;
    state.busy = true;
    hideError();
    updateSwapButton();
    setProgress(true, 'Отправляю фото в ComfyUI…');

    try {
      const r = await fetch('/api/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: state.target.dataUrl,
          donor: state.donor.dataUrl,
          targetIndex: parseInt(els.targetIndex.value, 10) || 0,
          donorIndex: parseInt(els.donorIndex.value, 10) || 0,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        throw new Error(data.error || ('Ошибка сервера: ' + r.status));
      }
      showResult(data);
      loadHistory();
    } catch (err) {
      showError('Не получилось: ' + (err && err.message ? err.message : err));
    } finally {
      state.busy = false;
      setProgress(false);
      updateSwapButton();
    }
  });

  function showResult(data) {
    els.resultEmpty.hidden = true;
    els.resultImage.hidden = false;
    els.resultImg.src = data.url;
    els.downloadBtn.href = data.url;
    els.downloadBtn.setAttribute('download', data.filename);
    const sec = (data.elapsedMs / 1000).toFixed(1);
    els.resultMeta.textContent = 'Готово за ' + sec + ' с · ' + data.filename;
  }

  els.againBtn.addEventListener('click', () => {
    els.resultImage.hidden = true;
    els.resultEmpty.hidden = false;
  });

  // ---------- Запуск ComfyUI ----------
  els.startComfyBtn.addEventListener('click', async () => {
    els.startComfyBtn.disabled = true;
    els.startComfyMsg.textContent = 'Запускаю…';
    try {
      const r = await fetch('/api/start-comfyui', { method: 'POST' });
      const data = await r.json();
      els.startComfyMsg.textContent = data.message || '';
      let tries = 0;
      const timer = setInterval(async () => {
        tries++;
        await refreshStatus();
        if (state.comfyOnline || tries > 20) clearInterval(timer);
      }, 3000);
    } catch (err) {
      els.startComfyMsg.textContent = 'Не удалось запустить: ' + err.message;
    } finally {
      els.startComfyBtn.disabled = false;
    }
  });

  // ---------- История ----------
  async function loadHistory() {
    try {
      const r = await fetch('/api/results');
      const data = await r.json();
      els.history.innerHTML = '';
      if (!data.results || !data.results.length) {
        const div = document.createElement('div');
        div.className = 'history-empty';
        div.textContent = 'Пока пусто';
        els.history.appendChild(div);
        return;
      }
      for (const item of data.results) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'history-item';
        btn.title = item.name;
        const img = document.createElement('img');
        img.src = item.url;
        img.alt = item.name;
        btn.appendChild(img);
        btn.addEventListener('click', () => {
          els.resultEmpty.hidden = true;
          els.resultImage.hidden = false;
          els.resultImg.src = item.url;
          els.downloadBtn.href = item.url;
          els.downloadBtn.setAttribute('download', item.name);
          els.resultMeta.textContent = item.name;
          els.resultImage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        els.history.appendChild(btn);
      }
    } catch { /* история не критична */ }
  }

  // ---------- Старт ----------
  refreshStatus();
  loadHistory();
  loadSystemCheck();
  setInterval(refreshStatus, 8000);
  setInterval(loadSystemCheck, 60000);
})();
