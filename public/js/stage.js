/* ===== stage.js — 射擊場繪製、命中判定（畫面端）與特效 =====
 *
 * 只負責「把 Rules.snapshot() 畫出來」與「把點擊換成瞄準到哪顆氣球」，不做計分。
 * 氣球位置是 Rules.balloonPos(b, now) 的純函式，所以伺服器 200ms 才推一次也很滑順。
 *
 * 命中判定在畫面端用橢圓做：點擊點落在氣球本體橢圓（加一圈手指容錯）內就算瞄到，
 * 取最靠近中心的那顆；最後仍由規則核心／伺服器決定有沒有真的射中。
 */
(function (w) {
  'use strict';

  var Rules = w.Rules, Art = w.Art;

  var field = null, layer = null, fx = null, xhair = null;
  var onShoot = null, getNow = Date.now;
  var recs = {};                 // balloonId -> {el, key, w, h, cx, cy}
  var reduceMotion = false;
  var bigTag = true;
  var aimEnabled = true;
  var W = 1, H = 1, U = 60;
  var kx = 0.5, ky = 0.6, kbUsed = false;
  var bound = false;
  var lastSnapBalloons = [];

  var TYPE_COLOR = {
    red: '#E8483A', yellow: '#FFC93C', twin: '#2FC4AE', star: '#A98BFF', rainbow: '#59B7FF',
    jumbo: '#2FC4AE', golden: '#FFC93C', dove: '#E5DEF5', lantern: '#FF9A3D', bomb: '#3A3158'
  };

  /* sprite 的 viewBox 是 -6 -10 112 168：本體中心 (50,52) 對應 sprite 內 (0.5, 0.369) */
  var CY = 0.369;
  var ASPECT = 1.5;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------------------------------------------------------- 建立 */

  function measure() {
    if (!field) return;
    var r = field.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    U = clamp(Math.min(W * 0.16, H * 0.19), 50, 118);
    field.style.setProperty('--u', U.toFixed(1) + 'px');
  }

  function mount(o) {
    field = o.field; layer = o.layer; fx = o.fx; xhair = o.xhair;
    onShoot = o.onShoot;
    if (o.now) getNow = o.now;
    measure();
    if (w.ResizeObserver) new w.ResizeObserver(measure).observe(field);
    w.addEventListener('resize', measure);
    bindEvents();
  }

  function bindEvents() {
    if (bound) return;
    bound = true;

    /* pointerdown 而不是 click：射氣球要「按下去就發射」，慢半拍會被搶走 */
    field.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button > 0) return;
      e.preventDefault();
      try { field.focus({ preventScroll: true }); } catch (err) {}
      var r = field.getBoundingClientRect();
      fire(e.clientX - r.left, e.clientY - r.top, e);
    });

    field.addEventListener('keydown', function (e) {
      var step = e.repeat ? 0.05 : 0.03;
      var used = true;
      if (e.key === 'ArrowLeft') kx = clamp(kx - step, 0.02, 0.98);
      else if (e.key === 'ArrowRight') kx = clamp(kx + step, 0.02, 0.98);
      else if (e.key === 'ArrowUp') ky = clamp(ky - step, 0.02, 0.98);
      else if (e.key === 'ArrowDown') ky = clamp(ky + step, 0.02, 0.98);
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        showKb();
        if (!e.repeat) fire(kx * W, ky * H, e);
        return;
      } else used = false;
      if (used) { e.preventDefault(); showKb(); }
    });
    field.addEventListener('blur', function () { if (xhair) xhair.classList.remove('on'); });
  }

  function showKb() {
    kbUsed = true;
    if (!xhair) return;
    xhair.classList.add('on');
    xhair.style.transform = 'translate(' + (kx * W).toFixed(1) + 'px,' + (ky * H).toFixed(1) + 'px)';
  }

  /** 點擊／按鍵 → 找到瞄到的氣球 → 通知 app */
  function fire(px, py, domEvent) {
    var hit = hitTest(px, py, getNow());
    if (onShoot) onShoot(hit ? hit.id : null, { x: px / W, y: py / H, px: px, py: py, type: hit ? hit.type : null }, domEvent);
  }

  /**
   * 命中測試：回傳點擊點瞄到的氣球 {id,type}，沒有就 null。
   * 橢圓半徑 = 本體半徑 + 手指容錯（至少 10px），取離中心最近（正規化距離最小）的一顆。
   */
  function hitTest(px, py, now) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < lastSnapBalloons.length; i++) {
      var b = lastSnapBalloons[i];
      if (now < b.spawnAt || now > b.expireAt) continue;
      var p = Rules.balloonPos(b, now);
      var bw = U * b.size;
      var cx = p.x * W, cy = p.y * H;
      var slack = Math.max(10, bw * 0.18);
      var rx = bw * 0.37 + slack, ry = bw * 0.41 + slack;
      var dx = (px - cx) / rx, dy = (py - cy) / ry;
      var d = dx * dx + dy * dy;
      if (d <= 1 && d < bestD) { bestD = d; best = b; }
    }
    return best ? { id: best.id, type: best.type } : null;
  }

  function setOptions(o) {
    if (o.reduceMotion !== undefined) reduceMotion = !!o.reduceMotion;
    if (o.bigTag !== undefined) { bigTag = !!o.bigTag; if (field) field.classList.toggle('big-tag', bigTag); }
    if (o.aim !== undefined) { aimEnabled = !!o.aim; if (field) field.classList.toggle('no-aim', !aimEnabled); }
    if (o.cursor !== undefined && field) field.classList.toggle('use-cursor', !!o.cursor);
  }

  /* ---------------------------------------------------------- 每幀更新 */

  function tagText(t) {
    return (t.points > 0 ? '+' : '−') + Math.abs(t.points);
  }

  /**
   * 依快照更新舞台。每一幀呼叫一次（rAF）。
   * @param {object} snap Rules.snapshot()
   * @param {number} now  與快照同一個時鐘的現在時間
   */
  function draw(snap, now) {
    if (!layer || !snap) return;
    lastSnapBalloons = snap.balloons;
    var seen = {};
    var i, b, rec;

    for (i = 0; i < snap.balloons.length; i++) {
      b = snap.balloons[i];
      seen[b.id] = true;
      var t = Rules.typeOf(b.type);
      rec = recs[b.id];
      var bw = U * b.size;
      var key = b.hpLeft + ':' + Math.round(bw);
      if (!rec) {
        var el = w.document.createElement('div');
        el.className = 'bln side-' + b.side + ' type-' + b.type;
        el.innerHTML = '<span class="bln-art"></span><span class="bln-tag" aria-hidden="true">' + tagText(t) + '</span>';
        layer.appendChild(el);
        rec = recs[b.id] = { el: el, art: el.firstChild, key: '', hp: -1 };
      }
      if (rec.key !== key) {
        rec.key = key;
        rec.el.style.width = bw.toFixed(1) + 'px';
        rec.el.style.height = (bw * ASPECT).toFixed(1) + 'px';
      }
      if (rec.hp !== b.hpLeft) {
        rec.hp = b.hpLeft;
        rec.art.innerHTML = Art.balloonSvg(b.type, b.hpLeft);
        rec.el.classList.toggle('hurt', b.hpLeft < b.hp);
      }
      var p = Rules.balloonPos(b, now);
      var x = p.x * W - bw / 2;
      var y = p.y * H - bw * ASPECT * CY;
      var rot = reduceMotion ? 0 : Math.cos(b.phase + (now - b.spawnAt) * 2 * Math.PI / b.period) * 5;
      rec.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(' + rot.toFixed(1) + 'deg)';
      /* 快飄出舞台頂端時閃一下，提醒玩家要來不及了 */
      rec.el.classList.toggle('leaving', !reduceMotion && p.y < 0.14 && p.y > -0.05);
    }

    for (var id in recs) {
      if (seen[id]) continue;
      var r = recs[id];
      if (r.el.parentNode) r.el.parentNode.removeChild(r.el);
      delete recs[id];
    }
  }

  /* ---------------------------------------------------------- 特效 */

  function spawnFx(node, ms) {
    fx.appendChild(node);
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, ms);
  }

  function limitFx() {
    /* 特效層不能無限長：超過 40 個就先收掉最舊的 */
    while (fx.childNodes.length > 40) fx.removeChild(fx.firstChild);
  }

  /** 飛鏢從舞台下緣飛向目標點（自己射的才畫，別人的只在命中處畫爆開） */
  function dart(px, py, color) {
    if (!fx || reduceMotion) return;
    var sx = W / 2 + (px - W / 2) * 0.25, sy = H + 10;
    var dx = px - sx, dy = py - sy;
    var ang = Math.atan2(dx, -dy) * 180 / Math.PI;
    var n = w.document.createElement('div');
    n.className = 'dart';
    n.innerHTML = Art.dart();
    n.style.setProperty('--dart', color || '#FFB73D');
    n.style.left = '0'; n.style.top = '0';
    fx.appendChild(n);
    if (n.animate) {
      var a = n.animate([
        { transform: 'translate(' + sx + 'px,' + sy + 'px) rotate(' + ang + 'deg)', opacity: 1 },
        { transform: 'translate(' + px + 'px,' + py + 'px) rotate(' + ang + 'deg)', opacity: 1 }
      ], { duration: 130, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'forwards' });
      a.onfinish = function () { if (n.parentNode) n.parentNode.removeChild(n); };
    } else {
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 130);
    }
  }

  function burst(px, py, color, count) {
    if (reduceMotion) return;
    for (var i = 0; i < count; i++) {
      var s = w.document.createElement('i');
      s.className = 'scrap';
      var a = (Math.PI * 2 * i / count) + Math.random() * 0.5;
      var d = 26 + Math.random() * 34;
      s.style.left = px + 'px'; s.style.top = py + 'px';
      s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px');
      s.style.setProperty('--dy', (Math.sin(a) * d - 8).toFixed(1) + 'px');
      s.style.setProperty('--c', color);
      s.style.setProperty('--r', (Math.random() * 360).toFixed(0) + 'deg');
      spawnFx(s, 560);
    }
  }

  /**
   * 命中／射空的回饋：爆開的碎片 + 浮出分數。
   * @param {object} ev  hit 或 miss 事件
   * @param {{who?:string,color?:string,mine?:boolean}} o
   */
  function effect(ev, o) {
    if (!fx) return;
    o = o || {};
    limitFx();
    var cls = 'flyscore', text = '', px, py;

    if (ev.k === 'hit') {
      px = ev.x * W; py = ev.y * H;
      var color = TYPE_COLOR[ev.type] || '#FFB73D';
      if (ev.type === 'rainbow') color = ['#E8483A', '#FFD84A', '#5BD49A', '#59B7FF', '#A98BFF'][Math.floor(Math.random() * 5)];
      burst(px, py, color, ev.killed ? 9 : 4);
      cls += ev.gain >= 0 ? ' good' : ' bad';
      text = (ev.gain >= 0 ? '+' : '') + ev.gain;
      if (ev.buffed) text += ' ×2';
      else if (ev.multiplier > 1.001) text += ' ×' + ev.multiplier.toFixed(1);
      if (!ev.killed) text = (globalThis.I18N ? globalThis.I18N.t("text.232") : "咚！") + text;
      if (o.mine && ev.side === 'avoid' && !reduceMotion && field) {
        field.classList.remove('shake'); void field.offsetWidth; field.classList.add('shake');
        setTimeout(function () { field.classList.remove('shake'); }, 320);
      }
    } else if (ev.k === 'miss') {
      if (!o.mine) return;
      px = (ev.x !== null && ev.x !== undefined && isFinite(ev.x)) ? ev.x * W : null;
      py = (ev.y !== null && ev.y !== undefined && isFinite(ev.y)) ? ev.y * H : null;
      if (px === null || py === null) return;
      cls += ' miss';
      text = ev.late ? (globalThis.I18N ? globalThis.I18N.t("text.231") : "慢了一步") : (globalThis.I18N ? globalThis.I18N.t("text.230") : "射空");
      var ring = w.document.createElement('i');
      ring.className = 'ring';
      ring.style.left = px + 'px'; ring.style.top = py + 'px';
      spawnFx(ring, 420);
    } else {
      return;
    }

    if (o.who) text = o.who + ' ' + text;
    var n = w.document.createElement('span');
    n.className = cls;
    if (o.color) n.style.setProperty('--who', o.color);
    n.textContent = text;
    n.style.left = clamp(px, 40, W - 40) + 'px';
    n.style.top = clamp(py - 18, 20, H - 20) + 'px';
    spawnFx(n, 950);
  }

  /** 中央大字：倒數、階段提示、連擊里程碑。同時只留一句話。 */
  function shout(text, cls, ms) {
    if (!fx) return;
    var stale = fx.querySelectorAll('.shout');
    for (var i = 0; i < stale.length; i++) stale[i].parentNode.removeChild(stale[i]);
    var n = w.document.createElement('div');
    n.className = 'shout ' + (cls || '');
    n.textContent = text;
    spawnFx(n, ms || 900);
  }

  /** 清掉所有氣球與特效（結算、離開房間、重開一局時用） */
  function clear() {
    for (var id in recs) {
      if (recs[id].el.parentNode) recs[id].el.parentNode.removeChild(recs[id].el);
    }
    recs = {};
    lastSnapBalloons = [];
    if (fx) fx.innerHTML = '';
  }

  w.Stage = {
    mount: mount, draw: draw, clear: clear, effect: effect, shout: shout, dart: dart,
    hitTest: hitTest, setOptions: setOptions, measure: measure,
    size: function () { return { w: W, h: H, u: U }; },
    count: function () { return Object.keys(recs).length; },
    TYPE_COLOR: TYPE_COLOR
  };
}(window));
