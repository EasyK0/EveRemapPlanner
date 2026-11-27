// ---- Engine: skill data, plan parsing, remap, ordering. No DOM. ----
const ATTRS = ['P', 'M', 'W', 'I', 'C']; // order of the in-game remap window
const ANAME = { P: 'Perception', M: 'Memory', W: 'Willpower', I: 'Intelligence', C: 'Charisma' };
const LV = [0, 250, 1415, 8000, 45255, 256000];
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };

const BY_ID = new Map();
const BY_NAME = new Map();
for (const [id, name, group, rank, p, s, req] of SKILLS) {
  const sk = { id, name, group, rank, p, s, req };
  BY_ID.set(id, sk);
  BY_NAME.set(name.toLowerCase(), sk);
}

function skillByName(n) { return BY_NAME.get(n.trim().toLowerCase().replace(/\s+/g, ' ')); }

// Returns {entries:[{id,lvl}], unknown:[line]}
function parseList(text) {
  const entries = [], unknown = [];
  for (let raw of String(text || '').split(/\r?\n/)) {
    let line = raw.replace(/^[\s\-•*·\d]+[.)]\s+/, '').replace(/\t+/g, ' ').trim();
    if (!line) continue;
    const m = line.match(/^(.+?)\s+(?:level\s+|lvl\s+|poziom\s+)?([1-5]|iv|v|i{1,3})(?=\s|$|[^a-z])/i);
    let sk = null, lvl = 0;
    if (m) { sk = skillByName(m[1]); lvl = /\d/.test(m[2]) ? +m[2] : ROMAN[m[2].toLowerCase()]; }
    if (!sk || !lvl) { unknown.push(raw.trim()); continue; }
    entries.push({ id: sk.id, lvl });
  }
  return { entries, unknown };
}

function spFor(sk, L) { return sk.rank * (LV[L] - LV[L - 1]); }
function rateOf(sk, a, imp) { return (a[sk.p] + imp) + (a[sk.s] + imp) / 2; } // SP/min

// Builds queue entries from the plan. trainedExtra: Map id->level (optional pasted trained skills).
// starter: Map id->level of starting skills; they only count for skills outside the plan.
function buildPlan(entries, trainedExtra, starter) {
  const planned = new Map(); // id -> Set of levels
  for (const e of entries) {
    if (!planned.has(e.id)) planned.set(e.id, new Set());
    planned.get(e.id).add(e.lvl);
  }
  const trained = new Map(trainedExtra || []);
  const items = [], byKey = new Map(), skillRange = new Map();
  for (const [id, set] of planned) {
    const sk = BY_ID.get(id);
    const min = Math.min(...set), max = Math.max(...set);
    // Levels below the first one in the plan are treated as trained.
    const have = Math.max(trained.get(id) || 0, min - 1);
    trained.set(id, have);
    if (have >= max) continue;
    skillRange.set(id, { from: have + 1, to: max });
    for (let L = have + 1; L <= max; L++) {
      const it = { key: id + ':' + L, sk, lvl: L, sp: spFor(sk, L), auto: !set.has(L), deps: [] };
      items.push(it); byKey.set(it.key, it);
    }
  }
  for (const [id, lvl] of starter || []) if (!planned.has(id) && (trained.get(id) || 0) < lvl) trained.set(id, lvl);
  const missing = new Map(); // id -> {sk, lvl, by:Set, inPlan}
  const levelOf = id => skillRange.has(id) ? skillRange.get(id).to : (trained.get(id) || 0);
  for (const it of items) {
    if (it.lvl > 1 && byKey.has(it.sk.id + ':' + (it.lvl - 1))) it.deps.push(byKey.get(it.sk.id + ':' + (it.lvl - 1)));
    if (it.lvl !== skillRange.get(it.sk.id).from) continue;
    for (const [r, rl] of it.sk.req) {
      const rr = skillRange.get(r);
      const dep = byKey.get(r + ':' + rl) || (rr && rl > rr.to ? byKey.get(r + ':' + rr.to) : null);
      if (dep) it.deps.push(dep);
      if (levelOf(r) < rl) {
        const m = missing.get(r) || { sk: BY_ID.get(r), lvl: 0, by: new Set(), inPlan: planned.has(r), have: levelOf(r) };
        m.lvl = Math.max(m.lvl, rl); m.by.add(it.sk.name); missing.set(r, m);
      }
    }
  }
  return { items, missing: [...missing.values()], levelOf, planned };
}

// All remaps: each attribute 17..27, 99 in total.
const REMAPS = [];
(function gen(i, left, cur) {
  if (i === 4) { if (left <= 10) { const a = {}; ATTRS.forEach((k, j) => a[k] = 17 + (j < 4 ? cur[j] : left)); REMAPS.push(a); } return; }
  for (let x = 0; x <= Math.min(10, left); x++) gen(i + 1, left - x, [...cur, x]);
})(0, 14, []);

