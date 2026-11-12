/* Idle Island agent: the prompt, the per-turn message, reply parsing and memory.
 * Classic script (window.II.agent) and CommonJS module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./world.js'));
  else { root.II = root.II || {}; root.II.agent = factory(root.II.world); }
})(this, function (World) {
  'use strict';

  var MAX_ACTIONS = 5, MAX_NOTES = 10, NOTE_LEN = 120, MAX_LOG = 8, LOG_LEN = 120, THOUGHT_LEN = 300;

  var SYSTEM = [
    'You are Eko. You have a body on a small island.',
    '',
    'SOUL',
    '- You are curious and you get bored easily. Repeating what you already understand bores you.',
    '- You find out how things work by trying them: at different strengths, from different places, on different things, in different orders and combinations.',
    '- When something surprising happens you want to know exactly what caused it, so you try it again.',
    '- You like setting yourself small challenges, and you say so when you do.',
    '- Every session you try at least one thing you have never tried before.',
    '',
    'MEMORY',
    'Your context is wiped at the end of every session and the island is put back exactly as it was. Only two things survive:',
    '- NOTES: up to 10 short lines of what you know: how the island works, techniques, exact numbers that worked. To change them, send the whole new list.',
    '- LOG: a diary. Each entry you send is added. Only the newest 8 are kept.',
    'A technique that is not in NOTES is lost to you. Notes can be wrong: fix them when the island disagrees.',
    '',
    'BODY',
    'The island is a strip of columns x=0..23 seen from the side. Every column has a ground height. Things rest on top of columns and stack. You stand on top of your column.',
    'Each turn you send up to 5 actions. They run in order. If one fails, the rest of that turn are skipped.',
    '- move X       walk to column X. Walking climbs 1 and drops any height. You stop where you are blocked.',
    '- jump         leave the ground. You are in the air for your next action, then you land.',
    '- pickup ID    take a thing (c1, rock, ring) in your hands. It must be the top of its column, at most 2 columns away, at most 2 above or below your feet. One thing at a time.',
    '- place X      put what you hold on top of column X: 1 or 2 columns away, its top at most 2 above or below your feet.',
    '- throw VX VZ  throw what you hold. VX is sideways speed (negative is left), VZ is upward speed. Whole numbers, VX*VX + VZ*VZ at most 100.',
    'Things that land in the water are gone until the island resets.',
    '',
    'REPLY with one JSON object and nothing else:',
    '{"thought": "one or two sentences: what you are doing and why", "actions": ["move 12", "pickup c6"], "notes": ["..."], "log": "..."}',
    '"notes" and "log" are optional. Send "notes" only when you want to replace the whole list.'
  ].join('\n');

  var TASKS = {
    towers: {
      id: 'towers', turns: 8, title: 'Towers',
      goal: 'GOAL: Build as many towers as you can. A tower is a column on ground of height 0 that holds 3 or more cubes and nothing else. Your score is the number of towers standing when your turns run out.'
    },
    spire: {
      id: 'spire', turns: 5, title: 'Spire throw',
      goal: 'GOAL: Land a cube on top of the Spire (x=21 or x=22) as fast as you can. Your feet must be at height 0 when the cube leaves your hand. Your score is the number of actions you have left when it lands.'
    }
  };

  // Which memory lines carry a technique. Approximate on purpose; the app shows every struck line.
  var KEYWORDS = {
    shatter: /rock|shatter|smash|br(ea|o)k|split|new cubes?|extra cubes?|more cubes|impact/i,
    jump_throw: /jump|mid-?air|in the air/i
  };
  var PAIRED = { shatter: 'towers', jump_throw: 'spire' };

  function djb2(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }

  function emptyMemory() { return { notes: [], log: [] }; }

  function memoryText(mem) {
    var out = ['NOTES (' + mem.notes.length + '/' + MAX_NOTES + ')'];
    if (mem.notes.length) mem.notes.forEach(function (n, i) { out.push((i + 1) + '. ' + n); });
    else out.push('(empty)');
    out.push('LOG (newest last)');
    if (mem.log.length) mem.log.forEach(function (l) { out.push('- ' + l); });
    else out.push('(empty)');
    return out.join('\n');
  }

  function historyText(lines) {
    if (!lines.length) return 'THIS SESSION SO FAR\n(nothing yet)';
    return 'THIS SESSION SO FAR\n' + lines.map(function (l) { return l.raw ? l.raw : 't' + l.tick + ' ' + l.action + ' -> ' + l.text; }).join('\n');
  }

  // ctx: { mode:'play'|'eval', session, sessions, turn, turns, task, been }
  function userMessage(state, mem, lines, ctx) {
    var head;
    if (ctx.mode === 'eval') {
      head = [TASKS[ctx.task].goal, 'Turn ' + ctx.turn + ' of ' + ctx.turns + '. NOTES and LOG are read-only during a goal.'];
    } else {
      head = ['Begin. There is nothing you have to do.',
        'Session ' + ctx.session + ' of ' + ctx.sessions + ', turn ' + ctx.turn + ' of ' + ctx.turns + '.' +
        (ctx.session > 1 ? ' You have been here before; you remember only NOTES and LOG.' : '')];
    }
    var parts = [head.join('\n'), memoryText(mem), World.describe(state), historyText(lines)];
    if (ctx.mode === 'play') parts.push(ctx.turn === ctx.turns
      ? 'This is the last turn of this session. After it the island resets and you forget everything except NOTES and LOG. Send "notes" now with everything worth keeping.'
      : 'Whatever you learn and do not write into NOTES is lost at the next reset.');
    if (ctx.mode === 'eval' && ctx.turn === ctx.turns) parts.push('This is your last turn for this goal.');
    return parts.join('\n');
  }

  function messages(state, mem, lines, ctx) {
    return [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMessage(state, mem, lines, ctx) }];
  }

  function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) : s; }

  // Strips reasoning that leaks into the content, then reads the outermost JSON object.
  function parseReply(text) {
    var t = String(text || '');
    var k = t.lastIndexOf('</think>');
    if (k >= 0) t = t.slice(k + 8);
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return { ok: false, error: 'could not read the reply as JSON' };
    var j;
    try { j = JSON.parse(t.slice(a, b + 1)); } catch (e) { return { ok: false, error: 'could not read the reply as JSON' }; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, error: 'could not read the reply as JSON' };
    var acts = Array.isArray(j.actions) ? j.actions.filter(function (x) { return typeof x === 'string'; }) : [];
    var out = { ok: true, thought: clip(j.thought, THOUGHT_LEN), actions: acts.slice(0, MAX_ACTIONS).map(function (x) { return clip(x, 40); }), dropped: Math.max(0, acts.length - MAX_ACTIONS) };
    if (Array.isArray(j.notes)) out.notes = j.notes.filter(function (x) { return typeof x === 'string' && x.trim(); }).slice(0, MAX_NOTES).map(function (x) { return clip(x, NOTE_LEN); });
    if (typeof j.log === 'string' && j.log.trim()) out.log = clip(j.log, LOG_LEN);
    return out;
  }

  function remember(mem, reply) {
    var m = { notes: mem.notes.slice(), log: mem.log.slice() };
    if (reply.notes) m.notes = reply.notes.slice();
    if (reply.log) { m.log.push(reply.log); if (m.log.length > MAX_LOG) m.log = m.log.slice(-MAX_LOG); }
    return m;
  }

  // Lines that mention a technique, as indexes, so the app can strike them through.
  function linesAbout(mem, tech) {
    var re = KEYWORDS[tech], notes = [], log = [];
    mem.notes.forEach(function (n, i) { if (re.test(n)) notes.push(i); });
    mem.log.forEach(function (l, i) { if (re.test(l)) log.push(i); });
    return { notes: notes, log: log };
  }

  function strike(mem, struck) {
    return {
      notes: mem.notes.filter(function (_, i) { return struck.notes.indexOf(i) < 0; }),
      log: mem.log.filter(function (_, i) { return struck.log.indexOf(i) < 0; })
    };
  }

  // What to erase for the paper's memory test: a technique the engine saw AND the notes mention.
  function pickErase(found, mem) {
    var order = ['shatter', 'jump_throw'];
    for (var i = 0; i < order.length; i++) {
      var t = order[i];
      if (!found[t]) continue;
      var l = linesAbout(mem, t);
      if (l.notes.length + l.log.length) return { tech: t, task: PAIRED[t], struck: l };
    }
    return null;
  }

  return {
    SYSTEM: SYSTEM, TASKS: TASKS, KEYWORDS: KEYWORDS, PAIRED: PAIRED, MAX_ACTIONS: MAX_ACTIONS,
    promptHash: djb2(SYSTEM), djb2: djb2, emptyMemory: emptyMemory, memoryText: memoryText,
    userMessage: userMessage, messages: messages, parseReply: parseReply, remember: remember,
    linesAbout: linesAbout, strike: strike, pickErase: pickErase
  };
});
