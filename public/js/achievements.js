/* ===== achievements.js — 成就與徽章（只在本機判定與保存） =====
 * 每局結束時，用「我的那一列成績」判斷這局解鎖了哪些成就；
 * 規則只讀結算資料，不影響對局本身，線上與單機共用。
 */
(function (w) {
  'use strict';

  function popped(row, key) { return (row.byType && row.byType[key]) || 0; }

  /* tier 只影響徽章的顏色：bronze 銅／silver 銀／gold 金 */
  var LIST = [
    { id: 'firstWin', glyph: 'crown', tier: 'bronze', test: function (r, c) { return c.outcome === 'win' && c.players >= 2; } },
    { id: 'combo10', glyph: 'flame', tier: 'bronze', test: function (r) { return r.bestCombo >= 10; } },
    { id: 'combo25', glyph: 'flame', tier: 'silver', test: function (r) { return r.bestCombo >= 25; } },
    { id: 'combo40', glyph: 'bolt', tier: 'gold', test: function (r) { return r.bestCombo >= 40; } },
    { id: 'clean', glyph: 'shield', tier: 'silver', test: function (r) { return r.badHits === 0 && r.hits >= 20; } },
    { id: 'sharp', glyph: 'target', tier: 'silver', test: function (r) { return r.shots >= 25 && r.accuracy >= 0.85; } },
    { id: 'score2500', glyph: 'star', tier: 'bronze', test: function (r) { return r.score >= 2500; } },
    { id: 'score4500', glyph: 'stars', tier: 'gold', test: function (r) { return r.score >= 4500; } },
    { id: 'golden3', glyph: 'sparkle', tier: 'silver', test: function (r) { return popped(r, 'golden') >= 3; } },
    { id: 'split9', glyph: 'split', tier: 'silver', test: function (r) { return popped(r, 'mini') >= 9; } },
    { id: 'lucky3', glyph: 'gift', tier: 'silver', test: function (r) { return r.luckyGood >= 3 && r.luckyBad === 0; } },
    { id: 'boss1', glyph: 'boss', tier: 'gold', test: function (r) { return r.bossKills >= 1; } },
    { id: 'games10', glyph: 'ticket', tier: 'bronze', test: function (r, c) { return c.games >= 10; } }
  ];

  function byId(id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return null;
  }

  /** @param row 我的結算列（Rules.standings 的一列）@param ctx {outcome, players, games} */
  function evaluate(row, ctx) {
    var out = [];
    if (!row) return out;
    var safe = {
      score: row.score || 0, hits: row.hits || 0, badHits: row.badHits || 0, shots: row.shots || 0,
      bestCombo: row.bestCombo || 0, accuracy: row.accuracy || 0, byType: row.byType || {},
      bossKills: row.bossKills || 0, luckyGood: row.luckyGood || 0, luckyBad: row.luckyBad || 0
    };
    for (var i = 0; i < LIST.length; i++) {
      var ok = false;
      try { ok = !!LIST[i].test(safe, ctx || {}); } catch (e) { ok = false; }
      if (ok) out.push(LIST[i].id);
    }
    return out;
  }

  w.Achievements = { LIST: LIST, byId: byId, evaluate: evaluate };
  if (typeof module === 'object' && module.exports) module.exports = w.Achievements;
}(typeof window !== 'undefined' ? window : globalThis));
