/* ===== i18n.js — 多語系核心（繁體中文 zh-Hant / English en） =====
 * 每個專案各放一份相同的核心；字典放在各專案自己的 locales 檔（I18N.register）。
 *
 * 語言決定順序：URL ?lang= → localStorage('game-island-lang') → zh-Hant（預設繁中）。
 * 大廳與各遊戲部署在同一個 github.io 來源時共用同一個 localStorage key，
 * 另外大廳開啟遊戲時會帶 ?lang=，跨來源也能同步。
 *
 * 用法：
 *   HTML：  <span data-i18n="menu.start">開始</span>
 *           <button data-i18n-attr="title=settings.open;aria-label=settings.open">
 *           <p data-i18n-html="help.body"></p>        （字典值可含受信任的 HTML 標籤）
 *   JS：    I18N.t('room.players', { n: 3 })           字典值可為字串（{n} 取代）或 function(params)
 *           I18N.onChange(function (lang) { rerender(); })
 *           I18N.setLang('en')
 *   切換鈕：I18N.mountToggle({ after: settingsButtonEl })  放在設定鈕旁，樣式由各專案 CSS 的 .lang-toggle 控制
 */
(function (root) {
  'use strict';

  var KEY = 'game-island-lang';
  var SUPPORTED = ['zh-Hant', 'zh-Hans', 'en'];
  var DEFAULT = 'zh-Hant';
  var messagePatterns = null;
  var dicts = { 'zh-Hant': {}, 'zh-Hans': {}, en: {} };
  var listeners = [];
  var lang = DEFAULT;
  var toggles = [];
  var openMenu = null;
  var menuStylesInstalled = false;

  function normalize(v) {
    if (!v) return null;
    v = String(v).toLowerCase().replace(/_/g, '-');
    if (v === 'en' || v.indexOf('en-') === 0 || v.indexOf('en_') === 0) return 'en';
    if (v.indexOf('zh') === 0) return v.indexOf('zh-hans') === 0 || v.indexOf('zh-cn') === 0 || v.indexOf('zh-sg') === 0 ? 'zh-Hans' : 'zh-Hant';
    return null;
  }

  function readStored() {
    try { return normalize(root.localStorage.getItem(KEY)); } catch (e) { return null; }
  }
  function writeStored(v) {
    try { root.localStorage.setItem(KEY, v); } catch (e) { /* 隱私模式等：忽略 */ }
  }
  function readUrl() {
    try { return normalize(new URLSearchParams(root.location.search).get('lang')); } catch (e) { return null; }
  }

  function detect() {
    return readUrl() || readStored() || DEFAULT;
  }

  function lookup(code, key) {
    var d = dicts[code];
    return d && Object.prototype.hasOwnProperty.call(d, key) ? d[key] : undefined;
  }

  function t(key, params, fallback) {
    var v = lookup(lang, key);
    if (v === undefined) v = lookup(DEFAULT, key);
    if (v === undefined) return fallback !== undefined ? fallback : key;
    if (typeof v === 'function') return v(params || {});
    if (params) {
      v = String(v).replace(/\{(\w+)\}/g, function (m, k) {
        return params[k] === undefined || params[k] === null ? m : String(params[k]);
      });
    }
    return v;
  }

  function register(code, dict) {
    messagePatterns = null;
    if (!dicts[code]) dicts[code] = {};
    for (var k in dict) if (Object.prototype.hasOwnProperty.call(dict, k)) dicts[code][k] = dict[k];
    return api;
  }

  function apply(scope) {
    var doc = root.document;
    if (!doc) return;
    scope = scope || doc;
    var i, el, list;
    list = scope.querySelectorAll('[data-i18n]');
    for (i = 0; i < list.length; i++) { el = list[i]; el.textContent = t(el.getAttribute('data-i18n')); }
    list = scope.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < list.length; i++) { el = list[i]; el.innerHTML = t(el.getAttribute('data-i18n-html')); }
    list = scope.querySelectorAll('[data-i18n-attr]');
    for (i = 0; i < list.length; i++) {
      el = list[i];
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var p = pair.split('=');
        if (p.length === 2 && p[0].trim()) el.setAttribute(p[0].trim(), t(p[1].trim()));
      });
    }
    var titleKey = doc.documentElement.getAttribute('data-i18n-title');
    if (titleKey) doc.title = t(titleKey);
    var desc = doc.querySelector('meta[name="description"][data-i18n-content]');
    if (desc) desc.setAttribute('content', t(desc.getAttribute('data-i18n-content')));
  }

  function menuLabel() {
    return lang === 'en' ? 'Language: English' : lang === 'zh-Hans' ? '语言：简体中文' : '語言：繁體中文';
  }

  function installMenuStyles() {
    if (menuStylesInstalled) return;
    menuStylesInstalled = true;
    var style = root.document.createElement('style');
    style.textContent =
      '.language-controls{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;vertical-align:middle;max-width:100%}' +
      '.language-controls:has(>[data-language-settings][hidden]),.language-controls:has(>[data-language-settings].hidden){display:none!important}' +
      '.language-controls[data-floating]{top:calc(10px + env(safe-area-inset-top));right:calc(12px + env(safe-area-inset-right));z-index:2147483000}' +
      '.language-controls[data-floating="fixed"]{position:fixed}' +
      '.language-controls[data-floating="absolute"]{position:absolute}' +
      '.language-controls>.lang-toggle{position:relative!important;inset:auto!important;margin:0!important;box-sizing:border-box;flex:0 0 48px;width:48px!important;min-width:48px!important;height:48px!important;min-height:48px!important;display:inline-grid;place-items:center;padding:0!important}' +
      '.language-controls>[data-language-settings]{position:relative!important;inset:auto!important;margin:0!important;flex-shrink:0}' +
      '.language-badge{position:absolute;right:3px;bottom:2px;font:800 10px/1.15 system-ui,sans-serif;letter-spacing:0;padding:1px 2px;border-radius:3px;pointer-events:none;background:inherit;color:inherit}' +
      '.language-menu{box-sizing:border-box;position:fixed;inset:auto;margin:0;width:188px;max-width:calc(100vw - 16px);padding:6px;gap:4px;z-index:2147483001;display:none;overflow:visible}' +
      '.language-menu[data-open]{display:grid}' +
      '.language-menu .language-option{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:46px;padding:10px 12px;border:2px solid transparent;border-radius:inherit;color:inherit;font-family:inherit;font-weight:700;font-size:15px;line-height:1.3;cursor:pointer;touch-action:manipulation}' +
      '.language-menu .language-option[aria-checked="true"]{background:color-mix(in srgb,currentColor 12%,transparent)}' +
      '.language-menu .language-option:hover,.language-menu .language-option:focus-visible{outline:0;border-color:currentColor;background:color-mix(in srgb,currentColor 16%,transparent)}';
    (root.document.head || root.document.body).appendChild(style);
  }

  function closeMenu(restoreFocus) {
    if (!openMenu) return;
    var button = openMenu;
    openMenu = null;
    var menu = button._languageMenu;
    if (menu.hidePopover && menu.matches(':popover-open')) menu.hidePopover();
    menu.hidden = true;
    menu.removeAttribute('data-open');
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
  }

  function placeMenu(button) {
    var menu = button._languageMenu;
    var rect = button.getBoundingClientRect();
    var bounds = menu.getBoundingClientRect();
    var left = Math.max(8, Math.min(rect.right - bounds.width, root.innerWidth - bounds.width - 8));
    var top = rect.bottom + 8;
    if (top + bounds.height > root.innerHeight - 8) top = Math.max(8, rect.top - bounds.height - 8);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function showMenu(button, focusLast) {
    if (openMenu === button) { closeMenu(true); return; }
    closeMenu(false);
    var menu = button._languageMenu;
    var theme = root.getComputedStyle(button);
    menu.style.backgroundColor = theme.backgroundColor;
    menu.style.backgroundImage = theme.backgroundImage;
    menu.style.color = theme.color;
    menu.style.fontFamily = theme.fontFamily;
    menu.style.border = theme.borderTopWidth + ' ' + theme.borderTopStyle + ' ' + theme.borderTopColor;
    menu.style.borderRadius = Math.min(16, parseFloat(theme.borderTopLeftRadius) || 12) + 'px';
    menu.style.boxShadow = theme.boxShadow;
    menu.hidden = false;
    menu.setAttribute('data-open', '');
    if (menu.showPopover) menu.showPopover();
    openMenu = button;
    button.setAttribute('aria-expanded', 'true');
    placeMenu(button);
    var selected = button._languageOptions.filter(function (item) { return item.getAttribute('aria-checked') === 'true'; })[0];
    (focusLast ? button._languageOptions[button._languageOptions.length - 1] : selected || button._languageOptions[0]).focus();
  }

  function syncToggles() {
    toggles.forEach(function (button) {
      var label = menuLabel();
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.setAttribute('lang', lang);
      button._languageBadge.textContent = lang === 'en' ? 'EN' : lang === 'zh-Hans' ? '简' : '繁';
      button._languageMenu.setAttribute('aria-label', lang === 'en' ? 'Choose language' : lang === 'zh-Hans' ? '选择语言' : '選擇語言');
      button._languageOptions.forEach(function (item) {
        var selected = item.getAttribute('data-language-option') === lang;
        item.setAttribute('aria-checked', String(selected));
        item._languageCheck.textContent = selected ? '✓' : '';
      });
    });
  }

  function setLang(next, opts) {
    next = normalize(next) || DEFAULT;
    var drafts = root.document ? Array.from(root.document.querySelectorAll('input[id], textarea[id]')).filter(function (el) {
      return !el.readOnly && !el.disabled && (el.tagName === 'TEXTAREA' || /^(text|search|url|email|tel|password)$/.test(el.type));
    }).map(function (el) { return { id: el.id, value: el.value, start: el.selectionStart, end: el.selectionEnd }; }) : [];
    var changed = next !== lang;
    lang = next;
    if (!opts || opts.persist !== false) writeStored(lang);
    try {
      var url = new URL(root.location.href);
      if (url.searchParams.has("lang")) { url.searchParams.set("lang", lang); root.history.replaceState(root.history.state, "", url); }
    } catch (e) { /* 非瀏覽器環境不處理網址 */ }
    var doc = root.document;
    if (doc) {
      doc.documentElement.setAttribute('lang', lang);
      doc.documentElement.setAttribute('data-lang', lang);
      apply(doc);
      syncToggles();
    }
    if (changed || (opts && opts.force)) {
      listeners.slice().forEach(function (fn) { try { fn(lang); } catch (e) { if (root.console) root.console.error(e); } });
      if (doc && root.CustomEvent) doc.dispatchEvent(new root.CustomEvent('i18n:change', { detail: { lang: lang } }));
    }
    drafts.forEach(function (draft) {
      var el = root.document.getElementById(draft.id);
      if (!el) return;
      el.value = draft.value;
      if (draft.start !== null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(draft.start, draft.end); } catch (e) { /* 不支援選取的欄位只保留內容 */ }
      }
    });
    return lang;
  }

  function onChange(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }

  /** 語言入口跟隨設定工具列排版，不另以視窗座標定位。 */
  function mountToggle(opts) {
    var doc = root.document;
    opts = opts || {};
    installMenuStyles();
    var button = doc.createElement('button');
    button.type = 'button';
    button.className = 'lang-toggle' + (opts.className ? ' ' + opts.className : '');
    button.id = opts.id || 'b-lang';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"' +
      ' fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"' +
      ' aria-hidden="true" focusable="false" style="display:block;margin:auto;transform:translate(-3px,-3px);pointer-events:none">' +
      '<circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="5" ry="10"/>' +
      '<path d="M12 2v20M2 12h20M4 6c4 3 12 3 16 0M4 18c4-3 12-3 16 0"/></svg>';
    var badge = doc.createElement('span');
    badge.className = 'language-badge';
    badge.setAttribute('aria-hidden', 'true');
    button.appendChild(badge);
    button._languageBadge = badge;

    var menu = doc.createElement('div');
    menu.id = button.id + '-menu';
    menu.className = 'language-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('popover', 'manual');
    button.setAttribute('aria-controls', menu.id);
    button._languageMenu = menu;
    button._languageOptions = SUPPORTED.map(function (code) {
      var item = doc.createElement('button');
      item.type = 'button';
      item.className = 'language-option tk';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('data-language-option', code);
      item.setAttribute('lang', code);
      var text = doc.createElement('span');
      text.textContent = code === 'en' ? 'English' : code === 'zh-Hans' ? '简体中文' : '繁體中文';
      var check = doc.createElement('span');
      check.setAttribute('aria-hidden', 'true');
      item._languageCheck = check;
      item.appendChild(text);
      item.appendChild(check);
      item.addEventListener('click', function () {
        closeMenu(false);
        if (code !== lang) setLang(code);
        button.focus();
      });
      menu.appendChild(item);
      return item;
    });
    doc.body.appendChild(menu);

    var controls = doc.createElement('span');
    controls.className = 'language-controls';
    if (opts.after && opts.after.parentNode) {
      var anchor = opts.after;
      var position = root.getComputedStyle(anchor).position;
      if (position === 'fixed' || position === 'absolute') controls.setAttribute('data-floating', position);
      var anchorId = 'language-settings-' + toggles.length;
      anchor.setAttribute('data-language-settings', anchorId);
      button.setAttribute('data-language-settings-for', anchorId);
      anchor.parentNode.insertBefore(controls, anchor);
      controls.appendChild(button);
      controls.appendChild(anchor);
    } else {
      (opts.parent || doc.body).appendChild(controls);
      controls.appendChild(button);
    }
    button.addEventListener('click', function () { showMenu(button); });
    button.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      event.stopPropagation();
      if (openMenu !== button) showMenu(button, event.key === 'ArrowUp');
    });
    menu.addEventListener('keydown', function (event) {
      var items = button._languageOptions;
      var index = items.indexOf(doc.activeElement);
      var next;
      if (event.key === 'ArrowDown') next = (index + 1) % items.length;
      else if (event.key === 'ArrowUp') next = (index + items.length - 1) % items.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      else if (event.key === 'Escape') { closeMenu(true); event.preventDefault(); }
      else if (event.key === 'Tab') closeMenu(true);
      if (next !== undefined) { event.preventDefault(); items[next].focus(); }
      event.stopPropagation();
    });
    if (!toggles.length) {
      doc.addEventListener('pointerdown', function (event) {
        if (openMenu && !openMenu.contains(event.target) && !openMenu._languageMenu.contains(event.target)) closeMenu(false);
      }, true);
      root.addEventListener('resize', function () { if (openMenu) placeMenu(openMenu); });
      root.addEventListener('scroll', function () {
        if (!openMenu) return;
        var rect = openMenu.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= root.innerHeight) closeMenu(false);
        else placeMenu(openMenu);
      }, true);
    }
    toggles.push(button);
    syncToggles();
    return button;
  }

  /** 給連結加上 ?lang=（跨來源同步語言用）。 */
  function withLang(url) {
    try {
      var u = new URL(url, root.location.href);
      u.searchParams.set('lang', lang);
      return u.toString();
    } catch (e) { return url; }
  }

  lang = detect();
  if (root.document) root.document.documentElement.setAttribute('lang', lang);


  /** Translate protocol message keys and legacy system messages, preserving parameters. */
  function message(value, params) {
    if (value == null) return '';
    if (typeof value === 'object') {
      if (value.key) return message(value.key, value.params);
      return value.message ? message(value.message, value.params) : '';
    }
    if (params) {
      var translated = {};
      Object.keys(params).forEach(function (key) {
        var v = params[key];
        translated[key] = Array.isArray(v) ? v.join(lang === 'en' ? ', ' : '、') : (v && typeof v === 'object' && v.key ? message(v) : v);
      });
      params = translated;
    }
    if (lookup(lang, value) !== undefined || lookup(DEFAULT, value) !== undefined) return t(value, params);
    if (lang === DEFAULT || typeof value !== 'string') return String(value);
    if (!messagePatterns) {
      messagePatterns = Object.keys(dicts[DEFAULT]).filter(function (key) { return typeof dicts[DEFAULT][key] === 'string'; }).map(function (key) {
        var names = [], source = dicts[DEFAULT][key];
        var escaped = source.split(/(\{\w+\})/).map(function (part) {
          if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return '(.+?)'; }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }).join('');
        return { key: key, names: names, size: source.length, re: new RegExp('^' + escaped + '$') };
      }).sort(function (a, b) { return b.size - a.size; });
    }
    for (var i = 0; i < messagePatterns.length; i++) {
      var item = messagePatterns[i], match = item.re.exec(value);
      if (match) { var p = {}; item.names.forEach(function (name, n) { p[name] = match[n + 1]; }); return t(item.key, p); }
    }
    return value;
  }

  var api = {
    SUPPORTED: SUPPORTED,
    get lang() { return lang; },
    t: t, message: message, register: register, apply: apply, setLang: setLang, onChange: onChange,
    mountToggle: mountToggle, withLang: withLang
  };
  root.I18N = api;
  root.t = root.t || t;

  // 字典載入後（所有 script 執行完）套用一次；儲存偏好時不覆寫使用者既有選擇。
  function boot() { setLang(lang, { persist: !!readUrl(), force: false }); }
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : this);