// Cybernetics: while training level L you have L-1, so implants work up to +(L-1) at most.
const CYBER = BY_NAME.get('cybernetics').id;
function impOf(it, imp) { return it.sk.id === CYBER ? Math.min(imp, it.lvl - 1) : imp; }
function itT(it, a, imp) { return it.sp / rateOf(it.sk, a, impOf(it, imp)); }
function aggregate(items, imp) {
  const agg = new Map();
  for (const it of items) { const i = impOf(it, imp), k = it.sk.p + it.sk.s + i; agg.set(k, (agg.get(k) || 0) + it.sp); }
  return [...agg].map(([k, sp]) => [k[0], k[1], sp, +k.slice(2)]);
}
function timeAgg(agg, a) { let t = 0; for (const [p, s, sp, i] of agg) t += sp / ((a[p] + i) + (a[s] + i) / 2); return t; }
function timeItems(items, a, imp) { let t = 0; for (const it of items) t += itT(it, a, imp); return t; }
function bestRemap(items, imp) {
  const agg = aggregate(items, imp); let best = null, bt = Infinity;
  for (const a of REMAPS) { const t = timeAgg(agg, a); if (t < bt - 1e-9) { bt = t; best = a; } }
  return { a: best, t: bt };
}

// Maximum closure (min-cut): picks set A (block 1) closed under prerequisites.
function closure(items, w) {
  const n = items.length, S = n, T = n + 1, N = n + 2;
  const head = new Int32Array(N).fill(-1), to = [], cap = [], nxt = [];
  const add = (u, v, c) => { to.push(v); cap.push(c); nxt.push(head[u]); head[u] = to.length - 1; to.push(u); cap.push(0); nxt.push(head[v]); head[v] = to.length - 1; };
  const idx = new Map(items.map((it, i) => [it, i]));
  items.forEach((it, i) => {
    if (w[i] > 0) add(S, i, w[i]); else if (w[i] < 0) add(i, T, -w[i]);
    for (const d of it.deps) if (idx.has(d)) add(i, idx.get(d), 1e15);
  });
  const level = new Int32Array(N), it2 = new Int32Array(N);
  const bfs = () => { level.fill(-1); level[S] = 0; const q = [S]; for (let h = 0; h < q.length; h++) { const u = q[h]; for (let e = head[u]; e >= 0; e = nxt[e]) if (cap[e] > 1e-9 && level[to[e]] < 0) { level[to[e]] = level[u] + 1; q.push(to[e]); } } return level[T] >= 0; };
  const dfs = (u, f) => { if (u === T) return f; for (; it2[u] >= 0; it2[u] = nxt[it2[u]]) { const e = it2[u], v = to[e]; if (cap[e] > 1e-9 && level[v] === level[u] + 1) { const d = dfs(v, Math.min(f, cap[e])); if (d > 1e-12) { cap[e] -= d; cap[e ^ 1] += d; return d; } } } return 0; };
  while (bfs()) { for (let i = 0; i < N; i++) it2[i] = head[i]; while (dfs(S, Infinity) > 1e-12); }
  const seen = new Uint8Array(N); const q = [S]; seen[S] = 1;
  for (let h = 0; h < q.length; h++) { const u = q[h]; for (let e = head[u]; e >= 0; e = nxt[e]) if (cap[e] > 1e-9 && !seen[to[e]]) { seen[to[e]] = 1; q.push(to[e]); } }
  return items.map((_, i) => !!seen[i]);
}

function pureRemap(p, s) { const a = { P: 17, M: 17, W: 17, I: 17, C: 17 }; a[p] = 27; if (s !== p) a[s] = 21; else a[p] = 27; return a; }
const sameA = (x, y) => ATTRS.every(k => x[k] === y[k]);

function bestTwo(items, imp) {
  const starts = []; const push = a => { if (!starts.some(b => sameA(a, b))) starts.push(a); };
  push(bestRemap(items, imp).a);
  for (const [p, s] of aggregate(items, imp)) push(pureRemap(p, s));
  let best = null;
  for (const a0 of starts) for (const b0 of starts) {
    if (a0 === b0) continue;
    let rA = a0, rB = b0, total = Infinity, A = null, B = null;
    for (let iter = 0; iter < 12; iter++) {
      const w = items.map(it => it.first ? 1e12 : itT(it, rB, imp) - itT(it, rA, imp));
      const inA = closure(items, w);
      const nA = items.filter((_, i) => inA[i]), nB = items.filter((_, i) => !inA[i]);
      const bA = nA.length ? bestRemap(nA, imp) : { a: rA, t: 0 };
      const bB = nB.length ? bestRemap(nB, imp) : { a: rB, t: 0 };
      const t = bA.t + bB.t;
      if (t >= total - 1e-6) break;
      total = t; A = nA; B = nB; rA = bA.a; rB = bB.a;
    }
    if (A && (!best || total < best.total)) best = { total, blocks: [{ a: rA, items: A }, { a: rB, items: B }] };
  }
  // Every skill wants the same remap: a second remap cannot help, so use one.
  if (!best) { const one = bestRemap(items, imp); return { total: one.t, blocks: [{ a: one.a, items }] }; }
  best.blocks = best.blocks.filter(b => b.items.length);
  return best;
}

