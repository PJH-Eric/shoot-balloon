/* ===== ai.js — 電腦射手 =====
 *
 * 難度的差別是「看得多快、認得多準、手多穩、會不會挑高分」，不是只換名字。
 * 每個參數都能從行為觀察到：
 *   reactionMs  氣球冒出到 AI「注意到」它所需的時間
 *   shotMs      兩次射擊之間的冷卻
 *   badMistake  「這一發看走眼」的機率（每發只擲一次骰，不是每顆氣球一次）
 *   whiff       瞄準失手、射到旁邊空處的機率
 *   valueBias   挑目標時有多偏好高分氣球（0 = 隨便射、1 = 專挑高分）
 *   moveMs      準星每移動半個舞台寬要多花的時間，AI 不會瞬間橫掃全場
 *
 * 沒有 DOM 相依：單機由瀏覽器跑，線上房間由伺服器跑，同一份程式。
 * AI 看到的就是 Rules.snapshot()，和玩家完全一樣，不偷看、不改傷害。
 */
(function (root, factory) {
  'use strict';
  var Rules = (typeof module === 'object' && module.exports) ? require('./rules.js') : root.Rules;
  var RNG = (typeof module === 'object' && module.exports) ? require('./rng.js') : root.RNG;
  var api = factory(Rules, RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AI = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Rules, RNG) {
  'use strict';

  var LEVELS = {
    rookie: {
      key: 'rookie', label: '超級新手',
      reactionMs: 1600, reactionJitter: 380, shotMs: 1500, shotJitter: 380,
      badMistake: 0.48, whiff: 0.36, valueBias: 0.05, moveMs: 260,
      blurb: '剛學會拿彈弓，慢吞吞又常常射錯，陪第一次玩的人剛剛好。'
    },
    easy: {
      key: 'easy', label: '簡單',
      reactionMs: 1100, reactionJitter: 260, shotMs: 1050, shotJitter: 260,
      badMistake: 0.36, whiff: 0.26, valueBias: 0.15, moveMs: 190,
      blurb: '反應慢、常常誤射禁射氣球，適合小朋友和第一次玩。'
    },
    normal: {
      key: 'normal', label: '普通',
      reactionMs: 800, reactionJitter: 170, shotMs: 780, shotJitter: 170,
      badMistake: 0.18, whiff: 0.13, valueBias: 0.6, moveMs: 130,
      blurb: '手腳算快，會挑分數高的射，偶爾會失手。'
    },
    hard: {
      key: 'hard', label: '困難',
      reactionMs: 600, reactionJitter: 110, shotMs: 600, shotJitter: 110,
      badMistake: 0.07, whiff: 0.07, valueBias: 1, moveMs: 90,
      blurb: '幾乎不誤射，專挑金色與巨無霸氣球，會跟你搶最後一發。'
    }
  };

  var ORDER = ['rookie', 'easy', 'normal', 'hard'];
  var NAME_POOL = ['彈弓', '阿呆', '小咻', '鷹眼', '眼鏡', '嘟嘟', '快手', '老練'];

  var NAME_COUNT = NAME_POOL.length;

  function levelOf(key) { return LEVELS[key] || LEVELS.normal; }

  function aiName(level, index) {
    var l = levelOf(level);
    return NAME_POOL[index % NAME_POOL.length] + '（' + l.label + '）';
  }

  /** 建立一顆 AI 大腦。狀態放在自己身上，同一場可以同時跑好幾顆而互不干擾。 */
  function createBrain(level, seed) {
    var L = levelOf(level);
    var rng = RNG.createRng(seed === undefined ? Math.random() : seed);
    var noticed = {};      // balloonId -> 注意到它的時間
    var nextShotAt = 0;
    var aimX = 0.5, aimY = 0.5;   // 準星目前位置，用來算移動時間
    var sloppy = null;     // 這一發會不會看走眼；擲一次骰後沿用到真的射出去為止

    function jitter(base, spread) {
      return Math.max(60, Math.round(base + RNG.symmetric(rng) * spread));
    }

    /**
     * 想一步。回傳 null 代表這個瞬間還不出手。
     * @returns {{balloonId:number|null, x:number, y:number, whiff:boolean}|null}
     */
    function step(snap, now) {
      if (!snap || snap.phase !== 'playing') { nextShotAt = 0; return null; }

      var list = snap.balloons || [];
      var i, b, alive = {};

      for (i = 0; i < list.length; i++) {
        b = list[i];
        alive[b.id] = true;
        if (noticed[b.id] === undefined && Rules.balloonPos(b, now).y <= 0.85) {
          /* 實際看見氣球進入舞台安全區才開始反應，不以出生時間預算。
           * 線上快照延遲或恢復遊戲時，也不能跳過看見後的等待時間。 */
          noticed[b.id] = now + jitter(L.reactionMs, L.reactionJitter);
        }
      }
      for (var id in noticed) if (!alive[id]) delete noticed[id];

      if (now < nextShotAt) return null;

      /* 已經注意到、而且在舞台上、還來得及射的氣球 */
      var seen = [];
      for (i = 0; i < list.length; i++) {
        b = list[i];
        if (noticed[b.id] === undefined || now < noticed[b.id]) continue;
        if (now > b.expireAt - 160) continue;
        var p = Rules.balloonPos(b, now);
        if (p.y < 0.02 || p.y > 0.85) continue;
        seen.push({ b: b, p: p });
      }
      if (!seen.length) return null;

      /* 目標評分：要射的氣球看「剩餘價值 × 快飄走了要優先」；
       * 禁射氣球本來不該碰，只有在「這一發看走眼」時才進候選。 */
      if (sloppy === null) sloppy = rng() < L.badMistake;
      var best = null, bestScore = -Infinity;
      for (i = 0; i < seen.length; i++) {
        b = seen[i].b;
        var t = Rules.typeOf(b.type);
        var mistaken = false;
        if (t.side === 'avoid') {
          if (!sloppy) continue;
          mistaken = true;
        }
        var value = t.side === 'avoid' ? 12 : Math.max(1, Rules.hitUnit(b.type));
        var weighted = Math.pow(value, 0.35 + L.valueBias * 1.15);
        var urgency = 1 + Math.max(0, 1 - (b.expireAt - now) / 2200) * 0.8;
        var score = weighted * urgency * (0.75 + rng() * 0.5);
        if (mistaken) score *= 0.8;
        if (score > bestScore) { bestScore = score; best = seen[i]; }
      }
      if (!best) return null;

      /* 準星要從上一個位置移過去，距離愈遠、下一發愈慢 */
      var dx = best.p.x - aimX, dy = (best.p.y - aimY) * 0.6;
      var dist = Math.sqrt(dx * dx + dy * dy);
      nextShotAt = now + jitter(L.shotMs, L.shotJitter) + Math.round(dist * 2 * L.moveMs);
      sloppy = null;

      /* 手滑：射到氣球旁邊的空處（真的會落空，不是假動作） */
      if (rng() < L.whiff) {
        var wx = Math.min(0.96, Math.max(0.04, best.p.x + (rng() < 0.5 ? -1 : 1) * (0.12 + rng() * 0.1)));
        aimX = wx; aimY = best.p.y;
        return { balloonId: null, x: wx, y: best.p.y, whiff: true };
      }

      aimX = best.p.x; aimY = best.p.y;
      return { balloonId: best.b.id, x: best.p.x, y: best.p.y, whiff: false };
    }

    function reset() { noticed = {}; nextShotAt = 0; aimX = 0.5; aimY = 0.5; sloppy = null; }

    return { level: L.key, config: L, step: step, reset: reset };
  }

  return {
    LEVELS: LEVELS,
    ORDER: ORDER,
    levelOf: levelOf,
    aiName: aiName,
    NAME_COUNT: NAME_COUNT,
    NAME_POOL: NAME_POOL,
    createBrain: createBrain
  };
}));
