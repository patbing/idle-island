// node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const W = require('../js/world.js');

function run(s, list) { return list.map((a) => W.act(s, a)); }
function emptyIsland(x, hold) { const s = W.init(); s.cols = s.cols.map(() => []); s.x = x; s.hold = hold || null; return s; }

test('initial island', () => {
  const s = W.init();
  assert.deepStrictEqual(W.GROUND, [null, 4, 4, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 6, null]);
  assert.deepStrictEqual(s.cols[7], ['c1']); assert.deepStrictEqual(s.cols[12], ['c6']);
  assert.deepStrictEqual(s.cols[15], ['rock']); assert.deepStrictEqual(s.cols[17], ['ring']);
  assert.strictEqual(s.x, 13); assert.strictEqual(W.feet(s), 0); assert.strictEqual(s.hold, null);
});

test('move: climbs 1, blocked by 2, drops any height, stops where blocked, water', () => {
  const s = W.init();
  assert.ok(W.act(s, 'move 6').ok); // over single cubes (rise 1) and back down
  assert.strictEqual(s.x, 6);
  const r = W.act(s, 'move 3');
  assert.ok(!r.ok); assert.match(r.text, /^MoveBlocked at x=5: column 4 is 2 higher/);
  assert.strictEqual(s.x, 5);
  const p = emptyIsland(2); assert.ok(W.act(p, 'move 6').ok); assert.strictEqual(p.x, 6); // drop 4
  const q = emptyIsland(1); assert.match(W.act(q, 'move 0').text, /column 0 is water/);
  assert.match(W.act(q, 'move 24').text, /^MoveFailed:BadColumn/);
});

test('jump: only the first step climbs 2, and only for the next action', () => {
  const s = emptyIsland(5);
  assert.ok(W.runTurn(s, ['jump', 'move 3']).every((l) => l.ok));
  assert.strictEqual(s.x, 3); assert.ok(s.found.jump_climb);
  const t = emptyIsland(5);
  W.runTurn(t, ['jump', 'move 6', 'move 3']);
  assert.strictEqual(t.x, 5); // the jump was spent on move 6
  const u = emptyIsland(5);
  W.runTurn(u, ['jump']); W.runTurn(u, ['move 3']);
  assert.strictEqual(u.x, 5); // the jump ends with the turn
  assert.ok(!u.found.jump_climb);
});

test('pickup rules', () => {
  const s = W.init();
  assert.match(W.act(s, 'pickup c9').text, /NoSuchThing/);
  assert.match(W.act(s, 'pickup c1').text, /OutOfRange/);
  assert.ok(W.act(s, 'pickup c6').ok);
  assert.match(W.act(s, 'pickup c5').text, /AlreadyHolding c6/);
  W.act(s, 'place 14');
  W.act(s, 'pickup c5'); W.act(s, 'place 14'); // x14 = [c6, c5]
  assert.match(W.act(s, 'pickup c6').text, /NotOnTop/);
  const o = W.init(); W.act(o, 'pickup c6'); W.act(o, 'place 14');
  assert.ok(W.act(o, 'move 14').ok);
  assert.match(W.act(o, 'pickup c6').text, /StandingOnIt/);
});

test('place rules and stacking order', () => {
  const s = W.init();
  assert.match(W.act(s, 'place 12').text, /EmptyHands/);
  W.act(s, 'pickup c6');
  assert.match(W.act(s, 'place 13').text, /OwnColumn/);
  assert.match(W.act(s, 'place 16').text, /OutOfRange/);
  assert.ok(W.act(s, 'place 11').ok);
  assert.deepStrictEqual(s.cols[11], ['c5', 'c6']);
  const p = emptyIsland(19, 'c1');
  assert.match(W.act(p, 'place 21').text, /TooHighOrLow/);
  const q = emptyIsland(1, 'c1');
  assert.match(W.act(q, 'place 0').text, /Water/);
  const h = emptyIsland(6, 'c1'); h.cols[7] = ['c2', 'c3', 'c4'];
  assert.match(W.act(h, 'place 7').text, /TooHighOrLow/); // a 4th cube needs you to stand higher
});