// Order inside a block: shortest first, but prerequisites always earlier.
function orderBlock(items, a, imp, done) {
  const left = new Set(items), out = [];
  const ready = it => it.deps.every(d => done.has(d));
  while (left.size) {
    let pick = null, pt = Infinity;
    // Cybernetics and its prerequisites always go first, so implants can be plugged in as soon as possible.
    const firstLeft = [...left].some(it => it.first);
    for (const it of left) if (ready(it) && (!firstLeft || it.first)) { const t = itT(it, a, imp); if (t < pt || (t === pt && it.lvl < pick.lvl)) { pt = t; pick = it; } }
    if (!pick) { pick = left.values().next().value; pt = itT(pick, a, imp); } // should not happen
    left.delete(pick); done.add(pick); out.push({ it: pick, t: pt });
  }
  return out;
}

function plan(items, mode, cur, imp) {
  const mark = it => { if (it.first) return; it.first = true; it.deps.forEach(mark); };
  items.forEach(it => { it.first = false; });
  items.filter(it => it.sk.id === CYBER).forEach(mark);
  const baseT = timeItems(items, cur, imp);
  let blocks;
  if (!items.length) blocks = [];
  else if (mode === 0) blocks = [{ a: cur, items, remap: false }];
  else if (mode === 1) blocks = [{ a: bestRemap(items, imp).a, items }];
  else blocks = bestTwo(items, imp).blocks;
  const done = new Set(); let clock = 0;
  const outBlocks = blocks.map(b => {
    const rows = orderBlock(b.items, b.a, imp, done).map(r => { const row = { ...r, start: clock, end: clock + r.t }; clock += r.t; return row; });
    return { a: b.a, remap: b.remap !== false, rows, t: rows.reduce((x, r) => x + r.t, 0) };
  });
  return { baseT, total: clock, blocks: outBlocks, sp: items.reduce((x, it) => x + it.sp, 0) };
}

function fmtDur(min) {
  min = Math.round(min);
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return (d ? d + 'd ' : '') + (d || h ? h + 'h ' : '') + m + 'm';
}

// Plain-text export of a plan: plan time, then each block's attributes and its skills in order.
// Skill lines keep the 'Name level' form, so they can be pasted back into the planner or the game.
// lab holds the texts in the page language: title, total, base, cur, remap, remapN(n).
function planText(R, lab) {
  const lines = [lab.title, '', lab.total + ': ' + fmtDur(R.total) + ' (' + lab.base + ': ' + fmtDur(R.baseT) + ')'];
  let n = 0;
  R.blocks.forEach((b, i) => {
    const head = !b.remap ? lab.cur : R.blocks.length > 1 ? lab.remapN(i + 1) : lab.remap;
    lines.push('', head + ': ' + ATTRS.map(k => ANAME[k] + ' ' + b.a[k]).join(', ') + ' (' + fmtDur(b.t) + ')');
    for (const r of b.rows) lines.push(++n + '. ' + r.it.sk.name + ' ' + r.it.lvl + ' (' + fmtDur(r.t) + ')');
  });
  return lines.join('\n') + '\n';
}

