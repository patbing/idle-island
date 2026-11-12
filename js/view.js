/* Drawing: the island as a side-view SVG. Model text never reaches this file. */
(function () {
  'use strict';
  var World = window.II.world;
  var NS = 'http://www.w3.org/2000/svg';
  var CW = 34, UH = 21, BASE = 262, PADT = 14, VW = World.W * CW, VH = 296;

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function y(z) { return BASE - z * UH; }

  function terrainClass(x) {
    if (x === 1 || x === 2) return 'peak';
    if (x === 3 || x === 4) return 'plateau';
    if (x === 21 || x === 22) return 'spire';
    return 'flat';
  }

  // opts: { lastThrow, highlight: [x...] }
  function island(svg, s) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', '0 0 ' + VW + ' ' + VH);
    var maxTop = 0;
    for (var x = 0; x < World.W; x++) if (!World.isWater(x)) maxTop = Math.max(maxTop, World.top(s, x));
    var scale = Math.min(1, (BASE - PADT) / ((maxTop + 2.5) * UH));
    var g = el('g', { transform: scale < 1 ? 'translate(0 ' + (BASE * (1 - scale)).toFixed(1) + ') scale(1 ' + scale.toFixed(3) + ')' : '' }, svg);
    el('rect', { x: 0, y: y(0) - 6, width: VW, height: VH, class: 'water' }, g);
    for (x = 0; x < World.W; x++) {
      if (World.isWater(x)) continue;
      var gh = World.GROUND[x];
      el('rect', { x: x * CW, y: y(gh), width: CW + 0.5, height: VH - y(gh), class: 'ground ' + terrainClass(x) }, g);
      s.cols[x].forEach(function (id, i) {
        var z = gh + i, cls = id === 'rock' ? 'rock' : id === 'ring' ? 'ring' : (Number(id.slice(1)) > 6 ? 'cube made' : 'cube');
        if (id === 'rock') el('rect', { x: x * CW + 4, y: y(z + 1) + 2, width: CW - 8, height: UH - 2, rx: 7, class: cls }, g);
        else if (id === 'ring') el('ellipse', { cx: x * CW + CW / 2, cy: y(z) - UH / 2, rx: CW / 2 - 6, ry: UH / 2 - 2, class: cls }, g);
        else el('rect', { x: x * CW + 3, y: y(z + 1) + 1, width: CW - 6, height: UH - 2, rx: 2, class: cls }, g);
        var t = el('text', { x: x * CW + CW / 2, y: y(z) - 4, class: 'tag' + (id === 'rock' ? ' light' : '') }, g);
        t.textContent = id === 'rock' ? 'rock' : id === 'ring' ? '' : id;
      });
    }
    var lt = s.lastThrow;
    if (lt && lt.pts && lt.pts.length > 1) {
      el('polyline', { points: lt.pts.map(function (p) { return (p[0] * CW).toFixed(1) + ',' + y(p[1]).toFixed(1); }).join(' '), class: 'arc' + (lt.air ? ' jump' : '') }, g);
    }
    // The agent stands on top of its column.
    var f = World.feet(s), ax = s.x * CW + CW / 2, ay = y(f);
    var body = el('g', { class: 'eko', transform: 'translate(' + ax + ' ' + ay + ')' }, g);
    el('rect', { x: -7, y: -26, width: 14, height: 20, rx: 6, class: 'eko-body' }, body);
    el('circle', { cx: 2.5, cy: -19, r: 2, class: 'eko-eye' }, body);
    el('line', { x1: -3, y1: -6, x2: -4, y2: 0, class: 'eko-leg' }, body);
    el('line', { x1: 3, y1: -6, x2: 4, y2: 0, class: 'eko-leg' }, body);
    if (s.hold) {
      el('rect', { x: -7, y: -40, width: 14, height: 11, rx: s.hold === 'rock' ? 5 : 2, class: s.hold === 'rock' ? 'rock' : s.hold === 'ring' ? 'ring' : 'cube' }, body);
    }
    // Landmarks and column numbers, outside the scaled group so they stay readable.
    [['Peak', 1.5, 4], ['Plateau', 3.5, 2], ['Spire', 21.5, 6]].forEach(function (l) {
      var t = el("text", { x: l[1] * CW, y: BASE + 16, class: "landmark" }, svg); t.textContent = l[0];
    });
    for (x = 0; x < World.W; x += 1) {
      if (x % 2) continue;
      var n = el("text", { x: x * CW + CW / 2, y: VH - 4, class: "colnum" }, svg); n.textContent = x;
    }
  }

  window.II.view = { island: island };
})();
