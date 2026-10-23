'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../js/model.js');

function sampleProject() {
  const p = Model.createProject('テスト');
  const m1 = Model.addMessage(p, 'root', 'user', 'ログイン画面を作りたい');
  const m2 = Model.addMessage(p, 'root', 'ai', '# 手順\n\n1. フォーム\n2. 認証');
  const m3 = Model.addMessage(p, 'root', 'user', '認証はどうやる？');
  return { p, m1, m2, m3 };
}

test('付箋の位置は保存され、null で吹き出しの下に戻る', () => {
  const { p, m1 } = sampleProject();
  const s = Model.addSticky(p, m1, 'メモ');
  Model.updateSticky(p, m1, s.id, { pos: { x: 120.4, y: -30 } });
  assert.deepEqual(Model.findSticky(p, m1, s.id).pos, { x: 120, y: -30 });
  const back = Model.deserialize(Model.serialize(p));
  assert.deepEqual(Model.findSticky(back, m1, s.id).pos, { x: 120, y: -30 });
  Model.updateSticky(p, m1, s.id, { pos: null });
  assert.equal('pos' in Model.findSticky(p, m1, s.id), false);
});

test('マーカー: 重なると 1 本にまとまり、本文がずれても文字列で追いかける', () => {
  const { p, m1 } = sampleProject();
  const plain = 'ログイン画面を作りたい';
  Model.addHighlight(p, m1, 0, 4, plain.slice(0, 4), 'green');
  const merged = Model.addHighlight(p, m1, 2, 6, plain.slice(2, 6), 'pink');
  const hs = p.messages[m1].highlights;
  assert.equal(hs.length, 1);
  assert.deepEqual([merged.start, merged.end, merged.text, merged.color], [0, 6, 'ログイン画面', 'pink']);

  // 先頭に文字が増えた → 位置は同じ文字列のところへ
  const r = Model.resolveHighlights(hs, '新しいログイン画面を作りたい');
  assert.deepEqual([r[0].start, r[0].end], [3, 9]);
  // 文字列が消えた → 落とす
  assert.equal(Model.resolveHighlights(hs, '別の文章').length, 0);

  Model.reanchorHighlights(p, m1, '新しいログイン画面を作りたい');
  assert.equal(p.messages[m1].highlights[0].start, 3);
  const back = Model.deserialize(Model.serialize(p));
  assert.equal(back.messages[m1].highlights[0].text, 'ログイン画面');
  assert.equal(Model.deleteHighlight(p, m1, merged.id), true);
  assert.equal('highlights' in p.messages[m1], false);
});

test('createProject は本流レーンだけを持つ', () => {
  const p = Model.createProject();
  assert.equal(p.schema, Model.SCHEMA);
  assert.deepEqual(p.laneOrder, ['root']);
  assert.equal(p.lanes.root.title, '本流');
  assert.deepEqual(p.messageOrder.root, []);
});

test('メッセージ追加と役割の自動反転', () => {
  const p = Model.createProject();
  assert.equal(Model.nextRole(p, 'root'), 'user');
  const a = Model.addMessage(p, 'root', 'user', 'こんにちは');
  assert.equal(Model.nextRole(p, 'root'), 'ai');
  Model.addMessage(p, 'root', 'ai', 'はい');
  assert.equal(Model.nextRole(p, 'root'), 'user');
  assert.equal(Model.messageIndex(p, a), 1);
  assert.equal(Model.messagesOf(p, 'root').length, 2);
});

test('分岐は DFS 順に並ぶ（分岐元メッセージの位置順、同じ元なら作成順）', () => {
  const { p, m1, m2 } = sampleProject();
  const laneA = Model.addLane(p, m2, 'A: m2から', 'depth');
  const laneB = Model.addLane(p, m1, 'B: m1から', 'speed');
  const aMsg = Model.addMessage(p, laneA, 'user', 'A の中');
  const laneC = Model.addLane(p, aMsg, 'C: Aの中から', null);
  const laneD = Model.addLane(p, m2, 'D: m2から2本目', 'range');

  const order = Model.orderedLanes(p).map((l) => l.id);
  assert.deepEqual(order, ['root', laneB, laneA, laneC, laneD]);
  assert.equal(Model.laneDepth(p, 'root'), 0);
  assert.equal(Model.laneDepth(p, laneA), 1);
  assert.equal(Model.laneDepth(p, laneC), 2);

  const parent = Model.parentOfLane(p, laneC);
  assert.equal(parent.lane.id, laneA);
  assert.equal(parent.index, 1);
  assert.equal(Model.parentOfLane(p, 'root'), null);
});

