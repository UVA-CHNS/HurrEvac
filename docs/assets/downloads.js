/* Download page: full workbook, or a partial download built from the per-hurricane workbooks in data/workbooks/. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var cfg = null, events = [];

  function show(id, on) { $(id).style.display = on ? 'block' : 'none'; }
  function alertBox(msg, color) {
    var d = document.createElement('div');
    d.className = 'alert alert-' + color;
    d.textContent = msg;
    $('dl-status').replaceChildren(d);
  }
  function save(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  function getBlob(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) { throw new Error(url + ' (' + r.status + ')'); }
      return r.blob();
    });
  }
  function checked() {
    return Array.prototype.filter.call(document.querySelectorAll('#dl-events input'), function (c) { return c.checked; })
      .map(function (c) { return events.filter(function (e) { return e.name === c.value; })[0]; });
  }
  function xlsxOf(e) { return 'data/workbooks/' + e.file.replace('.json', '.xlsx'); }

  function download() {
    var mode = $('dl-mode').value;
    $('dl-status').replaceChildren();
    if (mode === 'full') {
      getBlob('data/' + cfg.workbook).then(function (b) { save(b, cfg.workbook); },
        function () { alertBox('The data file is not available right now.', 'danger'); });
      return;
    }
    var sel = checked();
    if (!sel.length) { alertBox('Select at least one event first.', 'warning'); return; }
    var name = ($('dl-file-name').value || '').trim().replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'selected_hurricanes';
    if (sel.length === 1) {
      getBlob(xlsxOf(sel[0])).then(function (b) { save(b, name + '.xlsx'); },
        function (err) { alertBox('Could not build the file: ' + err.message, 'danger'); });
      return;
    }
    var zip = new window.JSZip();
    Promise.all(sel.map(function (e) {
      return getBlob(xlsxOf(e)).then(function (b) { zip.file(e.file.replace('.json', '.xlsx'), b); });
    })).then(function () { return zip.generateAsync({ type: 'blob' }); })
      .then(function (b) { save(b, name + '.zip'); },
        function (err) { alertBox('Could not build the file: ' + err.message, 'danger'); });
  }

  fetch('data/events.json').then(function (r) { return r.json(); }).then(function (c) {
    cfg = c;
    events = c.events.slice().sort(function (a, b) { return a.year - b.year || (a.name < b.name ? -1 : 1); });
    $('dl-full-name').textContent = c.workbook;
    $('dl-full-count').textContent = events.length;
    var list = $('dl-events');
    events.forEach(function (e, i) {
      var d = document.createElement('div');
      d.className = 'form-check';
      d.innerHTML = '<input class="form-check-input" type="checkbox" id="dl-ev-' + i + '" checked><label class="form-check-label" for="dl-ev-' + i + '"></label>';
      d.querySelector('input').value = e.name;
      d.querySelector('label').textContent = e.name;
      list.appendChild(d);
    });
  });

  $('dl-mode').addEventListener('change', function () {
    var m = $('dl-mode').value;
    show('dl-full-block', m === 'full');
    show('dl-partial-block', m === 'partial');
    show('dl-action', m === 'full' || m === 'partial');
    $('dl-status').replaceChildren();
  });
  $('dl-all').addEventListener('click', function () {
    document.querySelectorAll('#dl-events input').forEach(function (c) { c.checked = true; });
  });
  $('dl-none').addEventListener('click', function () {
    document.querySelectorAll('#dl-events input').forEach(function (c) { c.checked = false; });
  });
  $('dl-btn').addEventListener('click', download);
})();