// ---- Support skill suggestions. when(ctx) gets the names and groups of skills in the plan. ----
// A suggestion goes up to IV in one step; V (long) is offered on its own after IV.
const stepTo = (from, lvl) => Math.min(lvl, Math.max(from, 4));
const RULES = [
  { id: 'fit', label: { pl: 'Fitowanie i cap', en: 'Fitting and capacitor' }, why: { pl: 'Bez nich brakuje CPU, PG albo capa na każdym statku', en: 'Without these you run short of CPU, powergrid or cap on every ship' },
    when: c => c.groups.has('Spaceship Command'),
    add: [['CPU Management', 4], ['Power Grid Management', 4], ['Capacitor Management', 4], ['Capacitor Systems Operation', 4], ['Weapon Upgrades', 4], ['Thermodynamics', 3]] },
  { id: 'nav', label: { pl: 'Nawigacja', en: 'Navigation' }, why: { pl: 'Szybszy warp, align i lepszy MWD/AB', en: 'Faster warp and align, better MWD/AB' },
    when: c => c.groups.has('Spaceship Command'),
    add: [['Navigation', 4], ['Evasive Maneuvering', 4], ['Warp Drive Operation', 4], ['Spaceship Command', 4], ['Afterburner', 4], ['High Speed Maneuvering', 3], ['Acceleration Control', 4], ['Fuel Conservation', 3]] },
  { id: 'tgt', label: { pl: 'Celowanie', en: 'Targeting' }, why: { pl: 'Szybszy lock i większy zasięg', en: 'Faster lock and longer range' },
    when: c => c.groups.has('Spaceship Command'),
    add: [['Signature Analysis', 4], ['Long Range Targeting', 4], ['Target Management', 4]] },
  { id: 'armor', label: { pl: 'Tank pancerza', en: 'Armor tank' }, why: { pl: 'W planie są skille pancerza', en: 'Your plan has armor skills' },
    when: c => c.groups.has('Armor') || c.names.has('Armor Rigging'),
    add: [['Repair Systems', 4], ['Hull Upgrades', 4], ['Mechanics', 4], ['Armor Layering', 4], ['EM Armor Compensation', 4], ['Thermal Armor Compensation', 4], ['Kinetic Armor Compensation', 4], ['Explosive Armor Compensation', 4], ['Jury Rigging', 3], ['Armor Rigging', 3]] },
  { id: 'shield', label: { pl: 'Tank tarczy', en: 'Shield tank' }, why: { pl: 'W planie są skille tarczy', en: 'Your plan has shield skills' },
    when: c => c.groups.has('Shields') || c.names.has('Shield Rigging'),
    add: [['Shield Operation', 4], ['Shield Management', 4], ['Shield Upgrades', 4], ['Tactical Shield Manipulation', 4], ['EM Shield Compensation', 4], ['Thermal Shield Compensation', 4], ['Kinetic Shield Compensation', 4], ['Explosive Shield Compensation', 4], ['Jury Rigging', 3], ['Shield Rigging', 3]] },
  { id: 'turret', label: { pl: 'Działa (wsparcie)', en: 'Turret support' }, why: { pl: 'Każdy z nich podbija DPS albo zasięg wszystkich dział', en: 'Each one raises DPS or range of every turret' },
    when: c => [...c.names].some(n => /(Hybrid|Energy|Projectile|Precursor|Vorton) (Turret|Weapon|Projector)$/.test(n)),
    add: [['Gunnery', 5], ['Motion Prediction', 4], ['Rapid Firing', 4], ['Sharpshooter', 4], ['Surgical Strike', 4], ['Trajectory Analysis', 4], ['Weapon Upgrades', 4], ['Advanced Weapon Upgrades', 4]] },
  { id: 'hybrid', label: { pl: 'Działa hybrydowe', en: 'Hybrid turrets' }, why: { pl: 'Rigi i cap pod blastery/raile', en: 'Rigs and cap for blasters and rails' },
    when: c => [...c.names].some(n => /Hybrid Turret$/.test(n)),
    add: [['Controlled Bursts', 4], ['Hybrid Weapon Rigging', 3]] },
  { id: 'energy', label: { pl: 'Lasery', en: 'Lasers' }, why: { pl: 'Lasery zjadają dużo capa', en: 'Lasers use a lot of capacitor' },
    when: c => [...c.names].some(n => /Energy Turret$/.test(n)),
    add: [['Controlled Bursts', 4], ['Energy Weapon Rigging', 3]] },
  { id: 'proj', label: { pl: 'Działa projectile', en: 'Projectile turrets' }, why: { pl: 'Rigi pod artylerię i autocannony', en: 'Rigs for artillery and autocannons' },
    when: c => [...c.names].some(n => /Projectile Turret$/.test(n)),
    add: [['Projectile Weapon Rigging', 3]] },
  { id: 'missile', label: { pl: 'Rakiety (wsparcie)', en: 'Missile support' }, why: { pl: 'Podbijają obrażenia i zasięg wszystkich wyrzutni', en: 'Raise damage and range of every launcher' },
    when: c => c.groups.has('Missiles'),
    add: [['Missile Launcher Operation', 5], ['Rapid Launch', 4], ['Warhead Upgrades', 4], ['Missile Bombardment', 4], ['Missile Projection', 4], ['Target Navigation Prediction', 4], ['Guided Missile Precision', 4], ['Weapon Upgrades', 4], ['Launcher Rigging', 3]] },
  { id: 'drones', label: { pl: 'Drony', en: 'Drones' }, why: { pl: 'Obrażenia, zasięg i przeżywalność dronów', en: 'Drone damage, range and survivability' },
    when: c => c.groups.has('Drones'),
    add: [['Drones', 5], ['Drone Interfacing', 4], ['Drone Avionics', 4], ['Drone Navigation', 4], ['Drone Sharpshooting', 4], ['Drone Durability', 4], ['Light Drone Operation', 4], ['Medium Drone Operation', 4], ['Drones Rigging', 3]] },
  { id: 'command', label: { pl: 'Boostery floty', en: 'Fleet boosts' }, why: { pl: 'W planie są Command Bursty', en: 'Your plan has command bursts' },
    when: c => c.groups.has('Fleet Support'),
    add: c => {
      const a = [['Leadership', 5], ['Command Burst Specialist', 4]];
      for (const k of ['Armored', 'Shield', 'Information', 'Skirmish', 'Expedition'])
        if (c.names.has(k + ' Command')) a.push([k + ' Command', 5], [k + ' Command Specialist', 4]);
      if (c.names.has('Command Ships')) a.push(['Wing Command', 4]);
      return a;
    } },
  { id: 'ewar', label: { pl: 'Moduły EWAR', en: 'Electronic warfare' }, why: { pl: 'Mocniejsze paintery, disruptory, dampy i jammery z fitu', en: 'Stronger painters, disruptors, dampeners and jammers from the fit' },
    when: c => ['Target Painting', 'Weapon Disruption', 'Sensor Linking', 'Electronic Warfare'].some(n => c.names.has(n)),
    add: c => {
      const a = [];
      if (c.names.has('Target Painting')) a.push(['Target Painting', 4], ['Signature Focusing', 4]);
      if (c.names.has('Weapon Disruption')) a.push(['Weapon Disruption', 4], ['Weapon Destabilization', 4]);
      if (c.names.has('Sensor Linking')) a.push(['Sensor Linking', 4], ['Signal Suppression', 4]);
      if (c.names.has('Electronic Warfare')) a.push(['Electronic Warfare', 4], ['Signal Dispersion', 4], ['Long Distance Jamming', 3], ['Frequency Modulation', 3]);
      return a;
    } },
  { id: 'mjd', label: { pl: 'Micro Jump Drive', en: 'Micro Jump Drive' }, why: { pl: 'Szybszy MJD: ucieczka z bubli, dystans od celu', en: 'Faster MJD: out of bubbles, range from the target' },
    when: c => c.groups.has('Spaceship Command'), suggestOnly: true,
    add: [['Micro Jump Drive Operation', 4]] },
  { id: 'implants', label: { pl: 'Implanty', en: 'Implants' }, why: { pl: 'Implanty +5 wymagają Cybernetics 5', en: '+5 implants need Cybernetics 5' },
    when: () => true,
    add: [['Cybernetics', 5]] },
];