test('軸は4種類のみ受け付け、色が引ける', () => {
  const { p, m1 } = sampleProject();
  const l = Model.addLane(p, m1, 'x', 'bogus');
  assert.equal(p.lanes[l].axis, null);
  Model.updateLane(p, l, { axis: 'altitude' });
  assert.equal(p.lanes[l].axis, 'altitude');
  assert.equal(Model.laneColor(p.lanes[l]), Model.AXES.altitude.color);
  assert.equal(Model.laneColor(p.lanes.root), Model.COLORS.main);
});

test('メッセージ削除は子レーンを連鎖削除する', () => {
  const { p, m2 } = sampleProject();
  const laneA = Model.addLane(p, m2, 'A');
  const aMsg = Model.addMessage(p, laneA, 'user', 'a');
  const laneC = Model.addLane(p, aMsg, 'C');
  Model.addMessage(p, laneC, 'ai', 'c');

  assert.equal(Model.childLanesOf(p, m2).length, 1);
  assert.ok(Model.deleteMessage(p, m2));
  assert.equal(p.messages[m2], undefined);
  assert.equal(p.lanes[laneA], undefined);
  assert.equal(p.lanes[laneC], undefined);
  assert.deepEqual(p.laneOrder, ['root']);
  assert.equal(Object.keys(p.messages).length, 2);
  assert.equal(Model.messagesOf(p, 'root').length, 2);
});

test('本流は削除できない', () => {
  const p = Model.createProject();
  assert.equal(Model.deleteLane(p, 'root'), false);
  assert.ok(p.lanes.root);
});

test('付箋と ToDo の追加・更新・集計', () => {
  const { p, m1, m3 } = sampleProject();
  const s = Model.addSticky(p, m1, 'メモ');
  const t1 = Model.addTodo(p, m1, s.id, 'やること1');
  const t2 = Model.addTodo(p, m1, s.id, 'やること2');
  const tMid = Model.addTodo(p, m1, s.id, '間に挿入', t1.id);
  assert.deepEqual(s.todos.map((t) => t.text), ['やること1', '間に挿入', 'やること2']);

  Model.updateTodo(p, m1, s.id, t2.id, { done: true });
  const s2 = Model.addSticky(p, m3, '');
  Model.addTodo(p, m3, s2.id, '認証方式を決める');

  const open = Model.collectTodos(p);
  assert.deepEqual(open.map((x) => x.todo.text), ['やること1', '間に挿入', '認証方式を決める']);
  assert.equal(open[2].index, 3);
  assert.equal(Model.collectTodos(p, { includeDone: true }).length, 4);

  assert.ok(Model.deleteTodo(p, m1, s.id, tMid.id));
  assert.ok(Model.deleteSticky(p, m1, s.id));
  assert.equal(p.messages[m1].stickies.length, 0);
});

test('axisStats は Speed 偏重を検出する', () => {
  const { p, m1, m2 } = sampleProject();
  Model.addLane(p, m1, 'a', 'speed');
  Model.addLane(p, m1, 'b', 'speed');
  let st = Model.axisStats(p);
  assert.equal(st.total, 2);
  assert.equal(st.hint, false, '2本では警告しない');
  Model.addLane(p, m2, 'c', 'speed');
  st = Model.axisStats(p);
  assert.equal(st.total, 3);
  assert.equal(st.counts.speed, 3);
  assert.equal(st.hint, true);
  Model.addLane(p, m2, 'd', 'depth');
  Model.addLane(p, m2, 'e', 'altitude');
  st = Model.axisStats(p);
  assert.equal(st.hint, true, '3/5 = 60% はまだ警告');
  Model.addLane(p, m2, 'f', null);
  assert.equal(Model.axisStats(p).hint, false, '3/6 = 50% で解除');
  assert.equal(Model.axisStats(p).counts.none, 1);
});

test('search は大文字小文字を無視して前後の文脈を返す', () => {
  const { p } = sampleProject();
  const hits = Model.search(p, '認証');
  assert.equal(hits.length, 2);
  assert.equal(hits[0].match, '認証');
  assert.equal(hits[0].laneTitle, '本流');
  assert.equal(Model.search(p, 'ZZZ').length, 0);
  assert.equal(Model.search(p, '').length, 0);
  const upper = Model.search(Object.assign(Model.createProject(), {}), 'x');
  assert.deepEqual(upper, []);
});

