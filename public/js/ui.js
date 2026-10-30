/* ===== ui.js — 自訂 UI 元件 =====
 *
 * 遊戲裡玩家看得到的控制項全部在這裡封裝，頁面不直接使用瀏覽器預設外觀：
 *   .tk      票券按鈕（<button>，外觀完全自訂：缺口、硬邊陰影、按下位移）
 *   .sw      開關（<button role="switch">）
 *   .sl      滑桿（role="slider"，支援指標拖曳與方向鍵）
 *   .seg     分段選單（role="radiogroup"，方向鍵切換、roving tabindex）
 *   .fld-in  文字欄（<input> 被完整重畫，不顯示瀏覽器預設樣式）
 *   .sa      捲動區（自訂軌道與滑塊，原生捲軸被隱藏，仍保留觸控／滾輪／鍵盤捲動）
 *   modal    彈窗（焦點鎖定、Escape、返回鍵、關閉後把焦點還給原本的元素）
 *   toast    提示
 * 內部使用必要的語意標籤與 ARIA；外觀與互動都在這裡封裝。
 */
(function (w) {
  'use strict';

  var doc = w.document;
  var $ = function (id) { return doc.getElementById(id); };

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ------------------------------------------------------------ 圖示 */
  var ICONS = {
    gear: '<circle cx="12" cy="12" r="3.4"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.5-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.5 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.5 2.3-.9a7.6 7.6 0 0 0 2.6 1.5l.5 2.4h4l.5-2.4a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.5z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    send: '<path d="M3 11l18-8-8 18-2-8z"/>',
    chat: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="3.4"/>',
    repeat: '<path d="M4 11a8 8 0 0 1 14-4l2 2M20 13a8 8 0 0 1-14 4l-2-2M20 4v5h-5M4 20v-5h5"/>',
    home: '<path d="M3 11l9-8 9 8M5 9.5V21h14V9.5M10 21v-6h4v6"/>',
    door: '<path d="M6 3h11v18H6zM13.5 12h.01"/><path d="M3 21h18"/>',
    users: '<circle cx="9" cy="8" r="3.3"/><path d="M3 20c0-3.6 2.6-6 6-6s6 2.4 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M17 14c2.6 0 4.5 1.9 4.5 5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="17" cy="6" r="2.5"/><circle cx="17" cy="18" r="2.5"/><path d="M8.2 10.8l6.6-3.6M8.2 13.2l6.6 3.6"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M9 8h7"/>',
    medal: '<circle cx="12" cy="15" r="5.5"/><path d="M8.5 10.5L6 3h5l1 4M15.5 10.5L18 3h-5l-1 4"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M7 7l10 10M17 7L7 17"/>'
  };

  function icon(name, cls) {
    var p = ICONS[name];
    if (!p) return '';
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + p + '</svg>';
  }

  /** 把 data-icon="name" 的元素補上圖示（只做一次）。 */
  function decorate(root) {
    var list = (root || doc).querySelectorAll('[data-icon]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.dataset.iconDone) continue;
      el.dataset.iconDone = '1';
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    }
  }

  /* ------------------------------------------------------------ 捲動區 */

  var raf = w.requestAnimationFrame ? w.requestAnimationFrame.bind(w) : function (f) { return setTimeout(f, 16); };
  var saList = [];

  function initScrollArea(sa) {
    if (sa._sa) return sa._sa;
    var view = sa.querySelector(':scope > .sa-view');
    if (!view) return null;
    var ty = doc.createElement('div');
    ty.className = 'sa-track sa-y'; ty.setAttribute('aria-hidden', 'true');
    ty.innerHTML = '<div class="sa-thumb"></div>';
    var tx = doc.createElement('div');
    tx.className = 'sa-track sa-x'; tx.setAttribute('aria-hidden', 'true');
    tx.innerHTML = '<div class="sa-thumb"></div>';
    sa.appendChild(ty); sa.appendChild(tx);
    var thy = ty.firstChild, thx = tx.firstChild;
    var scheduled = false;

    function update() {
      scheduled = false;
      var ch = view.clientHeight, sh = view.scrollHeight;
      var cw = view.clientWidth, sw = view.scrollWidth;
      var needY = sh > ch + 1, needX = sw > cw + 1;
      sa.classList.toggle('has-y', needY);
      sa.classList.toggle('has-x', needX);
      if (needY) {
        var th = ty.clientHeight;
        var len = Math.max(32, Math.round(th * ch / sh));
        var top = (th - len) * (view.scrollTop / Math.max(1, sh - ch));
        thy.style.height = len + 'px';
        thy.style.transform = 'translateY(' + Math.round(top) + 'px)';
      }
      if (needX) {
        var tw = tx.clientWidth;
        var len2 = Math.max(32, Math.round(tw * cw / sw));
        var left = (tw - len2) * (view.scrollLeft / Math.max(1, sw - cw));
        thx.style.width = len2 + 'px';
        thx.style.transform = 'translateX(' + Math.round(left) + 'px)';
      }
    }
    function sched() { if (!scheduled) { scheduled = true; raf(update); } }

    view.addEventListener('scroll', sched, { passive: true });
    if (w.ResizeObserver) {
      var ro = new w.ResizeObserver(sched);
      ro.observe(view);
      ro.observe(sa);
    }
    if (w.MutationObserver) {
      new w.MutationObserver(sched).observe(view, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    }

    function drag(thumb, track, axis) {
      thumb.addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation();
        thumb.setPointerCapture(e.pointerId);
        thumb.classList.add('drag');
        var start = axis === 'y' ? e.clientY : e.clientX;
        var from = axis === 'y' ? view.scrollTop : view.scrollLeft;
        var move = function (ev) {
          var d = (axis === 'y' ? ev.clientY : ev.clientX) - start;
          if (axis === 'y') {
            var free = track.clientHeight - thumb.offsetHeight;
            view.scrollTop = from + d * (view.scrollHeight - view.clientHeight) / Math.max(1, free);
          } else {
            var freeX = track.clientWidth - thumb.offsetWidth;
            view.scrollLeft = from + d * (view.scrollWidth - view.clientWidth) / Math.max(1, freeX);
          }
        };
        var up = function () {
          thumb.classList.remove('drag');
          thumb.removeEventListener('pointermove', move);
          thumb.removeEventListener('pointerup', up);
          thumb.removeEventListener('pointercancel', up);
        };
        thumb.addEventListener('pointermove', move);
        thumb.addEventListener('pointerup', up);
        thumb.addEventListener('pointercancel', up);
      });
      /* 點軌道空白處：往那個方向翻一頁 */
      track.addEventListener('pointerdown', function (e) {
        if (e.target !== track) return;
        var r = thumb.getBoundingClientRect();
        if (axis === 'y') view.scrollTop += (e.clientY < r.top ? -1 : 1) * view.clientHeight * 0.9;
        else view.scrollLeft += (e.clientX < r.left ? -1 : 1) * view.clientWidth * 0.9;
      });
    }
    drag(thy, ty, 'y');
    drag(thx, tx, 'x');

    var api = { update: update, view: view };
    sa._sa = api;
    saList.push(sa);
    update();
    return api;
  }

  function scrollAreas(root) {
    var list = (root || doc).querySelectorAll('.sa');
    for (var i = 0; i < list.length; i++) initScrollArea(list[i]);
  }

  function refreshScroll(root) {
    var list = (root || doc).querySelectorAll('.sa');
    for (var i = 0; i < list.length; i++) if (list[i]._sa) list[i]._sa.update();
  }

  /* ------------------------------------------------------------ 開關 */

  function getSwitch(el) { return el.getAttribute('aria-checked') === 'true'; }
  function setSwitch(el, on) { el.setAttribute('aria-checked', on ? 'true' : 'false'); }

  doc.addEventListener('click', function (e) {
    var sw = e.target.closest ? e.target.closest('.sw') : null;
    if (!sw || sw.disabled) return;
    setSwitch(sw, !getSwitch(sw));
    sw.dispatchEvent(new w.CustomEvent('swchange', { bubbles: true, detail: { on: getSwitch(sw) } }));
  });

  /* ------------------------------------------------------------ 滑桿 */

  function slider(el, o) {
    var min = Number(el.getAttribute('aria-valuemin')) || 0;
    var max = Number(el.getAttribute('aria-valuemax')) || 100;
    var step = (o && o.step) || 5;
    var fill = el.querySelector('.sl-fill'), thumb = el.querySelector('.sl-thumb');

    function paint(v) {
      var pct = (v - min) / (max - min) * 100;
      fill.style.width = pct + '%';
      thumb.style.left = pct + '%';
      el.setAttribute('aria-valuenow', String(Math.round(v)));
      el.setAttribute('aria-valuetext', Math.round(v) + '%');
    }
    function set(v, fire) {
      v = Math.max(min, Math.min(max, Math.round(v / step) * step));
      paint(v);
      if (fire && o && o.onInput) o.onInput(v);
      return v;
    }
    function fromPointer(e) {
      var r = el.getBoundingClientRect();
      return min + (e.clientX - r.left) / Math.max(1, r.width) * (max - min);
    }
    var dragging = false;
    el.addEventListener('pointerdown', function (e) {
      dragging = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('drag');
      set(fromPointer(e), true);
    });
    el.addEventListener('pointermove', function (e) { if (dragging) set(fromPointer(e), true); });
    var end = function () {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('drag');
      if (o && o.onChange) o.onChange(Number(el.getAttribute('aria-valuenow')));
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', function (e) {
      var cur = Number(el.getAttribute('aria-valuenow')) || 0;
      var next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + step;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - step;
      else if (e.key === 'PageUp') next = cur + step * 4;
      else if (e.key === 'PageDown') next = cur - step * 4;
      else if (e.key === 'Home') next = min;
      else if (e.key === 'End') next = max;
      if (next === null) return;
      e.preventDefault();
      set(next, true);
      if (o && o.onChange) o.onChange(Number(el.getAttribute('aria-valuenow')));
    });
    paint(Number(el.getAttribute('aria-valuenow')) || 0);
    return { set: function (v) { return set(v, false); } };
  }

  /* ------------------------------------------------------------ 分段選單 */

  /**
   * @param {HTMLElement} el 容器
   * @param {Array<{value:string,label:string,sub?:string,disabled?:boolean,tone?:string}>} items
   * @param {string|null} value 目前選中的值
   * @param {function} onPick 選了之後呼叫 onPick(value)
   * @param {{mode?:'radio'|'action'}} [opt] action 模式沒有「選中」狀態，每顆都是一般按鈕
   */
  function seg(el, items, value, onPick, opt) {
    var action = opt && opt.mode === 'action';
    el.classList.add('seg');
    el.innerHTML = items.map(function (it, i) {
      var on = !action && String(it.value) === String(value);
      return '<button type="button" class="seg-btn' + (on ? ' on' : '') + '"'
        + (action ? '' : ' role="radio" aria-checked="' + on + '"')
        + ' data-v="' + esc(it.value) + '"'
        + ((it.disabled) ? ' disabled' : '')
        + (!action ? ' tabindex="' + ((on || (value === null && i === 0)) ? '0' : '-1') + '"' : '')
        + '><b>' + esc(it.label) + '</b>' + (it.sub ? '<span>' + esc(it.sub) + '</span>' : '') + '</button>';
    }).join('');

    var buttons = [].slice.call(el.querySelectorAll('.seg-btn'));
    function choose(btn, focus) {
      if (btn.disabled) return;
      if (!action) {
        buttons.forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', String(on));
          b.tabIndex = on ? 0 : -1;
        });
        if (focus) btn.focus();
      }
      onPick(btn.dataset.v);
    }
    buttons.forEach(function (b) {
      b.addEventListener('click', function () { choose(b, false); });
      if (action) return;
      b.addEventListener('keydown', function (e) {
        var i = buttons.indexOf(b), n = buttons.length, j = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = n - 1;
        if (j < 0) return;
        e.preventDefault();
        var guard = 0;
        while (buttons[j].disabled && guard++ < n) j = (j + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + n) % n;
        choose(buttons[j], true);
      });
    });
  }

  /* ------------------------------------------------------------ 彈窗 */

  var stack = [];
  var FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]';
  var popGuard = false;

  function focusables(m) {
    return [].slice.call(m.querySelectorAll(FOCUSABLE)).filter(function (x) {
      return x.offsetParent !== null || x === doc.activeElement;
    });
  }

  function openModal(id, o) {
    var m = $(id);
    if (!m || !m.hidden) return;
    m._ret = doc.activeElement;
    m.hidden = false;
    stack.push(m);
    doc.body.classList.add('modal-open');
    scrollAreas(m);
    refreshScroll(m);
    var first = (o && o.focus && m.querySelector(o.focus)) || m.querySelector('[data-autofocus]')
      || m.querySelector('.modal-body .tk, .modal-body .sw, .modal-body .fld-in, .modal-foot .tk') || focusables(m)[0];
    if (first && first.focus) first.focus();
    try { w.history.pushState({ modal: id }, ''); } catch (e) {}
    m.dispatchEvent(new w.CustomEvent('modalopen', { bubbles: true }));
  }

  function closeModal(id, fromPop) {
    var m = $(id);
    if (!m || m.hidden) return;
    m.hidden = true;
    var i = stack.indexOf(m);
    if (i >= 0) stack.splice(i, 1);
    if (!stack.length) doc.body.classList.remove('modal-open');
    var ret = m._ret; m._ret = null;
    if (ret && ret.focus && doc.contains(ret)) { try { ret.focus(); } catch (e) {} }
    if (!fromPop) {
      try {
        if (w.history.state && w.history.state.modal === id) { popGuard = true; w.history.back(); }
      } catch (e) {}
    }
    m.dispatchEvent(new w.CustomEvent('modalclose', { bubbles: true }));
  }

  function topModal() { return stack.length ? stack[stack.length - 1] : null; }

  w.addEventListener('popstate', function () {
    if (popGuard) { popGuard = false; return; }
    var m = topModal();
    if (m) closeModal(m.id, true);
  });

  doc.addEventListener('keydown', function (e) {
    var m = topModal();
    if (!m) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeModal(m.id); return; }
    if (e.key !== 'Tab') return;
    var f = focusables(m);
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (!m.contains(doc.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  }, true);

  doc.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-close-modal]') : null;
    if (t) { var m = t.closest('.modal'); if (m) closeModal(m.id); }
  });

  /* ------------------------------------------------------------ toast */

  var toastTimer = 0;
  function toast(msg, ms) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2800);
  }

  /* ------------------------------------------------------------ 啟動 */

  // Apply the existing ticket component to the result trigger and dialog controls.
  function mountResultShareTickets() {
    var result = $('ov-result');
    if (!result || !doc.body) return;
    function decorateShareControls() {
      var buttons = doc.querySelectorAll('#ov-result .result-share button:not(.tk), .result-share-dialog-layer button:not(.tk)');
      for (var i = 0; i < buttons.length; i++) {
        var button = buttons[i];
        var isClose = button.classList.contains('result-share-dialog-close');
        var paper = button.classList.contains('result-share-image-download') || isClose;
        button.classList.add('tk');
        if (isClose) button.classList.add('tk-icon');
        button.setAttribute('data-tone', paper ? 'paper' : 'gold');
      }
    }
    decorateShareControls();
    new w.MutationObserver(decorateShareControls).observe(doc.body, { childList: true, subtree: true });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mountResultShareTickets, { once: true });
  else mountResultShareTickets();
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mountResultShareTickets, { once: true });
  else mountResultShareTickets();
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mountResultShareTickets, { once: true });
  else mountResultShareTickets();

  function mount(root) {
    decorate(root);
    scrollAreas(root);
  }

  w.UI = {
    esc: esc, icon: icon, ICONS: ICONS, decorate: decorate, mount: mount,
    scrollAreas: scrollAreas, refreshScroll: refreshScroll,
    getSwitch: getSwitch, setSwitch: setSwitch,
    slider: slider, seg: seg,
    openModal: openModal, closeModal: closeModal, topModal: topModal,
    toast: toast
  };
}(window));
