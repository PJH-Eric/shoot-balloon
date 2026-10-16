/* ===== rules.js — 射氣球的規則核心（伺服器與前端共用的唯一真相）=====
 *
 * 沒有任何 DOM / Socket / 音效相依：
 *   - 瀏覽器用 <script> 載入 → window.Rules
 *   - Node（server.js、tests）用 require('./public/js/rules.js')
 *
 * 單機、線上、AI 全部共用這一份。所有隨機都走可注入的種子亂數（rng.js），
 * 同一個種子會長出同一批氣球。
 *
 * 座標：舞台是 0..1 的正規化空間，x 由左到右、y 由上到下。
 * 氣球從舞台下方（y=Y_START）往上飄到舞台上方外面（y=Y_END），
 * 位置是「時間的純函式」（balloonPos），所以伺服器只需在冒出／被射／飄走時送事件，
 * 前端自己用時間內插就能補滿動畫。
 */
(function (root, factory) {
  'use strict';
  var RNG = (typeof module === 'object' && module.exports)
    ? require('./rng.js')
    : root.RNG;
  var api = factory(RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Rules = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (RNG) {
  'use strict';

  /* ---------------------------------------------------------- 時間與常數 */

  var ROUND_MS = 60000;
  var COUNTDOWN_MS = 3000;
  var ROUND_SECONDS = [60, 75, 90];
  var DEFAULT_ROUND_SEC = 60;

  function roundMsOf(sec) {
    var n = Math.round(Number(sec));
    for (var i = 0; i < ROUND_SECONDS.length; i++) if (ROUND_SECONDS[i] === n) return n * 1000;
    return DEFAULT_ROUND_SEC * 1000;
  }
  /* 毫秒 → 秒，純顯示用；伺服器用環境變數開 14 秒房間時要照實顯示 */
  function roundSecOf(ms) {
    var n = Math.round(Number(ms) / 1000);
    return n > 0 ? n : DEFAULT_ROUND_SEC;
  }

  /* 氣球飛行的起點與終點（y）。起點在舞台下緣外面、終點在上緣外面。 */
  var Y_START = 1.1;
  var Y_END = -0.12;
  /* 判定寬限：封包延遲讓玩家「看起來剛好射到」的氣球仍然算數 */
  var GRACE_MS = 140;

  var COMBO_STEP = 5;
  var COMBO_BONUS = 0.10;
  var COMBO_MAX_BONUS = 0.50;
  var BUFF_MS = 6000;
  var MAX_PLAYERS = 5;

  /* ---------------------------------------------------------- 氣球圖鑑 */
  /*
   * side: 'pop'   = 要射的，射中加分
   *       'avoid' = 不能射的，射中扣分
   * hp:   要射幾下才會破。多層氣球每一下都給 round(points/hp)，最後一下再多拿一份。
   * upMs: 從舞台下緣飄到上緣的時間，實際會再乘上階段與難度的倍率。
   * size: 相對大小（1 = 標準）。
   * amp / period: 左右搖擺的幅度（舞台寬度的比例）與週期（毫秒）。
   * w:    各階段的出現權重，0 代表該階段不會出現。
   */
  var TYPES = {
    red: {
      key: 'red', side: 'pop', label: '紅氣球', points: 10, hp: 1,
      upMs: 7200, size: 1.0, amp: 0.03, period: 2600, w: [46, 26, 14],
      hint: '最常見的氣球，看到就射。'
    },
    yellow: {
      key: 'yellow', side: 'pop', label: '小黃氣球', points: 25, hp: 1,
      upMs: 4200, size: 0.8, amp: 0.05, period: 1500, w: [16, 17, 14],
      hint: '個子小、飄得快，要抓準時機。'
    },
    twin: {
      key: 'twin', side: 'pop', label: '雙層氣球', points: 44, hp: 2,
      upMs: 8200, size: 1.15, amp: 0.02, period: 3000, w: [0, 12, 11],
      hint: '外面包了一層，要射兩下才會破。'
    },
    star: {
      key: 'star', side: 'pop', label: '星星氣球', points: 60, hp: 1,
      upMs: 4800, size: 0.9, amp: 0.09, period: 1100, w: [0, 8, 9],
      hint: '左右亂晃的星星，分數高但很難瞄。'
    },
    rainbow: {
      key: 'rainbow', side: 'pop', label: '彩虹氣球', points: 50, hp: 1, buff: true,
      upMs: 5600, size: 1.0, amp: 0.04, period: 2000, w: [0, 5, 5],
      hint: '射中之後 6 秒內，你射中的正分全部加倍。'
    },
    jumbo: {
      key: 'jumbo', side: 'pop', label: '巨無霸氣球', points: 96, hp: 3,
      upMs: 11000, size: 1.7, amp: 0.015, period: 3400, w: [0, 3, 6],
      hint: '又大又慢，要射三下，補最後一下的人拿雙份。'
    },
    golden: {
      key: 'golden', side: 'pop', label: '金色氣球', points: 120, hp: 1,
      upMs: 3300, size: 0.85, amp: 0.06, period: 1300, w: [0, 2, 4],
      hint: '全場最高分，一下子就飄走了。'
    },
    dove: {
      key: 'dove', side: 'avoid', label: '白鴿氣球', points: -15, hp: 1,
      upMs: 7000, size: 1.0, amp: 0.03, period: 2400, w: [18, 11, 8],
      hint: '綁著白鴿的氣球，別射。'
    },
    lantern: {
      key: 'lantern', side: 'avoid', label: '祈福天燈', points: -30, hp: 1,
      upMs: 8000, size: 1.1, amp: 0.02, period: 3000, w: [10, 8, 8],
      hint: '寫滿願望的天燈，射下來要扣分。'
    },
    bomb: {
      key: 'bomb', side: 'avoid', label: '炸彈氣球', points: -50, hp: 1,
      upMs: 6500, size: 1.0, amp: 0.035, period: 2200, w: [0, 5, 6],
      hint: '點著引線的炸彈氣球，扣最多分。'
    }
  };

  var ORDER = ['red', 'yellow', 'twin', 'star', 'rainbow', 'jumbo', 'golden', 'dove', 'lantern', 'bomb'];
  var POP_TYPES = ORDER.filter(function (k) { return TYPES[k].side === 'pop'; });
  var AVOID_TYPES = ORDER.filter(function (k) { return TYPES[k].side === 'avoid'; });

  /* ---------------------------------------------------------- 難度與階段 */
  /*
   * 難度管的是「氣球飄多快、冒多快、同時幾顆」，電腦對手的強弱另外在 ai.js。
   *   upScale     飛行時間的倍率（愈大＝飄愈慢＝愈好射）
   *   spawnScale  冒出間隔的倍率（愈大＝冒得愈慢）
   *   maxUpDelta  同時在場的氣球數增減
   */
  var PACES = {
    rookie: {
      key: 'rookie', label: '超級新手', upScale: 1.6, spawnScale: 1.7, maxUpDelta: -2,
      blurb: '氣球慢慢飄、慢慢冒，看清楚再射也來得及。'
    },
    easy: {
      key: 'easy', label: '簡單', upScale: 1.3, spawnScale: 1.3, maxUpDelta: -1,
      blurb: '飄得慢一點、冒得少一點，剛上手玩這個。'
    },
    normal: {
      key: 'normal', label: '普通', upScale: 1.0, spawnScale: 1.0, maxUpDelta: 0,
      blurb: '標準節奏，三個階段會愈來愈快。'
    },
    hard: {
      key: 'hard', label: '困難', upScale: 0.78, spawnScale: 0.85, maxUpDelta: 2,
      blurb: '氣球又快又多，考驗手速與判斷。'
    }
  };
  var PACE_ORDER = ['rookie', 'easy', 'normal', 'hard'];
  var DEFAULT_PACE = 'normal';
  function paceOf(key) { return PACES[key] || PACES[DEFAULT_PACE]; }

  /* at＝這個階段從一局的幾分之幾開始。用比例，換局長時第 3 階段才不會跑不到。 */
  var STAGES = [
    { no: 1, at: 0, label: '暖場', spawnMs: 780, jitter: 240, maxUp: 8, upScale: 1.15 },
    { no: 2, at: 1 / 3, label: '加速', spawnMs: 580, jitter: 190, maxUp: 10, upScale: 1.0 },
    { no: 3, at: 2 / 3, label: '狂歡', spawnMs: 440, jitter: 150, maxUp: 12, upScale: 0.88 }
  ];

  function stageAt(elapsedMs, roundMs) {
    var total = roundMs || ROUND_MS;
    var s = STAGES[0];
    for (var i = 0; i < STAGES.length; i++) if (elapsedMs >= STAGES[i].at * total) s = STAGES[i];
    return s;
  }

  function scaleStage(st, pace) {
    var P = paceOf(pace);
    return {
      no: st.no, at: st.at, label: st.label,
      upScale: st.upScale * P.upScale,
      spawnMs: Math.max(260, Math.round(st.spawnMs * P.spawnScale)),
      jitter: Math.max(0, Math.round(st.jitter * P.spawnScale)),
      maxUp: Math.max(2, st.maxUp + P.maxUpDelta)
    };
  }

  /* ---------------------------------------------------------- 小工具 */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function typeOf(key) { return TYPES[key] || TYPES.red; }

  function weightsFor(stageNo) {
    var idx = clamp(stageNo, 1, STAGES.length) - 1;
    var list = [];
    for (var i = 0; i < ORDER.length; i++) {
      var k = ORDER[i];
      var w = TYPES[k].w[idx] || 0;
      if (w > 0) list.push({ key: k, w: w });
    }
    return list;
  }

  function pickType(stageNo, rng) {
    var list = weightsFor(stageNo);
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].w;
    var r = (rng || Math.random)() * total;
    for (i = 0; i < list.length; i++) {
      r -= list[i].w;
      if (r <= 0) return list[i].key;
    }
    return list.length ? list[list.length - 1].key : 'red';
  }

  function comboMultiplier(combo) {
    var steps = Math.floor(combo / COMBO_STEP);
    return 1 + Math.min(COMBO_MAX_BONUS, steps * COMBO_BONUS);
  }

  function hitUnit(type) {
    var t = typeOf(type);
    return Math.round(t.points / t.hp);
  }

  /** 純函式：算出這一下實際加減多少分。 */
  function scoreHit(opts) {
    var t = typeOf(opts.type);
    var unit = hitUnit(t.key);
    var raw = unit + (opts.killed && t.hp > 1 ? unit : 0);
    if (t.side === 'avoid') return { gain: raw, multiplier: 1, base: raw };
    var mult = comboMultiplier(opts.combo || 0) * (opts.buffed ? 2 : 1);
    return { gain: Math.round(raw * mult), multiplier: mult, base: raw };
  }

  function describeType(key) {
    var t = typeOf(key);
    return t.label + '（' + (t.points > 0 ? '+' : '') + t.points + '分'
      + (t.hp > 1 ? '、' + t.hp + '下' : '') + '）';
  }

  /**
   * 氣球在 now 這一刻的位置（舞台正規化座標）。前端畫圖、AI 瞄準、伺服器判定共用。
   */
  function balloonPos(b, now) {
    var age = now - b.spawnAt;
    var t = age / b.upMs;
    var y = Y_START + (Y_END - Y_START) * t;
    var x = b.lane + b.amp * Math.sin(b.phase + age * 2 * Math.PI / b.period);
    return { x: clamp(x, 0.03, 0.97), y: y, t: t };
  }

  /** 氣球現在看得到嗎（至少有一部分在舞台內） */
  function onStage(b, now) {
    var p = balloonPos(b, now);
    return p.y > -0.06 && p.y < 1.06;
  }

  /* ---------------------------------------------------------- 玩家 */

  var PLAYER_COLORS = ['coral', 'teal', 'amber', 'violet', 'sky'];
  var PLAYER_COLOR_HEX = {
    coral: '#FF6B57', teal: '#2FC4AE', amber: '#FFB73D', violet: '#A98BFF', sky: '#59B7FF'
  };

  function newPlayer(p, index) {
    var byType = {};
    for (var i = 0; i < ORDER.length; i++) byType[ORDER[i]] = 0;
    return {
      id: String(p.id),
      name: String(p.name || ('玩家' + (index + 1))),
      color: p.color || PLAYER_COLORS[index % PLAYER_COLORS.length],
      ai: p.ai || null,
      nameIdx: p.nameIdx === undefined ? null : p.nameIdx,   // 電腦對手的名字編號（前端依語言換名字）
      score: 0,
      hits: 0,          // 射中要射的氣球次數
      badHits: 0,       // 誤射禁射氣球次數
      shots: 0,         // 總發射次數
      combo: 0,
      bestCombo: 0,
      buffUntil: 0,
      byType: byType
    };
  }

  function accuracyOf(p) { return p.shots > 0 ? p.hits / p.shots : 0; }

  /* ---------------------------------------------------------- 對局狀態 */

  /**
   * @param {{seed:string, players:Array, now:number, roundMs?:number, countdownMs?:number, pace?:string}} o
   */
  function createMatch(o) {
    var now = o.now;
    var roundMs = o.roundMs || ROUND_MS;
    var countdownMs = o.countdownMs === undefined ? COUNTDOWN_MS : o.countdownMs;
    var seed = RNG.normalizeSeed(o.seed) || RNG.randomSeed();
    var pace = paceOf(o.pace);
    var players = {};
    var order = [];
    (o.players || []).slice(0, MAX_PLAYERS).forEach(function (p, i) {
      players[String(p.id)] = newPlayer(p, i);
      order.push(String(p.id));
    });
    return {
      seed: seed,
      pace: pace.key,
      createdAt: now,
      startAt: now + countdownMs,
      endAt: now + countdownMs + roundMs,
      roundMs: roundMs,
      countdownMs: countdownMs,
      players: players,
      order: order,
      balloons: [],
      nextId: 1,
      nextSpawnAt: now + countdownMs + 300,
      spawned: 0,
      escaped: 0,
      pausedAt: 0,
      over: false,
      endedAt: 0,
      winner: null,
      draw: false
    };
  }

  function elapsed(state, now) { return clamp(now - state.startAt, 0, state.roundMs); }
  function remainMs(state, now) {
    var ref = state.pausedAt || now;
    return clamp(state.endAt - ref, 0, state.roundMs);
  }
  function phaseOf(state, now) {
    if (state.over) return 'over';
    if (state.pausedAt) return 'paused';
    if (now < state.startAt) return 'countdown';
    if (now >= state.endAt) return 'over';
    return 'playing';
  }

  function liveBalloon(state, id) {
    for (var i = 0; i < state.balloons.length; i++) {
      if (state.balloons[i].id === id) return state.balloons[i];
    }
    return null;
  }

  /* 冒出位置：挑 3 個候選，取離「剛冒出的氣球」最遠的，避免疊在一起 */
  function pickLane(state, now, rng) {
    var best = 0.5, bestGap = -1;
    for (var c = 0; c < 3; c++) {
      var lane = 0.08 + rng() * 0.84;
      var gap = 1;
      for (var i = 0; i < state.balloons.length; i++) {
        var b = state.balloons[i];
        if (now - b.spawnAt > 2200) continue;
        gap = Math.min(gap, Math.abs(b.lane - lane));
      }
      if (gap > bestGap) { bestGap = gap; best = lane; }
    }
    return best;
  }

  /**
   * 推進到 now：讓飄走的氣球離場、依節奏冒出新氣球、時間到就結算。
   * @returns {Array} events
   */
  function tick(state, now, rng) {
    var events = [];
    if (state.over || state.pausedAt) return events;
    var rand = rng || Math.random;
    var i;

    for (i = state.balloons.length - 1; i >= 0; i--) {
      var b = state.balloons[i];
      if (now >= b.expireAt) {
        state.balloons.splice(i, 1);
        state.escaped += 1;
        events.push({ k: 'escape', id: b.id, type: b.type, side: typeOf(b.type).side });
      }
    }

    if (now >= state.endAt) {
      finish(state, now);
      events.push({ k: 'end' });
      return events;
    }
    if (now < state.startAt) return events;

    /* 一個 tick 最多補 4 顆，避免分頁切回來時瞬間爆量 */
    var guard = 0;
    while (now >= state.nextSpawnAt && guard < 4) {
      guard += 1;
      var el = elapsed(state, state.nextSpawnAt);
      var st = scaleStage(stageAt(el, state.roundMs), state.pace);
      var gap = st.spawnMs + Math.round((rand() * 2 - 1) * st.jitter);
      state.nextSpawnAt += Math.max(220, gap);

      if (state.balloons.length >= st.maxUp) continue;

      var key = pickType(st.no, rand);
      var t = typeOf(key);
      var up = Math.max(1800, Math.round(t.upMs * st.upScale));
      var balloon = {
        id: state.nextId++,
        type: key,
        side: t.side,
        hp: t.hp,
        hpLeft: t.hp,
        lane: pickLane(state, now, rand),
        amp: t.amp,
        period: t.period,
        phase: rand() * Math.PI * 2,
        size: t.size,
        spawnAt: now,
        upMs: up,
        expireAt: now + up,
        stage: st.no
      };
      state.balloons.push(balloon);
      state.spawned += 1;
      events.push({ k: 'spawn', balloon: balloon });
    }
    return events;
  }

  /** 失敗結果：error 是中文原文，key 讓前端翻成目前語言（字典 srv.r.*） */
  function err(error, code, key) { return { ok: false, error: error, code: code, key: key }; }

  /**
   * 射一發。共用天空先射先得分：同一顆氣球誰先送到伺服器誰得分。
   * @param {string} playerId
   * @param {{balloonId?:number|null}} aim  沒有 balloonId 代表射到空處
   */
  function shoot(state, playerId, aim, now) {
    var p = state.players[String(playerId)];
    if (!p) return err('你不在這一局裡（可能是觀戰中）。', 'notplayer', 'srv.r.notNotPlayer');
    if (phaseOf(state, now) !== 'playing') {
      return err('現在還不能射擊。', 'phase', 'srv.r.noShoot');
    }

    p.shots += 1;

    var id = aim && Number(aim.balloonId) > 0 ? Number(aim.balloonId) : 0;
    var b = id ? liveBalloon(state, id) : null;
    /* 氣球必須「真的在天上」：已經射破、飄走、還沒升起的都算射空 */
    if (b && !(now >= b.spawnAt && now <= b.expireAt + GRACE_MS)) b = null;

    if (!b) {
      return { ok: true, event: { k: 'miss', by: p.id, id: id || null, gain: 0,
        late: !!id, x: aim && isFinite(aim.x) ? Number(aim.x) : null, y: aim && isFinite(aim.y) ? Number(aim.y) : null } };
    }

    var t = typeOf(b.type);
    var pos = balloonPos(b, now);
    b.hpLeft -= 1;
    var killed = b.hpLeft <= 0;
    var buffed = t.side === 'pop' && now < p.buffUntil;

    var sc = scoreHit({ type: b.type, combo: p.combo, killed: killed, buffed: buffed });
    p.score += sc.gain;
    p.byType[b.type] = (p.byType[b.type] || 0) + 1;

    if (t.side === 'pop') {
      p.hits += 1;
      p.combo += 1;
      if (p.combo > p.bestCombo) p.bestCombo = p.combo;
      if (t.buff && killed) p.buffUntil = now + BUFF_MS;
    } else {
      p.badHits += 1;
      p.combo = 0;
    }

    if (killed) {
      var idx = state.balloons.indexOf(b);
      if (idx >= 0) state.balloons.splice(idx, 1);
    }

    return {
      ok: true,
      event: {
        k: 'hit',
        by: p.id,
        id: b.id,
        type: b.type,
        side: t.side,
        x: pos.x, y: pos.y,
        gain: sc.gain,
        multiplier: sc.multiplier,
        buffed: buffed,
        killed: killed,
        hpLeft: Math.max(0, b.hpLeft),
        combo: p.combo,
        score: p.score,
        buffUntil: p.buffUntil
      }
    };
  }

  /* 暫停／恢復（單機）：把所有時間戳往後推，氣球位置是時間的函式，所以不會跳 */
  function pause(state, now) {
    if (state.over || state.pausedAt) return false;
    state.pausedAt = now;
    return true;
  }
  function resume(state, now) {
    if (!state.pausedAt) return false;
    var d = Math.max(0, now - state.pausedAt);
    state.pausedAt = 0;
    state.startAt += d; state.endAt += d; state.nextSpawnAt += d;
    for (var i = 0; i < state.balloons.length; i++) {
      state.balloons[i].spawnAt += d;
      state.balloons[i].expireAt += d;
    }
    for (var id in state.players) {
      if (state.players[id].buffUntil) state.players[id].buffUntil += d;
    }
    return true;
  }

  function finish(state, now) {
    state.over = true;
    state.pausedAt = 0;
    state.endedAt = now;
    state.balloons = [];
    var rank = standings(state);
    if (!rank.length) { state.winner = null; state.draw = false; return state; }
    var top = rank[0];
    var tie = rank.filter(function (r) { return r.score === top.score; });
    state.draw = tie.length > 1;
    state.winner = state.draw ? null : top.id;
    return state;
  }

  /** 同分依序比：射中數多者前、誤射少者前、最佳連擊高者前、名字。 */
  function standings(state) {
    var list = state.order.map(function (id) { return state.players[id]; }).filter(Boolean);
    list = list.slice().sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.hits !== a.hits) return b.hits - a.hits;
      if (a.badHits !== b.badHits) return a.badHits - b.badHits;
      if (b.bestCombo !== a.bestCombo) return b.bestCombo - a.bestCombo;
      return String(a.name).localeCompare(String(b.name));
    });
    var out = [];
    var rank = 0, prevScore = null;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (prevScore === null || p.score !== prevScore) { rank = i + 1; prevScore = p.score; }
      out.push({
        rank: rank, id: p.id, name: p.name, color: p.color, ai: p.ai, nameIdx: p.nameIdx,
        score: p.score, hits: p.hits, badHits: p.badHits, shots: p.shots,
        combo: p.combo, bestCombo: p.bestCombo, accuracy: accuracyOf(p),
        buffUntil: p.buffUntil, byType: p.byType
      });
    }
    return out;
  }

  /** 給 UI 的即時快照（沒有任何隱藏資訊，觀戰者拿到同一份） */
  function snapshot(state, now) {
    var ref = state.pausedAt || now;
    var el = elapsed(state, ref);
    var st = stageAt(el, state.roundMs);
    return {
      seed: state.seed,
      phase: phaseOf(state, now),
      pace: state.pace,
      startAt: state.startAt, endAt: state.endAt,
      remainMs: remainMs(state, now),
      countdownMs: Math.max(0, state.startAt - ref),
      stage: { no: st.no, label: st.label },
      balloons: state.balloons.map(function (b) {
        return {
          id: b.id, type: b.type, side: b.side, hp: b.hp, hpLeft: b.hpLeft,
          lane: b.lane, amp: b.amp, period: b.period, phase: b.phase, size: b.size,
          spawnAt: b.spawnAt, upMs: b.upMs, expireAt: b.expireAt
        };
      }),
      standings: standings(state),
      spawned: state.spawned, escaped: state.escaped,
      over: state.over, winner: state.winner, draw: state.draw
    };
  }

  function describeEvent(ev, nameOf) {
    var who = nameOf ? nameOf(ev.by) : '有人';
    if (ev.k === 'hit') {
      var t = typeOf(ev.type);
      if (t.side === 'avoid') return who + ' 誤射了' + t.label + '，' + ev.gain + ' 分！';
      if (!ev.killed) return who + ' 射中' + t.label + '（還要 ' + ev.hpLeft + ' 下）+' + ev.gain;
      return who + ' 射破' + t.label + ' +' + ev.gain + (ev.combo >= COMBO_STEP ? '（' + ev.combo + ' 連擊）' : '');
    }
    if (ev.k === 'escape') return typeOf(ev.type).label + '飄走了。';
    if (ev.k === 'miss') return who + ' 射了個空。';
    return '';
  }

  return {
    ROUND_MS: ROUND_MS, COUNTDOWN_MS: COUNTDOWN_MS,
    ROUND_SECONDS: ROUND_SECONDS, DEFAULT_ROUND_SEC: DEFAULT_ROUND_SEC,
    roundMsOf: roundMsOf, roundSecOf: roundSecOf,
    Y_START: Y_START, Y_END: Y_END, GRACE_MS: GRACE_MS,
    COMBO_STEP: COMBO_STEP, COMBO_BONUS: COMBO_BONUS, COMBO_MAX_BONUS: COMBO_MAX_BONUS,
    BUFF_MS: BUFF_MS, MAX_PLAYERS: MAX_PLAYERS,
    TYPES: TYPES, ORDER: ORDER, POP_TYPES: POP_TYPES, AVOID_TYPES: AVOID_TYPES,
    PACES: PACES, PACE_ORDER: PACE_ORDER, DEFAULT_PACE: DEFAULT_PACE, paceOf: paceOf,
    STAGES: STAGES, scaleStage: scaleStage,
    PLAYER_COLORS: PLAYER_COLORS, PLAYER_COLOR_HEX: PLAYER_COLOR_HEX,

    typeOf: typeOf, stageAt: stageAt, weightsFor: weightsFor, pickType: pickType,
    comboMultiplier: comboMultiplier, hitUnit: hitUnit, scoreHit: scoreHit,
    describeType: describeType, describeEvent: describeEvent,
    balloonPos: balloonPos, onStage: onStage, accuracyOf: accuracyOf,

    createMatch: createMatch, tick: tick, shoot: shoot, finish: finish,
    pause: pause, resume: resume,
    standings: standings, snapshot: snapshot,
    phaseOf: phaseOf, elapsed: elapsed, remainMs: remainMs,
    liveBalloon: liveBalloon
  };
}));