test('serialize → deserialize で分岐・付箋・ToDo が完全に戻る', () => {
  const { p, m1, m2 } = sampleProject();
  p.northStar = 'クラッシュゼロのアプリ';
  const laneA = Model.addLane(p, m2, 'A', 'depth');
  const aMsg = Model.addMessage(p, laneA, 'user', 'a');
  Model.addLane(p, aMsg, 'C', 'range');
  const s = Model.addSticky(p, m1, 'メモ');
  Model.addTodo(p, m1, s.id, 'todo');
  Model.updateLane(p, laneA, { collapsed: true });

  const text = Model.serialize(p);
  const q = Model.deserialize(text);
  assert.deepEqual(q, p);
  assert.deepEqual(Model.orderedLanes(q).map((l) => l.id), Model.orderedLanes(p).map((l) => l.id));
});

test('deserialize は壊れた入力を拒否し、欠けを補う', () => {
  assert.throws(() => Model.deserialize('not json'), /JSON/);
  assert.throws(() => Model.deserialize('[]'), /形式/);
  assert.throws(() => Model.deserialize('{"foo":1}'), /ファイルではありません/);

  // 最小限のオブジェクトから本流・順序・付箋配列を補う
  const q = Model.deserialize(JSON.stringify({
    lanes: { root: { title: '本流' }, l1: { title: '迷子', parentMessageId: 'missing' } },
    messages: { m1: { laneId: 'root', role: 'ai', content: 'hi' }, m2: { laneId: 'root', role: 'bogus' } },
  }));
  assert.equal(q.schema, Model.SCHEMA);
  assert.equal(q.title, Model.DEFAULT_TITLE);
  assert.deepEqual(q.laneOrder, ['root'], '分岐元が無いレーンは落とす');
  assert.deepEqual(q.messageOrder.root.sort(), ['m1', 'm2']);
  assert.equal(q.messages.m2.role, 'user');
  assert.deepEqual(q.messages.m1.stickies, []);
});

test('toMarkdown は分岐の出所と付箋の ToDo を含む', () => {
  const { p, m2 } = sampleProject();
  p.northStar = '手順を聞かずに済む状態';
  const laneA = Model.addLane(p, m2, '認証の深掘り', 'depth');
  const a1 = Model.addMessage(p, laneA, 'user', 'OAuth と パスキーの比較');
  const s = Model.addSticky(p, a1, '比較表を作る');
  Model.addTodo(p, a1, s.id, '仕様を読む');
  const t = Model.addTodo(p, a1, s.id, '試作');
  Model.updateTodo(p, a1, s.id, t.id, { done: true });

  const md = Model.toMarkdown(p);
  assert.match(md, /^# テスト\n/);
  assert.match(md, /> 目的の先の目的: 手順を聞かずに済む状態/);
  assert.match(md, /## 本流\n/);
  assert.match(md, /### #2 AI\n\n# 手順/);
  assert.match(md, /## 分岐: 認証の深掘り \[Depth\]（← 本流 #2 から）/);
  assert.match(md, /> 📝 比較表を作る\n> - \[ \] 仕様を読む\n> - \[x\] 試作/);
});

test('safeFileName は Windows で使えない文字を置き換える', () => {
  assert.equal(Model.safeFileName('a/b:c*d?e"f<g>h|i', '.json'), 'a_b_c_d_e_f_g_h_i.json');
  assert.equal(Model.safeFileName('', '.md'), Model.DEFAULT_TITLE + '.md');
});

test('吹き出しのサイズは保存・読み込みで保たれ、null で解除できる', () => {
  const { p, m2 } = sampleProject();
  Model.updateMessage(p, m2, { size: { w: 700.4, h: null } });
  assert.deepEqual(p.messages[m2].size, { w: 700, h: null });
  const loaded = Model.normalize(JSON.parse(Model.serialize(p)));
  assert.deepEqual(loaded.messages[m2].size, { w: 700, h: null });
  Model.updateMessage(p, m2, { size: { w: null, h: null } });
  assert.equal('size' in p.messages[m2], false);
  const bad = Model.normalize(Object.assign(JSON.parse(Model.serialize(p)), {}));
  bad.messages[m2].size = { w: -3, h: 'x' };
  assert.equal('size' in Model.normalize(bad).messages[m2], false);
});

test('チュートリアルの保存例は normalize を通しても形が崩れない', () => {
  const Tutorial = require('../js/tutorial.js');
  const p = Tutorial.build();
  const q = Model.deserialize(Model.serialize(p));
  assert.equal(q.title, Tutorial.TITLE);
  assert.equal(q.laneOrder.length, 4);
  assert.deepEqual(Model.orderedLanes(q).map(l => l.axis), [null, 'altitude', 'depth', 'range']);
  assert.equal(Object.keys(q.messages).length, 8);
  assert.ok(Model.collectTodos(q).length >= 6);
});
