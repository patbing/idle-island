/* Idle Island world engine. Deterministic: the same actions always give the same state.
 * Only + - * /, Math.floor and Math.sqrt are used, so browsers and Node agree to the bit.
 * Classic script (window.II.world) and CommonJS module (tests, recorder).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.II = root.II || {}; root.II.world = factory(); }
})(this, function () {
  'use strict';

  var W = 24;
  // null = water. Peak x1-2, Plateau x3-4, flat x5-20, Spire x21-22.
  var GROUND = [null, 4, 4, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 6, null];
  var G = 10, JUMP_VZ = 4, SHATTER2 = 100, MAX_SPEED2 = 100, MAX_SPAWN = 12, STEPS = 400;
  var TECHNIQUES = ['shatter', 'jump_throw', 'jump_climb', 'stair'];
  var LABELS = {
    shatter: 'rock shatter', jump_throw: 'jump-throw', jump_climb: 'jump-climb', stair: 'cube stair',
    on_plateau: 'on the Plateau', on_peak: 'on the Peak', on_spire: 'on the Spire',
    thing_on_spire: 'a thing on the Spire', tower3: 'a 3-cube tower', water_loss: 'lost a thing in the water'
  };

  function init() {
    var cols = [];
    for (var x = 0; x < W; x++) cols.push([]);
    [7, 8, 9, 10, 11, 12].forEach(function (x, i) { cols[x].push('c' + (i + 1)); });
    cols[15].push('rock');
    cols[17].push('ring');
    return { cols: cols, x: 13, hold: null, air: false, tick: 0, spawned: 0, lost: [], found: {}, events: [], lastThrow: null, spireHit: null, session: 0 };
  }

  function clone(s) { return JSON.parse(JSON.stringify(s)); }
  function isWater(x) { return x < 0 || x >= W || GROUND[x] === null; }
  function top(s, x) { return isWater(x) ? null : GROUND[x] + s.cols[x].length; }
  function feet(s) { return top(s, s.x); }
  function isCube(id) { return /^c\d+$/.test(id); }
  function exists(s, id) { return id === 'rock' || id === 'ring' || (isCube(id) && Number(id.slice(1)) >= 1 && Number(id.slice(1)) <= 6 + s.spawned); }
  function where(s, id) {
    for (var x = 0; x < W; x++) { var i = s.cols[x].indexOf(id); if (i >= 0) return { x: x, i: i }; }
    return null;
  }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  function mark(s, id, extra) {
    if (s.found[id]) return;
    s.found[id] = { tick: s.tick, session: s.session };
    s.events.push({ tick: s.tick, id: id, extra: extra || '' });
  }

  function milestones(s) {
    var x = s.x;
    if (x === 3 || x === 4) mark(s, 'on_plateau');
    if (x === 1 || x === 2) mark(s, 'on_peak');
    if (x === 21 || x === 22) mark(s, 'on_spire');
    if (s.cols[21].length || s.cols[22].length) mark(s, 'thing_on_spire');
    for (var c = 5; c <= 20; c++) if (isTower(s, c)) { mark(s, 'tower3'); break; }
    if (s.lost.length) mark(s, 'water_loss');
  }

  function isTower(s, x) {
    var col = s.cols[x];
    return GROUND[x] === 0 && col.length >= 3 && col.every(isCube);
  }

  // ---- actions: each returns { ok, text } and spends one tick ----

  function move(s, X) {
    if (!isInt(X) || X < 0 || X >= W) return { ok: false, text: 'MoveFailed:BadColumn (columns are 0 to 23)' };
    if (X === s.x) return { ok: true, text: 'ok, you are already at x=' + X };
    var dir = X > s.x ? 1 : -1, first = true, air = s.air;
    while (s.x !== X) {
      var n = s.x + dir;
      if (isWater(n)) return { ok: false, text: 'MoveBlocked at x=' + s.x + ': column ' + n + ' is water' };
      var f = feet(s), rise = top(s, n) - f;
      var limit = air && first ? 2 : 1;
      if (rise > limit) return { ok: false, text: 'MoveBlocked at x=' + s.x + ': column ' + n + ' is ' + rise + ' higher than your feet' };
      var fromThings = s.cols[s.x].length > 0;
      s.x = n;
      if (air && first && rise === 2) mark(s, 'jump_climb');
      if (!air && fromThings && GROUND[n] >= 2 && rise > 0) mark(s, 'stair');
      first = false;
    }
    return { ok: true, text: 'ok, you are at x=' + s.x + ', feet ' + feet(s) };
  }

  function pickup(s, id) {
    if (!id || !exists(s, id)) return { ok: false, text: 'PickupFailed:NoSuchThing' };
    if (s.lost.indexOf(id) >= 0) return { ok: false, text: 'PickupFailed:Gone (it fell in the water)' };
    if (s.hold) return { ok: false, text: 'PickupFailed:AlreadyHolding ' + s.hold };
    var w = where(s, id);
    if (w.x === s.x) return { ok: false, text: 'PickupFailed:StandingOnIt' };
    if (w.i !== s.cols[w.x].length - 1) return { ok: false, text: 'PickupFailed:NotOnTop (' + s.cols[w.x][s.cols[w.x].length - 1] + ' is on it)' };
    var base = GROUND[w.x] + w.i, dx = Math.abs(w.x - s.x), dz = Math.abs(base - feet(s));
    if (dx > 2 || dz > 2) return { ok: false, text: 'PickupFailed:OutOfRange (' + dx + ' columns away, ' + dz + ' up or down)' };
    s.cols[w.x].pop();
    s.hold = id;
    return { ok: true, text: 'ok, holding ' + id };
  }

  function place(s, X) {
    if (!s.hold) return { ok: false, text: 'PlaceFailed:EmptyHands' };
    if (!isInt(X) || X < 0 || X >= W) return { ok: false, text: 'PlaceFailed:BadColumn' };
    if (X === s.x) return { ok: false, text: 'PlaceFailed:OwnColumn' };
    var dx = Math.abs(X - s.x);
    if (dx > 2) return { ok: false, text: 'PlaceFailed:OutOfRange (' + dx + ' columns away)' };
    if (isWater(X)) return { ok: false, text: 'PlaceFailed:Water' };
    var dz = top(s, X) - feet(s);
    if (Math.abs(dz) > 2) return { ok: false, text: 'PlaceFailed:TooHighOrLow (top of x=' + X + ' is ' + Math.abs(dz) + (dz > 0 ? ' above' : ' below') + ' your feet)' };
    var id = s.hold;
    s.cols[X].push(id);
    s.hold = null;
    return { ok: true, text: 'ok, ' + id + ' is on x=' + X + ' (top ' + top(s, X) + ')' };
  }

  function r2(v) { return Math.round(v * 100) / 100; }

  // Closed-form flight, sampled every 1/20 s. Returns where it ends and how hard it hits.
  function flight(s, VX, vz) {
    var f = feet(s), px = s.x + 0.5, pz = f + 1, prev = s.x, pts = [[r2(px), r2(pz)]], peak = pz;
    for (var k = 1; k <= STEPS; k++) {
      var t = k / 20, X = px + VX * t, Z = pz + vz * t - 5 * t * t, col = Math.floor(X);
      if (Z > peak) peak = Z;
      if (col < 0 || col >= W) { pts.push([r2(X), r2(Z)]); return { end: 'lost', col: col, pts: pts, peak: peak, pz: pz }; }
      if (isWater(col)) {
        pts.push([r2(X), r2(Z)]);
        if (Z <= 0) return { end: 'lost', col: col, pts: pts, peak: peak, pz: pz };
        prev = col; continue;
      }
      if (col !== prev) {
        var tb = ((VX > 0 ? col : col + 1) - px) / VX, zb = pz + vz * tb - 5 * tb * tb;
        if (zb < top(s, col)) {
          pts.push([r2(px + VX * tb), r2(zb)]);
          if (isWater(prev)) return { end: 'lost', col: prev, pts: pts, peak: peak, pz: pz };
          return { end: 'land', col: prev, side: col, pts: pts, peak: peak, pz: pz };
        }
      }
      if (Z <= top(s, col)) { pts.push([r2(X), r2(top(s, col))]); return { end: 'land', col: col, pts: pts, peak: peak, pz: pz }; }
      pts.push([r2(X), r2(Z)]);
      prev = col;
    }
    return { end: 'lost', col: prev, pts: pts, peak: peak, pz: pz };
  }

  function throwIt(s, VX, VZ) {
    if (!s.hold) return { ok: false, text: 'ThrowFailed:EmptyHands' };
    if (!isInt(VX) || !isInt(VZ) || VZ < 0) return { ok: false, text: 'ThrowFailed:BadVelocity (whole numbers, VZ 0 or more)' };
    if (VX * VX + VZ * VZ > MAX_SPEED2) return { ok: false, text: 'ThrowFailed:TooFast (VX*VX + VZ*VZ is ' + (VX * VX + VZ * VZ) + ', at most 100)' };
    var id = s.hold, air = s.air, vz = VZ + (air ? JUMP_VZ : 0), f = feet(s);
    var fl = flight(s, VX, vz);
    s.hold = null;
    var head = id + ' left your hand at vx=' + VX + ' vz=' + vz + ', peaked at ' + fl.peak.toFixed(1);
    var info = { id: id, vx: VX, vz: vz, air: air, feet: f, pts: fl.pts, end: fl.end, col: fl.col, impact2: null, spawned: [] };
    s.lastThrow = info;
    if (air) mark(s, 'jump_throw');
    if (fl.end === 'lost') {
      s.lost.push(id);
      milestones(s);
      return { ok: true, text: head + ', fell in the water and is gone' };
    }
    if (fl.col === s.x) {
      s.hold = id;
      return { ok: true, text: head + ', came back down and you caught it' };
    }
    var below = top(s, fl.col), impact2 = VX * VX + vz * vz + 20 * (fl.pz - below);
    info.impact2 = impact2;
    s.cols[fl.col].push(id);
    var text = head + ', ' + (fl.side != null ? 'hit the side of x=' + fl.side + ' and dropped on x=' + fl.col : 'landed on x=' + fl.col) +
      ' (top ' + top(s, fl.col) + '), impact speed ' + Math.sqrt(impact2).toFixed(1);
    if (id === 'rock' && impact2 >= SHATTER2) {
      var made = [];
      [-1, 1, 2].forEach(function (d) {
        if (s.spawned >= MAX_SPAWN) return;
        var c = fl.col + d, cid = 'c' + (7 + s.spawned);
        s.spawned++;
        if (isWater(c)) { s.lost.push(cid); made.push(cid + ' fell in the water'); return; }
        s.cols[c].push(cid);
        made.push(cid + '@' + c);
        info.spawned.push([cid, c]);
      });
      if (made.length) { text += '; ' + made.length + ' new cubes appeared: ' + made.join(' '); mark(s, 'shatter'); }
    }
    if (isCube(id) && f === 0 && (fl.col === 21 || fl.col === 22) && s.spireHit == null) s.spireHit = s.tick;
    milestones(s);
    return { ok: true, text: text };
  }

  function parseAction(raw) {
    var t = String(raw == null ? '' : raw).trim().toLowerCase().split(/\s+/);
    var n = function (v) { return v != null && /^[-+]?\d+$/.test(v) ? Number(v) : NaN; };
    return { verb: t[0] || '', a: t[1], b: t[2], na: n(t[1]), nb: n(t[2]) };
  }

  // One action = one tick. Returns { ok, text }.
  function act(s, raw) {
    var p = parseAction(raw), air = s.air, r;
    s.tick++;
    s.air = false;
    if (p.verb === 'jump') { s.air = true; r = { ok: true, text: 'ok, you are in the air for your next action' }; }
    else {
      s.air = air;
      if (p.verb === 'move') r = move(s, p.na);
      else if (p.verb === 'pickup') r = pickup(s, p.a);
      else if (p.verb === 'place') r = place(s, p.na);
      else if (p.verb === 'throw') r = throwIt(s, p.na, p.nb);
      else r = { ok: false, text: 'Failed:UnknownAction (use move, jump, pickup, place, throw)' };
      s.air = false;
    }
    if (r.ok && p.verb !== 'throw') milestones(s);
    return r;
  }

  // Up to `max` actions; the first failure skips the rest. The jump ends with the turn.
  function runTurn(s, actions, max) {
    var lines = [], list = (actions || []).slice(0, max || 5);
    for (var i = 0; i < list.length; i++) {
      var r = act(s, list[i]);
      lines.push({ tick: s.tick, action: String(list[i]), ok: r.ok, text: r.text });
      if (!r.ok) break;
    }
    s.air = false;
    return lines;
  }

  function towers(s) {
    var n = 0;
    for (var x = 0; x < W; x++) if (isTower(s, x)) n++;
    return n;
  }

  function pad(v) { v = String(v); return v.length >= 3 ? v : ('   ' + v).slice(-3); }
  function describe(s) {
    var xs = 'x     ', gr = 'ground', tp = 'top   ';
    for (var x = 0; x < W; x++) {
      xs += pad(x); gr += pad(isWater(x) ? '~' : GROUND[x]); tp += pad(isWater(x) ? '~' : top(s, x));
    }
    var things = [];
    for (x = 0; x < W; x++) if (s.cols[x].length) things.push('x' + x + ':[' + s.cols[x].join(',') + ']');
    var lines = ['ISLAND  (~ is water. Peak x1-2, Plateau x3-4, Spire x21-22)', xs, gr, tp,
      'THINGS (bottom to top) ' + (things.join(' ') || 'none'),
      'YOU x=' + s.x + ' feet=' + feet(s) + ' hands=' + (s.hold || 'empty')];
    if (s.lost.length) lines.push('GONE in the water: ' + s.lost.join(' '));
    return lines.join('\n');
  }

  return {
    W: W, GROUND: GROUND, TECHNIQUES: TECHNIQUES, LABELS: LABELS, init: init, clone: clone, top: top, feet: feet,
    isWater: isWater, isCube: isCube, act: act, runTurn: runTurn, towers: towers, describe: describe, flight: flight
  };
});
