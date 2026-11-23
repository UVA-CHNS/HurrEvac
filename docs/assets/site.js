/* Shared page shell (header, navigation, footer), light/dark theme, citation copy button and FAQ toggles. */
(function () {
  'use strict';

  var SITE_TITLE = 'HEvOD: Hurricane Evacuation Order Database';
  var QUALTRICS_URL = 'https://virginiahsd.co1.qualtrics.com/jfe/form/SV_a9odTuEwE17Ejci';
  var NAV = [
    { id: 'home', label: 'Home', href: 'index.html' },
    { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', blank: true },
    { id: 'downloads', label: 'Download', href: 'downloads.html' },
    { id: 'contribute', label: 'Contribute', href: QUALTRICS_URL, blank: true },
    { id: 'faqs', label: 'FAQs', href: 'faqs.html' }
  ];

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { n.setAttribute(k, props[k]); });
    (kids || []).forEach(function (c) { n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  var page = document.body.getAttribute('data-page') || 'home';
  var shell = document.getElementById('app-shell');
  shell.className = 'app-shell page-' + page;

  var toggle = el('button', {
    id: 'theme-toggle', type: 'button', 'class': 'hv-theme-btn', title: 'Switch light / dark theme',
    'aria-label': 'Switch between light and dark theme'
  }, [el('span', { 'class': 'ic-sun' }, ['☀']), el('span', { 'class': 'ic-moon' }, ['☾'])]);

  var header = el('header', { 'class': 'hv-header' }, [el('a', { 'class': 'hv-title', href: 'index.html' }, [SITE_TITLE]), toggle]);

  var nav = el('nav', { id: 'hv-nav', 'class': 'hv-nav' }, NAV.map(function (n) {
    var a = el('a', { href: n.href, 'class': 'nav-link hv-navlink' + (n.id === page ? ' active' : '') }, [n.label]);
    if (n.blank) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
    return a;
  }));

  var footer = el('footer', { 'class': 'hv-footer' }, [
    el('p', { 'class': 'hv-footer-text' }, ['HEvOD is supported by the University of Virginia’s Environmental Institute.']),
    el('a', { href: 'https://environment.virginia.edu/', target: '_blank', rel: 'noopener' }, [
      el('img', { src: 'assets/EI_whiteorange.png', alt: 'UVA Environmental Institute', 'class': 'hv-footer-logo' })
    ])
  ]);

  shell.insertBefore(nav, shell.firstChild);
  shell.insertBefore(header, shell.firstChild);
  shell.appendChild(footer);

  toggle.addEventListener('click', function () {
    var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('hevod-theme', t); } catch (e) { /* private mode */ }
    document.documentElement.setAttribute('data-theme', t);
    window.dispatchEvent(new CustomEvent('hevod-theme', { detail: t }));
  });

  var copyBtn = document.getElementById('copy-citation');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var msg = document.getElementById('copy-citation-msg');
      var text = document.getElementById('citation-text').textContent;
      var done = function (ok) { msg.textContent = ok ? 'Copied!' : 'Press Ctrl+C to copy'; };
      var fallback = function () {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        done(ok);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
      } else { fallback(); }
    });
  }

  document.querySelectorAll('.hv-faq-q').forEach(function (b) {
    b.addEventListener('click', function () {
      var a = b.nextElementSibling;
      a.hidden = !a.hidden;
      b.setAttribute('aria-expanded', a.hidden ? 'false' : 'true');
    });
  });
})();
