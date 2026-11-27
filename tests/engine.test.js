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

test('fit parsing recognises implants and boosters and counts their skills', () => {
  const fit = E.parseFit('[Rifter, Test]\nGyrostabilizer II\n\nHornet II x2\n\nMid-grade Amulet Alpha\nHigh-grade Snake Alpha\nSynth Blue Pill Booster');
  assert.equal(fit.ship.name, 'Rifter');
  assert.deepEqual(Array.from(fit.unknown), []);
  assert.deepEqual(Array.from(fit.types, t => t.name), ['Gyrostabilizer II', 'Hornet II', 'Mid-grade Amulet Alpha', 'High-grade Snake Alpha', 'Synth Blue Pill Booster']);
  const need = E.fitSkills(fit, 0);
  const cyber = E.skillByName('Cybernetics').id;
  assert.ok(need.get(cyber).lvl >= 1);
  assert.equal(need.get(cyber).why, 'implant');
  assert.equal(need.get(E.skillByName('Biology').id).why, 'implant');
});

test('fitSkills adds skills picked from the suggestions with their prerequisites', () => {
  const fit = E.parseFit('[Rifter, Test]\n200mm AutoCannon II');
  const base = E.fitSkills(fit, 0);
  const sk = E.skillByName('Surgical Strike');
  assert.ok(!base.has(sk.id));
  const need = E.fitSkills(fit, 0, [[sk.id, 4]]);
  assert.deepEqual({ ...need.get(sk.id) }, { lvl: 4, why: 'added' });
  for (const [r, rl] of sk.req) assert.ok(need.get(r).lvl >= rl);
  // the suggestions for the fit no longer offer it
  const lvl = id => (need.has(id) ? need.get(id).lvl : 0);
  const rows = E.suggestions({ planned: need, levelOf: lvl, items: [] }).flatMap(g => g.rows.map(r => r.sk.name));
  assert.ok(!rows.includes('Surgical Strike'));
  assert.ok(rows.length > 0);
});

test('fitUpgrades offers the next skill level, and V at Elite', () => {
  const fit = E.parseFit('[Rifter, Test]\n200mm AutoCannon II\nGyrostabilizer II');
  for (const tier of [0, 1]) {
    const need = E.fitSkills(fit, tier), next = E.fitSkills(fit, tier + 1);
    const ups = E.fitUpgrades(fit, tier);
    assert.ok(ups.length > 0);
    for (const u of ups) {
      assert.equal(u.lvl, next.get(u.sk.id).lvl);
      assert.equal(u.cur, need.has(u.sk.id) ? need.get(u.sk.id).lvl : 0);
      assert.ok(u.lvl > u.cur);
    }
  }
  const elite = E.fitUpgrades(fit, 2);
  assert.ok(elite.length > 0);
  for (const u of elite) assert.ok(u.lvl === 5 && u.cur < 5);
});

test('suggestions go up to IV first and offer V as a separate step', () => {
  assert.equal(E.stepTo(4, 5), 4);
  assert.equal(E.stepTo(1, 5), 4);
  assert.equal(E.stepTo(5, 5), 5);
  assert.equal(E.stepTo(1, 3), 3);
  const gun = E.skillByName('Gunnery'); // the turret rule wants Gunnery V
  const sugg = lvl => {
    const P = build('Small Projectile Turret 1\nGunnery ' + lvl);
    return E.suggestions(P).flatMap(g => g.rows).find(r => r.sk.id === gun.id);
  };
  assert.equal(sugg(3).lvl, 4);
  assert.equal(sugg(4).lvl, 5);
  assert.equal(sugg(5), undefined);
});

test('fitCapped lowers a skill but never below what the fit or another skill needs', () => {
  const fit = E.parseFit('[Kronos, Test]');
  const full = E.fitSkills(fit, 1);
  const id = n => E.skillByName(n).id;
  const mar = id('Marauders'), gbs = id('Gallente Battleship'), gcr = id('Gallente Battlecruiser');
  assert.ok(full.get(mar).lvl >= 4);
  // Marauders 4 -> 3 is allowed (the Kronos itself only needs level 1)
  const a = E.fitCapped(fit, full, [[mar, 3]]);
  assert.equal(a.need.get(mar).lvl, 3);
  assert.equal(a.need.get(mar).lowered, true);
  // Gallente Battlecruiser cannot go below what Gallente Battleship needs
  const need = E.skillByName('Gallente Battleship').req.find(([r]) => r === gcr)[1];
  const b = E.fitCapped(fit, full, [[gcr, 0]]);
  assert.equal(b.need.get(gcr).lvl, need);
  assert.equal(b.floor.get(gcr).lvl, need);
  assert.ok(b.floor.get(gcr).by.has('Gallente Battleship'));
  // the ship's own requirement holds too
  const shipReq = fit.ship.req.find(([r]) => r === gbs)[1];
  assert.equal(E.fitCapped(fit, full, [[gbs, 0]]).need.get(gbs).lvl, shipReq);
});

test('Micro Jump Drive Operation is suggested for ships but not added by Good or Elite', () => {
  const fit = E.parseFit('[Rifter, Test]\nGyrostabilizer II');
  const mjd = E.skillByName('Micro Jump Drive Operation').id;
  for (const tier of [1, 2]) {
    const need = E.fitSkills(fit, tier);
    assert.ok(!need.has(mjd));
    const lvl = id => (need.has(id) ? need.get(id).lvl : 0);
    const rows = E.suggestions({ planned: need, levelOf: lvl, items: [] }).flatMap(g => g.rows);
    assert.equal(rows.find(r => r.sk.id === mjd).lvl, 4);
  }
});

test('a target painter in the fit brings Signature Focusing', () => {
  const fit = E.parseFit('[Damnation, Test]\nTarget Painter II');
  const sf = E.skillByName('Signature Focusing').id;
  assert.ok(!E.fitSkills(fit, 0).has(sf));
  assert.ok(E.fitSkills(fit, 1).get(sf).lvl >= 4);
  const plain = E.parseFit('[Damnation, Test]');
  const need = E.fitSkills(plain, 1);
  assert.ok(!need.has(sf));
});

test('fleetSkills takes the highest level any saved ship needs', () => {
  const kronos = { fit: '[Kronos, A]', tier: 0, add: [], cap: [] };
  const rifter = { fit: '[Rifter, B]\n200mm AutoCannon II', tier: 1, add: [], cap: [] };
  const empty = { fit: '', tier: 1 };
  const F = E.fleetSkills([kronos, rifter, empty]);
  assert.equal(F.ships, 2);
  for (const p of [kronos, rifter]) {
    const fit = E.parseFit(p.fit);
    for (const [id, v] of E.fitSkills(fit, p.tier)) assert.ok(F.need.get(id) >= v.lvl);
  }
  // a lowered level in one profile is respected
  const mar = E.skillByName('Marauders').id;
  const k1 = { ...kronos, tier: 1 };
  assert.equal(E.fleetSkills([{ ...k1, cap: [[mar, 2]] }]).need.get(mar), 2);
});
