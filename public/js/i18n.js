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
  var SUPPORTED = ['zh-Hant', 'en'];
  var DEFAULT = 'zh-Hant';
  var messagePatterns = null;
  var dicts = { 'zh-Hant': {}, en: {} };
  var listeners = [];
  var lang = DEFAULT;
  var toggles = [];
  var toggleFrame = 0;
  var toggleObserver;

  function normalize(v) {
    if (!v) return null;
    v = String(v).toLowerCase();
    if (v === 'en' || v.indexOf('en-') === 0 || v.indexOf('en_') === 0) return 'en';
    if (v.indexOf('zh') === 0) return 'zh-Hant';
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

  /** Anchor controls in a body-level layer so dialogs cannot cover the language switch. */
  function positionToggles() {
    toggleFrame = 0;
    toggles.forEach(function (button) {
      var anchor = button._settingsAnchor;
      if (!anchor) return;
      var rect = anchor.getBoundingClientRect();
      var visible = rect.width > 0 && rect.height > 0 && root.getComputedStyle(anchor).visibility !== 'hidden';
      var left = Math.max(8, rect.left - 56);
      var top = Math.max(8, rect.top + (rect.height - 48) / 2);
      var css = 'position:fixed;z-index:2147483000;right:auto;bottom:auto;margin:0;box-sizing:border-box;width:48px;min-width:48px;height:48px;min-height:48px;left:' + left + 'px;top:' + top + 'px;display:' + (visible ? 'grid' : 'none');
      if (button.style.cssText !== css && button._positionStyle !== css) { button.style.cssText = css; button._positionStyle = css; }
    });
  }

  function scheduleTogglePosition() {
    if (!toggleFrame) toggleFrame = root.requestAnimationFrame(positionToggles);
  }

  function syncToggles() {
    toggles.forEach(function (b) {
      b.textContent = lang === 'en' ? '中' : 'EN';
      b.setAttribute('lang', lang === 'en' ? 'zh-Hant' : 'en');
      var label = t('lang.switchTo');
      b.setAttribute('aria-label', label);
      b.setAttribute('title', label);
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

  /** 在設定鈕旁插入語言切換鈕。after：設定鈕元素。回傳切換鈕。 */
  function mountToggle(opts) {
    var doc = root.document;
    opts = opts || {};
    var b = doc.createElement('button');
    b.type = 'button';
    b.style.zIndex = '2147483000';
    b.className = 'lang-toggle' + (opts.className ? ' ' + opts.className : '');
    b.id = opts.id || 'b-lang';
    b.addEventListener('click', function () { setLang(lang === 'en' ? 'zh-Hant' : 'en'); });
    if (opts.after && opts.after.parentNode) opts.after.parentNode.insertBefore(b, opts.after.nextSibling);
    else if (opts.parent) opts.parent.appendChild(b);
    if (opts.after) {
      b._settingsAnchor = opts.after;
      var anchorId = 'language-settings-' + toggles.length;
      opts.after.setAttribute('data-language-settings', anchorId);
      b.setAttribute('data-language-settings-for', anchorId);
      var positioning = root.getComputedStyle(b).position;
      if (positioning !== 'fixed' && positioning !== 'absolute') {
        var slot = doc.createElement('span');
        slot.className = 'language-toggle-slot';
        slot.setAttribute('aria-hidden', 'true');
        slot.style.cssText = 'width:48px;min-width:48px;height:48px;flex:0 0 48px;pointer-events:none';
        opts.after.parentNode.insertBefore(slot, opts.after);
      }
      doc.body.appendChild(b);
      if (!toggleObserver) {
        toggleObserver = new root.MutationObserver(scheduleTogglePosition);
        toggleObserver.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
        root.addEventListener('resize', scheduleTogglePosition);
        root.addEventListener('scroll', scheduleTogglePosition, true);
      }
    }
    toggles.push(b);
    positionToggles();
    syncToggles();
    return b;
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