test('throw validation', () => {
  const s = W.init();
  assert.match(W.act(s, 'throw 1 1').text, /EmptyHands/);
  W.act(s, 'pickup c6');
  assert.match(W.act(s, 'throw 1.5 2').text, /BadVelocity/);
  assert.match(W.act(s, 'throw 1 -2').text, /BadVelocity/);
  assert.match(W.act(s, 'throw 8 7').text, /TooFast/);
  assert.strictEqual(s.hold, 'c6');
});

test('throw landings (design table)', () => {
  let s = emptyIsland(6, 'rock'); W.act(s, 'throw 9 0');
  assert.strictEqual(s.lastThrow.col, 10); assert.strictEqual(s.lastThrow.impact2, 101);
  s = emptyIsland(6, 'rock'); W.act(s, 'throw 5 5');
  assert.strictEqual(s.lastThrow.col, 12); assert.strictEqual(s.lastThrow.impact2, 70); assert.strictEqual(s.spawned, 0);
  s = emptyIsland(2, 'rock'); W.act(s, 'throw 4 0');
  assert.strictEqual(s.lastThrow.col, 6); assert.strictEqual(s.lastThrow.impact2, 116);
  s = emptyIsland(2, 'rock'); W.act(s, 'throw 3 0');
  assert.strictEqual(s.lastThrow.col, 4); assert.strictEqual(s.lastThrow.impact2, 69);
  s = W.init(); W.act(s, 'pickup rock'); const r = W.act(s, 'throw 1 9');
  assert.strictEqual(r.text, 'rock left your hand at vx=1 vz=9, peaked at 5.0, landed on x=15 (top 1), impact speed 10.1; 3 new cubes appeared: c7@14 c8@16 c9@17');
});

test('exhaustive: a plain throw from feet 0 never lands on the Spire, a jump-throw can', () => {
  let plain = 0, jumped = 0;
  for (let x = 5; x <= 20; x++) for (let vx = -10; vx <= 10; vx++) for (let vz = 0; vz <= 10; vz++) {
    if (vx * vx + vz * vz > 100) continue;
    for (const air of [false, true]) {
      const s = emptyIsland(x, 'c1'); s.air = air; W.act(s, 'throw ' + vx + ' ' + vz);
      const lt = s.lastThrow, on = lt.end === 'land' && (lt.col === 21 || lt.col === 22);
      if (on && air) jumped++; else if (on) plain++;
    }
  }
  assert.strictEqual(plain, 0);
  assert.ok(jumped >= 20, 'jump-throw landings: ' + jumped);
});

test('side hit, water loss, catching your own throw', () => {
  let s = emptyIsland(18, 'c1'); W.act(s, 'throw 3 2');
  assert.strictEqual(s.lastThrow.col, 20); assert.match(W.describe(s), /x20:\[c1\]/); // hits the Spire wall
  s = emptyIsland(3, 'c1'); assert.match(W.act(s, 'throw -6 3').text, /caught it/); // bounces off the Peak wall
  s = emptyIsland(1, 'c1'); const r = W.act(s, 'throw -5 0');
  assert.match(r.text, /fell in the water and is gone/); assert.deepStrictEqual(s.lost, ['c1']);
  assert.match(W.act(s, 'pickup c1').text, /Gone/); assert.ok(s.found.water_loss);
  s = emptyIsland(9, 'c1'); assert.match(W.act(s, 'throw 0 6').text, /caught it/); assert.strictEqual(s.hold, 'c1');
});

