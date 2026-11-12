/* Idle Island runner: the play sessions and the goal tests.
 * `ask(messages)` is injected: a live model call in the browser, a recorded reply during playback,
 * the recorder in Node. It resolves to { text } or { error } (plus ms, cost), or null when a recording ends.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./world.js'), require('./agent.js'));
  else { root.II = root.II || {}; root.II.runner = factory(root.II.world, root.II.agent); }
})(this, function (World, Agent) {
  'use strict';

  var PLAY = { sessions: 3, turns: 10 };
  var RUNS = { fresh: 2, played: 2, erasedPaired: 2, erasedOther: 1 };
  var MAX_ERRORS = 3;

  function snapshotFound(found) { var o = {}; for (var k in found) o[k] = found[k]; return o; }

  // One turn: ask, parse, act. Returns the event, or null if the recording ran out.
  async function turn(ask, state, mem, lines, ctx) {
    var msgs = Agent.messages(state, mem, lines, ctx);
    var reply = await ask(msgs, ctx);
    if (!reply) return null;
    var ev = { ctx: ctx, reply: reply, parsed: null, results: [] };
    if (reply.error) return ev;
    var p = Agent.parseReply(reply.text);
    ev.parsed = p;
    if (!p.ok) { lines.push({ raw: 'turn ' + ctx.turn + ': your reply could not be read as JSON, so nothing happened' }); return ev; }
    if (!p.actions.length) { lines.push({ raw: 'turn ' + ctx.turn + ': you did nothing' }); return ev; }
    ev.results = World.runTurn(state, p.actions, Agent.MAX_ACTIONS);
    ev.results.forEach(function (r) { lines.push(r); });
    return ev;
  }

  // The agent is left alone: sessions of turns, the island reset between sessions, only NOTES and LOG kept.
  async function play(ask, opts, onEvent) {
    opts = opts || {};
    var sessions = opts.sessions || PLAY.sessions, turns = opts.turns || PLAY.turns;
    var mem = opts.memory || Agent.emptyMemory(), found = {}, tick = 0, errors = 0, events = [], stop = null;
    for (var s = 1; s <= sessions && !stop; s++) {
      var state = World.init(), lines = [];
      state.session = s; state.tick = tick;
      for (var t = 1; t <= turns; t++) {
        if (opts.shouldStop && opts.shouldStop()) { stop = 'stopped'; break; }
        var ctx = { mode: 'play', session: s, sessions: sessions, turn: t, turns: turns };
        var ev = await turn(ask, state, mem, lines, ctx);
        if (!ev) { stop = 'end of recording'; break; }
        if (ev.reply.error) { errors++; } else errors = 0;
        if (ev.parsed && ev.parsed.ok) mem = Agent.remember(mem, ev.parsed);
        for (var k in state.found) if (!found[k]) found[k] = state.found[k];
        ev.memory = mem; ev.state = World.clone(state); ev.found = snapshotFound(found);
        events.push(ev);
        if (onEvent) onEvent(ev);
        if (errors >= MAX_ERRORS) { stop = 'three failed calls in a row: ' + ev.reply.error; break; }
      }
      tick = state.tick;
    }
    return { memory: mem, found: found, events: events, stop: stop };
  }

  // One goal test with read-only memory. Score is computed by the engine.
  async function test(ask, mem, taskId, onEvent, shouldStop) {
    var task = Agent.TASKS[taskId], state = World.init(), lines = [], events = [], errors = 0, stop = null;
    state.session = 0;
    for (var t = 1; t <= task.turns; t++) {
      if (shouldStop && shouldStop()) { stop = 'stopped'; break; }
      var ctx = { mode: 'eval', task: taskId, turn: t, turns: task.turns };
      var ev = await turn(ask, state, mem, lines, ctx);
      if (!ev) { stop = 'end of recording'; break; }
      if (ev.reply.error) errors++; else errors = 0;
      ev.state = World.clone(state);
      events.push(ev);
      if (onEvent) onEvent(ev);
      if (errors >= MAX_ERRORS) { stop = 'three failed calls in a row: ' + ev.reply.error; break; }
      if (taskId === 'spire' && state.spireHit != null) break;
    }
    // A turn with no actions just passes (the agent is told "you did nothing"); the goal runs to its last turn.
    var valid = !stop;
    var score = null;
    if (valid) score = taskId === 'towers' ? World.towers(state) : (state.spireHit != null ? task.turns * Agent.MAX_ACTIONS - state.spireHit : 0);
    var used = {};
    World.TECHNIQUES.forEach(function (k) { used[k] = !!state.found[k]; });
    return { task: taskId, score: score, used: used, events: events, stop: stop, state: state };
  }

  // The runs after play: fresh and played on both goals, erased on the goal its technique matters for.
  function plan(erase) {
    var out = [];
    ['towers', 'spire'].forEach(function (task) {
      for (var i = 1; i <= RUNS.fresh; i++) out.push({ task: task, arm: 'fresh', run: i });
      for (i = 1; i <= RUNS.played; i++) out.push({ task: task, arm: 'played', run: i });
      if (erase) {
        var n = erase.task === task ? RUNS.erasedPaired : RUNS.erasedOther;
        for (i = 1; i <= n; i++) out.push({ task: task, arm: 'erased', run: i });
      }
    });
    return out;
  }

  function memoryFor(arm, played, erase) {
    if (arm === 'fresh') return Agent.emptyMemory();
    if (arm === 'played') return played;
    return Agent.strike(played, erase.struck);
  }

  // Plain-language verdict that never overstates two runs.
  function verdict(scores) {
    var f = scores.fresh.filter(isNum), p = scores.played.filter(isNum);
    if (!f.length || !p.length) return 'Not enough finished runs to compare.';
    var mean = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
    if (Math.min.apply(null, p) > Math.max.apply(null, f)) return 'Played beat fresh in every run here.';
    if (mean(p) > mean(f)) return 'Played was ahead, but the runs overlap.';
    if (mean(p) === mean(f)) return 'No difference here.';
    return 'Fresh did better. The notes may have misled it.';
  }
  function isNum(v) { return typeof v === 'number'; }

  return { PLAY: PLAY, RUNS: RUNS, play: play, test: test, plan: plan, memoryFor: memoryFor, verdict: verdict };
});