// Returns [{rule, rows:[{sk, lvl, from, why}]}] with only what the plan is missing.
// planObj needs planned (Map with skill ids as keys), levelOf(id) and items; the Fit tab passes the fit's skills.
function suggestions(planObj) {
  const names = new Set(), groups = new Set();
  for (const id of planObj.planned.keys()) { const sk = BY_ID.get(id); names.add(sk.name); groups.add(sk.group); }
  const ctx = { names, groups, items: planObj.items.length };
  const seen = new Set(), out = [];
  for (const r of RULES) {
    if (!r.when(ctx)) continue;
    const list = typeof r.add === 'function' ? r.add(ctx) : r.add;
    const rows = [];
    for (const [n, lvl] of list) {
      const sk = skillByName(n); if (!sk) continue;
      const have = planObj.levelOf(sk.id);
      if (have >= lvl || seen.has(sk.id)) continue;
      seen.add(sk.id);
      rows.push({ sk, lvl: stepTo(have + 1, lvl), from: have + 1 });
    }
    if (rows.length) out.push({ rule: r, rows });
  }
  return out;
}


// ---- Fit: EFT parsing and the skills a ship needs. TYPES: [name, category, group, metaGroup, requirements, fitting dogma] ----
const TYPE_BY_NAME = new Map();
if (typeof TYPES !== 'undefined') for (const [name, cat, group, meta, req, fd] of TYPES) TYPE_BY_NAME.set(name.toLowerCase(), { name, cat, group, meta, req, fd });

// EFT: [Ship, name], then modules "Module, Ammo", drones/cargo "Name x5", then implants and boosters (category 20).
function parseFit(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let ship = null, fitName = '';
  const types = [], unknown = [], mods = []; // mods: fitted modules and subsystems, {t, off}
  for (const line of lines) {
    const h = line.match(/^\[([^,\]]+)(?:,\s*([^\]]*))?\]$/);
    if (h) {
      const t = TYPE_BY_NAME.get(h[1].trim().toLowerCase());
      if (/^empty /i.test(h[1])) continue;
      if (!ship && t && t.cat === 6) { ship = t; fitName = (h[2] || '').trim(); continue; }
      if (!t) { unknown.push(line); continue; }
    }
    line.split(/,\s*/).forEach((part, i) => {
      const off = /\/\s*offline$/i.test(part), qty = /\s+x\d+$/i.test(part);
      part = part.replace(/\s*\/\s*offline$/i, '').replace(/\s+x\d+$/i, '').trim();
      if (!part || /^\[empty .*\]$/i.test(part)) return;
      const t = TYPE_BY_NAME.get(part.toLowerCase());
      if (!t) { unknown.push(part); return; }
      types.push(t);
      // Drones and cargo carry "xN"; the part after the comma is the loaded charge.
      if (i === 0 && !qty && (t.cat === 7 || t.cat === 32)) mods.push({ t, off });
    });
  }
  return { ship, fitName, types, unknown, mods };
}

