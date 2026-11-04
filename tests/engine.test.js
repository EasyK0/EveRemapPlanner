// Tests for engine.js. Run with: node --test tests/engine.test.js
// The skill data (SKILLS, TYPES) lives in the first <script> of remap-planner.html,
// so it is loaded from there together with engine.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'remap-planner.html'), 'utf8').replace(/\r\n/g, '\n');
const engineSrc = fs.readFileSync(path.join(root, 'engine.js'), 'utf8').replace(/\r\n/g, '\n');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(scripts[0] + '\n;globalThis.SKILLS = SKILLS; globalThis.TYPES = TYPES;', ctx);
vm.runInContext(engineSrc, ctx);
const E = ctx.module.exports;

const levels = (name, to) => Array.from({ length: to }, (_, i) => `${name} ${i + 1}`).join('\n');
const build = text => E.buildPlan(E.parseList(text).entries);
const rowsOf = p => p.blocks.flatMap(b => b.rows.map(r => r.it));
const name = it => `${it.sk.name} ${it.lvl}`;
const attrs = a => ({ P: a.P, M: a.M, W: a.W, I: a.I, C: a.C });
const CUR = { P: 17, M: 21, W: 17, I: 27, C: 17 }; // an Intelligence/Memory remap

test('the engine inside remap-planner.html is the same as engine.js', () => {
  const body = engineSrc.trim();
  const noExport = body.slice(0, body.lastIndexOf('\nif (typeof module'));
  assert.ok(scripts[1].includes(noExport), 'copy engine.js into remap-planner.html');
});

test('every remap has 99 points with each attribute 17 to 27', () => {
  assert.ok(E.REMAPS.length > 0);
  for (const a of E.REMAPS) {
    assert.equal(E.ATTRS.reduce((s, k) => s + a[k], 0), 99);
    for (const k of E.ATTRS) assert.ok(a[k] >= 17 && a[k] <= 27);
  }
});

test('remap: a Perception/Willpower plan gets Perception 27, Willpower 21', () => {
  const { items } = build([levels('Spaceship Command', 5), levels('Gallente Frigate', 5)].join('\n'));
  assert.deepEqual(attrs(E.bestRemap(items, 0).a), { P: 27, M: 17, W: 21, I: 17, C: 17 });
});

test('remap: one or two remaps are never slower than no remap', () => {
  const { items } = build([levels('Spaceship Command', 5), levels('Gallente Frigate', 5), levels('Science', 5), levels('Navigation', 5)].join('\n'));
  const none = E.plan(items, 0, CUR, 0), one = E.plan(items, 1, CUR, 0), two = E.plan(items, 2, CUR, 0);
  assert.ok(Math.abs(none.total - none.baseT) < 1e-6);
  assert.ok(one.total < none.total);
  assert.ok(two.total <= one.total + 1e-6);
});

test('queue: prerequisites always come before the skills that need them', () => {
  // listed in reverse on purpose: the turret needs Gunnery 3 and Small Hybrid Turret 3
  // (Science adds a second attribute pair, so the 2-remap mode has something to split)
  const { items, missing } = build([levels('Medium Hybrid Turret', 3), levels('Small Hybrid Turret', 3), levels('Gunnery', 3), levels('Science', 4)].join('\n'));
  assert.equal(missing.length, 0);
  for (const mode of [0, 1, 2]) {
    const order = rowsOf(E.plan(items, mode, CUR, 0));
    assert.equal(order.length, items.length);
    const pos = new Map(order.map((it, i) => [it, i]));
    for (const it of order) for (const d of it.deps) assert.ok(pos.get(d) < pos.get(it), `mode ${mode}: ${name(d)} before ${name(it)}`);
    const first = order.findIndex(it => it.sk.name === 'Medium Hybrid Turret');
    assert.ok(order.findIndex(it => name(it) === 'Gunnery 3') < first);
    assert.ok(order.findIndex(it => name(it) === 'Small Hybrid Turret 3') < first);
  }
});

test('2 remaps: a plan that uses only one attribute pair falls back to one remap', () => {
  const { items } = build([levels('Spaceship Command', 5), levels('Gallente Frigate', 5)].join('\n'));
  const two = E.plan(items, 2, CUR, 0);
  assert.ok(Math.abs(two.total - E.plan(items, 1, CUR, 0).total) < 1e-6);
});

