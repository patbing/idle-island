// Records real agents for playback. The key comes from the environment and is never printed.
//   POLLINATIONS_KEY=sk_... node tools/record.mjs pilot [maxPollen]          3 models x 1 play session -> recordings/pilot.json
//   POLLINATIONS_KEY=sk_... node tools/record.mjs full maxPollen model1 model2 ...   one agent per model, play then tests -> recordings/agents.json
//   POLLINATIONS_KEY=sk_... node tools/record.mjs retest maxPollen                  keep the recorded plays, record every agent's tests again
// Stops as soon as the running cost (usage x listed prices) passes maxPollen.
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const A = require('../js/agent.js');
const R = require('../js/runner.js');
const KEY = process.env.POLLINATIONS_KEY;
if (!KEY) { console.error('Set POLLINATIONS_KEY'); process.exit(1); }
const [mode = 'pilot', maxArg, ...modelArgs] = process.argv.slice(2);
const MAX = Number(maxArg || 0.05);
const API = 'https://gen.pollinations.ai';
const PILOT_MODELS = ['nvidia/nemotron-3.5-lightning', 'openai/gpt-oss-20b', 'openai/gpt-5-nano'];

const list = (await (await fetch(API + '/v1/models')).json()).data;
const info = Object.fromEntries(list.map((m) => [m.id, m]));
// pilot: [maxPollen] [sessions] [model...]
const pilotSessions = mode === 'pilot' && /^\d+$/.test(modelArgs[0] || '') ? Number(modelArgs.shift()) : 1;
const models = mode === 'pilot' ? (modelArgs.length ? modelArgs : PILOT_MODELS) : modelArgs;
for (const id of models) {
  if (!info[id]) { console.error('model not listed: ' + id); process.exit(1); }
  if (info[id].paid_only) { console.error('paid-only model refused: ' + id); process.exit(1); }
}
const price = (id, u) => u ? u.prompt_tokens * Number(info[id].pricing.promptTextTokens) + u.completion_tokens * Number(info[id].pricing.completionTextTokens) : 0;

let spent = 0, over = false;
const worst = (id) => 2000 * Number(info[id].pricing.promptTextTokens) + 4000 * Number(info[id].pricing.completionTextTokens);
function asker(id, sink) {
  const sp = info[id].supported_parameters || [];
  return async (messages) => {
    if (spent > MAX) { over = true; return null; }
    // A fresh seed per call: Pollinations caches identical request bodies, which made run 1 and run 2 identical.
    const body = { model: id, messages, max_tokens: 4000, seed: Math.floor(Math.random() * 2 ** 31) };
    if (sp.includes('reasoning_effort')) body.reasoning_effort = 'low';
    if (sp.includes('response_format')) body.response_format = { type: 'json_object' };
    let rec;
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      try {
        const res = await fetch(API + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY }, body: JSON.stringify(body) });
        const j = await res.json().catch(() => null);
        const ms = Date.now() - t0;
        if (!res.ok) {
          if (attempt === 0 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 3000)); continue; }
          // Failed calls can still be billed (an exhausted output limit is), so the cap counts them at worst case.
          spent += worst(id);
          rec = { error: 'HTTP ' + res.status + (j?.error?.message ? ': ' + String(j.error.message).slice(0, 200) : ''), ms };
          break;
        }
        const cost = price(id, j.usage);
        spent += cost;
        const text = j.choices?.[0]?.message?.content || '';
        rec = text ? { text, ms, cost: Number(cost.toPrecision(3)), usage: { in: j.usage?.prompt_tokens, out: j.usage?.completion_tokens } } : { error: 'empty reply', ms, cost };
        break;
      } catch (e) { if (attempt === 0) continue; rec = { error: String(e.message || e), ms: Date.now() - t0 }; }
    }
    sink.push(rec);
    return rec;
  };
}

