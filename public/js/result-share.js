/* Shared settlement control. No network, storage, or game-state side effects. */
(function (w) {
  'use strict';
  if (w.GameResultShare) return;

  var d = w.document;
  var selector = '[data-result-share]';
  var words = w.GameResultShareLocales;

  function messages() {
    var lang = (d.documentElement.lang || 'zh-TW').toLowerCase();
    return lang.indexOf('en') === 0 ? words.en : /hans|cn/.test(lang) ? words['zh-Hans'] : words['zh-TW'];
  }

  function content(root) {
    var lines = [];
    var walker = d.createTreeWalker(root, w.NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var parent = node.parentElement;
      if (!parent || parent.closest('.result-share, button, a, script, style, svg, [hidden], [aria-hidden="true"]')) continue;
      var style = w.getComputedStyle(parent);
      if (!parent.getClientRects().length || style.visibility === 'hidden' || style.display === 'none') continue;
      var text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    }
    return lines.join('\n').slice(0, 4000);
  }

  function payload(root) {
    // Keep the actual deployment path, including a monorepo prefix. Drop invitations and credentials.
    var url = new URL(w.location.href);
    url.search = '';
    url.hash = '';
    var title = d.title;
    return { title: title, text: title + '\n' + content(root), url: url.href };
  }

  function element(tag, cls, text) {
    var el = d.createElement(tag);
    el.className = cls;
    if (text) el.textContent = text;
    return el;
  }

  function mount(root) {
    if (root.querySelector('.result-share')) return;
    var ui = element('div', 'result-share');
    var actions = element('div', 'result-share-actions');
    var share = element('button', 'result-share-button');
    var preview = element('button', 'result-share-preview');
    share.type = preview.type = 'button';
    var status = element('p', 'result-share-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var panel = element('div', 'result-share-panel');
    panel.hidden = true;
    var text = element('p', 'result-share-text');
    text.tabIndex = 0;
    var copy = element('button', 'result-share-button');
    copy.type = 'button';
    panel.append(text, copy);
    actions.append(share, preview);
    ui.append(actions, status, panel);
    root.appendChild(ui);
    var busy = false;
    var statusKey = '';
    var revision = 0;

    function currentText() {
      var data = payload(root);
      return data.text + '\n' + data.url;
    }

    function paint() {
      var m = messages();
      share.textContent = busy ? m.busy : m.share;
      preview.textContent = m.preview;
      preview.setAttribute('aria-expanded', String(!panel.hidden));
      copy.textContent = m.copy;
      text.setAttribute('aria-label', m.label);
      status.textContent = statusKey ? m[statusKey] : '';
      share.disabled = copy.disabled = busy;
      if (!panel.hidden) {
        var value = currentText();
        if (text.textContent !== value) text.textContent = value;
      }
    }

    function report(key, operation) {
      if (!ui.isConnected || operation !== revision) return;
      statusKey = key;
      paint();
    }

    async function copyText(value, operation) {
      try {
        if (!w.navigator.clipboard || !w.navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
        await w.navigator.clipboard.writeText(value);
        report('copied', operation);
      } catch (_) {
        if (!ui.isConnected || operation !== revision) return;
        panel.hidden = false;
        report('manual', operation);
        text.focus({ preventScroll: true });
        var range = d.createRange();
        range.selectNodeContents(text);
        var selection = w.getSelection();
        if (selection) { selection.removeAllRanges(); selection.addRange(range); }
      }
    }

    share.addEventListener('click', async function (event) {
      event.stopPropagation();
      if (busy) return;
      var data = payload(root);
      var operation = ++revision;
      busy = true;
      statusKey = '';
      paint();
      try {
        if (typeof w.navigator.share === 'function') {
          try {
            // Call within the user's click activation; do not await preparatory work.
            await w.navigator.share(data);
            report('shared', operation);
          } catch (error) {
            if (error && error.name === 'AbortError') report('cancelled', operation);
            else if (operation === revision) await copyText(data.text + '\n' + data.url, operation);
          }
        } else await copyText(data.text + '\n' + data.url, operation);
      } finally {
        if (operation === revision) {
          busy = false;
          if (ui.isConnected) paint();
        }
      }
    });
    preview.addEventListener('click', function (event) {
      event.stopPropagation();
      panel.hidden = !panel.hidden;
      paint();
    });
    copy.addEventListener('click', async function (event) {
      event.stopPropagation();
      if (busy) return;
      var operation = ++revision;
      busy = true;
      paint();
      await copyText(currentText(), operation);
      if (operation === revision) {
        busy = false;
        if (ui.isConnected) paint();
      }
    });
    // Language changes are global; retain no listeners for removed settlements.
    ui._resultSharePaint = paint;
    ui._resultShareReset = function () {
      revision++;
      busy = false;
      statusKey = '';
      panel.hidden = true;
      paint();
    };
    paint();
  }

  function scan(node) {
    if (!node || node.nodeType !== 1 || node.closest('.result-share')) return;
    var owner = node.closest(selector);
    if (owner) mount(owner);
    node.querySelectorAll(selector).forEach(mount);
  }

  function start() {
    if (!d.getElementById('result-share-style')) {
      var style = element('style', '');
      style.id = 'result-share-style';
      style.textContent = '.result-share{box-sizing:border-box;flex:0 0 100%;width:100%;min-width:0;margin:12px 0 4px;font:inherit;color:inherit;text-align:center}.result-share *{box-sizing:border-box}.result-share-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}.result-share button{appearance:none;position:static;display:inline-flex;align-items:center;justify-content:center;min-height:48px;max-width:100%;padding:10px 16px;border:2px solid currentColor;border-radius:12px;background:var(--paper,#fffaf0);color:var(--ink,#28354b);font:inherit;font-weight:700;line-height:1.4;white-space:normal;overflow-wrap:anywhere;cursor:pointer;touch-action:manipulation;box-shadow:0 3px 0 #0002}.result-share button:hover{filter:brightness(.96)}.result-share button:active{transform:translateY(1px)}.result-share button:focus-visible,.result-share-text:focus-visible{outline:3px solid #2575cf;outline-offset:3px}.result-share button:disabled{opacity:.6;cursor:wait}.result-share-status{font-size:.9em;margin:6px 0;white-space:normal;overflow-wrap:anywhere}.result-share-status:empty{display:none}.result-share-panel{margin-top:10px;padding:12px;border:1px solid currentColor;border-radius:10px;min-width:0}.result-share-panel[hidden]{display:none!important}.result-share-text{white-space:pre-wrap;overflow-wrap:anywhere;text-align:start;user-select:text;-webkit-user-select:text;font:inherit;line-height:1.5;margin:0 0 10px}.result-share-preview{font-size:.9em!important}';
      d.head.appendChild(style);
    }
    scan(d.body);
    new w.MutationObserver(function (changes) {
      changes.forEach(function (change) {
        if (change.target.nodeType === 1 && change.target.closest('.result-share')) return;
        var owner = change.target.nodeType === 1 && change.target.closest(selector);
        if (owner) {
          var existing = owner.querySelector('.result-share');
          if (existing) existing._resultShareReset();
          else mount(owner);
        }
        change.addedNodes.forEach(scan);
      });
    }).observe(d.body, { childList: true, subtree: true });
    new w.MutationObserver(function () {
      d.querySelectorAll('.result-share').forEach(function (ui) { ui._resultSharePaint(); });
    }).observe(d.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }

  w.GameResultShare = { payload: payload, mount: mount };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);