const WEAPON_GROUP = /Weapon|Launcher|Vorton|Projector|Combat Drone|Fighter|Sentry/i;
const ELITE5 = new Set(['Gunnery', 'Drones', 'Missile Launcher Operation', 'Rapid Firing', 'Surgical Strike', 'Drone Interfacing', 'Warhead Upgrades', 'Rapid Launch',
  'Hull Upgrades', 'Shield Management', 'Shield Upgrades', 'Shield Operation', 'Repair Systems', 'Mechanics', 'Capacitor Management', 'Capacitor Systems Operation',
  'CPU Management', 'Power Grid Management', 'Weapon Upgrades', 'Navigation', 'Evasive Maneuvering', 'Leadership', 'Thermodynamics']);

// ---- Fitting: CPU and powergrid of a fit, from the SDE dogma in FITD (a small dogma engine). ----
// Modifiers from ships, charges, skills, implants and subsystems are not stacking penalized.
const FIT_NOPEN = new Set([6, 8, 16, 20, 32]);
const hasFitd = () => typeof FITD !== 'undefined';
// lvlOf(skillId) -> trained level. Returns {cpu: [used, output], pg: [used, output]} or null without data.
function fitResources(fit, lvlOf) {
  if (!hasFitd() || !fit.ship || !fit.ship.fd) return null;
  const items = [];
  const add = (cat, fd, req, extra) => { const it = { n: items.length, cat, gid: fd[0], at: fd[1], ef: fd[2], req: req || [], ...extra }; items.push(it); return it; };
  const ship = add(6, fit.ship.fd, fit.ship.req);
  const mods = (fit.mods || []).filter(m => m.t.fd).map(m => add(m.t.cat, m.t.fd, m.t.req, { off: m.off }));
  for (const t of fit.types) if (t.cat === 20 && t.fd) add(20, t.fd, t.req);
  for (const id in FITD.S) { const l = lvlOf(+id); if (l > 0) add(16, [0, ...FITD.S[id]], [], { id: +id, level: l }); }
  const byTarget = new Map();
  const push = (tg, a, m) => { const k = tg.n + ':' + a; if (!byTarget.has(k)) byTarget.set(k, []); byTarget.get(k).push(m); };
  for (const src of items) for (const ef of src.ef) for (const [dom, func, op, a, ma, grp, sk] of FITD.E[ef] || []) {
    const m = { src, a: ma, op };
    if (func === 0) { if (dom === 0) push(src, a, m); else if (dom === 1) push(ship, a, m); continue; }
    if (dom !== 1) continue;
    const skill = sk === -1 ? src.id : sk;
    for (const t of mods) {
      if (func === 1 && t.gid !== grp) continue;
      if (func === 3 && !t.req.some(([r]) => r === skill)) continue;
      push(t, a, m);
    }
  }
  const memo = new Map();
  const mul = (v, list, f) => {
    const pen = [[], []];
    for (const m of list) { const x = f(m.x); if (m.p) pen[x < 1 ? 1 : 0].push(x); else v *= x; }
    for (const p of pen) { p.sort((a, b) => Math.abs(Math.log(b)) - Math.abs(Math.log(a))); p.forEach((x, i) => { v *= 1 + (x - 1) * Math.exp(-((i / 2.67) ** 2)); }); }
    return v;
  };
  const val = (it, a) => {
    const k = it.n + ':' + a;
    if (memo.has(k)) return memo.get(k);
    memo.set(k, 0); // guards against loops
    let v = a === 280 && it.level ? it.level : it.at[a] != null ? it.at[a] : FITD.A[a] ? FITD.A[a][0] : 0;
    const stack = !FITD.A[a] || FITD.A[a][1];
    const by = op => (byTarget.get(k) || []).filter(m => m.op === op).map(m => ({ x: val(m.src, m.a), p: !stack && !FIT_NOPEN.has(m.src.cat) }));
    for (const m of by(-1)) v = m.x;
    v = mul(v, by(0), x => x); v = mul(v, by(1), x => (x ? 1 / x : 1));
    for (const m of by(2)) v += m.x;
    for (const m of by(3)) v -= m.x;
    v = mul(v, by(4), x => x); v = mul(v, by(5), x => (x ? 1 / x : 1)); v = mul(v, by(6), x => 1 + x / 100);
    for (const m of by(7)) v = m.x;
    memo.set(k, v);
    return v;
  };
  const on = mods.filter(m => !m.off);
  const r2 = x => Math.round(x * 100) / 100;
  return {
    cpu: [r2(on.reduce((s, m) => s + val(m, 50), 0)), r2(val(ship, 48))],
    pg: [r2(on.reduce((s, m) => s + val(m, 30), 0)), r2(val(ship, 11))],
  };
}
const fitShort = r => Math.max(0, r.cpu[0] - r.cpu[1]) / Math.max(1, r.cpu[1]) + Math.max(0, r.pg[0] - r.pg[1]) / Math.max(1, r.pg[1]);
// lvl: Map skillId -> level. True when the fit has enough CPU and powergrid (or there is no data to tell).
function fitsAt(fit, lvl) { const r = fitResources(fit, id => lvl.get(id) || 0); return !r || fitShort(r) === 0; }
// Raises the fitting skills (CPU Management, Weapon Upgrades, ...) until the fit has enough CPU and powergrid,
// each step the one with the most CPU/PG for its skill points. lvl is changed in place.
// max: optional Map skillId -> highest level allowed. Returns false when even that does not fit.
function fitFitting(fit, lvl, max) {
  let r = fitResources(fit, id => lvl.get(id) || 0);
  if (!r || fitShort(r) === 0) return true;
  const raise = (m, id, L) => {
    let sp = 0;
    for (let x = (m.get(id) || 0) + 1; x <= L; x++) sp += spFor(BY_ID.get(id), x);
    if ((m.get(id) || 0) < L) m.set(id, L);
    for (const [q, ql] of BY_ID.get(id).req) sp += raise(m, q, ql);
    return sp;
  };
  const cand = Object.keys(FITD.S).map(Number).filter(id => BY_ID.has(id));
  const start = new Map(lvl);
  for (let guard = 0; guard < 200 && fitShort(r) > 0; guard++) {
    let best = null;
    for (const id of cand) {
      const L = (lvl.get(id) || 0) + 1;
      if (L > 5 || (max && max.has(id) && L > max.get(id))) continue;
      const t = new Map(lvl), sp = raise(t, id, L);
      const rt = fitResources(fit, x => t.get(x) || 0), gain = fitShort(r) - fitShort(rt);
      if (gain > 1e-9 && (!best || gain / sp > best.score)) best = { t, rt, score: gain / sp };
    }
    if (!best) return false;
    for (const [id, l] of best.t) lvl.set(id, l);
    r = best.rt;
  }
  // Take back levels that turned out not to be needed, most expensive first.
  const raised = [...lvl.keys()].filter(id => (lvl.get(id) || 0) > (start.get(id) || 0))
    .sort((a, b) => spFor(BY_ID.get(b), lvl.get(b)) - spFor(BY_ID.get(a), lvl.get(a)));
  const neededBy = (id, L) => [...lvl].some(([o, ol]) => ol > 0 && BY_ID.get(o).req.some(([q, ql]) => q === id && ql > L));
  for (const id of raised) {
    while ((lvl.get(id) || 0) > (start.get(id) || 0) && !neededBy(id, lvl.get(id) - 1)) {
      const t = new Map(lvl); t.set(id, lvl.get(id) - 1);
      if (!fitsAt(fit, t)) break;
      lvl.set(id, t.get(id));
    }
  }
  for (const [id, l] of [...lvl]) if (l === 0 && !start.has(id)) lvl.delete(id);
  return fitShort(fitResources(fit, id => lvl.get(id) || 0)) === 0;
}

