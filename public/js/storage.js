/* ===== storage.js — 本機偏好與戰績 =====
 * localStorage 在無痕視窗、封鎖資料的瀏覽器裡可能會丟例外，
 * 所以每一次存取都包 try/catch，失敗就當作「沒有存過」繼續玩。
 */
(function (w) {
  'use strict';

  var KEY = {
    nick: 'sb_nick',
    clientId: 'sb_client',
    tutorialDone: 'sb_tutorial',
    pace: 'sb_pace',
    aiCount: 'sb_ai_count',
    stats: 'sb_stats',
    best: 'sb_best',
    reduceMotion: 'sb_reduce_motion',
    bigTag: 'sb_big_tag',
    roundSec: 'sb_round_sec',
    cursor: 'sb_cursor',
    sideOpen: 'sb_side_open'
  };

  function get(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
  function getJson(k, d) {
    try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
  }
  function setJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function getFlag(k, d) { var v = get(k, null); return v === null ? d : v === '1'; }
  function setFlag(k, v) { set(k, v ? '1' : '0'); }
  function getNum(k, d) { var v = Number(get(k, NaN)); return isFinite(v) ? v : d; }

  /** 這台裝置的身分：重新整理後要靠它回到原本的座位 */
  function clientId() {
    var id = get(KEY.clientId, '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = 'c' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
      set(KEY.clientId, id);
    }
    return id;
  }

  var EMPTY_STATS = { solo: { win: 0, lose: 0, draw: 0 }, online: { win: 0, lose: 0, draw: 0 } };

  function stats() {
    var s = getJson(KEY.stats, null);
    if (!s || !s.solo || !s.online) return JSON.parse(JSON.stringify(EMPTY_STATS));
    return s;
  }

  function recordResult(mode, outcome) {
    var s = stats();
    var bucket = s[mode === 'online' ? 'online' : 'solo'];
    if (outcome === 'win' || outcome === 'lose' || outcome === 'draw') bucket[outcome] += 1;
    setJson(KEY.stats, s);
    return s;
  }

  function best(v) {
    if (v === undefined) return getJson(KEY.best, { score: 0, combo: 0, accuracy: 0 });
    var cur = best();
    var next = {
      score: Math.max(cur.score || 0, v.score || 0),
      combo: Math.max(cur.combo || 0, v.combo || 0),
      accuracy: Math.max(cur.accuracy || 0, v.accuracy || 0)
    };
    setJson(KEY.best, next);
    return next;
  }

  w.Store = {
    KEY: KEY,
    clientId: clientId,
    nick: function (v) { if (v === undefined) return get(KEY.nick, ''); set(KEY.nick, v); return v; },
    pace: function (v) { if (v === undefined) return get(KEY.pace, 'normal'); set(KEY.pace, v); return v; },
    aiCount: function (v) { if (v === undefined) return getNum(KEY.aiCount, 2); set(KEY.aiCount, v); return v; },
    tutorialDone: function (v) { if (v === undefined) return getFlag(KEY.tutorialDone, false); setFlag(KEY.tutorialDone, v); return v; },
    reduceMotion: function (v) { if (v === undefined) return getFlag(KEY.reduceMotion, false); setFlag(KEY.reduceMotion, v); return v; },
    bigTag: function (v) { if (v === undefined) return getFlag(KEY.bigTag, true); setFlag(KEY.bigTag, v); return v; },
    /* 本機偏好的一局長度；建立線上房間時先沿用，之後仍由房主決定 */
    roundSec: function (v) { if (v === undefined) return getNum(KEY.roundSec, 0); set(KEY.roundSec, v); return v; },
    cursor: function (v) { if (v === undefined) return getFlag(KEY.cursor, true); setFlag(KEY.cursor, v); return v; },
    sideOpen: function (v) { if (v === undefined) return getFlag(KEY.sideOpen, true); setFlag(KEY.sideOpen, v); return v; },
    best: best,
    stats: stats,
    recordResult: recordResult,
    resetDefaults: function () {
      setFlag(KEY.reduceMotion, false);
      setFlag(KEY.bigTag, true);
      setFlag(KEY.cursor, true);
    }
  };
}(window));