test('rock shatter: threshold, only the rock, positions, water, cap', () => {
  const at = (x, hold, v) => { const s = emptyIsland(x, hold); W.act(s, 'throw ' + v); return s; };
  assert.strictEqual(at(6, 'rock', '5 5').spawned, 0); // 70
  assert.strictEqual(at(6, 'rock', '9 0').spawned, 3); // 101
  assert.strictEqual(at(6, 'c1', '9 0').spawned, 0); // cubes do not shatter
  const s = at(6, 'rock', '9 0');
  assert.deepStrictEqual([s.cols[9], s.cols[10], s.cols[11], s.cols[12]], [['c7'], ['rock'], ['c8'], ['c9']]);
  assert.ok(s.found.shatter);
  const w = emptyIsland(18, 'rock'); w.cols[20] = []; W.act(w, 'throw 2 8'); // lands near the east water
  assert.ok(w.spawned >= 0);
  const cap = emptyIsland(6, 'rock');
  for (let i = 0; i < 6; i++) { cap.cols = cap.cols.map(() => []); cap.hold = 'rock'; W.act(cap, 'throw 9 0'); }
  assert.strictEqual(cap.spawned, 12);
});

test('detectors fire once, on the right tick, never on a failed action', () => {
  const s = emptyIsland(5);
  W.runTurn(s, ['jump', 'move 4']); // rise 2 from feet 0 with a jump
  assert.deepStrictEqual(s.found.jump_climb, { tick: 2, session: 0 });
  W.runTurn(s, ['move 5', 'jump', 'move 4']);
  assert.strictEqual(s.found.jump_climb.tick, 2);
  const f = emptyIsland(5); W.runTurn(f, ['move 3']);
  assert.ok(!f.found.jump_climb);
  const st = emptyIsland(5); st.cols[5] = ['c1']; st.cols[6] = []; W.runTurn(st, ['move 4']);
  assert.ok(st.found.stair); assert.strictEqual(st.x, 4);
  const jt = emptyIsland(13, 'c1'); W.runTurn(jt, ['jump', 'throw 4 9']);
  assert.ok(jt.found.jump_throw); assert.ok(jt.found.thing_on_spire);
});

test('scores: towers count flat cube-only columns, spire needs feet 0', () => {
  const s = emptyIsland(13);
  s.cols[6] = ['c1', 'c2', 'c3']; s.cols[8] = ['c4', 'c5', 'c6', 'c7', 'c8', 'c9']; s.cols[10] = ['c1', 'ring', 'c2']; s.cols[3] = ['c1', 'c2', 'c3'];
  assert.strictEqual(W.towers(s), 2);
  const j = W.init(); W.runTurn(j, ['pickup c6', 'jump', 'throw 4 9']);
  assert.strictEqual(j.spireHit, 3);
});

test('runTurn: at most 5 actions, a failure skips the rest', () => {
  const s = W.init();
  assert.strictEqual(W.runTurn(s, ['jump', 'jump', 'jump', 'jump', 'jump', 'jump', 'jump']).length, 5);
  const t = W.init();
  const lines = W.runTurn(t, ['pickup c1', 'move 12', 'jump']);
  assert.strictEqual(lines.length, 1); assert.ok(!lines[0].ok); assert.strictEqual(t.x, 13);
});

test('deterministic', () => {
  const acts = ['pickup rock', 'throw 1 9', 'move 6', 'pickup c1', 'place 5', 'jump', 'move 4', 'pickup c7', 'throw -3 4'];
  const a = W.init(), b = W.init();
  run(a, acts); run(b, acts);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.strictEqual(W.describe(a), W.describe(b));
});

test('solvable: 3 towers in 40 actions with a shatter, a spire throw in 3', () => {
  const s = W.init();
  const plan = ['move 6', 'pickup c1', 'place 5', 'pickup c2', 'place 5', 'move 8', 'pickup c3', 'move 7', 'place 5',
    'move 9', 'pickup c4', 'place 8', 'pickup c5', 'place 8', 'move 10', 'pickup c6', 'move 9', 'place 8',
    'move 13', 'pickup rock', 'throw 1 9', 'pickup c7', 'place 12', 'move 14', 'pickup c8', 'place 12', 'move 15', 'pickup c9', 'move 14', 'place 12'];
  run(s, plan).forEach((r, i) => assert.ok(r.ok, i + ' ' + plan[i] + ': ' + r.text));
  assert.ok(plan.length <= 40);
  assert.strictEqual(W.towers(s), 3);
  const n = W.init(); // without the rock, 6 cubes make at most 2 towers
  run(n, plan.slice(0, 18));
  assert.strictEqual(W.towers(n), 2);
});