function summary(play) {
  const f = Object.entries(play.found).map(([k, v]) => `${k}@t${v.tick}/s${v.session}`).join(' ') || 'nothing';
  const bad = play.events.filter((e) => e.reply.error || (e.parsed && !e.parsed.ok)).length;
  const acts = play.events.reduce((n, e) => n + e.results.length, 0), okActs = play.events.reduce((n, e) => n + e.results.filter((r) => r.ok).length, 0);
  return `found: ${f} | unreadable/failed turns ${bad}/${play.events.length} | actions ok ${okActs}/${acts} | notes ${play.memory.notes.length}`;
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

if (mode === 'pilot') {
  const out = { app: 'idle-island', kind: 'pilot', promptHash: A.promptHash, recordedAt: new Date().toISOString(), agents: [] };
  await Promise.all(models.map(async (id) => {
    const turns = [];
    const play = await R.play(asker(id, turns), { sessions: pilotSessions, turns: 10 });
    const c = turns.reduce((n, t) => n + (t.cost || 0), 0);
    console.log(`${id.padEnd(32)} ${summary(play)} | cost ${c.toFixed(5)} | tokens/call in ${Math.round(avg(turns, 'in'))} out ${Math.round(avg(turns, 'out'))}`);
    console.log('   notes: ' + JSON.stringify(play.memory.notes).slice(0, 400));
    out.agents.push({ model: { id, title: info[id].title || id }, play: turns, stop: play.stop });
  }));
  writeFileSync(new URL('../recordings/pilot.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
} else if (mode === 'retest') {
  // Keep each recorded play (replayed through the engine, no calls) and record its tests again.
  const file = new URL('../recordings/agents.json', import.meta.url);
  const out = JSON.parse(readFileSync(file, 'utf8'));
  if (out.promptHash !== A.promptHash) { console.error('agents.json was recorded with a different prompt'); process.exit(1); }
  out.recordedAt = new Date().toISOString();
  for (const a of out.agents) {
    if (over) break;
    const id = a.model.id;
    let i = 0; const replay = async () => (i < a.play.length ? a.play[i++] : null);
    const play = await R.play(replay, {});
    const erase = A.pickErase(play.found, play.memory);
    console.log(`${a.id} ${id}: ${summary(play)}`);
    const evals = await pool(R.plan(erase), 4, async (r) => {
      const t = [];
      const res = await R.test(asker(id, t), R.memoryFor(r.arm, play.memory, erase), r.task);
      return { task: r.task, arm: r.arm, run: r.run, turns: t, score: res.score, used: res.used, stop: res.stop };
    });
    if (over) { console.log('  budget reached during this agent: kept its old tests'); break; }
    evals.forEach((e) => console.log(`  ${e.task.padEnd(6)} ${e.arm.padEnd(6)} #${e.run} score ${e.score} used ${Object.keys(e.used).filter((k) => e.used[k]).join(',') || '-'}${e.stop ? ' (' + e.stop + ')' : ''}`));
    a.evals = evals.map((e) => ({ task: e.task, arm: e.arm, run: e.run, turns: e.turns }));
    a.check = { found: play.found, erase: erase && erase.tech, scores: evals.map((e) => [e.task, e.arm, e.run, e.score]) };
    writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  }
} else {
  const file = new URL('../recordings/agents.json', import.meta.url);
  const out = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { app: 'idle-island', v: 1, agents: [] };
  out.promptHash = A.promptHash; out.recordedAt = new Date().toISOString();
  for (const id of models) {
    if (over) break;
    const n = out.agents.length + 1, turns = [];
    console.log(`agent ${n}: ${id} playing...`);
    const play = await R.play(asker(id, turns), {});
    console.log('  ' + summary(play));
    const erase = A.pickErase(play.found, play.memory);
    const runs = R.plan(erase);
    const evals = await pool(runs, 4, async (r) => {
      const t = [];
      const res = await R.test(asker(id, t), R.memoryFor(r.arm, play.memory, erase), r.task);
      return { task: r.task, arm: r.arm, run: r.run, turns: t, score: res.score, used: res.used, stop: res.stop };
    });
    if (over) { console.log('  budget reached during this agent: not saved'); break; }
    evals.forEach((e) => console.log(`  ${e.task.padEnd(6)} ${e.arm.padEnd(6)} #${e.run} score ${e.score} used ${Object.keys(e.used).filter((k) => e.used[k]).join(',') || '-'}${e.stop ? ' (' + e.stop + ')' : ''}`));
    out.agents.push({
      id: 'a' + n, model: { id, title: info[id].title || id }, play: turns,
      evals: evals.map((e) => ({ task: e.task, arm: e.arm, run: e.run, turns: e.turns })),
      check: { found: play.found, erase: erase && erase.tech, scores: evals.map((e) => [e.task, e.arm, e.run, e.score]) }
    });
    writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  }
}
function avg(turns, k) { const v = turns.filter((t) => t.usage).map((t) => t.usage[k] || 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }
console.log('total cost (Pollen, from usage x listed prices):', spent.toFixed(6), over ? '(budget reached, stopped early)' : '');
