// Every recording must replay through today's engine and prompt to exactly what was recorded.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../js/agent.js');
const R = require('../js/runner.js');

const file = path.join(__dirname, '..', 'recordings', 'agents.json');
const ask = (list) => { let i = 0; return async () => (i < list.length ? list[i++] : null); };

test('recordings replay to the recorded results', { skip: !fs.existsSync(file) }, async () => {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(!j.fixture, 'recordings/agents.json is still the UI fixture');
  assert.strictEqual(j.promptHash, A.promptHash, 'recorded with a different system prompt');
  for (const a of j.agents) {
    const play = await R.play(ask(a.play), {});
    assert.deepStrictEqual(play.found, a.check.found, a.id + ' found');
    const erase = A.pickErase(play.found, play.memory);
    assert.strictEqual(erase && erase.tech, a.check.erase, a.id + ' erase');
    for (const e of a.evals) {
      const res = await R.test(ask(e.turns), R.memoryFor(e.arm, play.memory, erase), e.task);
      const want = a.check.scores.find((s) => s[0] === e.task && s[1] === e.arm && s[2] === e.run);
      assert.strictEqual(res.score, want[3], `${a.id} ${e.task} ${e.arm} #${e.run}`);
    }
  }
});
