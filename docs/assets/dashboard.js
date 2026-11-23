/* HEvOD dashboard: map, slider, legend. Data comes from data/events.json, geo_meta.json, counties_subset.json
   and one data/events/<event>.json per hurricane (written by pipeline/hevod_preprocess.py). */
(function () {
  'use strict';

  var THUMB = 20;                       // px, must match --thumb in hevod.css
  var cfg = null, GEOJSON = null, current = null, lastArgs = null, evCache = {};

  /* ------------------------------------------------------------------ helpers */
  var fmtCache = {};
  function formatter(tz) {
    if (!fmtCache[tz]) {
      fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short'
      });
    }
    return fmtCache[tz];
  }
  function parts(ms, tz) {
    var o = {};
    formatter(tz).formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    var time = o.hour + ':' + o.minute + ' ' + (o.dayPeriod || '').toUpperCase();
    var abbr = o.timeZoneName || tz;
    return {
      md: o.month + '/' + o.day, ymd: o.year + '-' + o.month + '-' + o.day, time: time, abbr: abbr,
      full: o.month + '/' + o.day + '/' + o.year + ' ' + time + ' ' + abbr
    };
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, kids) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    (kids || []).forEach(function (k) { n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return n;
  }
  function theme() { return document.documentElement.getAttribute('data-theme') || 'light'; }
  function styleColor(st, dark) { return dark ? st.dark : st.light; }
  function allIdx() { var a = []; for (var i = 0; i < cfg.nTraces; i++) { a.push(i); } return a; }
  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) { throw new Error(url + ' (' + r.status + ')'); }
      return r.json();
    });
  }

  /* ------------------------------------------------------------------ map state at time T */
  // Two independent layers: fill types (latest record per county wins) and outline types (state of emergency).
  // Inside a layer, county-level records win over state-wide ones.
  function layerOf(cty, st) {
    var res = {}, f, s, i, lst;
    for (f in cty) { if (Object.prototype.hasOwnProperty.call(cty, f)) { res[f] = [cty[f], false]; } }
    for (s in st) {
      if (!Object.prototype.hasOwnProperty.call(st, s)) { continue; }
      lst = cfg.geo.state_counties[s] || [];
      for (i = 0; i < lst.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(res, lst[i])) { res[lst[i]] = [st[s], true]; }
      }
    }
    return res;
  }

  function computeState(ev, T) {
    var R = ev.records, i, r, isFill, cF = {}, sF = {}, cO = {}, sO = {};
    for (i = 0; i < R.length; i++) {
      r = R[i];
      if (r.t > T) { break; }
      isFill = cfg.styles[r.ty].mode === 'fill';
      if (r.f) { (isFill ? cF : cO)[r.f] = r; } else { (isFill ? sF : sO)[r.s] = r; }
    }
    var fillL = layerOf(cF, sF), outL = layerOf(cO, sO), out = [], f;
    for (f in fillL) {
      if (Object.prototype.hasOwnProperty.call(fillL, f)) { out.push([f, fillL[f][0], fillL[f][1], outL[f] || null]); }
    }
    for (f in outL) {
      if (Object.prototype.hasOwnProperty.call(outL, f)) { out.push([f, outL[f][0], outL[f][1], fillL[f] || null]); }
    }
    return out;
  }

  /* ------------------------------------------------------------------ hover text */
  function orderBlock(r, statewide, tz) {
    var t = 'Order type: ' + esc(cfg.styles[r.ty].name);
    t += '<br>Announced: ' + parts(r.t, tz).full;
    if (r.e) { t += '<br>Effective: ' + esc(r.e) + ' (local time)'; }
    if (r.a) { t += '<br>Area: ' + r.a; }
    if (statewide) { t += '<br><i>State-wide order</i>'; }
    return t;
  }

  function hoverText(o, tz) {
    var fips = o[0], r = o[1];
    var ab = cfg.geo.state_abbr[r.s] || r.ab || '';
    var name = cfg.geo.names[fips] || r.cn || fips;
    var t = '<b>' + esc(name) + (ab ? ', ' + esc(ab) : '') + '</b>';
    var blocks = [[r, o[2]]];
    if (o[3]) { blocks.push(o[3]); }
    if (blocks.length > 1 && cfg.styles[blocks[0][0].ty].mode !== 'fill') { blocks.reverse(); }
    blocks.forEach(function (b, n) {
      t += (n ? '<br>- - - - - - - -<br>' : '<br>') + orderBlock(b[0], b[1], tz);
    });
    return t;
  }

  /* ------------------------------------------------------------------ fit the view to an event */
  function merc(latDeg) { var p = latDeg * Math.PI / 180; return Math.log(Math.tan(Math.PI / 4 + p / 2)); }
  function invMerc(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI; }

  function fitView(gd, ev) {
    var b = ev.bbox;
    if (!b) { return; }
    var W = gd.clientWidth || 900, H = gd.clientHeight || 600;
    var box = $('hv-controls'), x0 = 0, y0 = 0;
    if (W > 760) { x0 = box ? box.offsetWidth + 30 : 0; } else { y0 = box ? box.offsetHeight + 20 : 0; }
    var effW = Math.max(W - x0, 220), effH = Math.max(H - y0, 220);
    var dLon = Math.max(b[2] - b[0], 0.4);
    var yMin = merc(b[1]), yMax = merc(b[3]);
    var dY = Math.max(yMax - yMin, 0.01);
    var zLon = Math.log(effW / 512 * 360 / dLon) / Math.LN2;
    var zLat = Math.log(effH / 512 * 2 * Math.PI / dY) / Math.LN2;
    var z = Math.max(3.2, Math.min(9, Math.min(zLon, zLat) - 0.25));
    var lonC = (b[0] + b[2]) / 2 - (x0 / 2) * 360 / (512 * Math.pow(2, z));
    var yC = (yMin + yMax) / 2 + (y0 / 2) * 2 * Math.PI / (512 * Math.pow(2, z));
    var upd = {};
    upd[cfg.mapKey + '.center.lon'] = lonC;
    upd[cfg.mapKey + '.center.lat'] = invMerc(yC);
    upd[cfg.mapKey + '.zoom'] = z;
    window.Plotly.relayout(gd, upd);
  }

  /* ------------------------------------------------------------------ map */
  var TRANSPARENT = 'rgba(0,0,0,0)';

  function fillColorscale(dark) {
    var k = cfg.styles.length;
    var cols = cfg.styles.map(function (s) { return s.mode === 'fill' ? styleColor(s, dark) : TRANSPARENT; });
    if (k === 1) { return [[0, cols[0]], [1, cols[0]]]; }
    return cols.map(function (c, i) { return [i / (k - 1), c]; });
  }

  function createMap() {
    var common = function () {
      return {
        type: 'choroplethmap', geojson: GEOJSON, featureidkey: 'id', locations: [], z: [], customdata: [],
        showscale: false, zmin: 0, zmax: Math.max(cfg.styles.length - 1, 1),
        hovertemplate: '%{customdata[0]}<extra></extra>', hoverlabel: { align: 'left', namelength: 0 }
      };
    };
    var traces = [Object.assign(common(), {
      colorscale: fillColorscale(false), marker: { opacity: 0.88, line: { width: 0, color: '#FFFFFF' } }
    })];
    cfg.styles.forEach(function (s) {
      if (s.mode === 'outline') {
        traces.push(Object.assign(common(), {
          colorscale: [[0, TRANSPARENT], [1, TRANSPARENT]],
          marker: { opacity: 1, line: { width: cfg.outlineWidth, color: s.light } }
        }));
      }
    });
    var layout = {
      margin: { r: 0, t: 0, l: 0, b: 0 }, paper_bgcolor: TRANSPARENT, autosize: true, uirevision: 'hevod'
    };
    layout[cfg.mapKey] = { style: cfg.basemaps.light, center: { lat: 32.0, lon: -86.0 }, zoom: 4.2 };
    return window.Plotly.newPlot('map-graph', traces, layout,
      { responsive: true, displayModeBar: false, scrollZoom: true, doubleClick: 'reset' });
  }

  function mapReady(gd) {
    var lay = gd && gd._fullLayout && gd._fullLayout[cfg.mapKey];
    var sp = lay && lay._subplot;
    var m = sp && sp.map;
    if (!(m && m.getStyle)) { return false; }
    try { if (!m.getStyle()) { return false; } } catch (e) { return false; }
    if (sp.traceHash && Object.keys(sp.traceHash).length === 0) { return false; }
    return true;
  }

  // county polygons above every basemap layer, basemap labels back on top, light labels on the dark basemap
  function decorateBasemap(gd, dark) {
    var P = window.Plotly, m = gd._fullLayout[cfg.mapKey]._subplot.map;
    return P.restyle(gd, { below: allIdx().map(function () { return ''; }) }, allIdx()).then(function () {
      (m.getStyle().layers || []).forEach(function (l) {
        if (l.type !== 'symbol') { return; }
        if (dark && l.layout && l.layout['text-field']) {
          try {
            m.setPaintProperty(l.id, 'text-color', '#F4F4F2');
            m.setPaintProperty(l.id, 'text-halo-color', 'rgba(0,0,0,0.9)');
            m.setPaintProperty(l.id, 'text-halo-width', 1.6);
            m.setPaintProperty(l.id, 'text-halo-blur', 0.5);
          } catch (e) { /* layer without text paint properties */ }
        }
        try { m.moveLayer(l.id); } catch (e) { /* ignore */ }
      });
    });
  }

  function whenMapReady(gd, cb, tries) {
    if (mapReady(gd)) { cb(); return; }
    if ((tries || 0) > 80) { cb(); return; }
    setTimeout(function () { whenMapReady(gd, cb, (tries || 0) + 1); }, 100);
  }

  function updateMap(args) {
    var P = window.Plotly, gd = $('map-graph');
    if (!gd || !P || !gd._fullData || !gd._fullData.length || !mapReady(gd) || gd._hvBusy) {
      if (args.tries < 200) {
        args.tries += 1;
        setTimeout(function () { if (lastArgs === args) { updateMap(args); } }, 120);
      }
      return;
    }
    var dark = args.theme === 'dark';

    if (gd._hvTheme === undefined && gd._hvSettle === undefined) {       // let plotly finish its first draw
      gd._hvSettle = true;
      setTimeout(function () { gd._hvSettle = false; if (lastArgs) { updateMap(lastArgs); } }, 700);
    }
    if (gd._hvSettle) { return; }

    if (gd._hvTheme !== args.theme) {
      // swap basemap style and colours first, data follows afterwards
      var lay = {};
      lay[cfg.mapKey + '.style'] = cfg.basemaps[dark ? 'dark' : 'light'];
      gd._hvTheme = args.theme;
      gd._hvBusy = true;
      var idx = allIdx(), tr = 1;
      var lineCol = idx.map(function () { return dark ? '#F1F1EF' : '#232D4B'; });
      cfg.styles.forEach(function (st) { if (st.mode === 'outline') { lineCol[tr] = styleColor(st, dark); tr += 1; } });
      var cscale = idx.map(function (i) { return i === 0 ? fillColorscale(dark) : [[0, TRANSPARENT], [1, TRANSPARENT]]; });
      P.update(gd, {
        'colorscale': cscale,
        'marker.line.color': lineCol,
        'hoverlabel.bgcolor': idx.map(function () { return dark ? '#141414' : '#FFFFFF'; }),
        'hoverlabel.font.color': idx.map(function () { return dark ? '#F1F1EF' : '#232D4B'; })
      }, lay, idx).then(function () {
        setTimeout(function () {
          whenMapReady(gd, function () {
            var done = function () {
              setTimeout(function () { gd._hvBusy = false; if (lastArgs) { updateMap(lastArgs); } }, 250);
            };
            try { decorateBasemap(gd, dark).then(done, done); } catch (e) { done(); }
          });
        }, 250);
      }, function () { gd._hvBusy = false; });
      return;
    }

    var st = args.state, nT = cfg.nTraces, loc = [], z = [], cd = [], bc = [], j;
    for (j = 0; j < nT; j++) { loc.push([]); z.push([]); cd.push([]); bc.push([]); }
    for (var i = 0; i < st.length; i++) {
      var ty = st[i][1].ty, t = cfg.traceOf[ty];
      loc[t].push(st[i][0]);
      z[t].push(ty);
      cd[t].push([hoverText(st[i], args.tz)]);
      bc[t].push(styleColor(cfg.styles[ty], dark));
    }
    P.restyle(gd, { locations: loc, z: z, customdata: cd, 'hoverlabel.bordercolor': bc }, allIdx());

    if (gd._hvEvent !== args.ev.event) {
      gd._hvEvent = args.ev.event;
      fitView(gd, args.ev);
    }
  }

  /* ------------------------------------------------------------------ slider labels */
  function buildLabels(ticks, cur, tz, W) {
    var N = ticks.length, i;
    if (!N) { return []; }
    var minGap = W < 520 ? 70 : 82;
    var px = function (k) { return N > 1 ? k / (N - 1) * W : 0; };
    var chosen = [cur];
    var fits = function (k) {
      for (var j = 0; j < chosen.length; j++) { if (Math.abs(px(k) - px(chosen[j])) < minGap) { return false; } }
      return true;
    };
    [0, N - 1].forEach(function (k) { if (chosen.indexOf(k) < 0 && fits(k)) { chosen.push(k); } });
    var cands = [], lastDay = null;
    for (i = 0; i < N; i++) {
      var d = parts(ticks[i].t, tz).ymd;
      if (d !== lastDay) { cands.push(i); lastDay = d; }
    }
    var maxL = Math.max(2, Math.floor(W / minGap));
    var stride = Math.max(1, Math.ceil(cands.length / maxL));
    cands.forEach(function (k, n) {
      if (n % stride === 0 && chosen.indexOf(k) < 0 && fits(k)) { chosen.push(k); }
    });
    chosen.sort(function (a, b) { return a - b; });
    return chosen.map(function (k) {
      var p = N > 1 ? k / (N - 1) * 100 : 0, pp = parts(ticks[k].t, tz);
      var cls = 'hv-tick' + (k === cur ? ' is-current' : '') + (ticks[k].kind !== 'pad' ? ' is-' + ticks[k].kind : '') +
        (p < 8 ? ' edge-l' : (p > 92 ? ' edge-r' : ''));
      var n = el('div', cls, [el('span', 'd', [pp.md]), el('span', 't', [pp.time])]);
      n.style.left = 'calc(' + p + '% + ' + ((0.5 - p / 100) * THUMB).toFixed(2) + 'px)';
      return n;
    });
  }

  function swatch(st, dark) {
    var n = el('span', 'sw'), c = styleColor(st, dark);
    if (st.mode === 'fill') { n.style.background = c; n.style.border = '0'; }
    else { n.style.background = 'transparent'; n.style.border = '3px solid ' + c; n.style.boxSizing = 'border-box'; }
    return n;
  }

  /* ------------------------------------------------------------------ render */
  function render() {
    var ev = current, slider = $('pad-slider');
    if (!ev || !ev.ticks || !ev.ticks.length) { return; }
    var tz = $('tz-select').value || 'America/New_York', th = theme();
    var ticks = ev.ticks, N = ticks.length;
    var cur = Math.min(Math.max(parseInt(slider.value, 10) || 0, 0), N - 1);
    var tick = ticks[cur], tp = parts(tick.t, tz);

    var state = computeState(ev, tick.t);
    lastArgs = { ev: ev, state: state, tz: tz, theme: th, tries: 0 };
    updateMap(lastArgs);

    var W = slider.getBoundingClientRect().width || 320;
    var box = $('slider-labels');
    box.replaceChildren.apply(box, buildLabels(ticks, cur, tz, W));
    var pct = N > 1 ? cur / (N - 1) * 100 : 0;
    slider.style.setProperty('--p', 'calc(' + pct + '% + ' + ((0.5 - pct / 100) * THUMB).toFixed(2) + 'px)');

    $('slider-title').textContent = 'Public Advisories Time (Current Timezone: ' + tp.abbr + ')';
    var uniq = {};
    state.forEach(function (o) { uniq[o[0]] = 1; });
    var nCty = Object.keys(uniq).length;
    var cap = 'Orders announced through ' + tp.full + ' · ' + nCty + (nCty === 1 ? ' county' : ' counties');
    if (tick.kind === 'pre') { cap += ' · includes orders announced before the first advisory'; }
    if (tick.kind === 'post') { cap += ' · includes orders announced after the last advisory'; }
    $('slider-caption').textContent = cap;

    var counts = {};
    state.forEach(function (o) { counts[o[1].ty] = (counts[o[1].ty] || 0) + 1; });
    var items = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; }).map(function (ty) {
      return el('div', 'hv-legend-item', [
        swatch(cfg.styles[ty], th === 'dark'), el('span', 'nm', [cfg.styles[ty].name]), el('span', 'ct', [String(counts[ty])])
      ]);
    });
    if (!items.length) { items = [el('div', 'hv-legend-empty', ['No orders announced yet'])]; }
    var lg = $('legend-body');
    lg.replaceChildren.apply(lg, items);
  }

  /* ------------------------------------------------------------------ events */
  function nhcLink(e) {
    if (cfg.nhcOverrides && cfg.nhcOverrides[e.name]) { return cfg.nhcOverrides[e.name]; }
    var name = e.name.replace('Hurricane', '').split('(')[0].trim().toUpperCase();
    var ext = e.year === 2016 ? 'shtml' : 'php';
    return 'https://www.nhc.noaa.gov/archive/' + e.year + '/' + name + '_graphics.' + ext;
  }

  function loadEvent(name) {
    var e = cfg.events.filter(function (x) { return x.name === name; })[0];
    if (!e) { return Promise.resolve(); }
    var p = evCache[name] ? Promise.resolve(evCache[name]) : fetchJSON('data/events/' + e.file).then(function (d) {
      evCache[name] = d;
      return d;
    });
    return p.then(function (ev) {
      current = ev;
      var slider = $('pad-slider');
      slider.max = Math.max(ev.ticks.length - 1, 0);
      slider.value = 0;
      var btn = $('nhc-btn');
      btn.href = nhcLink(e);
      btn.replaceChildren(el('span', 'lbl-full', ['National Hurricane Center Graphics Archive']),
        el('span', 'lbl-short', ['NHC Archive']), el('small', 'lbl-event', [e.name]));
      render();
    });
  }

  function init() {
    Promise.all([fetchJSON('data/events.json'), fetchJSON('data/geo_meta.json'), fetchJSON('data/counties_subset.json')])
      .then(function (r) {
        cfg = r[0];
        cfg.geo = r[1];
        cfg.mapKey = 'map';
        GEOJSON = r[2];

        var sel = $('event-select'), tzs = $('tz-select');
        cfg.events.forEach(function (e) { sel.appendChild(new Option(e.name, e.name)); });
        cfg.timezones.forEach(function (t) { tzs.appendChild(new Option(t.label, t.value)); });
        sel.value = cfg.events[0].name;

        return createMap().then(function () {
          sel.addEventListener('change', function () { loadEvent(sel.value); });
          tzs.addEventListener('change', render);
          $('pad-slider').addEventListener('input', render);
          window.addEventListener('hevod-theme', render);
          var rt = null;
          window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(render, 150); });
          return loadEvent(sel.value);
        });
      })
      .catch(function (err) {
        $('slider-caption').textContent = 'Could not load the dashboard data: ' + err.message +
          ' (open the site through a web server, not by double-clicking the file).';
      });
  }

  init();
})();
