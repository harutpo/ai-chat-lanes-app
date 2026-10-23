/* app.js — 起動・ヘッダー操作・ショートカット・保存状態(dirty)の管理。 */
(function () {
  'use strict';

  const App = { project: null, fileName: null, dirty: false };
  let draftTimer = null;

  function $(sel) { return document.querySelector(sel); }

  function renderHeader() { View.renderHeader(App.fileName, App.dirty, Store.hasHandle()); }

  function setProject(p, name, dirty) {
    App.project = p;
    App.fileName = name || null;
    App.dirty = !!dirty;
    View.resetUi();
    View.setProject(p);
    renderHeader();
    View.renderAll();
  }

  /** View からの変更通知。structural=true ならボード全体を再描画。 */
  function commit(structural) {
    App.dirty = true;
    Model.touch(App.project);
    scheduleDraft();
    renderHeader();
    if (structural) View.renderAll(); else View.renderSidebar();
  }

  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(flushDraft, 500);
  }
  function flushDraft() {
    clearTimeout(draftTimer);
    draftTimer = null;
    if (App.project) Store.saveDraft(App.project, App.fileName, App.dirty);
  }

  function confirmDiscard() {
    if (!App.dirty) return true;
    return confirm('保存していない変更があります。破棄して続けますか？');
  }

  // ---------- ファイル操作 ----------
  function newProject() {
    if (!confirmDiscard()) return;
    Store.resetHandle();
    setProject(Model.createProject(), null, false);
    flushDraft();
    View.toast('新しいプロジェクトを作りました');
    $('#title').focus();
    $('#title').select();
  }

  async function openFile() {
    if (!confirmDiscard()) return;
    try {
      const r = await Store.openFile();
      if (!r) return;
      setProject(r.project, r.name, false);
      flushDraft();
      View.toast(r.name + ' を開きました');
    } catch (e) {
      console.error(e);
      alert('開けませんでした: ' + (e && e.message ? e.message : e));
    }
  }

  async function save(saveAs) {
    try {
      const r = saveAs
        ? await Store.saveAs(App.project, App.fileName || undefined)
        : await Store.saveFile(App.project, App.fileName || undefined);
      if (!r) return; // キャンセル
      App.dirty = false;
      App.fileName = r.name;
      flushDraft();
      renderHeader();
      View.toast(r.shared ? r.name + ' を書き出しました' : r.downloaded ? r.name + ' をダウンロードしました' : r.name + ' に保存しました');
    } catch (e) {
      console.error(e);
      alert('保存できませんでした: ' + (e && e.message ? e.message : e));
    }
  }

  async function exportMd() {
    try {
      const r = await Store.exportMarkdown(App.project);
      if (r) View.toast(r.downloaded ? r.name + ' をダウンロードしました' : r.name + ' を書き出しました');
    } catch (e) {
      console.error(e);
      alert('書き出せませんでした: ' + (e && e.message ? e.message : e));
    }
  }

  // ---------- ヘッダー ----------
  function toggleSidebar() {
    const hidden = document.body.classList.toggle('sidebar-hidden');
    Store.savePrefs({ sidebarHidden: hidden });
    View.scheduleLayout();
  }

  function bindHeader() {
    $('#btn-new').addEventListener('click', newProject);
    $('#btn-open').addEventListener('click', openFile);
    $('#btn-save').addEventListener('click', function () { save(false); });
    $('#btn-saveas').addEventListener('click', function () { save(true); });
    $('#btn-export-md').addEventListener('click', exportMd);
    $('#btn-sidebar').addEventListener('click', toggleSidebar);

    const title = $('#title');
    title.addEventListener('input', function () {
      App.project.title = title.value;
      commit(false);
    });
    title.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
    title.addEventListener('blur', function () {
      if (!App.project.title.trim()) { App.project.title = Model.DEFAULT_TITLE; renderHeader(); flushDraft(); }
    });

    const ns = $('#northstar');
    ns.addEventListener('input', function () {
      App.project.northStar = ns.value;
      View.autosize(ns, 30);
      commit(false);
    });
    ns.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ns.blur(); }
    });
  }

  /** 文字列(JSON)からプロジェクトを開く。ドラッグ＆ドロップと外部からの読み込みに使う。 */
  function loadFromText(text, name) {
    const project = Model.deserialize(text);
    Store.resetHandle();
    setProject(project, name || null, false);
    flushDraft();
    View.toast((name || 'ファイル') + ' を開きました' + (Store.hasFSA ? '（上書き保存は Ctrl+S で保存先を指定）' : ''));
  }

  function bindDragDrop() {
    document.addEventListener('dragover', function (e) {
      if (e.dataTransfer && Array.prototype.some.call(e.dataTransfer.types || [], function (t) { return t === 'Files'; })) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    document.addEventListener('drop', async function (e) {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      if (e.target && e.target.closest && e.target.closest('textarea, input')) return; // テキスト入力への通常ドロップは邪魔しない
      e.preventDefault();
      if (!/\.json$/i.test(file.name)) { View.toast('.aichat.json / .json ファイルをドロップしてください'); return; }
      if (!confirmDiscard()) return;
      try { loadFromText(await file.text(), file.name); }
      catch (err) { alert('開けませんでした: ' + (err && err.message ? err.message : err)); }
    });
  }

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); save(e.shiftKey); }
      else if (k === 'o') { e.preventDefault(); openFile(); }
    });
  }

  // ---------- 起動 ----------
  function init() {
    const prefs = Store.loadPrefs();
    if (prefs.sidebarHidden) document.body.classList.add('sidebar-hidden');

    View.init({ commit: commit });

    const draft = Store.loadDraft();
    let restored = false;
    if (draft) {
      try {
        setProject(Model.normalize(draft.project), draft.fileName, !!draft.dirty);
        restored = true;
      } catch (e) {
        console.warn('下書きを復元できませんでした', e);
      }
    }
    if (!restored) {
      // 初回（下書きなし）はチュートリアルの保存例を開く
      setProject(window.Tutorial ? Tutorial.build() : Model.createProject(), null, false);
      flushDraft();
      if (window.Tutorial) View.toast('チュートリアルの保存例を開きました。「新規」で自分のプロジェクトを始められます', 5000);
    }

    bindHeader();
    bindKeys();
    bindDragDrop();

    window.addEventListener('beforeunload', function (e) {
      flushDraft();
      if (App.dirty && App.fileName) { e.preventDefault(); e.returnValue = ''; }
    });
    // iPad の Safari は beforeunload が来ないことが多いので、裏に回ったときにも下書きを書く
    window.addEventListener('pagehide', flushDraft);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushDraft(); });

    if (restored && draft.fileName) {
      View.toast('下書きを復元しました（' + draft.fileName + '）。Ctrl+S でファイルに保存できます', 4000);
    }
    if (!Store.hasFSA) console.info('File System Access API が使えないため、保存はダウンロードになります');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  App.loadFromText = loadFromText;
  App.save = save;
  window.App = App;
})();