// tier: 0 minimum, 1 good, 2 elite. extra: optional [[skillId, level]] the user added from the suggestions.
// Every tier also gets the skills it takes for the fit's CPU and powergrid (why 'fitting').
// Returns Map skillId -> {lvl, why:'ship'|'weapon'|'module'|'implant'|'support'|'added'|'fitting'|'req'}
function fitSkills(fit, tier, extra) {
  const need = new Map();
  const want = (id, lvl, why) => {
    const cur = need.get(id);
    if (!cur || cur.lvl < lvl) need.set(id, { lvl, why: cur && cur.why !== 'req' ? cur.why : why });
    for (const [r, rl] of BY_ID.get(id).req) want(r, rl, 'req');
  };
  const direct = (t, why) => {
    for (const [id, l] of t.req) {
      const spec = /Specialization$/.test(BY_ID.get(id).name);
      let lvl = l;
      if (tier === 1) lvl = Math.max(l, spec ? 3 : 4);
      if (tier === 2) lvl = Math.max(l, spec ? 4 : 5);
      want(id, lvl, why);
    }
  };
  if (fit.ship) { if (tier) direct(fit.ship, 'ship'); else for (const [id, l] of fit.ship.req) want(id, l, 'ship'); }
  for (const t of fit.types) {
    const weapon = WEAPON_GROUP.test(t.group) && (t.cat === 7 || t.cat === 18 || t.cat === 87);
    if (tier && weapon) direct(t, 'weapon');
    else for (const [id, l] of t.req) want(id, l, weapon ? 'weapon' : t.cat === 20 ? 'implant' : 'module');
  }
  if (tier) {
    // Support skills from the same rules as the plan, matched to the skills the fit needs.
    const names = new Set([...need.keys()].map(id => BY_ID.get(id).name));
    const groups = new Set([...need.keys()].map(id => BY_ID.get(id).group));
    const ctx = { names, groups, items: 1 };
    for (const r of RULES) {
      if (r.suggestOnly || !r.when(ctx)) continue; // suggestOnly: offered at the bottom, never added by Good/Elite
      for (const [n, l] of (typeof r.add === 'function' ? r.add(ctx) : r.add)) {
        const sk = skillByName(n); if (!sk) continue;
        want(sk.id, tier === 2 && ELITE5.has(n) ? 5 : l, 'support');
      }
    }
  }
  for (const [id, l] of extra || []) if (BY_ID.has(id)) want(id, l, 'added');
  const lvl = new Map([...need].map(([id, v]) => [id, v.lvl]));
  fitFitting(fit, lvl);
  for (const [id, l] of lvl) if (l > (need.has(id) ? need.get(id).lvl : 0)) want(id, l, 'fitting');
  return need;
}