test('queue: independent skills are ordered shortest first', () => {
  const { items } = build([levels('Navigation', 5), levels('Drones', 5), levels('Spaceship Command', 4)].join('\n'));
  const rows = E.plan(items, 0, CUR, 0).blocks[0].rows;
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].t >= rows[i - 1].t - 1e-9, `${name(rows[i].it)} after ${name(rows[i - 1].it)}`);
});

test('queue: missing prerequisites are listed', () => {
  const { missing } = build('Gallente Cruiser 1');
  assert.ok(missing.some(m => m.sk.name === 'Gallente Destroyer' && m.lvl === 3));
});

test('Cybernetics and its prerequisites go first in every mode', () => {
  const { items } = build([levels('Navigation', 3), levels('Drones', 3), levels('Science', 3), levels('Cybernetics', 4)].join('\n'));
  const firstCount = 7; // Science 1-3 and Cybernetics 1-4
  for (const mode of [0, 1, 2]) {
    const order = rowsOf(E.plan(items, mode, CUR, 3));
    const head = order.slice(0, firstCount).map(it => it.sk.name);
    assert.ok(head.every(n => n === 'Science' || n === 'Cybernetics'), `mode ${mode}: ${head.join(', ')}`);
  }
});

test('Cybernetics level L only gets implants up to +(L-1)', () => {
  const { items } = build(levels('Cybernetics', 2));
  const t = imp => E.plan(items, 0, CUR, imp).blocks[0].rows.map(r => r.t);
  assert.equal(t(5)[0], t(0)[0]);      // level 1: no implant bonus yet
  assert.equal(t(5)[1], t(1)[1]);      // level 2: +1 at most
  assert.ok(t(1)[1] < t(0)[1]);
});

test('plan parsing accepts Roman numerals and reports unknown lines', () => {
  const r = E.parseList('Navigation IV\nDrones level 3\nNot A Skill 2');
  // Array.from: the engine runs in its own vm context, so its arrays have another prototype
  assert.deepEqual(Array.from(r.entries, e => [E.BY_ID.get(e.id).name, e.lvl]), [['Navigation', 4], ['Drones', 3]]);
  assert.deepEqual(Array.from(r.unknown), ['Not A Skill 2']);
});

test('durations are formatted as days, hours and minutes', () => {
  assert.equal(E.fmtDur(1500), '1d 1h 0m');
  assert.equal(E.fmtDur(61), '1h 1m');
  assert.equal(E.fmtDur(5), '5m');
});

test('planText lists the remap and every queued skill in order', () => {
  const lab = { title: 'Plan', total: 'Plan time', base: 'Without remap', cur: 'Current attributes', remap: 'Remap', remapN: n => 'Remap ' + n };
  const p = E.plan(build('Gunnery 3\nDrones 3').items, 1, CUR, 0);
  const lines = E.planText(p, lab).split('\n');
  assert.equal(lines[0], 'Plan');
  assert.equal(lines[2], `Plan time: ${E.fmtDur(p.total)} (Without remap: ${E.fmtDur(p.baseT)})`);
  const a = p.blocks[0].a;
  assert.equal(lines[4], `Remap: Perception ${a.P}, Memory ${a.M}, Willpower ${a.W}, Intelligence ${a.I}, Charisma ${a.C} (${E.fmtDur(p.blocks[0].t)})`);
  const skills = lines.filter(l => /^\d+\. /.test(l)).map(l => l.replace(/^\d+\. /, '').replace(/ \(.*\)$/, ''));
  assert.deepEqual(skills, Array.from(rowsOf(p), name));
  assert.equal(lines.at(-1), '');
});

test('planText names the blocks for no remap and for two remaps', () => {
  const lab = { title: 'Plan', total: 'T', base: 'B', cur: 'Current attributes', remap: 'Remap', remapN: n => 'Remap ' + n };
  const items = build(levels('Gunnery', 5) + '\n' + levels('Drones', 5) + '\n' + levels('Leadership', 5)).items;
  assert.ok(E.planText(E.plan(items, 0, CUR, 0), lab).includes('\nCurrent attributes: '));
  const two = E.plan(items, 2, CUR, 0);
  const text = E.planText(two, lab);
  assert.equal(two.blocks.length, 2);
  assert.ok(text.includes('Remap 1: ') && text.includes('Remap 2: '));
});
