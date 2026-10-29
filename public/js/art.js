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

    /* 分身氣球：天藍色，肚子上有一個 Y 形的虛線縫，暗示會裂成三顆 */
    split: function () {
      return string('#CFEBFF') + shape('#59B7FF') + knot('#59B7FF')
        + '<path d="M50 94V58M50 58L24 32M50 58L76 32" fill="none" stroke="' + INK + '" stroke-width="3.6" stroke-linecap="round" stroke-dasharray="7 6"/>'
        + '<circle cx="50" cy="58" r="6.5" fill="' + CREAM + '" stroke="' + INK + '" stroke-width="3"/>'
        + shine(28, 34);
    },

    /* 小分身：同色系的小氣球 */
    mini: function () {
      return string('#CFEBFF') + shape('#8FD0FF') + knot('#8FD0FF') + shine();
    },

    /* 幸運福袋：粉紅氣球、頂上綁金色蝴蝶結、肚子是一個大問號 */
    lucky: function () {
      return string('#FFE08A') + shape('#FF8FC8') + knot('#FF8FC8') + shine(24, 34)
        + '<path d="M50 8C42 -6 28 -2 31 8 34 14 45 11 50 8 55 11 66 14 69 8 72 -2 58 -6 50 8Z" fill="#FFD84A" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round"/>'
        + '<circle cx="50" cy="8" r="4" fill="#E8A21C" stroke="' + INK + '" stroke-width="2.4"/>'
        + '<circle cx="50" cy="56" r="21" fill="' + CREAM + '" stroke="' + INK + '" stroke-width="3.4"/>'
        + '<path d="M41 49c0-7 5-11 10-11s10 4 10 9c0 7-10 8-10 15" fill="none" stroke="' + INK + '" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>'
        + '<circle cx="51" cy="71" r="3.6" fill="' + INK + '"/>';
    },

    /* Boss：紫色大氣球，戴金皇冠、生氣的臉；血量愈低裂痕愈多 */
    boss: function (hpLeft, hpTotal) {
      var f = hpTotal ? hpLeft / hpTotal : 1;
      var crack = '';
      if (f <= 0.66) crack += '<path d="M64 10l-9 13 11 8-9 13" fill="none" stroke="' + INK + '" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>';
      if (f <= 0.33) crack += '<path d="M22 28l13 9-9 10 13 8M72 62l14 8-6 9" fill="none" stroke="' + INK + '" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>';
      return string('#D6C2FF') + shape('#7A3FD1') + knot('#7A3FD1') + shine(24, 34)
        + '<path d="M27 21L31 -3 42 11 50 -7 58 11 69 -3 73 21z" fill="#FFC93C" stroke="' + INK + '" stroke-width="3.6" stroke-linejoin="round"/>'
        + '<path d="M27 21h46" stroke="' + INK + '" stroke-width="3.6"/>'
        + '<ellipse cx="36" cy="50" rx="8" ry="9" fill="' + CREAM + '" stroke="' + INK + '" stroke-width="3"/>'
        + '<ellipse cx="64" cy="50" rx="8" ry="9" fill="' + CREAM + '" stroke="' + INK + '" stroke-width="3"/>'
        + '<circle cx="38" cy="52" r="3.8" fill="' + INK + '"/><circle cx="62" cy="52" r="3.8" fill="' + INK + '"/>'
        + '<path d="M24 36L45 45M76 36L55 45" stroke="' + INK + '" stroke-width="5.2" stroke-linecap="round"/>'
        + '<path d="M32 72l6-7 6 7 6-7 6 7 6-7 6 7" fill="none" stroke="' + INK + '" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
        + crack;
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
  function balloonArt(key, hpLeft, hpTotal) {
    var fn = ART[key] || ART.red;
    return fn(hpLeft, hpTotal);
  }

  /** 完整 <svg>，圖鑑、結算等直接用 */
  function balloonSvg(key, hpLeft, cls, hpTotal) {
    return '<svg class="' + (cls || 'bln-svg') + '" viewBox="-6 -10 112 168" aria-hidden="true" focusable="false">'
      + balloonArt(key, hpLeft, hpTotal) + '</svg>';
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


  /* ---- 成就徽章：圓形獎牌 + 圖案；未解鎖是暗色剪影 ---- */
  var TIER_FILL = { bronze: '#C98A4B', silver: '#D5DCEC', gold: '#FFB73D' };
  var GLYPH = {
    crown: '<path d="M26 64L30 38 41 52 50 32 59 52 70 38 74 64z"/><path d="M26 70h48"/>',
    flame: '<path d="M50 24c5 11 16 15 16 30a16 16 0 0 1-32 0c0-9 4-13 9-18 0 7 4 9 6 9-3-9-3-15 1-21z"/>',
    bolt: '<path d="M57 22L35 54h13l-5 24 23-34H54z"/>',
    star: '<path d="M50 24l8 17 18 2-13 13 4 18-17-9-17 9 4-18-13-13 18-2z"/>',
    stars: '<path d="M38 30l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z"/><path d="M64 44l4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1z"/>',
    shield: '<path d="M50 24l20 8v16c0 14-9 24-20 30-11-6-20-16-20-30V32z"/><path d="M40 51l8 8 14-16" fill="none"/>',
    target: '<circle cx="50" cy="50" r="22" fill="none"/><circle cx="50" cy="50" r="11" fill="none"/><circle cx="50" cy="50" r="3.6"/><path d="M50 20v10M50 70v10M20 50h10M70 50h10" fill="none"/>',
    sparkle: '<path d="M50 20c2 16 10 24 26 30-16 6-24 14-26 30-2-16-10-24-26-30 16-6 24-14 26-30z"/>',
    split: '<path d="M50 78V54M50 54L32 34M50 54L68 34" fill="none"/><circle cx="50" cy="54" r="5"/><circle cx="30" cy="30" r="8"/><circle cx="70" cy="30" r="8"/><circle cx="50" cy="26" r="6" />',
    gift: '<rect x="28" y="42" width="44" height="32" rx="3"/><path d="M26 42h48v-8H26zM50 34v40" /><path d="M50 34c-10-12-20-6-14 0M50 34c10-12 20-6 14 0" fill="none"/>',
    boss: '<ellipse cx="50" cy="56" rx="19" ry="22"/><path d="M34 40L38 22 45 32 50 20 55 32 62 22 66 40z"/>',
    ticket: '<path d="M26 34h48v10a6 6 0 0 0 0 12v10H26V56a6 6 0 0 0 0-12z"/><path d="M42 34v32" fill="none"/>'
  };
  function badge(glyph, tier, earned, cls) {
    var fill = earned ? (TIER_FILL[tier] || TIER_FILL.bronze) : '#3C3380';
    var ink = earned ? INK : '#8D83C2';
    return '<svg class="' + (cls || 'badge-svg') + (earned ? '' : ' locked') + '" viewBox="0 0 100 100" aria-hidden="true" focusable="false">'
      + '<path d="M34 6h12l4 22H30z" fill="' + (earned ? '#E8483A' : '#4B3F96') + '" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round"/>'
      + '<path d="M54 6h12l4 22H50z" fill="' + (earned ? '#FFF1D6' : '#4B3F96') + '" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round"/>'
      + '<circle cx="50" cy="60" r="34" fill="' + fill + '" stroke="' + INK + '" stroke-width="4"/>'
      + '<circle cx="50" cy="60" r="27" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-dasharray="3 5" opacity=".7"/>'
      + '<g transform="translate(0 10) scale(1) " fill="' + (earned ? CREAM : '#5A4FA6') + '" stroke="' + ink + '" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round">'
      + (GLYPH[glyph] || GLYPH.star) + '</g></svg>';
  }

  /* ---- 攤位場景：遠處摩天輪、遮陽篷與燈泡、吊燈籠；都在氣球後面，不搶戲 ---- */
  function scene() {
    var spokes = '';
    for (var i = 0; i < 8; i++) spokes += '<path d="M60 60L' + (60 + 46 * Math.cos(i * Math.PI / 4)).toFixed(1) + ' ' + (60 + 46 * Math.sin(i * Math.PI / 4)).toFixed(1) + '"/>';
    var pods = '';
    for (var j = 0; j < 8; j++) pods += '<circle cx="' + (60 + 46 * Math.cos(j * Math.PI / 4)).toFixed(1) + '" cy="' + (60 + 46 * Math.sin(j * Math.PI / 4)).toFixed(1) + '" r="5" fill="' + (j % 2 ? '#FFB73D' : '#E8483A') + '" stroke="none"/>';
    var wheel = '<svg class="wheel-svg" viewBox="0 0 120 130" aria-hidden="true" focusable="false">'
      + '<path d="M60 60L30 128M60 60L90 128M22 128h76" fill="none" stroke="#6C5CC0" stroke-width="3"/>'
      + '<g class="wheel-rot" fill="none" stroke="#8E7FE0" stroke-width="2.6"><circle cx="60" cy="60" r="46"/><circle cx="60" cy="60" r="4" fill="#8E7FE0"/>' + spokes + pods + '</g></svg>';
    var lantern = function (cls, hue) {
      return '<span class="deco-lantern ' + cls + '"><svg viewBox="0 0 40 70" aria-hidden="true" focusable="false">'
        + '<path d="M20 0v12" stroke="' + CREAM + '" stroke-width="2" opacity=".7"/>'
        + '<rect x="10" y="10" width="20" height="5" rx="2" fill="' + INK + '"/>'
        + '<path d="M8 22c0-6 6-8 12-8s12 2 12 8v16c0 6-6 8-12 8s-12-2-12-8z" fill="' + hue + '" stroke="' + INK + '" stroke-width="2.6"/>'
        + '<path d="M14 18v26M20 16v30M26 18v26" stroke="' + INK + '" stroke-width="1.6" opacity=".45"/>'
        + '<rect x="12" y="46" width="16" height="4" rx="2" fill="' + INK + '"/>'
        + '<path d="M16 50v12M20 50v14M24 50v12" stroke="' + hue + '" stroke-width="2.4" stroke-linecap="round"/></svg></span>';
    };
    return '<span class="deco-far">' + wheel + '</span>'
      + '<span class="deco-awning"></span><span class="deco-bulbs"></span>'
      + lantern('l1', '#E8483A') + lantern('l2', '#FF9A3D');
  }

  /* ---- 櫃檯上的獎品：熊、疊杯、金魚袋 ---- */
  function prizes() {
    var bear = '<svg class="prize-svg" viewBox="0 0 90 60" aria-hidden="true" focusable="false">'
      + '<g stroke="' + INK + '" stroke-width="2.6" stroke-linejoin="round">'
      + '<circle cx="14" cy="14" r="6" fill="#C98A4B"/><circle cx="34" cy="14" r="6" fill="#C98A4B"/>'
      + '<circle cx="24" cy="24" r="14" fill="#D9A066"/><ellipse cx="24" cy="29" rx="6" ry="4.4" fill="' + CREAM + '"/>'
      + '<ellipse cx="24" cy="48" rx="15" ry="12" fill="#D9A066"/></g>'
      + '<circle cx="19" cy="22" r="1.8" fill="' + INK + '"/><circle cx="29" cy="22" r="1.8" fill="' + INK + '"/><circle cx="24" cy="27.5" r="1.8" fill="' + INK + '"/>'
      + '<g stroke="' + INK + '" stroke-width="2.6" stroke-linejoin="round">'
      + '<path d="M54 56l3-14h16l3 14z" fill="#59B7FF"/><path d="M57 42l2-12h10l2 12z" fill="#2FC4AE"/><path d="M60 30l1.5-10h7L70 30z" fill="#FFC93C"/></g></svg>';
    var fish = '<svg class="prize-svg" viewBox="0 0 90 60" aria-hidden="true" focusable="false">'
      + '<g stroke="' + INK + '" stroke-width="2.6" stroke-linejoin="round">'
      + '<path d="M14 18h28l-2 36H16z" fill="#BFE8FF" fill-opacity=".6"/><path d="M18 18c0-6 20-6 20 0" fill="none"/>'
      + '<ellipse cx="27" cy="38" rx="7" ry="5" fill="#FF9A3D"/><path d="M34 38l6-5v10z" fill="#FF9A3D"/>'
      + '<path d="M58 54V26a14 14 0 0 1 28 0v28z" fill="#E8483A"/><path d="M58 40h28" fill="none"/></g>'
      + '<circle cx="72" cy="33" r="4" fill="' + CREAM + '"/></svg>';
    return '<span class="prize prize-l">' + bear + '</span><span class="prize prize-r">' + fish + '</span>';
  }

  w.Art = {
    INK: INK,
    badge: badge, scene: scene, prizes: prizes,
    balloonArt: balloonArt, balloonSvg: balloonSvg,
    dart: dart, crosshairCursor: crosshairCursor,
    homeArt: homeArt, trophy: trophy, bulbString: bulbString
  };
}(window));
