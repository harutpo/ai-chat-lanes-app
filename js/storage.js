/* storage.js — 下書き(localStorage) と ファイル(File System Access API / フォールバック) の入出力。 */
window.Store = (function () {
  'use strict';

  const DRAFT_KEY = 'aichat:draft:v1';
  const PREF_KEY = 'aichat:prefs:v1';
  const hasFSA = typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';
  const JSON_TYPES = [{ description: 'AIチャットメモ (JSON)', accept: { 'application/json': ['.json'] } }];
  const MD_TYPES = [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }];
  // iPad / iPhone では共有シートの「"ファイル"に保存」で保存先フォルダ（Google ドライブなど）を選べる
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // ピッカーの id ごとにブラウザが最後のフォルダを覚える（開く・保存は同じフォルダを共有）
  const PICKER_ID = 'aichat-memo';
  const MD_PICKER_ID = 'aichat-memo-md';

  let handle = null; // 現在開いているファイルのハンドル（FSA のみ）

  // ---------- 下書き・設定 ----------
  function saveDraft(project, fileName, dirty) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ fileName: fileName || null, dirty: !!dirty, savedAt: Date.now(), project: project }));
      return true;
    } catch (e) { console.warn('下書きの保存に失敗', e); return false; }
  }
  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || !d.project) return null;
      return d;
    } catch (e) { return null; }
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function savePrefs(patch) {
    try {
      const cur = loadPrefs();
      localStorage.setItem(PREF_KEY, JSON.stringify(Object.assign(cur, patch)));
    } catch (e) { /* ignore */ }
  }

  // ---------- 共通 ----------
  function isAbort(e) { return !!(e && e.name === 'AbortError'); }
  function hasHandle() { return !!handle; }
  function resetHandle() { handle = null; }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }

  /** FSA が無いときの書き出し。iOS は共有シート、それ以外はダウンロード。キャンセル時は null。 */
  async function exportFallback(name, text, mime) {
    if (isIOS && typeof navigator.share === 'function' && typeof File === 'function') {
      const file = new File([text], name, { type: mime });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); }
        catch (e) { if (isAbort(e)) return null; throw e; }
        return { name: name, shared: true };
      }
    }
    download(name, text, mime);
    return { name: name, downloaded: true };
  }

  function pickFileFallback() {
    return new Promise(function (resolve) {
      const input = document.getElementById('file-input');
      input.value = '';
      function done() {
        input.removeEventListener('change', done);
        input.removeEventListener('cancel', done);
        resolve((input.files && input.files[0]) || null);
      }
      input.addEventListener('change', done);
      input.addEventListener('cancel', done);
      input.click();
    });
  }

  /** 開いているファイルがあればそのフォルダから、なければ前回のフォルダから始める。 */
  function pickerOpts(types) {
    const o = { types: types, id: PICKER_ID };
    if (handle) o.startIn = handle;
    return o;
  }

  async function writeHandle(h, text) {
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
  }

  // ---------- 開く / 保存 ----------
  /** @returns {Promise<{project, name}|null>} キャンセル時は null */
  async function openFile() {
    if (hasFSA) {
      let picked;
      try { picked = await window.showOpenFilePicker(Object.assign(pickerOpts(JSON_TYPES), { multiple: false })); }
      catch (e) { if (isAbort(e)) return null; throw e; }
      const h = picked[0];
      const file = await h.getFile();
      const project = Model.deserialize(await file.text());
      handle = h;
      return { project: project, name: file.name };
    }
    const file = await pickFileFallback();
    if (!file) return null;
    const project = Model.deserialize(await file.text());
    handle = null;
    return { project: project, name: file.name };
  }

  /** 開いているファイルがあれば上書き、なければ「名前を付けて保存」。 */
  async function saveFile(project, suggestedName) {
    if (hasFSA && handle) {
      await writeHandle(handle, Model.serialize(project));
      return { name: handle.name };
    }
    return saveAs(project, suggestedName);
  }

  async function saveAs(project, suggestedName) {
    const text = Model.serialize(project);
    const name = suggestedName || Model.safeFileName(project.title, '.aichat.json');
    if (hasFSA) {
      let h;
      try { h = await window.showSaveFilePicker(Object.assign(pickerOpts(JSON_TYPES), { suggestedName: name })); }
      catch (e) { if (isAbort(e)) return null; throw e; }
      await writeHandle(h, text);
      handle = h;
      return { name: h.name };
    }
    return exportFallback(name, text, 'application/json');
  }

  async function exportMarkdown(project) {
    const text = Model.toMarkdown(project);
    const name = Model.safeFileName(project.title, '.md');
    if (hasFSA) {
      let h;
      try { h = await window.showSaveFilePicker({ suggestedName: name, types: MD_TYPES, id: MD_PICKER_ID }); }
      catch (e) { if (isAbort(e)) return null; throw e; }
      await writeHandle(h, text);
      return { name: h.name };
    }
    return exportFallback(name, text, 'text/markdown');
  }

  return {
    hasFSA: hasFSA,
    saveDraft: saveDraft, loadDraft: loadDraft, clearDraft: clearDraft,
    loadPrefs: loadPrefs, savePrefs: savePrefs,
    openFile: openFile, saveFile: saveFile, saveAs: saveAs, exportMarkdown: exportMarkdown,
    hasHandle: hasHandle, resetHandle: resetHandle, download: download,
  };
})();
