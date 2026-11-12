/* Idle Island page. Model text is only ever inserted with textContent. */
(function () {
  'use strict';
  var II = window.II, C = II.config, World = II.world, Agent = II.agent, R = II.runner, N = II.net, V = II.view;
  function $(id) { return document.getElementById(id); }
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var params = new URLSearchParams(location.search);

  var app = {
    key: null, models: [], byId: {}, modelId: null, exps: [], cur: 0,
    view: { kind: 'play', test: null }, frame: 0, playing: false, speed: 1, timer: null,
    spent: 0, busy: null, ctrl: null, stopAsked: false, notice: '', recordedAt: null
  };
  var ARMS = ['fresh', 'played', 'erased', 'edited'];
  var TECH_FOR = { towers: 'shatter', spire: 'jump_throw' };

  function fmtP(p) { return p == null ? '' : (p < 0.01 ? p.toFixed(5) : p.toFixed(4)) + ' P'; }
  function exp() { return app.exps[app.cur]; }
  function frames() {
    var e = exp(); if (!e) return [];
    if (app.view.kind === 'test') { var t = e.tests[app.view.test]; return t && t.res ? t.res.events : (t && t.live ? t.live : []); }
    return e.play.events;
  }

  // ---------- recordings: re-run every recorded reply through the engine ----------
  function replayAsk(list) { var i = 0; return function () { return Promise.resolve(i < list.length ? list[i++] : null); }; }
  async function replay(rec) {
    var play = await R.play(replayAsk(rec.play), {});
    var erase = Agent.pickErase(play.found, play.memory);
    var tests = [];
    for (var i = 0; i < (rec.evals || []).length; i++) {
      var ev = rec.evals[i];
      var res = await R.test(replayAsk(ev.turns), R.memoryFor(ev.arm, play.memory, erase), ev.task);
      tests.push({ task: ev.task, arm: ev.arm, run: ev.run, res: res, memory: R.memoryFor(ev.arm, play.memory, erase) });
    }
    var cost = rec.play.concat.apply(rec.play, (rec.evals || []).map(function (e) { return e.turns; })).reduce(function (n, t) { return n + (t.cost || 0); }, 0);
    return { label: 'Agent ' + rec.id.slice(1), sub: rec.model.title, model: rec.model, live: false, play: play, erase: erase, tests: tests, cost: cost };
  }
  function loadRecordings() {
    return fetch('recordings/agents.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(async function (j) {
      app.recordedAt = j.recordedAt;
      if (j.promptHash !== Agent.promptHash) app.notice = 'These recordings were made with an older prompt.';
      for (var i = 0; i < j.agents.length; i++) app.exps.push(await replay(j.agents[i]));
    }).catch(function (e) { app.notice = 'Could not load the recordings (' + e.message + '). You can still leave your own agent alone after signing in.'; });
  }

  // ---------- connect ----------
  (function () {
    var c = $('connect');
    c.setAttribute('app-key', C.APP_KEY);
    c.setAttribute('menu-links', JSON.stringify([{ label: 'Source code', href: C.REPO_URL }]));
  })();
  function readKey(c, e) {
    var k = (c && c.apiKey) || (e && e.detail && (e.detail.apiKey || e.detail.key)) || null;
    return typeof k === 'string' && k ? k : null;
  }
  function wireConnect() {
    var c = $('connect');
    Promise.race([customElements.whenDefined('polli-connect'), new Promise(function (r) { setTimeout(r, 8000); })]).then(function () {
      if (!customElements.get('polli-connect')) { c.hidden = true; $('connect-fallback').hidden = false; }
      onKey(readKey(c));
    });
    c.addEventListener('change', function (e) { onKey(readKey(c, e)); });
  }
  function onKey(k) {
    if (k === app.key) return;
    app.key = k;
    if (!k && app.ctrl) { app.stopAsked = true; app.ctrl.abort(); }
    render();
  }
  function loadModels() {
    return N.listModels().then(function (list) {
      app.models = list; app.byId = {};
      list.forEach(function (m) { app.byId[m.id] = m; });
      var first = C.DEFAULT_MODELS.filter(function (id) { return app.byId[id] && !app.byId[id].paidOnly; })[0];
      app.modelId = first || (list.filter(function (m) { return !m.paidOnly; })[0] || {}).id || null;
    }).catch(function (e) { app.modelsError = e.message; });
  }

  // ---------- live runs ----------
  function perCall(m) { return m ? C.EST_IN_TOKENS * m.inPrice + C.EST_OUT_TOKENS * m.outPrice : 0; }
  function testCalls(erase) { return R.plan(erase).reduce(function (n, p) { return n + Agent.TASKS[p.task].turns; }, 0); }

  function liveAsk(e, model) {
    return function (msgs) {
      if (app.stopAsked) return Promise.resolve(null);
      if (e.capSpent >= C.MAX_SPEND) { app.notice = 'Stopped: this agent reached its spend limit of ' + C.MAX_SPEND + ' Pollen.'; return Promise.resolve(null); }
      return N.ask(app.key, model, msgs, app.ctrl.signal).then(function (r) {
        if (r.cancelled) return null;
        if (r.cost) { e.spent += r.cost; app.spent += r.cost; }
        // The cap also counts calls whose cost is unknown (errors, timeouts) at worst case: a failed call can be billed.
        e.capSpent += r.cost || (C.EST_IN_TOKENS * model.inPrice + C.MAX_TOKENS * model.outPrice);
        if (r.status === 402 || /balance|insufficient|402/i.test(r.error || '')) {
          app.notice = 'Out of Pollen: ' + r.error + '. Top up at enter.pollinations.ai, then try again.';
          app.stopAsked = true;
        }
        return r;
      });
    };
  }

  // In a live run a null reply means Stop or the spend limit, not the end of a recording.
  function liveStop(s) { return s === 'end of recording' ? 'stopped' : s; }
  function unfinished(t) { return !t.res || t.res.score == null; }

  function begin(kind) {
    app.busy = kind; app.stopAsked = false; app.ctrl = new AbortController(); app.notice = '';
    stopPlayback();
  }
  function done() { app.busy = null; app.ctrl = null; render(); }

  async function leaveAlone(ev) {
    if (!ev.isTrusted || app.busy || !app.key) return;
    var model = app.byId[app.modelId]; if (!model) return;
    var e = { label: 'Your agent', sub: model.title, model: { id: model.id, title: model.title }, live: true, spent: 0, capSpent: 0,
      play: { events: [], found: {}, memory: Agent.emptyMemory(), stop: null, running: true }, erase: null, tests: [], cost: 0 };
    app.exps.push(e); app.cur = app.exps.length - 1; app.view = { kind: 'play', test: null }; app.frame = 0;
    begin('play'); render();
    var res = await R.play(liveAsk(e, model), { shouldStop: function () { return app.stopAsked; } }, function (evt) {
      e.play.events.push(evt); e.play.found = evt.found; e.play.memory = evt.memory;
      if (app.cur === app.exps.indexOf(e) && app.view.kind === 'play') app.frame = e.play.events.length;
      render();
    });
    e.play = { events: e.play.events, found: res.found, memory: res.memory, stop: liveStop(res.stop) };
    e.erase = Agent.pickErase(res.found, res.memory);
    e.cost = e.spent;
    done();
  }

  async function runTests(e, runs, model) {
    var queue = runs.slice(), workers = [];
    for (var w = 0; w < C.PARALLEL_TESTS; w++) workers.push((async function () {
      while (queue.length && !app.stopAsked) {
        var t = queue.shift();
        t.state = 'running'; t.live = []; render();
        t.res = await R.test(liveAsk(e, model), t.memory, t.task, function (evt) {
          t.live.push(evt);
          if (app.view.kind === 'test' && e.tests[app.view.test] === t) app.frame = t.live.length;
          render();
        }, function () { return app.stopAsked; });
        t.res.stop = liveStop(t.res.stop);
        t.state = 'done'; e.cost = e.spent; render();
      }
    })());
    await Promise.all(workers);
  }

  async function testNotes(ev) {
    var e = exp();
    if (!ev.isTrusted || app.busy || !app.key || !e || !e.live || e.play.running || (e.tests.length && !e.tests.some(unfinished))) return;
    var model = app.byId[e.model.id]; if (!model) return;
    if (!e.tests.length) e.tests = R.plan(e.erase).map(function (p) {
      return { task: p.task, arm: p.arm, run: p.run, res: null, state: 'waiting', memory: R.memoryFor(p.arm, e.play.memory, e.erase) };
    });
    var todo = e.tests.filter(unfinished);
    todo.forEach(function (t) { t.res = null; t.state = 'waiting'; t.live = null; });
    begin('test'); render();
    await runTests(e, todo, model);
    done();
  }

  async function rerunEdited(ev) {
    var e = exp();
    if (!ev.isTrusted || app.busy || !app.key || !e || !e.live || !e.custom) return;
    var model = app.byId[e.model.id]; if (!model) return;
    var mem = Agent.strike(e.play.memory, e.custom);
    e.tests = e.tests.filter(function (t) { return t.arm !== 'edited'; });
    var runs = ['towers', 'spire'].map(function (task) { return { task: task, arm: 'edited', run: 1, res: null, state: 'waiting', memory: mem, struck: JSON.parse(JSON.stringify(e.custom)) }; });
    e.tests = e.tests.concat(runs);
    begin('test'); render();
    await runTests(e, runs, model);
    done();
  }

  function stop(ev) {
    if (!ev.isTrusted || !app.busy) return;
    app.stopAsked = true;
    if (app.ctrl) app.ctrl.abort();
  }

  // ---------- playback ----------
  function stopPlayback() { app.playing = false; clearTimeout(app.timer); }
  function tick() {
    if (!app.playing) return;
    var n = frames().length;
    if (app.frame >= n) { stopPlayback(); render(); return; }
    app.frame++; render();
    app.timer = setTimeout(tick, 1100 / app.speed);
  }
  function togglePlay() {
    if (app.playing) { stopPlayback(); render(); return; }
    if (app.frame >= frames().length) app.frame = 0;
    app.playing = true; render();
    app.timer = setTimeout(tick, 300);
  }
  function seek(i) { stopPlayback(); app.frame = Math.max(0, Math.min(frames().length, i)); render(); }
  function pickExp(i) { stopPlayback(); app.cur = i; app.view = { kind: 'play', test: null }; app.frame = 0; render(); }
  function pickTest(i) { stopPlayback(); app.view = { kind: 'test', test: i }; app.frame = 0; render(); app.playing = true; app.timer = setTimeout(tick, 300); render(); }

  // ---------- rendering ----------
  function currentState() {
    var f = frames();
    return app.frame > 0 && f[app.frame - 1] ? f[app.frame - 1].state : World.init();
  }

  function renderAgents() {
    var nav = $('agents'); nav.textContent = '';
    app.exps.forEach(function (e, i) {
      var b = h('button', 'agent' + (i === app.cur ? ' on' : '') + (e.live ? ' mine' : ''));
      b.type = 'button';
      b.appendChild(h('span', 'an', e.label));
      b.appendChild(h('span', 'am', e.sub));
      b.addEventListener('click', function () { pickExp(i); });
      nav.appendChild(b);
    });
    if (!app.exps.length) nav.appendChild(h('span', 'hint', 'No agents yet.'));
  }

  function renderLive() {
    var box = $('live'); box.textContent = '';
    if (!app.key) {
      box.appendChild(h('span', 'hint', 'Sign in to leave your own agent alone (about 30 calls, paid with your Pollen).'));
      return;
    }
    if (!app.models.length) {
      box.appendChild(h('span', app.modelsError ? 'hint warn' : 'hint', app.modelsError ? 'Could not load the model list: ' + app.modelsError : 'Loading the model list…'));
      return;
    }
    var m = app.byId[app.modelId];
    var sel = h('select'); sel.id = 'model'; sel.setAttribute('aria-label', 'Model');
    app.models.forEach(function (mm) {
      var o = h('option', null, mm.title + (mm.paidOnly ? ' (paid-only)' : '') + ' · ~' + fmtP(perCall(mm)) + '/call');
      o.value = mm.id; if (mm.id === app.modelId) o.selected = true; sel.appendChild(o);
    });
    sel.disabled = !!app.busy;
    sel.addEventListener('change', function () { app.modelId = sel.value; render(); });
    box.appendChild(sel);
    var e = exp();
    if (app.busy) {
      var s = h('button', 'stop', 'Stop'); s.type = 'button'; s.addEventListener('click', stop); box.appendChild(s);
      box.appendChild(h('span', 'hint', app.busy === 'play' ? 'Playing alone… each turn is one call.' : 'Testing its notes…'));
      return;
    }
    var go = h('button', 'primary', 'Leave a new agent alone · ~' + fmtP(perCall(m) * R.PLAY.sessions * R.PLAY.turns));
    go.type = 'button'; go.disabled = !m; go.addEventListener('click', leaveAlone); box.appendChild(go);
    var left = e && e.live && e.tests.filter(unfinished);
    if (e && e.live && e.play.events.length && (!e.tests.length || left.length)) {
      var tm = app.byId[e.model.id];
      var calls = e.tests.length ? left.reduce(function (n, x) { return n + Agent.TASKS[x.task].turns; }, 0) : testCalls(e.erase);
      var t = h('button', 'primary', (e.tests.length ? 'Finish the test' : 'Test its notes') + ' · ~' + fmtP(perCall(tm) * calls));
      t.type = 'button'; t.addEventListener('click', testNotes); box.appendChild(t);
    }
    if (e && e.live && e.custom && e.tests.length) {
      var r = h('button', 'ghost', 'Re-run with your edits · ~' + fmtP(perCall(app.byId[e.model.id]) * 13));
      r.type = 'button'; r.addEventListener('click', rerunEdited); box.appendChild(r);
    }
    if (m && m.paidOnly) box.appendChild(h('span', 'hint warn', 'Paid-only model: it needs paid Pollen.'));
  }

  function renderWhere() {
    var f = frames(), e = exp(), w = $('where');
    if (!e) { w.textContent = ''; return; }
    if (app.view.kind === 'test') {
      var t = e.tests[app.view.test], ev = f[app.frame - 1];
      w.textContent = 'Test: ' + Agent.TASKS[t.task].title + ' · ' + t.arm + ' run ' + t.run + (ev ? ' · turn ' + ev.ctx.turn + ' of ' + ev.ctx.turns : ' · start');
      var back = h('button', 'link', '← back to the play'); back.type = 'button';
      back.addEventListener('click', function () { pickExp(app.cur); });
      w.appendChild(document.createTextNode(' '));
      w.appendChild(back);
      return;
    }
    var cur = f[app.frame - 1];
    w.textContent = cur ? 'Left alone · session ' + cur.ctx.session + ' of ' + cur.ctx.sessions + ' · turn ' + cur.ctx.turn + ' of ' + cur.ctx.turns + ' · tick ' + cur.state.tick
      : 'Left alone · before the first turn';
  }

  function newFinds(ev, prev) {
    var out = [];
    World.TECHNIQUES.forEach(function (k) { if (ev.found && ev.found[k] && !(prev && prev.found && prev.found[k])) out.push(k); });
    return out;
  }

  function renderTimeline() {
    var box = $('timeline'); box.textContent = '';
    var f = frames(), lastSession = null;
    var start = h('button', 'cell start' + (app.frame === 0 ? ' cur' : ''), '');
    start.type = 'button'; start.title = 'Start'; start.addEventListener('click', function () { seek(0); });
    box.appendChild(start);
    f.forEach(function (ev, i) {
      if (app.view.kind === 'play' && ev.ctx.session !== lastSession) {
        box.appendChild(h('span', 'sess', 'S' + ev.ctx.session));
        lastSession = ev.ctx.session;
      }
      var cls = 'cell';
      if (ev.reply.error) cls += ' err';
      else if (!ev.parsed || !ev.parsed.ok) cls += ' bad';
      else if (ev.results.some(function (r) { return !r.ok; })) cls += ' part';
      else if (ev.results.length) cls += ' ok';
      if (i + 1 === app.frame) cls += ' cur';
      var finds = app.view.kind === 'play' ? newFinds(ev, f[i - 1]) : World.TECHNIQUES.filter(function (k) { return ev.state.found[k] && (!f[i - 1] || !f[i - 1].state.found[k]); });
      var b = h('button', cls + (finds.length ? ' flag' : ''));
      b.type = 'button';
      b.title = 'turn ' + ev.ctx.turn + (finds.length ? ' · found: ' + finds.map(function (k) { return World.LABELS[k]; }).join(', ') : '');
      if (finds.length) b.appendChild(h('span', 'flagtxt', finds.map(function (k) { return World.LABELS[k]; }).join(' · ')));
      b.addEventListener('click', function () { seek(i + 1); });
      box.appendChild(b);
    });
    var e = exp();
    if (e && e.live && app.busy === 'play' && app.view.kind === 'play') box.appendChild(h('span', 'cell pending', '…'));
  }

  function renderTurn() {
    var box = $('turn'); box.textContent = '';
    var ev = frames()[app.frame - 1];
    if (!ev) { box.appendChild(h('p', 'hint', app.view.kind === 'test' ? 'Press Play or a cell to watch this test.' : 'Press Play to watch it, or click a cell in the timeline.')); return; }
    if (ev.reply.error) { box.appendChild(h('p', 'errline', 'The call failed: ' + ev.reply.error)); return; }
    if (!ev.parsed.ok) {
      box.appendChild(h('p', 'errline', 'The reply could not be read as JSON, so nothing happened. It began:'));
      box.appendChild(h('pre', 'raw', String(ev.reply.text).slice(0, 240)));
      return;
    }
    box.appendChild(h('p', 'thought', ev.parsed.thought ? '“' + ev.parsed.thought + '”' : '(no thought given)'));
    var ul = h('ul', 'acts');
    if (!ev.results.length) ul.appendChild(h('li', 'muted', 'did nothing'));
    ev.results.forEach(function (r) {
      var li = h('li', r.ok ? 'ok' : 'no');
      li.appendChild(h('code', null, r.action));
      li.appendChild(h('span', null, ' ' + r.text));
      ul.appendChild(li);
    });
    var skipped = ev.parsed.actions.length - ev.results.length;
    if (skipped > 0) ul.appendChild(h('li', 'muted', skipped + ' more skipped after the failure'));
    if (ev.parsed.dropped) ul.appendChild(h('li', 'muted', ev.parsed.dropped + ' actions over the limit of 5 ignored'));
    box.appendChild(ul);
    var cost = ev.reply.cost != null ? fmtP(ev.reply.cost) : '';
    box.appendChild(h('p', 'meta', [ev.reply.ms ? (ev.reply.ms / 1000).toFixed(1) + ' s' : '', cost].filter(Boolean).join(' · ')));
  }

  function mindMemory() {
    var e = exp(); if (!e) return { mem: Agent.emptyMemory(), struck: null, sub: '' };
    if (app.view.kind === 'test') {
      var t = e.tests[app.view.test];
      if (t.arm === 'fresh') return { mem: Agent.emptyMemory(), struck: null, sub: 'fresh: empty notes' };
      var struck = t.arm === 'erased' ? e.erase.struck : t.arm === 'edited' ? t.struck : null;
      return { mem: e.play.memory, struck: struck, sub: t.arm + (struck ? ': struck lines are hidden from it' : ': its own notes') + ' · read-only' };
    }
    var f = frames(), ev = f[app.frame - 1];
    var atEnd = app.frame >= f.length && !e.play.running && f.length;
    if (atEnd) {
      var s = e.custom || (e.erase && e.erase.struck) || null;
      return { mem: e.play.memory, struck: s, sub: 'after play' + (s ? ' · struck = ' + (e.custom ? 'your edit' : 'erased for the test (' + World.LABELS[e.erase.tech] + ')') : ''), editable: e.live && !app.busy };
    }
    return { mem: ev ? ev.memory : Agent.emptyMemory(), struck: null, sub: ev ? 'as of this turn' : 'empty at the start' };
  }

  function renderMind() {
    var m = mindMemory(), e = exp();
    $('mind-sub').textContent = m.sub;
    var ol = $('notes'); ol.textContent = '';
    if (!m.mem.notes.length) ol.appendChild(h('li', 'muted', '(empty)'));
    m.mem.notes.forEach(function (n, i) {
      var li = h('li', m.struck && m.struck.notes.indexOf(i) >= 0 ? 'struck' : '', n);
      if (m.editable) {
        li.classList.add('edit'); li.tabIndex = 0; li.title = 'Click to strike or restore this line';
        var flip = function () {
          var base = e.custom || (e.erase ? JSON.parse(JSON.stringify(e.erase.struck)) : { notes: [], log: [] });
          var k = base.notes.indexOf(i);
          if (k >= 0) base.notes.splice(k, 1); else base.notes.push(i);
          e.custom = base; render();
        };
        li.addEventListener('click', flip);
        li.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); flip(); } });
      }
      ol.appendChild(li);
    });
    var ul = $('log'); ul.textContent = '';
    if (!m.mem.log.length) ul.appendChild(h('li', 'muted', '(empty)'));
    m.mem.log.forEach(function (l, i) { ul.appendChild(h('li', m.struck && m.struck.log.indexOf(i) >= 0 ? 'struck' : '', l)); });

    var fl = $('found'); fl.textContent = '';
    var f = frames(), ev = f[app.frame - 1];
    var found = app.view.kind === 'test' ? (ev ? ev.state.found : {}) : (ev ? ev.found : {});
    World.TECHNIQUES.forEach(function (k) {
      var x = found && found[k], li = h('li', x ? 'yes' : 'no');
      li.appendChild(h('b', null, World.LABELS[k]));
      var txt = x ? ' · tick ' + x.tick + (x.session ? ' · session ' + x.session : '') : ' · not yet';
      if (x && app.view.kind === 'play' && Agent.KEYWORDS[k]) {
        var l = Agent.linesAbout(m.mem, k);
        txt += l.notes.length ? ' · written down: NOTES line ' + l.notes.map(function (n) { return n + 1; }).join(', ') : ' · not in NOTES';
      }
      li.appendChild(document.createTextNode(txt));
      fl.appendChild(li);
    });
    var ms = ['on_plateau', 'on_peak', 'on_spire', 'thing_on_spire', 'tower3', 'water_loss'].filter(function (k) { return found && found[k]; });
    if (ms.length) fl.appendChild(h('li', 'small', 'Also: ' + ms.map(function (k) { return World.LABELS[k]; }).join(', ')));
  }

  function renderTest() {
    var box = $('test'); box.textContent = '';
    var e = exp();
    if (!e) return;
    if (!e.tests.length) {
      box.appendChild(h('p', 'hint', e.live ? (e.play.running ? 'The test comes after the play.' : 'Press "Test its notes" to run it.') : 'This agent has no test runs.'));
      return;
    }
    if (!e.erase) box.appendChild(h('p', 'hint', 'Nothing was found to erase: the engine saw no rock shatter or jump-throw that the notes also mention, so there is no erased arm.'));
    ['towers', 'spire'].forEach(function (task) {
      var row = h('div', 'trow');
      var T = Agent.TASKS[task];
      var head = h('div', 'thead');
      head.appendChild(h('b', null, T.title));
      head.appendChild(h('small', null, task === 'towers' ? 'towers standing after ' + T.turns + ' turns' : 'actions left when a cube lands, from feet 0'));
      row.appendChild(head);
      var scores = {}, used = {};
      ARMS.forEach(function (arm) {
        var runs = e.tests.map(function (t, i) { return { t: t, i: i }; }).filter(function (x) { return x.t.task === task && x.t.arm === arm; });
        if (!runs.length) return;
        var cell = h('div', 'arm ' + arm);
        cell.appendChild(h('span', 'armname', arm));
        scores[arm] = []; used[arm] = [0, 0];
        runs.forEach(function (x) {
          var t = x.t, res = t.res, label = res ? (res.score == null ? '×' : String(res.score)) : (t.state === 'running' ? '…' : '·');
          var b = h('button', 'dot' + (app.view.kind === 'test' && app.view.test === x.i ? ' cur' : '') + (res && res.used[TECH_FOR[task]] ? ' used' : ''), label);
          b.type = 'button';
          b.title = arm + ' run ' + t.run + (res ? (res.score == null ? ': no valid score (' + res.stop + ')' : ': score ' + res.score) + (res.used[TECH_FOR[task]] ? ', used ' + World.LABELS[TECH_FOR[task]] : '') : '');
          b.disabled = !res && !t.live;
          b.addEventListener('click', function () { pickTest(x.i); });
          cell.appendChild(b);
          if (res) { scores[arm].push(res.score); if (res.score != null) { used[arm][1]++; if (res.used[TECH_FOR[task]]) used[arm][0]++; } }
        });
        row.appendChild(cell);
      });
      var facts = h('div', 'facts');
      facts.appendChild(h('div', 'fact', World.LABELS[TECH_FOR[task]] + ' used: ' + Object.keys(used).map(function (a) { return a + ' ' + used[a][0] + '/' + used[a][1]; }).join(' · ')));
      facts.appendChild(h('div', 'verdict', R.verdict({ fresh: scores.fresh || [], played: scores.played || [] })));
      row.appendChild(facts);
      box.appendChild(row);
    });
    box.appendChild(h('p', 'fine', 'Two runs per arm is an anecdote, not a statistic. The paper used 13 agents for 30 hours each. Click a score to watch that run.' + (e.cost ? ' This agent cost ' + fmtP(e.cost) + ' in total.' : '')));
  }

  function renderNotice() {
    var n = $('notice');
    var bits = [];
    if (app.notice) bits.push(app.notice);
    var e = exp();
    if (e && !e.live && app.recordedAt) bits.push('Recorded ' + app.recordedAt.slice(0, 10) + ' with ' + e.model.title + '. Nothing is charged for watching; the engine re-runs every action here.');
    if (e && e.live && e.play.stop && e.play.stop !== 'stopped') bits.push('Play ended early: ' + e.play.stop + '.');
    n.textContent = bits.join(' ');
  }

  function render() {
    renderAgents(); renderLive(); renderNotice(); renderWhere();
    var s = currentState();
    V.island($('island'), s);
    renderTimeline(); renderTurn(); renderMind(); renderTest();
    $('playbtn').textContent = app.playing ? 'Pause' : 'Play';
    $('speed').textContent = app.speed + 'x';
    var sp = $('spent'); sp.hidden = !app.spent; sp.textContent = 'spent ' + fmtP(app.spent);
    var cur = $('timeline').querySelector('.cur');
    if (cur && cur.scrollIntoView) { var tl = $('timeline'); tl.scrollLeft = Math.max(0, cur.offsetLeft - tl.clientWidth / 2); }
  }

  // ---------- wiring ----------
  $('playbtn').addEventListener('click', togglePlay);
  $('speed').addEventListener('click', function () { app.speed = app.speed === 1 ? 4 : app.speed === 4 ? 12 : 1; render(); });
  document.addEventListener('keydown', function (ev) {
    if (ev.target && /input|select|textarea/i.test(ev.target.tagName)) return;
    if (ev.key === 'ArrowRight') { seek(app.frame + 1); ev.preventDefault(); }
    if (ev.key === 'ArrowLeft') { seek(app.frame - 1); ev.preventDefault(); }
  });
  $('prompt').textContent = Agent.SYSTEM;
  $('paper').href = C.PAPER_URL; $('src').href = C.REPO_URL;

  wireConnect();
  render();
  loadModels().then(render);
  loadRecordings().then(function () {
    var a = Number(params.get('agent'));
    if (Number.isInteger(a) && a >= 1 && a <= app.exps.length) app.cur = a - 1;
    if (params.get('frame') === 'end') app.frame = frames().length;
    render();
    if (params.get('play') === '1' && !app.key) togglePlay();
  });
})();