// Levels a fit cannot go below: what the fitted items need and what the other skills need.
// lvl: Map skillId -> level. Returns Map skillId -> {lvl, by: Set of names}.
function fitFloors(fit, lvl) {
  const fl = new Map();
  const bump = (id, l, name) => {
    const c = fl.get(id) || { lvl: 0, by: new Set() };
    if (l > c.lvl) { c.lvl = l; c.by = new Set([name]); } else if (l === c.lvl) c.by.add(name);
    fl.set(id, c);
  };
  for (const t of [fit.ship, ...fit.types]) if (t) for (const [id, l] of t.req) bump(id, l, t.name);
  for (const [id, l] of lvl) if (l > 0) for (const [r, rl] of BY_ID.get(id).req) bump(r, rl, BY_ID.get(id).name);
  // CPU and powergrid: a fitting skill one level lower would leave the fit short.
  const r = fitResources(fit, id => lvl.get(id) || 0);
  if (r && fitShort(r) === 0) for (const [id, l] of lvl) {
    if (!(id in FITD.S) || l < 1) continue;
    const t = new Map(lvl); t.set(id, l - 1);
    const rt = fitResources(fit, x => t.get(x) || 0);
    if (fitShort(rt) > 0) bump(id, l, rt.cpu[0] > rt.cpu[1] ? 'CPU' : 'Powergrid');
  }
  return fl;
}

// Applies the levels the user lowered (caps: [[skillId, level]]) to a fitSkills() result,
// never below fitFloors(). Skills lowered to 0 are dropped. Returns {need, floor}.
function fitCapped(fit, need, caps) {
  const lvl = new Map([...need].map(([id, v]) => [id, v.lvl]));
  for (const [id, c] of caps || []) if (lvl.has(id)) lvl.set(id, Math.min(lvl.get(id), c));
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, f] of fitFloors(fit, lvl)) if ((lvl.get(id) || 0) < f.lvl) { lvl.set(id, f.lvl); changed = true; }
  }
  // Short of CPU or powergrid after lowering: other fitting skills make up for it, the lowered ones as a last resort.
  if (!fitsAt(fit, lvl) && !fitFitting(fit, lvl, new Map((caps || []).filter(([id]) => lvl.has(id)).map(([id]) => [id, lvl.get(id)])))) fitFitting(fit, lvl);
  const out = new Map();
  for (const [id, l] of lvl) if (l > 0) out.set(id, need.has(id) ? { ...need.get(id), lvl: l, lowered: l < need.get(id).lvl } : { lvl: l, why: 'fitting', lowered: false });
  return { need: out, floor: fitFloors(fit, lvl) };
}

// Skills for several saved ship profiles together: the highest level any of them needs.
// profiles: [{fit (EFT text), tier, add, cap}]. Returns {need: Map skillId -> level, ships: count}.
function fleetSkills(profiles) {
  const need = new Map(); let ships = 0;
  for (const p of profiles) {
    const fit = parseFit(p.fit);
    if (!fit.ship && !fit.types.length) continue;
    ships++;
    const one = fitCapped(fit, fitSkills(fit, p.tier || 0, p.add), p.cap).need;
    for (const [id, v] of one) need.set(id, Math.max(need.get(id) || 0, v.lvl));
  }
  return { need, ships };
}

// Next step up for a fit: what the next skill level (Minimum -> Good -> Elite) adds,
// or at Elite the skills the fit uses that are still below V. Returns [{sk, lvl, cur}].
function fitUpgrades(fit, tier, extra) {
  const need = fitSkills(fit, tier, extra), out = [];
  const curOf = id => (need.has(id) ? need.get(id).lvl : 0);
  if (tier < 2) {
    for (const [id, v] of fitSkills(fit, tier + 1, extra)) if (v.lvl > curOf(id)) out.push({ sk: BY_ID.get(id), lvl: v.lvl, cur: curOf(id) });
  } else {
    for (const [id, v] of need) if (v.why !== 'req' && v.lvl < 5) out.push({ sk: BY_ID.get(id), lvl: 5, cur: v.lvl });
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { fitResources, fitFitting, fitsAt, fleetSkills, fitFloors, fitCapped, stepTo, planText, parseFit, fitSkills, fitUpgrades, TYPE_BY_NAME, suggestions, RULES, parseList, buildPlan, plan, bestRemap, fmtDur, BY_ID, BY_NAME, skillByName, spFor, rateOf, REMAPS, ATTRS };
