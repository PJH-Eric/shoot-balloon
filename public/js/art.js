/* ===== art.js — 氣球與場景的 SVG 美術 =====
 *
 * 視覺方向：夜市射氣球攤。紙剪貼般的平塗色塊、一圈深墨色輪廓、
 * 一條奶油色高光，沒有漸層與立體光影。
 *
 * 要射與不能射的差別「不能只靠顏色」：
 *   要射：單純的氣球造型，旁邊的標籤是青綠底「＋分數」
 *   不能射：造型本身就不一樣（綁著白鴿、天燈、炸彈），
 *           身上有紅色圓圈斜線禁止標記，標籤是紅底「－分數」
 *
 * 氣球 sprite 一律畫在 100 x 150 的 viewBox 裡：
 * 氣球本體中心約在 (50, 50)，繩子往下垂到 y=148。
 */
(function (w) {
  'use strict';

  var INK = '#1A1233';
  var CREAM = '#FFF1D6';
  var SW = 4;

  /* 氣球本體（蛋形）與綁結、繩子 */
  var BODY = 'M50 6C77 6 91 28 91 50C91 76 69 96 50 98C31 96 9 76 9 50C9 28 23 6 50 6Z';

  function shape(fill, extra) {
    return '<path d="' + BODY + '" fill="' + fill + '" stroke="' + INK + '" stroke-width="' + SW + '" stroke-linejoin="round"' + (extra || '') + '/>';
  }
  function knot(fill) {
    return '<path d="M50 98l-7 9h14z" fill="' + fill + '" stroke="' + INK + '" stroke-width="3.4" stroke-linejoin="round"/>';
  }
  function string(color) {
    return '<path d="M50 107c-5 8 5 14 0 21s5 14 0 20" fill="none" stroke="' + (color || CREAM) + '" stroke-width="3" stroke-linecap="round" opacity=".9"/>';
  }
  function shine(x, y) {
    return '<path d="M' + (x || 28) + ' ' + (y || 36) + 'c3-9 10-14 17-15" fill="none" stroke="' + CREAM + '" stroke-width="6" stroke-linecap="round" opacity=".8"/>';
  }
  /* 禁止標記：紅圈斜線（不能射的氣球專用） */
  function noMark(cx, cy) {
    return '<g transform="translate(' + cx + ' ' + cy + ')">'
      + '<circle r="13" fill="' + CREAM + '" stroke="' + INK + '" stroke-width="3.4"/>'
      + '<circle r="8.5" fill="none" stroke="#E8483A" stroke-width="4"/>'
      + '<path d="M-6 6L6 -6" stroke="#E8483A" stroke-width="4" stroke-linecap="round"/></g>';
  }
  function spark(x, y, r) {
    return '<path d="M' + x + ' ' + (y - r) + 'q1.5 ' + (r * 0.8) + ' ' + r + ' ' + r + 'q-' + (r * 0.8) + ' 1.5 -' + r + ' ' + r
      + 'q-1.5 -' + (r * 0.8) + ' -' + r + ' -' + r + 'q' + (r * 0.8) + ' -1.5 ' + r + ' -' + r + 'z" fill="' + CREAM + '" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/>';
  }

  var rbN = 0;

  var ART = {
    /* 紅氣球：最基本款，記住牠就記住了「要射的」 */
    red: function () {
      return string() + shape('#E8483A') + knot('#E8483A') + shine();
    },

    /* 小黃氣球：小、有速度線 */
    yellow: function () {
      return '<path d="M2 40h14M0 58h10M98 40H84M100 58H90" stroke="#FFB73D" stroke-width="4" stroke-linecap="round" opacity=".85"/>'
        + string() + shape('#FFC93C') + knot('#FFC93C') + shine();
    },

    /* 雙層氣球：外面有一層奶油色薄膜，射一下薄膜破掉，剩下裡面的青綠氣球 */
    twin: function (hpLeft) {
      var inner = string() + shape('#2FC4AE') + knot('#2FC4AE') + shine(30, 38);
      if (hpLeft !== undefined && hpLeft < 2) {
        /* 外層已破：留下幾片碎膜 */
        return inner
          + '<path d="M9 50C9 38 14 26 24 17l6 12-9 8z" fill="' + CREAM + '" opacity=".8" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/>'
          + '<path d="M91 50c0 12-5 24-14 33l-7-11 9-9z" fill="' + CREAM + '" opacity=".8" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/>';
      }
      return string() + '<path d="M50 0C84 0 98 26 98 52C98 82 72 104 50 106C28 104 2 82 2 52C2 26 16 0 50 0Z" fill="' + CREAM + '" fill-opacity=".55" stroke="' + INK + '" stroke-width="' + SW + '" stroke-dasharray="1 0" stroke-linejoin="round"/>'
        + '<g transform="translate(50 52) scale(.8) translate(-50 -52)">' + shape('#2FC4AE') + shine(30, 38) + '</g>'
        + knot('#2FC4AE');
    },

    /* 星星氣球：星形鋁箔，左右亂晃 */
    star: function () {
      return string('#A98BFF')
        + '<path d="M50 4l13 29 31 3-23 21 7 31-28-16-28 16 7-31L6 36l31-3z" transform="translate(0 4)" fill="#A98BFF" stroke="' + INK + '" stroke-width="' + SW + '" stroke-linejoin="round"/>'
        + '<path d="M50 24l5 12 13 1-10 9 3 13-11-7" fill="none" stroke="' + CREAM + '" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>'
        + '<path d="M50 100l-7 9h14z" fill="#A98BFF" stroke="' + INK + '" stroke-width="3.4" stroke-linejoin="round"/>'
        + '<path d="M50 109c-5 8 5 14 0 21s5 14 0 18" fill="none" stroke="' + CREAM + '" stroke-width="3" stroke-linecap="round"/>';
    },

    /* 彩虹氣球：六道色帶 */
    rainbow: function () {
      var cid = 'rbclip' + (++rbN);
      var cols = ['#E8483A', '#FF9A3D', '#FFD84A', '#5BD49A', '#59B7FF', '#A98BFF'];
      var bands = '';
      for (var i = 0; i < cols.length; i++) bands += '<rect x="0" y="' + (6 + i * 15.5) + '" width="100" height="16" fill="' + cols[i] + '"/>';
      return string()
        + '<defs><clipPath id="' + cid + '"><path d="' + BODY + '"/></clipPath></defs>'
        + '<g clip-path="url(#' + cid + ')">' + bands + '</g>'
        + '<path d="' + BODY + '" fill="none" stroke="' + INK + '" stroke-width="' + SW + '" stroke-linejoin="round"/>'
        + knot('#A98BFF') + shine();
    },

    /* 巨無霸：青綠底白圓點，射到會一層層出現裂痕 */
    jumbo: function (hpLeft) {
      var dots = '<circle cx="30" cy="40" r="6" fill="' + CREAM + '" opacity=".8"/><circle cx="66" cy="32" r="5" fill="' + CREAM + '" opacity=".8"/>'
        + '<circle cx="52" cy="62" r="7" fill="' + CREAM + '" opacity=".8"/><circle cx="76" cy="62" r="4.5" fill="' + CREAM + '" opacity=".8"/>'
        + '<circle cx="28" cy="70" r="4.5" fill="' + CREAM + '" opacity=".8"/>';
      var crack = '';
      if (hpLeft !== undefined && hpLeft <= 2) crack += '<path d="M62 8l-8 14 10 8-9 14" fill="none" stroke="' + INK + '" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>';
      if (hpLeft !== undefined && hpLeft <= 1) crack += '<path d="M24 24l12 10-8 10 12 8M70 60l12 8" fill="none" stroke="' + INK + '" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>';
      return string() + shape('#2FC4AE') + dots + knot('#2FC4AE') + shine(26, 30) + crack;
    },

    /* 金色氣球：閃亮亮 */
    golden: function () {
      return spark(8, 30, 9) + spark(93, 22, 7) + spark(95, 66, 6)
        + string('#FFD76A') + shape('#FFC93C') + knot('#FFC93C') + shine(26, 36)
        + '<path d="M50 28l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z" fill="#FFF1D6" stroke="' + INK + '" stroke-width="2.6" stroke-linejoin="round"/>';
    },

    /* ---------- 不能射的 ---------- */

    /* 白鴿氣球：淡紫白氣球，上面停著一隻白鴿 */
    dove: function () {
      return string() + shape('#E5DEF5') + knot('#E5DEF5') + noMark(50, 62)
        + '<g transform="translate(34 -6)">'
        + '<ellipse cx="22" cy="20" rx="17" ry="11" fill="#FFFFFF" stroke="' + INK + '" stroke-width="3.4"/>'
        + '<circle cx="36" cy="12" r="7.5" fill="#FFFFFF" stroke="' + INK + '" stroke-width="3.4"/>'
        + '<path d="M42 12l8 2-8 3z" fill="#FFB73D" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/>'
        + '<circle cx="37" cy="10.5" r="1.8" fill="' + INK + '"/>'
        + '<path d="M10 18c4-8 12-10 18-6" fill="none" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>'
        + '<path d="M6 24l-8 4 10 2z" fill="#FFFFFF" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round"/></g>';
    },

    /* 祈福天燈：方形紙燈，底部有火光，沒有繩子 */
    lantern: function () {
      return '<path d="M26 18h48l6 10v54H20V28z" fill="#FF9A3D" stroke="' + INK + '" stroke-width="' + SW + '" stroke-linejoin="round"/>'
        + '<path d="M38 18v64M50 18v64M62 18v64" stroke="' + INK + '" stroke-width="2.6" opacity=".55"/>'
        + '<path d="M20 28h60" stroke="' + INK + '" stroke-width="3.4"/>'
        + '<path d="M30 18c2-8 8-12 20-12s18 4 20 12z" fill="#E8483A" stroke="' + INK + '" stroke-width="' + SW + '" stroke-linejoin="round"/>'
        + '<path d="M50 82c-7 0-9-6-5-12 2 3 3 3 5 1 3 2 4 6 0 11z" fill="#FFD84A" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/>'
        + '<path d="M26 82h48l-4 8H30z" fill="#E8483A" stroke="' + INK + '" stroke-width="3.4" stroke-linejoin="round"/>'
        + '<path d="M40 90v14M50 90v18M60 90v14" stroke="#E8483A" stroke-width="3.4" stroke-linecap="round"/>'
        + '<path d="M26 40c3-5 9-8 14-8" fill="none" stroke="' + CREAM + '" stroke-width="5" stroke-linecap="round" opacity=".8"/>'
        + noMark(50, 52);
    },

    /* 炸彈氣球：黑色氣球，綁結變成點著的引線 */
    bomb: function () {
      return '<path d="M50 107c-5 8 5 14 0 21s5 14 0 20" fill="none" stroke="' + CREAM + '" stroke-width="3" stroke-linecap="round" opacity=".9"/>'
        + shape('#3A3158') + knot('#3A3158')
        + '<path d="M50 6c0-6 8-8 12-4" fill="none" stroke="#C9A879" stroke-width="4" stroke-linecap="round"/>'
        + '<circle cx="64" cy="1" r="5.5" fill="#FFD84A" stroke="' + INK + '" stroke-width="2.4"/><circle cx="64" cy="1" r="2.4" fill="#E8483A"/>'
        + shine(26, 38) + noMark(50, 60);
    }
  };

  /** 氣球 sprite 內容（不含 <svg> 外層） */
  function balloonArt(key, hpLeft) {
    var fn = ART[key] || ART.red;
    return fn(hpLeft);
  }

  /** 完整 <svg>，圖鑑、結算等直接用 */
  function balloonSvg(key, hpLeft, cls) {
    return '<svg class="' + (cls || 'bln-svg') + '" viewBox="-6 -10 112 168" aria-hidden="true" focusable="false">'
      + balloonArt(key, hpLeft) + '</svg>';
  }

  /* ---- 飛鏢（發射特效） ---- */
  function dart() {
    return '<svg class="dart-svg" viewBox="0 0 24 64" aria-hidden="true" focusable="false">'
      + '<path d="M12 2l5 14H7z" fill="#E8EEF7" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>'
      + '<rect x="9.5" y="16" width="5" height="30" rx="2" fill="#FFB73D" stroke="' + INK + '" stroke-width="2"/>'
      + '<path d="M12 40L2 56l10-5 10 5z" fill="#E8483A" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/></svg>';
  }

  /* ---- 準星游標（CSS cursor 用） ---- */
  function crosshairCursor() {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">'
      + '<circle cx="24" cy="24" r="14" fill="none" stroke="#1A1233" stroke-width="7"/>'
      + '<path d="M24 2v12M24 34v12M2 24h12M34 24h12" stroke="#1A1233" stroke-width="7" stroke-linecap="round"/>'
      + '<circle cx="24" cy="24" r="14" fill="none" stroke="#FFB73D" stroke-width="3.4"/>'
      + '<path d="M24 2v12M24 34v12M2 24h12M34 24h12" stroke="#FFB73D" stroke-width="3.4" stroke-linecap="round"/>'
      + '<circle cx="24" cy="24" r="2.4" fill="#E8483A"/></svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") 24 24, crosshair';
  }

  /* ---- 首頁招牌插圖：三顆氣球 + 飛鏢 ---- */
  function homeArt() {
    return '<svg viewBox="0 0 320 120" class="home-art-svg" aria-hidden="true" focusable="false">'
      + '<g transform="translate(34 4) scale(.62)">' + ART.red() + '</g>'
      + '<g transform="translate(112 -6) scale(.72)">' + ART.golden() + '</g>'
      + '<g transform="translate(196 6) scale(.62)">' + ART.star() + '</g>'
      + '<g transform="translate(262 4) scale(.56)">' + ART.rainbow() + '</g>'
      + '</svg>';
  }

  function trophy() {
    return '<svg viewBox="0 0 100 100" class="trophy-svg" aria-hidden="true" focusable="false">'
      + '<path d="M26 14h48v24a24 24 0 0 1-48 0z" fill="#FFB73D" stroke="' + INK + '" stroke-width="4" stroke-linejoin="round"/>'
      + '<path d="M26 22H12a14 14 0 0 0 14 14M74 22h14a14 14 0 0 1-14 14" fill="none" stroke="' + INK + '" stroke-width="4"/>'
      + '<rect x="42" y="60" width="16" height="14" fill="#E8A21C" stroke="' + INK + '" stroke-width="4"/>'
      + '<rect x="28" y="74" width="44" height="12" rx="2" fill="#FFB73D" stroke="' + INK + '" stroke-width="4"/>'
      + '<path d="M36 22c3-4 8-6 12-6" fill="none" stroke="#FFF1D6" stroke-width="5" stroke-linecap="round"/></svg>';
  }

  /* ---- 攤位頂上的燈泡串（首頁招牌／背景用） ---- */
  function bulbString(n) {
    var html = '';
    for (var i = 0; i < n; i++) html += '<i style="--i:' + i + '"></i>';
    return html;
  }

  w.Art = {
    INK: INK,
    balloonArt: balloonArt, balloonSvg: balloonSvg,
    dart: dart, crosshairCursor: crosshairCursor,
    homeArt: homeArt, trophy: trophy, bulbString: bulbString
  };
}(window));
