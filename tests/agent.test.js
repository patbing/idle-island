const test = require('node:test');
const assert = require('node:assert');
const W = require('../js/world.js');
const A = require('../js/agent.js');
const R = require('../js/runner.js');

test('parse: JSON, fenced JSON, leaked reasoning, garbage, limits', () => {
  assert.deepStrictEqual(A.parseReply('{"thought":"hi","actions":["move 5"]}').actions, ['move 5']);
  assert.ok(A.parseReply('```json\n{"thought":"x","actions":[]}\n```').ok);
  assert.deepStrictEqual(A.parseReply('let me think {a}</think>{"actions":["jump"]}').actions, ['jump']);
  assert.ok(!A.parseReply('I will walk to the rock.').ok);
  assert.ok(!A.parseReply('[1,2]').ok);
  const p = A.parseReply(JSON.stringify({ thought: 'x'.repeat(500), actions: ['jump', 'jump', 'jump', 'jump', 'jump', 'jump', 'jump'], notes: Array(15).fill('n'.repeat(200)), log: 'l'.repeat(300) }));
  assert.strictEqual(p.actions.length, 5); assert.strictEqual(p.dropped, 2);
  assert.strictEqual(p.notes.length, 10); assert.strictEqual(p.notes[0].length, 120);
  assert.strictEqual(p.log.length, 120); assert.strictEqual(p.thought.length, 300);
  assert.strictEqual(A.parseReply('{"actions":["jump"]}').notes, undefined); // notes kept unless sent
});

test('the prompt does not give the hidden mechanics away', () => {
  assert.doesNotMatch(A.SYSTEM, /shatter|spawn|inherit|new cube|climbs 2|adds? .*speed/i);
  Object.values(A.TASKS).forEach((t) => assert.doesNotMatch(t.goal, /shatter|spawn|inherit|jump/i));
});

test('memory: replace notes, keep the newest 8 log entries, strike only matching lines', () => {
  let m = A.emptyMemory();
  m = A.remember(m, { notes: ['a', 'b'] });
  for (let i = 1; i <= 10; i++) m = A.remember(m, { log: 'entry ' + i });
  assert.deepStrictEqual(m.notes, ['a', 'b']);
  assert.strictEqual(m.log.length, 8); assert.strictEqual(m.log[0], 'entry 3');
  const mem = { notes: ['Throwing the rock hard makes new cubes: from x=13 throw 1 9', 'Walking climbs 1', 'Jump then throw goes higher'], log: ['tried the rock', 'stacked c1'] };
  const l = A.linesAbout(mem, 'shatter');
  assert.deepStrictEqual(l, { notes: [0], log: [0] });
  assert.deepStrictEqual(A.strike(mem, l), { notes: ['Walking climbs 1', 'Jump then throw goes higher'], log: ['stacked c1'] });
  assert.deepStrictEqual(A.pickErase({ shatter: {} }, mem).task, 'towers');
  assert.deepStrictEqual(A.pickErase({ jump_throw: {} }, mem).tech, 'jump_throw');
  assert.strictEqual(A.pickErase({ shatter: {} }, { notes: ['Walking climbs 1'], log: [] }), null);
  assert.match(A.memoryText(A.emptyMemory()), /NOTES \(0\/10\)\n\(empty\)\nLOG \(newest last\)\n\(empty\)/);
});

test('the worst-case message stays small', () => {
  const s = W.init();
  const mem = { notes: Array(10).fill('n'.repeat(120)), log: Array(8).fill('l'.repeat(120)) };
  const lines = [];
  for (let i = 0; i < 50; i++) lines.push({ tick: i, action: 'throw -10 10', text: 'x'.repeat(150) });
  const msg = A.userMessage(s, mem, lines, { mode: 'play', session: 3, sessions: 3, turn: 10, turns: 10 });
  assert.ok(msg.length < 12000, String(msg.length));
  assert.match(msg, /^Begin\. There is nothing you have to do\.\nSession 3 of 3, turn 10 of 10\. You have been here before/);
  assert.match(msg, /This is the last turn of this session/);
});

