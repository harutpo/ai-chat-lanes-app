/* render.js — DOM 描画とボード上の操作。
 * 状態の変更は必ず Model を通し、変更後に handlers.commit(structural) を呼ぶ。
 *   structural=true  : レーン/メッセージ/付箋の構造が変わった → ボード全体を再描画
 *   structural=false : テキストだけ変わった → サイドバーのみ更新（入力中のフォーカスを壊さない）
 */
window.View = (function () {
  'use strict';

  let project = null;
  let handlers = { commit: function () {} };
  const ui = {
    expanded: new Set(),  // 「もっと見る」で展開済みのメッセージ ID
    editingId: null,      // 編集中のメッセージ ID
    composer: {},         // laneId -> { role, text }
    focusTarget: null,    // 再描画後にフォーカスする CSS セレクタ
    revealLane: null,     // 再描画後に画面内へスクロールするレーン ID
    search: '',
    tab: 'outline',
    marker: false,        // マーカーモード中か
    markerColor: 'yellow',
  };
  const els = {};
  let layoutQueued = false;
  let resizeObserver = null;
  let toastTimer = null;
  const CLAMP_PX = 500;
  const LANE_W = 520;       // css の --lane-w と揃える
  const MSG_MIN_W = 200;
  const MSG_MAX_W = 1600;
  const BODY_MIN_H = 40;
  let resizing = null;      // 吹き出しのサイズ変更ドラッグ中の状態
  let panning = null;       // ボードのドラッグ移動中の状態
  let stickyDrag = null;    // 付箋のドラッグ移動中の状態
  let penMark = null;       // ペンでマーカーを引いている途中の状態
  let penUpAt = 0;          // 最後にペンを離した時刻
  const DRAG_THRESHOLD = 4; // これ未満の動きはクリック扱い

  // ---------- 小さなヘルパー ----------
  function $(sel, root) { return (root || document).querySelector(sel); }

  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function (prop) { el.style.setProperty(prop, v[prop]); });
        }
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      });
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x != null && x !== false) el.append(x instanceof Node ? x : document.createTextNode(String(x))); });
      else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function autosize(ta, min) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(min || 0, ta.scrollHeight) + 'px';
  }
  function roleLabel(role) { return role === 'ai' ? 'AI' : '自分'; }
  function composerPlaceholder(role) {
    return role === 'ai' ? 'AI の返答をここに貼り付け…（Markdown はそのまま描画されます）' : '自分のプロンプトをここに貼り付け…';
  }
  function composerState(laneId) {
    if (!ui.composer[laneId]) ui.composer[laneId] = { role: Model.nextRole(project, laneId), text: '' };
    return ui.composer[laneId];
  }
  function debounce(fn, ms) {
    let t = null;
    return function () { clearTimeout(t); const args = arguments; t = setTimeout(function () { fn.apply(null, args); }, ms); };
  }
  function flash(el) {
    el.classList.remove('flash');
    void el.offsetWidth; // アニメーションを再始動させる
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1300);
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('コピーしました');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.append(ta);
      ta.select();
      try { document.execCommand('copy'); toast('コピーしました'); } catch (e2) { toast('コピーに失敗しました'); }
      ta.remove();
    }
  }
  function countLaneTree(laneId) {
    let lanes = 1;
    let messages = 0;
    Model.messagesOf(project, laneId).forEach(function (m) {
      messages++;
      Model.childLanesOf(project, m.id).forEach(function (child) {
        const c = countLaneTree(child.id);
        lanes += c.lanes;
        messages += c.messages;
      });
    });
    return { lanes: lanes, messages: messages };
  }

  // ---------- 初期化 ----------
  function init(hs) {
    handlers = Object.assign(handlers, hs || {});
    els.board = $('#board');
    els.boardWrap = $('#board-wrap');
    els.svg = $('#connectors');
    els.stickyLinks = $('#sticky-links');
    els.stickyLayer = $('#sticky-layer');
    els.markerBtn = $('#btn-marker');
    els.markerColors = $('#marker-colors');
    els.outline = $('#outline');
    els.meter = $('#axis-meter');
    els.todoList = $('#todo-list');
    els.todoBadge = $('#todo-badge');
    els.search = $('#search');
    els.searchResults = $('#search-results');
    els.title = $('#title');
    els.northstar = $('#northstar');
    els.fileName = $('#file-name');
    els.dirty = $('#dirty-mark');
    els.toast = $('#toast');

    bindBoardEvents();
    bindSidebarEvents();
    bindMarkerEvents();
    resizeObserver = new ResizeObserver(function () { scheduleLayout(); });
    resizeObserver.observe(els.board);
    window.addEventListener('resize', scheduleLayout);
  }

  function setProject(p) { project = p; }

  function resetUi() {
    ui.expanded.clear();
    ui.editingId = null;
    ui.composer = {};
    ui.focusTarget = null;
    ui.revealLane = null;
  }

  // ---------- 描画 ----------
  function renderAll() {
    if (!project) return;
    const sl = els.boardWrap.scrollLeft;
    const st = els.boardWrap.scrollTop;
    renderBoard();
    renderSidebar();
    els.boardWrap.scrollLeft = sl;
    els.boardWrap.scrollTop = st;
    applyFocus();
    scheduleLayout();
  }

  function renderBoard() {
    els.board.querySelectorAll('.lane').forEach(function (l) { l.remove(); });
    const frag = document.createDocumentFragment();
    Model.orderedLanes(project).forEach(function (lane) { frag.append(renderLane(lane)); });
    els.board.append(frag);

    // 動かした付箋はレーンの外の層に置く（他のレーンの上にも重ねられるように）。位置は layoutLanes で決める
    const free = [];
    Object.keys(project.messages).forEach(function (id) {
      const m = project.messages[id];
      (m.stickies || []).forEach(function (s, i) { if (s.pos) free.push(renderSticky(m, s, i)); });
    });
    els.stickyLayer.replaceChildren.apply(els.stickyLayer, free);

    resizeObserver.disconnect();
    resizeObserver.observe(els.board);
    els.board.querySelectorAll('.lane').forEach(function (l) { resizeObserver.observe(l); });

    // 長い本文は折りたたむ
    els.board.querySelectorAll('.msg-body[data-clampable]').forEach(function (body) {
      if (body.scrollHeight > CLAMP_PX) {
        body.classList.add('clamped');
        const more = body.nextElementSibling;
        if (more && more.classList.contains('msg-more')) more.hidden = false;
      }
    });
    els.board.querySelectorAll('textarea.sticky-text').forEach(function (ta) { autosize(ta, 26); });
    els.board.querySelectorAll('textarea.composer-text').forEach(function (ta) { autosize(ta, 76); });
    els.board.querySelectorAll('textarea.edit-text').forEach(function (ta) { autosize(ta, 120); });
  }

  function renderLane(lane) {
    const color = Model.laneColor(lane);
    const isRoot = lane.id === Model.ROOT_ID;
    const msgs = Model.messagesOf(project, lane.id);
    const parent = Model.parentOfLane(project, lane.id);
    // 手動で広げた吹き出しが収まるようにレーン幅を広げる
    const widest = msgs.reduce(function (w, m) { return Math.max(w, (m.size && m.size.w) || 0); }, LANE_W);
    const laneStyle = { '--axis-color': color };
    if (widest > LANE_W) laneStyle['--lane-w'] = widest + 'px';
    const laneEl = h('div', {
      class: 'lane' + (lane.collapsed ? ' collapsed' : ''),
      id: 'lane-' + lane.id,
      dataset: { lane: lane.id },
      style: laneStyle,
    });

    const header = h('div', { class: 'lane-header' });
    if (lane.collapsed) {
      header.append(
        h('button', { class: 'lane-expand', title: '展開する', type: 'button', text: '▸' }),
        h('span', { class: 'lane-title-v', text: lane.title || '(無題)' }),
        h('span', { class: 'lane-count', text: msgs.length + '件' })
      );
    } else {
      header.append(
        h('button', { class: 'lane-collapse', title: '折りたたむ', type: 'button', text: '▾' }),
        h('input', { class: 'lane-title', type: 'text', value: lane.title, placeholder: isRoot ? '本流' : '分岐名', spellcheck: 'false', title: 'レーン名（クリックで編集）' })
      );
      if (!isRoot) {
        const sel = h('select', { class: 'lane-axis', title: 'この分岐の軸（野心の4軸: Speed / Altitude / Depth / Range）' });
        sel.append(h('option', { value: '', text: '軸: 未分類' }));
        Model.AXIS_KEYS.forEach(function (k) {
          const a = Model.AXES[k];
          sel.append(h('option', { value: k, text: a.label + '・' + a.ja, title: a.desc }));
        });
        sel.value = lane.axis || '';
        header.append(sel);
      }
      header.append(h('span', { class: 'lane-count', text: msgs.length + '件' }));
      if (parent) {
        header.append(h('button', {
          class: 'lane-parent', type: 'button', title: '分岐元のメッセージへ移動',
          dataset: { target: parent.message.id },
          text: '← ' + (parent.lane ? parent.lane.title : '') + ' #' + parent.index,
        }));
      }
      if (!isRoot) header.append(h('button', { class: 'lane-delete', title: 'この分岐を削除', type: 'button', text: '🗑' }));
    }
    laneEl.append(header);

    if (!lane.collapsed) {
      const body = h('div', { class: 'lane-body' });
      if (!msgs.length) {
        body.append(h('div', {
          class: 'lane-empty',
          text: isRoot
            ? '下の入力欄に、自分のプロンプトや AI の返答を貼り付けて「追加」してください'
            : 'この分岐はまだ空です。分岐元の文脈を踏まえた質問と返答を貼り付けましょう',
        }));
      }
      msgs.forEach(function (m, i) { body.append(renderMessage(m, i + 1)); });
      laneEl.append(body, renderComposer(lane));
    }
    return laneEl;
  }

  function renderMessage(m, index) {
    const row = h('div', { class: 'msg-row ' + m.role, dataset: { msg: m.id } });
    const size = m.size || {};
    const msgEl = h('div', {
      class: 'msg ' + m.role + (size.w ? ' sized-w' : ''),
      id: 'msg-' + m.id,
      dataset: { msg: m.id },
      style: size.w ? { width: size.w + 'px' } : null,
    });
    const head = h('div', { class: 'msg-head' },
      h('span', { class: 'msg-idx', text: '#' + index }),
      h('span', { class: 'msg-role', text: roleLabel(m.role) }),
      h('span', { class: 'msg-time', text: fmtTime(m.createdAt) })
    );
    const editing = ui.editingId === m.id;
    if (!editing) {
      head.append(h('div', { class: 'msg-tools' },
        h('button', { type: 'button', dataset: { act: 'edit' }, title: '編集', text: '✎' }),
        h('button', { type: 'button', dataset: { act: 'copy' }, title: '本文（生の Markdown）をコピー', text: '⧉' }),
        h('button', { type: 'button', dataset: { act: 'branch' }, title: 'ここから分岐を作る', text: '⑂ 分岐' }),
        h('button', { type: 'button', dataset: { act: 'sticky' }, title: '付箋を貼る（ToDo を書ける）', text: '📝' }),
        h('button', { type: 'button', dataset: { act: 'role' }, title: '自分⇄AI を入れ替える', text: '⇄' }),
        h('button', { type: 'button', dataset: { act: 'delete' }, title: '削除', text: '🗑' })
      ));
    }
    msgEl.append(head);

    if (editing) {
      const ta = h('textarea', { class: 'edit-text', spellcheck: 'false' }, m.content);
      msgEl.append(h('div', { class: 'msg-edit' },
        ta,
        h('div', { class: 'edit-actions' },
          h('button', { type: 'button', class: 'edit-cancel', text: 'キャンセル (Esc)' }),
          h('button', { type: 'button', class: 'edit-save', text: '保存 (Ctrl+Enter)' })
        )
      ));
    } else {
      const expanded = ui.expanded.has(m.id);
      const body = h('div', {
        class: 'msg-body prose' + (size.h ? ' sized-h' : ''),
        html: MD.render(m.content),
        style: size.h ? { height: size.h + 'px' } : null,
      });
      if (m.highlights && m.highlights.length) applyHighlights(body, m.highlights);
      // 高さを手動で決めた吹き出しは折りたたまず、中をスクロールさせる
      if (!expanded && !size.h) body.dataset.clampable = '1';
      body.querySelectorAll('pre').forEach(function (pre) {
        pre.append(h('button', { class: 'code-copy', type: 'button', text: 'コピー' }));
      });
      const more = h('button', { class: 'msg-more', type: 'button', text: expanded ? '折りたたむ' : 'もっと見る', hidden: !expanded || !!size.h });
      const tip = 'ドラッグでサイズ変更（ダブルクリックで元に戻す）';
      msgEl.append(body, more,
        h('div', { class: 'msg-resize rx', dataset: { resize: 'x' }, title: tip }),
        h('div', { class: 'msg-resize ry', dataset: { resize: 'y' }, title: tip }),
        h('div', { class: 'msg-resize rxy', dataset: { resize: 'xy' }, title: tip })
      );
    }
    row.append(msgEl);
    // 動かしていない付箋だけ吹き出しの下に並べる
    const docked = (m.stickies || []).map(function (s, i) { return s.pos ? null : renderSticky(m, s, i); }).filter(Boolean);
    if (docked.length) row.append(h('div', { class: 'stickies' }, docked));
    return row;
  }

  function renderSticky(m, s, i) {
    const el = h('div', {
      class: 'sticky' + (s.pos ? ' free' : ''),
      dataset: { sticky: s.id, msg: m.id },
      style: { '--rot': (i % 2 === 0 ? -1.5 : 1.2) + 'deg' },
    });
    el.append(h('div', {
      class: 'sticky-grip',
      title: s.pos ? 'ドラッグで移動（ダブルクリックで吹き出しの下に戻す）' : 'ドラッグで好きな場所へ動かせます',
    }));
    el.append(h('button', { class: 'sticky-del', type: 'button', title: '付箋を外す', text: '×' }));
    el.append(h('textarea', { class: 'sticky-text', rows: '1', placeholder: 'メモ…（Ctrl+Enter で ToDo 追加）', spellcheck: 'false' }, s.text));
    const ul = h('ul', { class: 'todos' });
    (s.todos || []).forEach(function (td) {
      const cb = h('input', { type: 'checkbox', title: '完了にする' });
      cb.checked = !!td.done;
      ul.append(h('li', { class: 'todo' + (td.done ? ' done' : ''), dataset: { todo: td.id } },
        cb,
        h('input', { type: 'text', class: 'todo-text', value: td.text, placeholder: 'ToDo…', spellcheck: 'false' })
      ));
    });
    el.append(ul, h('button', { class: 'todo-add', type: 'button', text: '+ ToDo' }));
    return el;
  }

  // ---------- マーカー（本文テキスト上の位置で保存し、描画のたびに <mark> を差し込む） ----------
  /** 本文のテキストノード（コードのコピーボタンは除く）。マーカー位置はこれを連結した文字列で数える。 */
  function textNodesOf(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return n.parentElement && n.parentElement.closest('.code-copy') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  }

  function applyHighlights(body, highlights) {
    const nodes = textNodesOf(body);
    const ranges = Model.resolveHighlights(highlights, nodes.map(function (n) { return n.nodeValue; }).join(''));
    let pos = 0;
    nodes.forEach(function (node) {
      const len = node.nodeValue.length;
      const from = pos;
      pos += len;
      ranges.filter(function (r) { return r.start < from + len && r.end > from; })
        .map(function (r) { return { s: Math.max(r.start, from) - from, e: Math.min(r.end, from + len) - from, r: r }; })
        .sort(function (a, b) { return b.s - a.s; }) // 後ろから切ると前の位置がずれない
        .forEach(function (sg) {
          if (sg.e < node.nodeValue.length) node.splitText(sg.e);
          const mid = sg.s > 0 ? node.splitText(sg.s) : node;
          if (!mid.nodeValue.trim()) return; // 表のセル間の改行などは包まない
          const mark = h('mark', { class: 'hl hl-' + sg.r.color, dataset: { hl: sg.r.id } });
          mid.parentNode.insertBefore(mark, mid);
          mark.append(mid);
        });
    });
  }

  /** body 先頭から (container, offset) までの文字数。 */
  function textOffset(body, container, offset) {
    const r = document.createRange();
    r.selectNodeContents(body);
    r.setEnd(container, offset);
    let n = 0;
    textNodesOf(body).forEach(function (node) {
      if (!r.intersectsNode(node)) return;
      n += node === container ? offset : node.nodeValue.length;
    });
    return n;
  }

  function closestOf(node, sel) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el ? el.closest(sel) : null;
  }

  function setMarker(on) {
    ui.marker = !!on;
    document.body.classList.toggle('marker-mode', ui.marker);
    els.markerBtn.classList.toggle('active', ui.marker);
    els.markerBtn.setAttribute('aria-pressed', String(ui.marker));
    if (ui.marker) toast('マーカー: 吹き出しの文章をドラッグ（ペンならなぞる）して線を引く。引いた線をクリック・タップで消す（M / Esc で終了）');
  }

  function setMarkerColor(color) {
    ui.markerColor = color;
    document.body.dataset.marker = color;
    els.markerColors.querySelectorAll('.marker-color').forEach(function (b) { b.classList.toggle('active', b.dataset.color === color); });
  }

  function bindMarkerEvents() {
    els.markerBtn.addEventListener('click', function () { setMarker(!ui.marker); });
    els.markerColors.addEventListener('click', function (e) {
      const b = e.target.closest('.marker-color');
      if (!b) return;
      setMarkerColor(b.dataset.color);
      if (!ui.marker) setMarker(true);
    });
    setMarkerColor(ui.markerColor);
    document.addEventListener('keydown', function (e) {
      const t = e.target;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'm' || e.key === 'M') { e.preventDefault(); setMarker(!ui.marker); }
      else if (e.key === 'Escape' && ui.marker) setMarker(false);
    });
    document.addEventListener('mouseup', onMarkerUp);
    els.board.addEventListener('pointerdown', onPenDown);
    // ペンでなぞるときはページをスクロールさせない（指のスクロールはそのまま）
    els.board.addEventListener('touchstart', function (e) {
      const t = e.changedTouches[0];
      if (ui.marker && t && t.touchType === 'stylus' && closestOf(e.target, '.msg-body')) e.preventDefault();
    }, { passive: false });
  }

  function onMarkerUp(e) {
    if (!ui.marker || e.button !== 0 || !project) return;
    if (Date.now() - penUpAt < 600) return; // ペン操作のあとに来る互換マウスイベントは無視
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const body = closestOf(range.startContainer, '.msg-body') || closestOf(range.endContainer, '.msg-body');
      if (!body) return;
      sel.removeAllRanges();
      addMarker(body, range);
      return;
    }
    const mark = e.target instanceof Element && e.target.closest('mark.hl');
    if (mark) deleteMarker(mark);
  }

  /** range（吹き出しの外にはみ出していたら端で切る）にマーカーを引く。 */
  function addMarker(body, range) {
    const r = range.cloneRange();
    if (!body.contains(range.startContainer)) r.setStart(body, 0);
    if (!body.contains(range.endContainer)) r.setEnd(body, body.childNodes.length);
    const plain = textNodesOf(body).map(function (n) { return n.nodeValue; }).join('');
    const start = textOffset(body, r.startContainer, r.startOffset);
    const end = textOffset(body, r.endContainer, r.endOffset);
    if (!plain.slice(start, end).trim()) return;
    const id = body.closest('.msg').dataset.msg;
    Model.reanchorHighlights(project, id, plain);
    Model.addHighlight(project, id, start, end, plain.slice(start, end), ui.markerColor);
    handlers.commit(true);
  }

  function deleteMarker(mark) {
    const body = mark.closest('.msg-body');
    const id = mark.closest('.msg').dataset.msg;
    Model.reanchorHighlights(project, id, textNodesOf(body).map(function (n) { return n.nodeValue; }).join(''));
    Model.deleteHighlight(project, id, mark.dataset.hl);
    handlers.commit(true);
  }

  // ---------- ペン（Apple Pencil）のマーカー ----------
  // 文字選択を経由せず、なぞった範囲をそのまま塗る。線をタップすると消える。
  function caretAt(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      const r = document.createRange();
      r.setStart(p.offsetNode, p.offset);
      return r;
    }
    return null;
  }

  function onPenDown(e) {
    if (e.pointerType !== 'pen' || !ui.marker || !project || !(e.target instanceof Element)) return;
    const body = e.target.closest('.msg-body');
    const c = body && caretAt(e.clientX, e.clientY);
    if (!c || !body.contains(c.startContainer)) return;
    e.preventDefault();
    penMark = { body: body, node: c.startContainer, offset: c.startOffset, x: e.clientX, y: e.clientY, range: null, mark: e.target.closest('mark.hl') };
    window.addEventListener('pointermove', onPenMove);
    window.addEventListener('pointerup', onPenUp);
    window.addEventListener('pointercancel', onPenUp);
  }

  function onPenMove(e) {
    const p = penMark;
    if (!p) return;
    if (!p.range && Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) < DRAG_THRESHOLD) return;
    const c = caretAt(e.clientX, e.clientY);
    if (!c || !p.body.contains(c.startContainer)) return; // 吹き出しの外ではひとつ前の範囲のまま
    const r = document.createRange();
    r.setStart(p.node, p.offset);
    if (c.compareBoundaryPoints(Range.START_TO_START, r) < 0) {
      r.setStart(c.startContainer, c.startOffset);
      r.setEnd(p.node, p.offset);
    } else {
      r.setEnd(c.startContainer, c.startOffset);
    }
    p.range = r;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r); // 塗る前のプレビュー（::selection がマーカー色）
  }

  function onPenUp(e) {
    const p = penMark;
    penMark = null;
    penUpAt = Date.now();
    window.removeEventListener('pointermove', onPenMove);
    window.removeEventListener('pointerup', onPenUp);
    window.removeEventListener('pointercancel', onPenUp);
    if (!p) return;
    window.getSelection().removeAllRanges();
    if (e.type === 'pointercancel') return;
    if (p.range) addMarker(p.body, p.range);
    else if (p.mark) deleteMarker(p.mark);
  }

  function renderComposer(lane) {
    const st = composerState(lane.id);
    const c = h('div', { class: 'composer', dataset: { lane: lane.id } });
    const toggle = h('div', { class: 'role-toggle' },
      h('button', { type: 'button', class: 'role-btn user' + (st.role === 'user' ? ' active' : ''), dataset: { role: 'user' }, text: '自分' }),
      h('button', { type: 'button', class: 'role-btn ai' + (st.role === 'ai' ? ' active' : ''), dataset: { role: 'ai' }, text: 'AI' })
    );
    c.append(h('div', { class: 'composer-top' }, toggle, h('span', { class: 'composer-hint', text: 'Ctrl+Enter で追加' })));
    c.append(h('textarea', { class: 'composer-text ' + st.role, placeholder: composerPlaceholder(st.role), spellcheck: 'false' }, st.text));
    c.append(h('div', { class: 'composer-actions' }, h('button', { type: 'button', class: 'composer-add', text: '追加' })));
    return c;
  }

  // ---------- サイドバー ----------
  function renderSidebar() {
    if (!project) return;
    renderOutline();
    renderMeter();
    renderTodos();
    renderSearch();
  }

  function renderOutline() {
    const todosByLane = {};
    Model.collectTodos(project).forEach(function (t) { todosByLane[t.laneId] = (todosByLane[t.laneId] || 0) + 1; });
    const items = Model.orderedLanes(project).map(function (lane) {
      const item = h('div', {
        class: 'outline-item' + (lane.collapsed ? ' collapsed' : ''),
        dataset: { lane: lane.id },
        title: lane.title + (lane.axis ? '（' + Model.AXES[lane.axis].label + '）' : ''),
        style: { '--depth': String(Model.laneDepth(project, lane.id)) },
      });
      item.append(
        h('span', { class: 'outline-dot', style: { '--c': Model.laneColor(lane) } }),
        h('span', { class: 'outline-title', text: lane.title || '(無題)' })
      );
      if (todosByLane[lane.id]) item.append(h('span', { class: 'outline-todo', text: '☐ ' + todosByLane[lane.id] }));
      item.append(h('span', { class: 'outline-count', text: String(Model.messagesOf(project, lane.id).length) }));
      return item;
    });
    els.outline.replaceChildren.apply(els.outline, items);
  }

  function renderMeter() {
    const st = Model.axisStats(project);
    const values = Model.AXIS_KEYS.map(function (k) { return st.counts[k]; }).concat([st.counts.none]);
    const max = Math.max.apply(null, [1].concat(values));
    const rows = [h('h4', { text: '分岐の軸（野心の4軸） 全' + st.total + '本' })];
    Model.AXIS_KEYS.forEach(function (k) {
      const a = Model.AXES[k];
      const n = st.counts[k];
      rows.push(h('div', { class: 'axis-row', title: a.desc, style: { '--c': a.color } },
        h('span', { class: 'axis-name', html: MD.escapeHtml(a.label) + '<small>' + MD.escapeHtml(a.ja) + '</small>' }),
        h('div', { class: 'axis-bar' }, h('i', { style: { '--w': (n / max * 100) + '%' } })),
        h('span', { class: 'axis-count', text: String(n) })
      ));
    });
    if (st.counts.none) {
      rows.push(h('div', { class: 'axis-row', title: '軸が未分類の分岐。ヘッダーの「軸: 未分類」から選べます', style: { '--c': Model.COLORS.none } },
        h('span', { class: 'axis-name', html: '未分類<small>軸を選ぶ</small>' }),
        h('div', { class: 'axis-bar' }, h('i', { style: { '--w': (st.counts.none / max * 100) + '%' } })),
        h('span', { class: 'axis-count', text: String(st.counts.none) })
      ));
    }
    if (st.hint) {
      rows.push(h('div', { class: 'axis-hint', text: '手順の分岐（Speed）が多めです。目的の先（Altitude）・深掘り（Depth）・別分野の視点（Range）の分岐も検討してみましょう。' }));
    }
    els.meter.replaceChildren.apply(els.meter, rows);
  }

  function renderTodos() {
    const todos = Model.collectTodos(project);
    els.todoBadge.textContent = String(todos.length);
    els.todoBadge.hidden = !todos.length;
    if (!todos.length) {
      els.todoList.replaceChildren(h('div', { class: 'todo-empty', text: '未完了の ToDo はありません。吹き出しの 📝 から付箋を貼り、ToDo を書けます。' }));
      return;
    }
    const groups = new Map();
    todos.forEach(function (t) {
      if (!groups.has(t.laneId)) groups.set(t.laneId, []);
      groups.get(t.laneId).push(t);
    });
    const out = [];
    groups.forEach(function (items, laneId) {
      const lane = project.lanes[laneId];
      const g = h('div', { class: 'todo-group' });
      g.append(h('h4', {}, h('span', { class: 'outline-dot', style: { '--c': Model.laneColor(lane) } }), lane ? lane.title : ''));
      items.forEach(function (t) {
        g.append(h('div', { class: 'todo-item', dataset: { msg: t.messageId, sticky: t.stickyId, todo: t.todo.id } },
          h('input', { type: 'checkbox', title: '完了にする' }),
          h('span', { class: 'todo-label', text: t.todo.text || '（空の ToDo）', title: 'クリックで該当メッセージへ' }),
          h('span', { class: 'todo-ref', text: '#' + t.index })
        ));
      });
      out.push(g);
    });
    els.todoList.replaceChildren.apply(els.todoList, out);
  }

  function renderSearch() {
    const q = ui.search.trim();
    if (!q) {
      els.searchResults.hidden = true;
      els.searchResults.replaceChildren();
      return;
    }
    const hits = Model.search(project, q, 50);
    els.searchResults.hidden = false;
    if (!hits.length) {
      els.searchResults.replaceChildren(h('div', { class: 'search-empty', text: '見つかりません' }));
      return;
    }
    const nodes = hits.map(function (hit) {
      return h('div', { class: 'search-hit', dataset: { msg: hit.messageId } },
        h('div', { class: 'hit-meta', text: hit.laneTitle + ' · #' + hit.index + ' · ' + roleLabel(hit.role) }),
        h('div', {}, hit.before, h('mark', { text: hit.match }), hit.after)
      );
    });
    els.searchResults.replaceChildren.apply(els.searchResults, nodes);
  }

  function renderHeader(fileName, dirty, linked) {
    if (!project) return;
    if (document.activeElement !== els.title) els.title.value = project.title;
    if (document.activeElement !== els.northstar) {
      els.northstar.value = project.northStar;
      autosize(els.northstar, 30);
    }
    if (fileName) {
      els.fileName.textContent = fileName + (linked ? '' : '（Ctrl+S で保存先を再指定）');
    } else {
      els.fileName.textContent = '未保存（下書きはブラウザ内に自動保存）';
    }
    els.dirty.hidden = !dirty;
    document.title = (dirty ? '● ' : '') + project.title + ' — AIチャット管理メモ';
  }

  // ---------- レーン配置とコネクタ ----------
  function scheduleLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    const run = function () { if (!layoutQueued) return; layoutQueued = false; layoutLanes(); };
    // 非表示・最小化中は requestAnimationFrame が止まるので setTimeout でも走らせる（先に走った方だけ実行）
    requestAnimationFrame(run);
    setTimeout(run, 60);
  }

  function layoutLanes() {
    if (!project) return;
    const boardRect = els.board.getBoundingClientRect();
    const padTop = parseFloat(getComputedStyle(els.board).paddingTop) || 0;
    const anchors = [];
    Model.orderedLanes(project).forEach(function (lane) {
      const laneEl = document.getElementById('lane-' + lane.id);
      if (!laneEl) return;
      if (lane.id === Model.ROOT_ID) { laneEl.style.marginTop = '0px'; return; }
      let from = document.getElementById('msg-' + lane.parentMessageId);
      if (!from) {
        const pm = project.messages[lane.parentMessageId];
        from = pm ? document.getElementById('lane-' + pm.laneId) : null; // 親レーンが折りたたまれている
      }
      if (!from) { laneEl.style.marginTop = '0px'; return; }
      const fr = from.getBoundingClientRect();
      const top = Math.max(0, Math.round(fr.top - boardRect.top - padTop));
      laneEl.style.marginTop = top + 'px';
      anchors.push({ laneEl: laneEl, from: from, color: Model.laneColor(lane) });
    });
    drawConnectors(anchors);
    layoutFreeStickies();
  }

  /** 動かした付箋を「吹き出しの左上 + pos」に置き、吹き出しと点線でつなぐ。 */
  function layoutFreeStickies() {
    const svg = els.stickyLinks;
    const w = els.board.offsetWidth;
    const hgt = els.board.offsetHeight;
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(hgt));
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + hgt);
    const boardRect = els.board.getBoundingClientRect();
    const clamp = function (v, lo, hi) { return Math.min(Math.max(v, lo), hi); };
    const parts = [];
    els.stickyLayer.querySelectorAll('.sticky').forEach(function (el) {
      const s = Model.findSticky(project, el.dataset.msg, el.dataset.sticky);
      const msgEl = document.getElementById('msg-' + el.dataset.msg);
      // 吹き出しが見えない（レーンが畳まれている）ときは付箋も隠す
      el.hidden = !(s && s.pos && msgEl);
      if (el.hidden) return;
      const mr = msgEl.getBoundingClientRect();
      const m = { left: mr.left - boardRect.left, top: mr.top - boardRect.top, right: mr.right - boardRect.left, bottom: mr.bottom - boardRect.top };
      const left = Math.max(0, m.left + s.pos.x);
      const top = Math.max(0, m.top + s.pos.y);
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      const st = { left: left, top: top, right: left + el.offsetWidth, bottom: top + el.offsetHeight };
      // 吹き出しの縁で付箋に一番近い点 → 付箋の縁でその点に一番近い点
      const ax = clamp((st.left + st.right) / 2, m.left, m.right);
      const ay = clamp((st.top + st.bottom) / 2, m.top, m.bottom);
      const bx = clamp(ax, st.left, st.right);
      const by = clamp(ay, st.top, st.bottom);
      if (Math.hypot(bx - ax, by - ay) < 6) return; // 重なっているなら線は要らない
      parts.push('<line x1="' + ax + '" y1="' + ay + '" x2="' + bx + '" y2="' + by + '"/>');
      parts.push('<circle cx="' + ax + '" cy="' + ay + '" r="4"/>');
    });
    svg.innerHTML = parts.join('');
  }

  // ---------- 付箋のドラッグ移動 ----------
  // 付箋の入力欄・ボタン以外を掴んで動かす。少し動かして初めてドラッグ扱い（クリックは邪魔しない）。
  function onStickyDragStart(e) {
    const t = e.target;
    if (e.button !== 0 || !(t instanceof Element)) return;
    const el = t.closest('.sticky');
    if (!el || t.closest('textarea, input, button')) return;
    e.preventDefault();
    stickyDrag = { msgId: el.dataset.msg, stickyId: el.dataset.sticky, x: e.clientX, y: e.clientY, base: null };
    window.addEventListener('pointermove', onStickyDragMove);
    window.addEventListener('pointerup', onStickyDragEnd);
    window.addEventListener('pointercancel', onStickyDragEnd);
  }

  function onStickyDragMove(e) {
    const d = stickyDrag;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.base) {
      if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
      const s = Model.findSticky(project, d.msgId, d.stickyId);
      const el = els.board.querySelector('.sticky[data-sticky="' + d.stickyId + '"]');
      const msgEl = document.getElementById('msg-' + d.msgId);
      if (!s || !el || !msgEl) { onStickyDragEnd(); return; }
      if (s.pos) {
        d.base = { x: s.pos.x, y: s.pos.y };
      } else {
        // 吹き出しの下から剥がす: 今見えている位置を起点にして、自由配置の層へ移す
        const sr = el.getBoundingClientRect();
        const mr = msgEl.getBoundingClientRect();
        d.base = { x: sr.left - mr.left, y: sr.top - mr.top };
        Model.updateSticky(project, d.msgId, d.stickyId, { pos: d.base });
        renderAll();
      }
      document.body.classList.add('dragging-sticky');
    }
    Model.updateSticky(project, d.msgId, d.stickyId, { pos: { x: d.base.x + dx, y: d.base.y + dy } });
    layoutFreeStickies();
  }

  function onStickyDragEnd() {
    const d = stickyDrag;
    stickyDrag = null;
    window.removeEventListener('pointermove', onStickyDragMove);
    window.removeEventListener('pointerup', onStickyDragEnd);
    window.removeEventListener('pointercancel', onStickyDragEnd);
    document.body.classList.remove('dragging-sticky');
    if (d && d.base) handlers.commit(true);
  }

  function onStickyReset(e) {
    const t = e.target;
    if (!(t instanceof Element) || t.closest('textarea, input, button')) return;
    const el = t.closest('.sticky.free');
    if (!el) return;
    Model.updateSticky(project, el.dataset.msg, el.dataset.sticky, { pos: null });
    handlers.commit(true);
  }

  function drawConnectors(anchors) {
    const svg = els.svg;
    const w = els.board.offsetWidth;
    const hgt = els.board.offsetHeight;
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(hgt));
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + hgt);
    const boardRect = els.board.getBoundingClientRect();
    const parts = [];
    anchors.forEach(function (a) {
      const fr = a.from.getBoundingClientRect();
      const header = a.laneEl.querySelector('.lane-header');
      if (!header) return;
      const hr = header.getBoundingClientRect();
      const y2 = hr.top + hr.height / 2 - boardRect.top;
      const x1 = fr.right - boardRect.left;
      const y1 = Math.min(Math.max(y2, fr.top - boardRect.top + 8), fr.bottom - boardRect.top - 8);
      const x2 = hr.left - boardRect.left;
      const dx = Math.max(24, (x2 - x1) / 2);
      parts.push('<path d="M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2 + '" stroke="' + a.color + '"/>');
      parts.push('<circle cx="' + x1 + '" cy="' + y1 + '" r="4.5" fill="' + a.color + '"/>');
      parts.push('<circle cx="' + x2 + '" cy="' + y2 + '" r="4.5" fill="' + a.color + '"/>');
    });
    svg.innerHTML = parts.join('');
  }

  // ---------- 移動・フォーカス・トースト ----------
  function jumpToMessage(id) {
    const el = document.getElementById('msg-' + id);
    if (!el) {
      const m = project.messages[id];
      const lane = m && project.lanes[m.laneId];
      if (lane && lane.collapsed) {
        Model.updateLane(project, lane.id, { collapsed: false });
        handlers.commit(true);
        requestAnimationFrame(function () { jumpToMessage(id); });
      }
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    flash(el);
  }

  function jumpToLane(id) {
    const el = document.getElementById('lane-' + id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'center' });
    flash(el);
  }

  function applyFocus() {
    if (ui.revealLane) {
      const laneEl = document.getElementById('lane-' + ui.revealLane);
      ui.revealLane = null;
      if (laneEl) {
        requestAnimationFrame(function () { laneEl.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'center' }); flash(laneEl); });
      }
    }
    if (!ui.focusTarget) return;
    const el = els.board.querySelector(ui.focusTarget);
    ui.focusTarget = null;
    if (!el) return;
    el.focus({ preventScroll: false });
    if (typeof el.setSelectionRange === 'function' && (el.tagName === 'TEXTAREA' || el.type === 'text')) {
      const n = el.value.length;
      try { el.setSelectionRange(n, n); } catch (e) { /* ignore */ }
    }
  }

  function toast(msg, ms) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, ms || 2800);
  }

  function setTab(name) {
    ui.tab = name;
    document.querySelectorAll('.sb-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    document.querySelectorAll('.sb-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + name); });
  }

  // ---------- ボード上の操作 ----------
  function bindBoardEvents() {
    els.board.addEventListener('click', onBoardClick);
    els.board.addEventListener('input', onBoardInput);
    els.board.addEventListener('change', onBoardChange);
    els.board.addEventListener('keydown', onBoardKeydown);
    els.board.addEventListener('pointerdown', onResizeStart);
    els.board.addEventListener('dblclick', onResizeReset);
    els.board.addEventListener('pointerdown', onStickyDragStart);
    els.board.addEventListener('dblclick', onStickyReset);
    els.boardWrap.addEventListener('pointerdown', onPanStart);
  }

  // ---------- ボードのドラッグ移動 ----------
  // 方眼紙の空いているところを掴んでスクロールする。吹き出し・付箋・入力欄の上では始めない（文字選択を邪魔しない）。
  function isEmptySpace(el) {
    return el === els.boardWrap || el === els.board || el.id === 'connectors' ||
      el.classList.contains('lane') || el.classList.contains('lane-body') || el.classList.contains('msg-row');
  }

  function onPanStart(e) {
    // 指やペンはブラウザ自身のスクロールに任せる（慣性スクロールも効く）
    if (e.pointerType !== 'mouse' || e.button !== 0 || resizing || !(e.target instanceof Element) || !isEmptySpace(e.target)) return;
    e.preventDefault();
    const wrap = els.boardWrap;
    panning = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
    wrap.setPointerCapture(e.pointerId);
    wrap.addEventListener('pointermove', onPanMove);
    wrap.addEventListener('pointerup', onPanEnd);
    wrap.addEventListener('pointercancel', onPanEnd);
    document.body.classList.add('panning');
  }

  function onPanMove(e) {
    const p = panning;
    if (!p) return;
    els.boardWrap.scrollLeft = p.sl - (e.clientX - p.x);
    els.boardWrap.scrollTop = p.st - (e.clientY - p.y);
  }

  function onPanEnd() {
    panning = null;
    const wrap = els.boardWrap;
    wrap.removeEventListener('pointermove', onPanMove);
    wrap.removeEventListener('pointerup', onPanEnd);
    wrap.removeEventListener('pointercancel', onPanEnd);
    document.body.classList.remove('panning');
  }

  // ---------- 吹き出しのサイズ変更 ----------
  // 横幅は吹き出しの空いている側（AI は右、自分は左）、高さは下端、角で両方。文字の大きさは変えない。
  function onResizeStart(e) {
    const handle = e.target instanceof Element && e.target.closest('.msg-resize');
    if (!handle || e.button !== 0) return;
    e.preventDefault();
    const msgEl = handle.closest('.msg');
    const body = msgEl.querySelector('.msg-body');
    const mode = handle.dataset.resize;
    const startH = body.getBoundingClientRect().height;
    const more = body.nextElementSibling;
    resizing = {
      more: more && more.classList.contains('msg-more') ? more : null,
      id: msgEl.dataset.msg,
      msgEl: msgEl,
      body: body,
      laneEl: msgEl.closest('.lane'),
      mode: mode,
      dir: msgEl.classList.contains('user') ? -1 : 1, // 自分の吹き出しは右寄せなので左へ広げる
      x: e.clientX,
      y: e.clientY,
      w: msgEl.getBoundingClientRect().width,
      h: startH,
      moved: false,
    };
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', onResizeMove);
    handle.addEventListener('pointerup', onResizeEnd);
    handle.addEventListener('pointercancel', onResizeEnd);
    document.body.classList.add('resizing-' + mode);
  }

  function onResizeMove(e) {
    const r = resizing;
    if (!r) return;
    r.moved = true;
    if (r.mode !== 'y') {
      const w = Math.min(MSG_MAX_W, Math.max(MSG_MIN_W, Math.round(r.w + (e.clientX - r.x) * r.dir)));
      r.msgEl.classList.add('sized-w');
      r.msgEl.style.width = w + 'px';
      r.laneEl.style.setProperty('--lane-w', Math.max(LANE_W, w) + 'px');
    }
    if (r.mode !== 'x') {
      const hgt = Math.max(BODY_MIN_H, Math.round(r.h + (e.clientY - r.y)));
      r.body.classList.remove('clamped');
      if (r.more) r.more.hidden = true;
      r.body.classList.add('sized-h');
      r.body.style.height = hgt + 'px';
    }
    scheduleLayout();
  }

  function onResizeEnd(e) {
    const r = resizing;
    resizing = null;
    const handle = e.currentTarget;
    handle.removeEventListener('pointermove', onResizeMove);
    handle.removeEventListener('pointerup', onResizeEnd);
    handle.removeEventListener('pointercancel', onResizeEnd);
    document.body.classList.remove('resizing-x', 'resizing-y', 'resizing-xy');
    if (!r) return;
    if (!r.moved) return; // クリックだけ（ダブルクリックでのリセットを含む）なら何もしない
    const m = project.messages[r.id];
    const size = Object.assign({}, m && m.size);
    if (r.mode !== 'y') size.w = parseFloat(r.msgEl.style.width);
    if (r.mode !== 'x') size.h = parseFloat(r.body.style.height);
    Model.updateMessage(project, r.id, { size: size });
    handlers.commit(true);
  }

  function onResizeReset(e) {
    const handle = e.target instanceof Element && e.target.closest('.msg-resize');
    if (!handle) return;
    const id = handle.closest('.msg').dataset.msg;
    const m = project.messages[id];
    if (!m || !m.size) return;
    const mode = handle.dataset.resize;
    const size = Object.assign({}, m.size);
    if (mode !== 'y') size.w = null;
    if (mode !== 'x') size.h = null;
    Model.updateMessage(project, id, { size: size });
    handlers.commit(true);
  }

  function onBoardClick(e) {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const tool = t.closest('.msg-tools button[data-act]');
    if (tool) { doMessageAction(tool.dataset.act, tool.closest('.msg').dataset.msg); return; }

    if (t.closest('.msg-more')) {
      const id = t.closest('.msg').dataset.msg;
      if (ui.expanded.has(id)) ui.expanded.delete(id); else ui.expanded.add(id);
      renderAll();
      return;
    }
    const cc = t.closest('.code-copy');
    if (cc) {
      const clone = cc.closest('pre').cloneNode(true);
      clone.querySelectorAll('.code-copy').forEach(function (b) { b.remove(); });
      copyText(clone.textContent.replace(/\n$/, ''));
      return;
    }
    if (t.closest('.edit-save')) { saveEdit(t.closest('.msg')); return; }
    if (t.closest('.edit-cancel')) { ui.editingId = null; renderAll(); return; }

    const sdel = t.closest('.sticky-del');
    if (sdel) {
      const s = sdel.closest('.sticky');
      const sticky = Model.findSticky(project, s.dataset.msg, s.dataset.sticky);
      const hasContent = sticky && ((sticky.text || '').trim() || sticky.todos.length);
      if (hasContent && !confirm('この付箋を外しますか？（中の ToDo も消えます）')) return;
      Model.deleteSticky(project, s.dataset.msg, s.dataset.sticky);
      handlers.commit(true);
      return;
    }
    const tadd = t.closest('.todo-add');
    if (tadd) {
      const s = tadd.closest('.sticky');
      const td = Model.addTodo(project, s.dataset.msg, s.dataset.sticky, '');
      ui.focusTarget = '.todo[data-todo="' + td.id + '"] .todo-text';
      handlers.commit(true);
      return;
    }
    if (t.closest('.composer-add')) { addFromComposer(t.closest('.composer').dataset.lane); return; }

    const rb = t.closest('.role-btn');
    if (rb) {
      const c = rb.closest('.composer');
      const st = composerState(c.dataset.lane);
      st.role = rb.dataset.role;
      c.querySelectorAll('.role-btn').forEach(function (b) { b.classList.toggle('active', b === rb); });
      const ta = c.querySelector('.composer-text');
      ta.classList.remove('user', 'ai');
      ta.classList.add(st.role);
      ta.placeholder = composerPlaceholder(st.role);
      ta.focus();
      return;
    }
    const lc = t.closest('.lane-collapse, .lane-expand');
    if (lc) {
      const laneId = lc.closest('.lane').dataset.lane;
      Model.updateLane(project, laneId, { collapsed: !project.lanes[laneId].collapsed });
      handlers.commit(true);
      return;
    }
    const ld = t.closest('.lane-delete');
    if (ld) {
      const laneId = ld.closest('.lane').dataset.lane;
      const lane = project.lanes[laneId];
      const n = countLaneTree(laneId);
      let msg = '分岐「' + lane.title + '」を削除しますか？\nこの分岐のメッセージ ' + n.messages + ' 件';
      if (n.lanes > 1) msg += 'と子分岐 ' + (n.lanes - 1) + ' 本';
      msg += 'が消えます。';
      if (!confirm(msg)) return;
      Model.deleteLane(project, laneId);
      handlers.commit(true);
      return;
    }
    const lp = t.closest('.lane-parent');
    if (lp) { jumpToMessage(lp.dataset.target); return; }
  }

  function doMessageAction(act, id) {
    const m = project.messages[id];
    if (!m) return;
    switch (act) {
      case 'edit':
        ui.editingId = id;
        ui.focusTarget = '#msg-' + id + ' .edit-text';
        renderAll();
        break;
      case 'copy':
        copyText(m.content);
        break;
      case 'branch': {
        const laneId = Model.addLane(project, id, null, null);
        ui.focusTarget = '#lane-' + laneId + ' .lane-title';
        ui.revealLane = laneId;
        handlers.commit(true);
        toast('分岐を作りました。名前と軸（Speed / Altitude / Depth / Range）を付けましょう');
        break;
      }
      case 'sticky': {
        const s = Model.addSticky(project, id, '');
        ui.focusTarget = '.sticky[data-sticky="' + s.id + '"] .sticky-text';
        handlers.commit(true);
        break;
      }
      case 'role':
        Model.updateMessage(project, id, { role: m.role === 'ai' ? 'user' : 'ai' });
        handlers.commit(true);
        break;
      case 'delete': {
        const kids = Model.childLanesOf(project, id);
        let msg = '#' + Model.messageIndex(project, id) + ' のメッセージを削除しますか？';
        if (kids.length) msg += '\nここから生えている分岐 ' + kids.length + ' 本（とその中身）も消えます。';
        if (!confirm(msg)) return;
        Model.deleteMessage(project, id);
        handlers.commit(true);
        break;
      }
      default:
        break;
    }
  }

  function saveEdit(msgEl) {
    if (!msgEl) return;
    const id = msgEl.dataset.msg;
    const ta = msgEl.querySelector('.edit-text');
    if (ta) Model.updateMessage(project, id, { content: ta.value });
    ui.editingId = null;
    handlers.commit(true);
  }

  function addFromComposer(laneId) {
    const st = composerState(laneId);
    const text = st.text.replace(/\s+$/, '');
    if (!text.trim()) { toast('貼り付ける内容が空です'); return; }
    Model.addMessage(project, laneId, st.role, text);
    st.text = '';
    st.role = st.role === 'user' ? 'ai' : 'user';
    ui.focusTarget = '.composer[data-lane="' + laneId + '"] .composer-text';
    handlers.commit(true);
  }

  function onBoardInput(e) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.classList.contains('composer-text')) {
      composerState(t.closest('.composer').dataset.lane).text = t.value;
      autosize(t, 76);
      return;
    }
    if (t.classList.contains('sticky-text')) {
      const s = t.closest('.sticky');
      Model.updateSticky(project, s.dataset.msg, s.dataset.sticky, { text: t.value });
      autosize(t, 26);
      handlers.commit(false);
      return;
    }
    if (t.classList.contains('todo-text')) {
      const s = t.closest('.sticky');
      const li = t.closest('.todo');
      Model.updateTodo(project, s.dataset.msg, s.dataset.sticky, li.dataset.todo, { text: t.value });
      handlers.commit(false);
      return;
    }
    if (t.classList.contains('lane-title')) {
      Model.updateLane(project, t.closest('.lane').dataset.lane, { title: t.value });
      handlers.commit(false);
      return;
    }
    if (t.classList.contains('edit-text')) { autosize(t, 120); }
  }

  function onBoardChange(e) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.matches('.todo input[type="checkbox"]')) {
      const s = t.closest('.sticky');
      const li = t.closest('.todo');
      Model.updateTodo(project, s.dataset.msg, s.dataset.sticky, li.dataset.todo, { done: t.checked });
      li.classList.toggle('done', t.checked);
      handlers.commit(false);
      return;
    }
    if (t.classList.contains('lane-axis')) {
      Model.updateLane(project, t.closest('.lane').dataset.lane, { axis: t.value || null });
      handlers.commit(true);
    }
  }

  function onBoardKeydown(e) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const ctrl = e.ctrlKey || e.metaKey;

    if (t.classList.contains('composer-text')) {
      if (e.key === 'Enter' && ctrl) { e.preventDefault(); addFromComposer(t.closest('.composer').dataset.lane); }
      return;
    }
    if (t.classList.contains('edit-text')) {
      if (e.key === 'Enter' && ctrl) { e.preventDefault(); saveEdit(t.closest('.msg')); }
      else if (e.key === 'Escape') { e.preventDefault(); ui.editingId = null; renderAll(); }
      return;
    }
    if (t.classList.contains('todo-text')) {
      const s = t.closest('.sticky');
      const li = t.closest('.todo');
      if (e.key === 'Enter') {
        e.preventDefault();
        const td = Model.addTodo(project, s.dataset.msg, s.dataset.sticky, '', li.dataset.todo);
        ui.focusTarget = '.todo[data-todo="' + td.id + '"] .todo-text';
        handlers.commit(true);
      } else if (e.key === 'Backspace' && t.value === '') {
        e.preventDefault();
        const prev = li.previousElementSibling;
        Model.deleteTodo(project, s.dataset.msg, s.dataset.sticky, li.dataset.todo);
        ui.focusTarget = prev
          ? '.todo[data-todo="' + prev.dataset.todo + '"] .todo-text'
          : '.sticky[data-sticky="' + s.dataset.sticky + '"] .sticky-text';
        handlers.commit(true);
      }
      return;
    }
    if (t.classList.contains('sticky-text')) {
      if (e.key === 'Enter' && ctrl) {
        e.preventDefault();
        const s = t.closest('.sticky');
        const td = Model.addTodo(project, s.dataset.msg, s.dataset.sticky, '');
        ui.focusTarget = '.todo[data-todo="' + td.id + '"] .todo-text';
        handlers.commit(true);
      }
      return;
    }
    if (t.classList.contains('lane-title') && e.key === 'Enter') { e.preventDefault(); t.blur(); }
  }

  // ---------- サイドバーの操作 ----------
  function bindSidebarEvents() {
    document.querySelectorAll('.sb-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { setTab(btn.dataset.tab); });
    });
    els.search.addEventListener('input', debounce(function () { ui.search = els.search.value; renderSearch(); }, 150));
    els.search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { els.search.value = ''; ui.search = ''; renderSearch(); }
      if (e.key === 'Enter') { const first = els.searchResults.querySelector('.search-hit'); if (first) jumpToMessage(first.dataset.msg); }
    });
    els.searchResults.addEventListener('click', function (e) {
      const hit = e.target.closest('.search-hit');
      if (hit) jumpToMessage(hit.dataset.msg);
    });
    els.outline.addEventListener('click', function (e) {
      const item = e.target.closest('.outline-item');
      if (item) jumpToLane(item.dataset.lane);
    });
    els.todoList.addEventListener('click', function (e) {
      const item = e.target.closest('.todo-item');
      if (!item) return;
      if (e.target.matches('input[type="checkbox"]')) {
        Model.updateTodo(project, item.dataset.msg, item.dataset.sticky, item.dataset.todo, { done: e.target.checked });
        handlers.commit(true);
        return;
      }
      jumpToMessage(item.dataset.msg);
    });
  }

  return {
    init: init,
    setProject: setProject,
    resetUi: resetUi,
    renderAll: renderAll,
    renderSidebar: renderSidebar,
    renderHeader: renderHeader,
    scheduleLayout: scheduleLayout,
    toast: toast,
    jumpToMessage: jumpToMessage,
    jumpToLane: jumpToLane,
    setTab: setTab,
    autosize: autosize,
  };
})();
