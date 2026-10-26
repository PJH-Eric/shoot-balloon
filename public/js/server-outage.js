/* Online outage notice: no requests or timers until an online connection starts. */
(function (w) {
  'use strict';

  var timer = null, active = false, shown = false, mask = null, previousFocus = null;
  var background = [];
  var WAIT_MS = 30000; // User-selected online connection timeout; cancel on recovery or exit.

  function copy(now, language) {
    var next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    var locale = /^en/i.test(language) ? 'en' : /Hans|CN|SG/i.test(language) ? 'zh-Hans' : 'zh-Hant';
    var words = w.ServerOutageMessages[locale].slice();
    var date = locale === 'en'
      ? next.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
      : String(next.getMonth() + 1);
    // Keep all player-facing translations in locales.js.
    words[1] = words[1].replace('{date}', date);
    return words;
  }

  function close() {
    if (!mask) return;
    mask.remove();
    mask = null;
    background.forEach(function (entry) { entry[0].inert = entry[1]; });
    background = [];
    document.removeEventListener('keydown', onKey, true);
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    else if (event.key === 'Tab') { event.preventDefault(); mask.querySelector('button').focus(); }
  }

  function show() {
    if (shown || !active) return;
    shown = true;
    previousFocus = document.activeElement;
    var words = copy(new Date(), document.documentElement.lang || 'zh-Hant');
    mask = document.createElement('div');
    mask.className = 'server-outage-mask';
    var panel = document.createElement('section');
    panel.className = 'server-outage-panel';
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'server-outage-title');
    panel.setAttribute('aria-describedby', 'server-outage-message');
    var title = document.createElement('h2');
    title.id = 'server-outage-title';
    title.textContent = words[0];
    var message = document.createElement('p');
    message.id = 'server-outage-message';
    message.textContent = words[1];
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'server-outage-button';
    button.textContent = words[2];
    button.addEventListener('click', close);
    panel.append(title, message, button);
    mask.appendChild(panel);
    Array.prototype.forEach.call(document.body.children, function (node) {
      background.push([node, node.inert]);
      node.inert = true;
    });
    document.body.appendChild(mask);
    document.addEventListener('keydown', onKey, true);
    button.focus();
  }

  function state(value) {
    if (/^(open|online|connected|ok|idle|unset|unavailable|disabled|nourl)$/.test(value)) {
      clearTimeout(timer);
      timer = null;
      active = false;
      shown = false;
      close();
      return;
    }
    if (!/^(begin|connecting|loading|waking|retrying|reconnecting)$/.test(value)) return;
    if (active) return;
    active = true;
    timer = setTimeout(show, WAIT_MS);
  }

  w.ServerOutage = { state: state, copy: copy };
})(window);