// A scripted agent: replays fixed replies, like a recording.
function scripted(replies) { let i = 0; return async () => (i < replies.length ? { text: replies[i++], ms: 1, cost: 0 } : null); }
const J = (o) => JSON.stringify(o);

test('play: sessions reset the island, keep notes, count ticks across sessions, record discoveries', async () => {
  const replies = [
    J({ thought: 'rock', actions: ['pickup rock', 'throw 1 9'], notes: ['Throw the rock hard: from x=13 throw 1 9 makes new cubes'], log: 'made cubes' }),
    'not json at all',
    J({ thought: 'again', actions: ['pickup c6', 'jump', 'throw 4 9'] }),
  ];
  const out = await R.play(scripted(replies), { sessions: 2, turns: 2 });
  assert.strictEqual(out.stop, 'end of recording');
  assert.strictEqual(out.events.length, 3);
  assert.deepStrictEqual(out.found.shatter, { tick: 2, session: 1 });
  assert.deepStrictEqual(out.found.jump_throw, { tick: 5, session: 2 }); // tick count continues into session 2
  assert.ok(!out.events[1].parsed.ok);
  assert.strictEqual(out.events[2].state.spawned, 0); // the island was reset for session 2
  assert.deepStrictEqual(out.memory.log, ['made cubes']);
});

test('play stops after three failed calls in a row and never invents a reply', async () => {
  let n = 0;
  const failing = async () => { n++; return { error: 'HTTP 500: boom', ms: 1 }; };
  const out = await R.play(failing, { sessions: 3, turns: 10 });
  assert.strictEqual(n, 3);
  assert.match(out.stop, /three failed calls in a row: HTTP 500: boom/);
});

test('tests: towers and spire scored by the engine, techniques detected, empty turns just pass', async () => {
  const spire = await R.test(scripted([J({ actions: ['pickup c6', 'jump', 'throw 4 9'] })]), A.emptyMemory(), 'spire');
  assert.strictEqual(spire.score, 22); assert.ok(spire.used.jump_throw); assert.strictEqual(spire.events.length, 1);
  const miss = await R.test(scripted(Array(5).fill(J({ actions: ['jump'] }))), A.emptyMemory(), 'spire');
  assert.strictEqual(miss.score, 0);
  const idle = await R.test(scripted(Array(8).fill(J({ actions: [] }))), A.emptyMemory(), 'towers');
  assert.strictEqual(idle.score, 0); assert.strictEqual(idle.stop, null); assert.strictEqual(idle.events.length, 8);
  const cut = await R.test(scripted([J({ actions: ['jump'] })]), A.emptyMemory(), 'towers');
  assert.strictEqual(cut.score, null); // a recording that ends early has no valid score
});

test('plan and verdicts', () => {
  const p = R.plan({ tech: 'shatter', task: 'towers' });
  const count = (task, arm) => p.filter((x) => x.task === task && x.arm === arm).length;
  assert.deepStrictEqual([count('towers', 'erased'), count('spire', 'erased'), p.length], [2, 1, 11]);
  assert.strictEqual(R.plan(null).length, 8);
  assert.strictEqual(R.verdict({ fresh: [2, 2], played: [3, 4] }), 'Played beat fresh in every run here.');
  assert.strictEqual(R.verdict({ fresh: [2, 3], played: [3, 4] }), 'Played was ahead, but the runs overlap.');
  assert.strictEqual(R.verdict({ fresh: [2, 2], played: [2, 2] }), 'No difference here.');
  assert.strictEqual(R.verdict({ fresh: [3, 3], played: [2, 2] }), 'Fresh did better. The notes may have misled it.');
  assert.strictEqual(R.verdict({ fresh: [null], played: [2] }), 'Not enough finished runs to compare.');
});
