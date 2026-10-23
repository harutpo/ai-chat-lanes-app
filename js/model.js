/* model.js — データ層。ブラウザ(window.Model)と Node(require) の両方で読める UMD 風。
 * DOM には一切触らない。状態はプレーンなオブジェクト（保存ファイルと同じ形）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.Model = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA = 1;
  const ROOT_ID = 'root';
  const DEFAULT_TITLE = '無題のプロジェクト';

  // 「野心」の4軸（記事: Speed / Altitude / Depth / Range）
  const AXES = {
    speed:    { key: 'speed',    label: 'Speed',    ja: '速さ・手順',   color: '#f59e0b',
                desc: '同じ作業をより短時間で。手順や具体的なやり方を聞く分岐' },
    altitude: { key: 'altitude', label: 'Altitude', ja: '目的の先',     color: '#8b5cf6',
                desc: '抽象度を上げ、作業ではなく「その先に何が起きてほしいか」を問う分岐' },
    depth:    { key: 'depth',    label: 'Depth',    ja: '深掘り',       color: '#10b981',
                desc: '一流の専門家の道具・生データ・外部の審判を使って深くやる分岐' },
    range:    { key: 'range',    label: 'Range',    ja: '別分野の視点', color: '#ec4899',
                desc: '普段使わない分野の知識・手法・ツールを持ち込む分岐' },
  };
  const AXIS_KEYS = Object.keys(AXES);
  const COLORS = { main: '#64748b', none: '#94a3b8' };

  // ---------- ユーティリティ ----------
  function uid(prefix) {
    let s;
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      s = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    } else {
      s = Math.random().toString(36).slice(2, 12);
    }
    return prefix + '_' + s;
  }
  function now() { return new Date().toISOString(); }
  function touch(p) { p.updatedAt = now(); return p; }
  function isAxis(a) { return AXIS_KEYS.includes(a); }

  // ---------- プロジェクト ----------
  function createProject(title) {
    const t = now();
    return {
      schema: SCHEMA,
      title: title || DEFAULT_TITLE,
      northStar: '',
      createdAt: t,
      updatedAt: t,
      laneOrder: [ROOT_ID],
      lanes: {
        [ROOT_ID]: { id: ROOT_ID, title: '本流', axis: null, parentMessageId: null, collapsed: false, createdAt: t },
      },
      messageOrder: { [ROOT_ID]: [] },
      messages: {},
    };
  }

  // ---------- レーン ----------
  function getLane(p, id) { return p.lanes[id] || null; }

  function addLane(p, parentMessageId, title, axis) {
    const pm = p.messages[parentMessageId];
    if (!pm) throw new Error('分岐元のメッセージが見つかりません');
    const id = uid('l');
    const t = now();
    const n = p.laneOrder.length; // 本流を含む本数 = 新しい分岐の番号
    p.lanes[id] = {
      id,
      title: title || ('分岐 ' + n),
      axis: isAxis(axis) ? axis : null,
      parentMessageId,
      collapsed: false,
      createdAt: t,
    };
    p.laneOrder.push(id);
    p.messageOrder[id] = [];
    touch(p);
    return id;
  }

  function updateLane(p, id, patch) {
    const l = p.lanes[id];
    if (!l) return null;
    if ('title' in patch) l.title = String(patch.title);
    if ('axis' in patch) l.axis = isAxis(patch.axis) ? patch.axis : null;
    if ('collapsed' in patch) l.collapsed = !!patch.collapsed;
    touch(p);
    return l;
  }

  function childLanesOf(p, messageId) {
    return p.laneOrder.map(function (id) { return p.lanes[id]; })
      .filter(function (l) { return l && l.parentMessageId === messageId; });
  }

  function deleteLane(p, id) {
    if (id === ROOT_ID || !p.lanes[id]) return false;
    const ids = (p.messageOrder[id] || []).slice();
    ids.forEach(function (mid) { deleteMessage(p, mid); }); // 子レーンも連鎖削除
    delete p.messageOrder[id];
    delete p.lanes[id];
    p.laneOrder = p.laneOrder.filter(function (x) { return x !== id; });
    touch(p);
    return true;
  }

  /** 表示順: 本流から DFS。各メッセージの位置に生えている分岐を作成順にたどる。 */
  function orderedLanes(p) {
    const out = [];
    const seen = new Set();
    const byParent = {};
    p.laneOrder.forEach(function (id) {
      const l = p.lanes[id];
      if (!l || !l.parentMessageId) return;
      (byParent[l.parentMessageId] = byParent[l.parentMessageId] || []).push(l);
    });
    function visit(laneId) {
      if (seen.has(laneId) || !p.lanes[laneId]) return;
      seen.add(laneId);
      out.push(p.lanes[laneId]);
      (p.messageOrder[laneId] || []).forEach(function (mid) {
        (byParent[mid] || []).forEach(function (child) { visit(child.id); });
      });
    }
    visit(ROOT_ID);
    p.laneOrder.forEach(function (id) { if (!seen.has(id)) visit(id); }); // 迷子レーンは末尾
    return out;
  }

  function laneDepth(p, laneId) {
    let d = 0;
    let l = p.lanes[laneId];
    const guard = new Set();
    while (l && l.parentMessageId && !guard.has(l.id)) {
      guard.add(l.id);
      const pm = p.messages[l.parentMessageId];
      if (!pm) break;
      l = p.lanes[pm.laneId];
      d++;
    }
    return d;
  }

  /** 分岐元の情報 { message, lane, index } を返す（本流なら null）。 */
  function parentOfLane(p, laneId) {
    const l = p.lanes[laneId];
    if (!l || !l.parentMessageId) return null;
    const message = p.messages[l.parentMessageId];
    if (!message) return null;
    return { message, lane: p.lanes[message.laneId] || null, index: messageIndex(p, message.id) };
  }

  function laneColor(lane) {
    if (!lane) return COLORS.none;
    if (lane.id === ROOT_ID) return COLORS.main;
    return lane.axis ? AXES[lane.axis].color : COLORS.none;
  }

  // ---------- メッセージ ----------
  function addMessage(p, laneId, role, content) {
    if (!p.lanes[laneId]) throw new Error('レーンが見つかりません');
    const id = uid('m');
    const t = now();
    p.messages[id] = {
      id, laneId,
      role: role === 'ai' ? 'ai' : 'user',
      content: String(content == null ? '' : content),
      createdAt: t, updatedAt: t,
      stickies: [],
    };
    (p.messageOrder[laneId] = p.messageOrder[laneId] || []).push(id);
    touch(p);
    return id;
  }

  function updateMessage(p, id, patch) {
    const m = p.messages[id];
    if (!m) return null;
    if ('content' in patch) m.content = String(patch.content);
    if ('role' in patch) m.role = patch.role === 'ai' ? 'ai' : 'user';
    if ('size' in patch) {
      const size = normalizeSize(patch.size);
      if (size) m.size = size; else delete m.size;
    }
    m.updatedAt = now();
    touch(p);
    return m;
  }

  function deleteMessage(p, id) {
    const m = p.messages[id];
    if (!m) return false;
    childLanesOf(p, id).forEach(function (l) { deleteLane(p, l.id); });
    p.messageOrder[m.laneId] = (p.messageOrder[m.laneId] || []).filter(function (x) { return x !== id; });
    delete p.messages[id];
    touch(p);
    return true;
  }

  /** レーン内の 1 始まり番号。見つからなければ 0。 */
  function messageIndex(p, id) {
    const m = p.messages[id];
    if (!m) return 0;
    return (p.messageOrder[m.laneId] || []).indexOf(id) + 1;
  }

  function messagesOf(p, laneId) {
    return (p.messageOrder[laneId] || []).map(function (id) { return p.messages[id]; }).filter(Boolean);
  }

  function lastRole(p, laneId) {
    const ids = p.messageOrder[laneId] || [];
    if (!ids.length) return null;
    const m = p.messages[ids[ids.length - 1]];
    return m ? m.role : null;
  }

  /** 次に貼る役割の既定値: 直前が自分なら AI、それ以外は自分。 */
  function nextRole(p, laneId) {
    return lastRole(p, laneId) === 'user' ? 'ai' : 'user';
  }

  // ---------- 付箋 / ToDo ----------
  function addSticky(p, messageId, text) {
    const m = p.messages[messageId];
    if (!m) return null;
    const s = { id: uid('s'), text: String(text || ''), todos: [] };
    (m.stickies = m.stickies || []).push(s);
    touch(p);
    return s;
  }

  function findSticky(p, messageId, stickyId) {
    const m = p.messages[messageId];
    if (!m) return null;
    return (m.stickies || []).find(function (s) { return s.id === stickyId; }) || null;
  }

  function updateSticky(p, messageId, stickyId, patch) {
    const s = findSticky(p, messageId, stickyId);
    if (!s) return null;
    if ('text' in patch) s.text = String(patch.text);
    if ('pos' in patch) {
      const pos = normalizePos(patch.pos);
      if (pos) s.pos = pos; else delete s.pos;
    }
    touch(p);
    return s;
  }

  function deleteSticky(p, messageId, stickyId) {
    const m = p.messages[messageId];
    if (!m) return false;
    const before = (m.stickies || []).length;
    m.stickies = (m.stickies || []).filter(function (s) { return s.id !== stickyId; });
    touch(p);
    return m.stickies.length !== before;
  }

  function addTodo(p, messageId, stickyId, text, afterTodoId) {
    const s = findSticky(p, messageId, stickyId);
    if (!s) return null;
    const td = { id: uid('t'), text: String(text || ''), done: false };
    const idx = afterTodoId ? s.todos.findIndex(function (t) { return t.id === afterTodoId; }) : -1;
    if (idx >= 0) s.todos.splice(idx + 1, 0, td); else s.todos.push(td);
    touch(p);
    return td;
  }

  function updateTodo(p, messageId, stickyId, todoId, patch) {
    const s = findSticky(p, messageId, stickyId);
    if (!s) return null;
    const td = s.todos.find(function (t) { return t.id === todoId; });
    if (!td) return null;
    if ('text' in patch) td.text = String(patch.text);
    if ('done' in patch) td.done = !!patch.done;
    touch(p);
    return td;
  }

  function deleteTodo(p, messageId, stickyId, todoId) {
    const s = findSticky(p, messageId, stickyId);
    if (!s) return false;
    const before = s.todos.length;
    s.todos = s.todos.filter(function (t) { return t.id !== todoId; });
    touch(p);
    return s.todos.length !== before;
  }

  // ---------- マーカー ----------
  // 範囲は「描画後の本文テキスト」上の文字位置 [start, end)。本文を編集してずれたときのため、引いた文字列 text も持つ。
  const HIGHLIGHT_COLORS = ['yellow', 'green', 'pink', 'blue'];

  /** マーカーを引く。重なる既存のマーカーは 1 本にまとめ、新しい色にする。 */
  function addHighlight(p, messageId, start, end, text, color) {
    const m = p.messages[messageId];
    if (!m || !(end > start)) return null;
    let s = start;
    let e = end;
    let t = String(text || '');
    const keep = [];
    (m.highlights || []).forEach(function (h) {
      if (h.end <= s || h.start >= e) { keep.push(h); return; }
      // 重なる → 範囲を合併。文字列も合併後の範囲に合わせる
      const ns = Math.min(s, h.start);
      const ne = Math.max(e, h.end);
      const head = h.start < s ? h.text.slice(0, s - h.start) : '';
      const tail = h.end > e ? h.text.slice(h.text.length - (h.end - e)) : '';
      t = head + t + tail;
      s = ns;
      e = ne;
    });
    const hl = { id: uid('h'), start: s, end: e, text: t, color: HIGHLIGHT_COLORS.includes(color) ? color : HIGHLIGHT_COLORS[0] };
    keep.push(hl);
    keep.sort(function (a, b) { return a.start - b.start; });
    m.highlights = keep;
    touch(p);
    return hl;
  }

  function deleteHighlight(p, messageId, highlightId) {
    const m = p.messages[messageId];
    if (!m || !m.highlights) return false;
    const before = m.highlights.length;
    m.highlights = m.highlights.filter(function (h) { return h.id !== highlightId; });
    if (!m.highlights.length) delete m.highlights;
    touch(p);
    return (m.highlights ? m.highlights.length : 0) !== before;
  }

  /**
   * 本文テキストに対してマーカーの位置を合わせ直す（DOM なし）。
   * 位置の文字列が一致しなければ、元の位置に一番近い同じ文字列を探す。見つからないものは落とす。
   */
  function resolveHighlights(highlights, plain) {
    const out = [];
    (highlights || []).forEach(function (h) {
      if (!h.text) return;
      let s = h.start;
      if (plain.slice(s, s + h.text.length) !== h.text) {
        let best = -1;
        let i = plain.indexOf(h.text);
        while (i >= 0) {
          if (best < 0 || Math.abs(i - h.start) < Math.abs(best - h.start)) best = i;
          i = plain.indexOf(h.text, i + 1);
        }
        if (best < 0) return;
        s = best;
      }
      out.push({ id: h.id, start: s, end: s + h.text.length, color: h.color });
    });
    return out;
  }

  /** 保存しているマーカー位置を今の本文テキストに合わせ直す（見つからないものは消える）。 */
  function reanchorHighlights(p, messageId, plain) {
    const m = p.messages[messageId];
    if (!m || !m.highlights) return;
    const byId = {};
    m.highlights.forEach(function (h) { byId[h.id] = h; });
    m.highlights = resolveHighlights(m.highlights, plain).map(function (r) {
      return { id: r.id, start: r.start, end: r.end, text: byId[r.id].text, color: r.color };
    });
    if (!m.highlights.length) delete m.highlights;
  }

  /** 全付箋の ToDo を表示順で集める。既定は未完了のみ。 */
  function collectTodos(p, opts) {
    const includeDone = !!(opts && opts.includeDone);
    const out = [];
    orderedLanes(p).forEach(function (lane) {
      messagesOf(p, lane.id).forEach(function (m, i) {
        (m.stickies || []).forEach(function (s) {
          (s.todos || []).forEach(function (td) {
            if (!includeDone && td.done) return;
            out.push({ laneId: lane.id, laneTitle: lane.title, messageId: m.id, index: i + 1, stickyId: s.id, todo: td });
          });
        });
      });
    });
    return out;
  }

  /** 分岐（本流以外）の軸ごとの本数。Speed 偏重の目安も返す。 */
  function axisStats(p) {
    const counts = { speed: 0, altitude: 0, depth: 0, range: 0, none: 0 };
    let total = 0;
    p.laneOrder.forEach(function (id) {
      const l = p.lanes[id];
      if (!l || id === ROOT_ID) return;
      total++;
      if (l.axis && counts.hasOwnProperty(l.axis)) counts[l.axis]++; else counts.none++;
    });
    const speedShare = total ? counts.speed / total : 0;
    return { counts, total, speedShare, hint: total >= 3 && speedShare >= 0.6 };
  }

  /** 全文検索（大文字小文字を区別しない部分一致）。 */
  function search(p, query, limit) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const max = limit || 50;
    const out = [];
    const lanes = orderedLanes(p);
    for (let li = 0; li < lanes.length && out.length < max; li++) {
      const lane = lanes[li];
      const msgs = messagesOf(p, lane.id);
      for (let i = 0; i < msgs.length && out.length < max; i++) {
        const m = msgs[i];
        const hay = m.content.toLowerCase();
        const idx = hay.indexOf(q);
        if (idx < 0) continue;
        const start = Math.max(0, idx - 40);
        const end = Math.min(m.content.length, idx + q.length + 60);
        out.push({
          messageId: m.id, laneId: lane.id, laneTitle: lane.title, index: i + 1, role: m.role,
          before: (start > 0 ? '…' : '') + m.content.slice(start, idx),
          match: m.content.slice(idx, idx + q.length),
          after: m.content.slice(idx + q.length, end) + (end < m.content.length ? '…' : ''),
        });
      }
    }
    return out;
  }

  // ---------- 入出力 ----------
  function serialize(p) { return JSON.stringify(p, null, 2); }

  function normalizeSticky(s) {
    if (!s || typeof s !== 'object') return null;
    const out = {
      id: s.id || uid('s'),
      text: typeof s.text === 'string' ? s.text : '',
      todos: Array.isArray(s.todos) ? s.todos.filter(Boolean).map(function (t) {
        return { id: t.id || uid('t'), text: typeof t.text === 'string' ? t.text : '', done: !!t.done };
      }) : [],
    };
    const pos = normalizePos(s.pos);
    if (pos) out.pos = pos;
    return out;
  }

  /** 動かした付箋の位置 { x, y }（吹き出しの左上からの px）。未指定なら null（吹き出しの下に並ぶ）。 */
  function normalizePos(pos) {
    if (!pos || typeof pos !== 'object') return null;
    const ok = function (v) { return typeof v === 'number' && isFinite(v); };
    if (!ok(pos.x) || !ok(pos.y)) return null;
    return { x: Math.round(pos.x), y: Math.round(pos.y) };
  }

  function normalizeHighlights(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (h) {
      return h && typeof h === 'object' && typeof h.text === 'string' && h.text &&
        typeof h.start === 'number' && typeof h.end === 'number' && h.end > h.start;
    }).map(function (h) {
      return {
        id: h.id || uid('h'), start: Math.round(h.start), end: Math.round(h.end), text: h.text,
        color: HIGHLIGHT_COLORS.includes(h.color) ? h.color : HIGHLIGHT_COLORS[0],
      };
    });
  }

  /** 吹き出しの手動サイズ { w, h }（px）。どちらも未指定なら null。 */
  function normalizeSize(s) {
    if (!s || typeof s !== 'object') return null;
    const px = function (v) { return typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v) : null; };
    const w = px(s.w);
    const h = px(s.h);
    if (w == null && h == null) return null;
    return { w: w, h: h };
  }

  /** 読み込んだオブジェクトを現在の schema に揃える（欠けを補い、壊れた参照を落とす）。 */
  function normalize(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('ファイル形式が違います');
    if (!obj.lanes || typeof obj.lanes !== 'object' || !obj.messages || typeof obj.messages !== 'object') {
      throw new Error('AIチャットメモのファイルではありません');
    }
    const t = now();
    const p = {
      schema: SCHEMA,
      title: typeof obj.title === 'string' && obj.title ? obj.title : DEFAULT_TITLE,
      northStar: typeof obj.northStar === 'string' ? obj.northStar : '',
      createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : t,
      updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : t,
      laneOrder: Array.isArray(obj.laneOrder) ? obj.laneOrder.filter(function (id) { return obj.lanes[id]; }) : Object.keys(obj.lanes),
      lanes: {},
      messageOrder: {},
      messages: {},
    };
    Object.keys(obj.lanes).forEach(function (id) {
      const l = obj.lanes[id] || {};
      p.lanes[id] = {
        id,
        title: typeof l.title === 'string' ? l.title : (id === ROOT_ID ? '本流' : '分岐'),
        axis: isAxis(l.axis) ? l.axis : null,
        parentMessageId: id === ROOT_ID ? null : (l.parentMessageId || null),
        collapsed: !!l.collapsed,
        createdAt: typeof l.createdAt === 'string' ? l.createdAt : p.createdAt,
      };
    });
    if (!p.lanes[ROOT_ID]) {
      p.lanes[ROOT_ID] = { id: ROOT_ID, title: '本流', axis: null, parentMessageId: null, collapsed: false, createdAt: p.createdAt };
      p.laneOrder.unshift(ROOT_ID);
    }
    Object.keys(p.lanes).forEach(function (id) { if (!p.laneOrder.includes(id)) p.laneOrder.push(id); });

    Object.keys(obj.messages).forEach(function (id) {
      const m = obj.messages[id] || {};
      if (!p.lanes[m.laneId]) return;
      p.messages[id] = {
        id,
        laneId: m.laneId,
        role: m.role === 'ai' ? 'ai' : 'user',
        content: typeof m.content === 'string' ? m.content : '',
        createdAt: typeof m.createdAt === 'string' ? m.createdAt : p.createdAt,
        updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : (typeof m.createdAt === 'string' ? m.createdAt : p.createdAt),
        stickies: Array.isArray(m.stickies) ? m.stickies.map(normalizeSticky).filter(Boolean) : [],
      };
      const size = normalizeSize(m.size);
      if (size) p.messages[id].size = size;
      const highlights = normalizeHighlights(m.highlights);
      if (highlights.length) p.messages[id].highlights = highlights;
    });

    const mo = (obj.messageOrder && typeof obj.messageOrder === 'object') ? obj.messageOrder : {};
    p.laneOrder.forEach(function (laneId) {
      const order = Array.isArray(mo[laneId])
        ? mo[laneId].filter(function (id) { return p.messages[id] && p.messages[id].laneId === laneId; })
        : [];
      const seen = new Set(order);
      Object.values(p.messages).forEach(function (m) { if (m.laneId === laneId && !seen.has(m.id)) order.push(m.id); });
      p.messageOrder[laneId] = order;
    });

    // 分岐元が消えているレーンは丸ごと落とす
    p.laneOrder.slice().forEach(function (id) {
      const l = p.lanes[id];
      if (l && id !== ROOT_ID && !p.messages[l.parentMessageId]) deleteLane(p, id);
    });
    return p;
  }

  function deserialize(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('JSONとして読み込めませんでした'); }
    return normalize(obj);
  }

  /** 人が読む用の Markdown。分岐は見出しにし、どこから生えたかを添える。 */
  function toMarkdown(p) {
    const lines = [];
    lines.push('# ' + p.title, '', '> 目的の先の目的: ' + (p.northStar ? p.northStar.replace(/\n+/g, ' / ') : '（未記入）'), '');
    orderedLanes(p).forEach(function (lane) {
      if (lane.id === ROOT_ID) {
        lines.push('## ' + lane.title);
      } else {
        const parent = parentOfLane(p, lane.id);
        const axis = lane.axis ? ' [' + AXES[lane.axis].label + ']' : '';
        const from = parent && parent.lane ? '（← ' + parent.lane.title + ' #' + parent.index + ' から）' : '';
        lines.push('## 分岐: ' + lane.title + axis + from);
      }
      lines.push('');
      const msgs = messagesOf(p, lane.id);
      if (!msgs.length) lines.push('_（メッセージなし）_', '');
      msgs.forEach(function (m, i) {
        lines.push('### #' + (i + 1) + ' ' + (m.role === 'ai' ? 'AI' : '自分'), '', (m.content || '').replace(/\s+$/, ''), '');
        (m.stickies || []).forEach(function (s) {
          const t = (s.text || '').trim();
          lines.push('> 📝 ' + (t ? t.split('\n').join('\n> ') : '付箋'));
          (s.todos || []).forEach(function (td) { lines.push('> - [' + (td.done ? 'x' : ' ') + '] ' + td.text); });
          lines.push('');
        });
      });
    });
    return lines.join('\n');
  }

  function safeFileName(title, ext) {
    const base = String(title || DEFAULT_TITLE).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || DEFAULT_TITLE;
    return base + (ext || '');
  }

  return {
    SCHEMA, ROOT_ID, AXES, AXIS_KEYS, COLORS, DEFAULT_TITLE,
    uid, now, touch,
    createProject,
    getLane, addLane, updateLane, childLanesOf, deleteLane, orderedLanes, laneDepth, parentOfLane, laneColor,
    addMessage, updateMessage, deleteMessage, messageIndex, messagesOf, lastRole, nextRole,
    addSticky, findSticky, updateSticky, deleteSticky, addTodo, updateTodo, deleteTodo, collectTodos,
    HIGHLIGHT_COLORS, addHighlight, deleteHighlight, resolveHighlights, reanchorHighlights,
    axisStats, search,
    serialize, deserialize, normalize, toMarkdown, safeFileName,
  };
});
