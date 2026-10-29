/* ===== app.js — 畫面流程、單機主迴圈、線上房間串接 =====
 *
 * 分工：
 *   rules.js  規則與計分（前後端共用，唯一真相）
 *   ai.js     電腦射手（單機在這裡跑，線上在伺服器跑，同一份程式）
 *   stage.js  射擊場繪製與瞄準
 *   ui.js     自訂元件（按鈕、開關、滑桿、分段選單、捲動區、彈窗）
 *   online.js Socket.IO 包裝
 *   app.js    只做「把上面幾個接起來 + 使用者介面」
 *
 * 線上模式一律不自己判斷分數：畫面上的每一分都來自伺服器的事件或同步包。
 */
(function (w) {
  'use strict';

  var Rules = w.Rules, AI = w.AI, RNG = w.RNG, Art = w.Art, Stage = w.Stage, UI = w.UI;
  var Store = w.Store, Sound = w.Sound, Config = w.GameConfig, Online = w.Online;

  var $ = function (id) { return document.getElementById(id); };
  var els = function (sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); };
  var esc = UI.esc;
  var toast = function (value, ms) { UI.toast(w.I18N.message(value), ms); };

  /* ------------------------------------------------------------ 狀態 */

  var S = {
    screen: 's-home',
    mode: null,               // 'solo' | 'online'
    clientId: Store.clientId(),
    name: '',
    clockOffset: 0,           // 伺服器時間 - 本機時間
    solo: { state: null, rng: null, brains: {}, ids: [], paused: false },
    view: null,               // 最近一次 room:sync
    match: null,              // 目前快照（線上會用事件在本機補幀）
    closed: false,            // 房間已被伺服器關閉
    lastStage: 0,
    warned: false,
    unread: 0,
    raf: 0,
    lastPaint: 0,
    drewOver: false,
    joinIntent: null,
    voted: false,
    sideReturn: null,
    soloResultShown: false,
    sigs: {}
  };

  function srvNow() { return Date.now() + S.clockOffset; }
  function clockNow() { return S.mode === 'solo' ? Date.now() : srvNow(); }

  /* 只有內容真的變了才重畫，避免每次同步都把焦點與選單狀態洗掉 */
  function paintOnce(key, sig, fn) {
    if (S.sigs[key] === sig) return false;
    S.sigs[key] = sig;
    fn();
    return true;
  }


  /** Bot display names follow the interface language; human names remain untouched. */
  function playerName(player) {
    if (!player || (!player.ai && !player.level)) return player ? player.name : '';
    var index = player.nameIdx == null ? 0 : player.nameIdx;
    var name = w.I18N.t('ai.n' + index);
    return name + ' (' + w.I18N.t('pace.' + (player.ai || player.level) + '.label') + ')';
  }

  function colorHex(key) { return Rules.PLAYER_COLOR_HEX[key] || '#59B7FF'; }

  function show(id) {
    if (id === 's-home' || id === 's-solo') Online.disconnect();
    if (id === 's-lobby' && S.screen !== 's-lobby') { S.onlineCount = null; paintOnlineCount(); }
    if (w.ServerOutage) w.ServerOutage.setScreen(id);
    els('.screen').forEach(function (s) { s.classList.toggle('active', s.id === id); });
    S.screen = id;
    if (w.NetworkLatency) w.NetworkLatency.setActive(id === 's-game' && S.mode === 'online' && !!S.view && S.view.phase === 'playing');
    Sound.setTrack(id === 's-game' ? 'battle' : 'menu');
    var t = document.querySelector('.screen.active h2');
    var sa = document.querySelector('.screen.active .sa-view');
    if (sa) sa.scrollTop = 0;
    if (t && t.focus) { try { t.focus({ preventScroll: true }); } catch (e) {} }
    UI.refreshScroll(document.querySelector('.screen.active'));
  }

  /* ------------------------------------------------------------ 圖鑑 */

  function dexCard(key) {
    var t = Rules.typeOf(key);
    var pts = t.lucky ? w.I18N.t('dex.luckyPts')
      : (t.boss ? w.I18N.t('dex.bossPts', { n: Rules.hitUnit(key) })
        : (t.points > 0 ? '+' : '−') + Math.abs(t.points) + (globalThis.I18N ? globalThis.I18N.t("text.204") : " 分") + (t.hp > 1 ? (globalThis.I18N ? globalThis.I18N.t("text.203") : "・要 ") + t.hp + (globalThis.I18N ? globalThis.I18N.t("text.202") : " 下") : ''));
    return '<div class="dexcard ' + t.side + '">'
      + '<div class="pic">' + Art.balloonSvg(key, t.hp, undefined, t.hp) + '</div>'
      + '<div><div class="nm">' + esc(t.label) + '</div>'
      + '<div class="pt">' + esc(pts) + '</div>'
      + '<div class="ds">' + esc(t.hint) + '</div></div></div>';
  }

  function buildDex() {
    $('dex-pop').innerHTML = Rules.POP_TYPES.map(dexCard).join('');
    $('dex-avoid').innerHTML = Rules.AVOID_TYPES.map(dexCard).join('');
    $('dex-lucky').innerHTML = Rules.LUCKY_TYPES.map(dexCard).join('');
  }

  /* ------------------------------------------------------------ 教學（純文字） */

  var TUT = [
    { get h() { return globalThis.I18N ? globalThis.I18N.t("text.201") : "目標"; }, get t() { return globalThis.I18N ? globalThis.I18N.t("text.200") : "在時間內射破愈多氣球愈好，分數最高的人獲勝。氣球會從畫面下方的攤位後面往上飄，飄出畫面頂端就算溜走了，不會扣分。"; } },
    { get h() { return globalThis.I18N ? globalThis.I18N.t("text.199") : "怎麼射"; }, get t() { return globalThis.I18N ? globalThis.I18N.t("text.198") : "用手指或滑鼠直接點氣球就會射出一發飛鏢，按下去就發射，不用等放開。用鍵盤的話，先點一下射擊場，按方向鍵移動準星，再按空白鍵或 Enter 發射。點到空白處是射空，不會扣分，只會拉低命中率。"; } },
    { get h() { return globalThis.I18N ? globalThis.I18N.t("text.197") : "要射的氣球"; }, get t() { return globalThis.I18N ? globalThis.I18N.t("text.196") : "紅氣球最常見，小黃氣球又小又快，星星氣球左右亂晃，金色氣球分數最高但很快就飄走。雙層氣球要射 2 下，巨無霸要射 3 下，最後一發會多拿一份分數。完整清單可以到首頁的「玩法與圖鑑」查看。"; } },
    { get h() { return globalThis.I18N ? globalThis.I18N.t("text.195") : "不能射的氣球"; }, get t() { return globalThis.I18N ? globalThis.I18N.t("text.194") : "綁著白鴿的氣球、祈福天燈和炸彈氣球不能射，射到會扣分。它們身上都有一個紅色圓圈斜線的禁止標記，旁邊的標籤是紅底的負分數，要射的氣球標籤則是青綠底的正分數。"; } },
    { get h() { return globalThis.I18N ? globalThis.I18N.t("text.193") : "連擊與彩虹加倍"; }, get t() { return globalThis.I18N ? globalThis.I18N.t("text.192") : "連續射中要射的氣球，每 5 連擊分數多 10%，最多多 50%；誤射不能射的氣球，連擊就歸零。射破彩虹氣球後的 6 秒內，你射中的正分全部加倍。"; } },
    { get h() { return w.I18N.t('tut.newH'); }, get t() { return w.I18N.t('tut.newT'); } },
    { get h() { return globalThis.I18N ? globalThis.I18N.t("text.191") : "線上對戰"; }, get t() { return globalThis.I18N ? globalThis.I18N.t("text.190") : "線上最多 5 人共用同一片天空，同一顆氣球誰先射到誰得分，慢一步就會顯示「慢了一步」。局末會有結算畫面，可以選「再來一局」、「回到房間」或「回到首頁」。"; } },
    { get h() { return globalThis.I18N ? globalThis.I18N.t("text.189") : "準備好了嗎？"; }, get t() { return globalThis.I18N ? globalThis.I18N.t("text.188") : "按「立即練習」會開一局沒有電腦對手的簡單難度，可以放心試射；之後隨時能在設定裡「重看玩法教學」。"; } }
  ];
  var tutIdx = 0;

  function paintTutorial() {
    var last = tutIdx === TUT.length - 1;
    $('tut-progress').textContent = (globalThis.I18N ? globalThis.I18N.t("text.187") : "第 ") + (tutIdx + 1) + (globalThis.I18N ? globalThis.I18N.t("text.186") : " 步，共 ") + TUT.length + (globalThis.I18N ? globalThis.I18N.t("text.185") : " 步");
    $('tut-head').textContent = TUT[tutIdx].h;
    $('tut-text').textContent = TUT[tutIdx].t;
    $('b-tut-prev').disabled = tutIdx === 0;
    $('b-tut-skip').hidden = last;
    var next = $('b-tut-next');
    next.querySelector('span').textContent = last ? (globalThis.I18N ? globalThis.I18N.t("text.184") : "立即練習") : (globalThis.I18N ? globalThis.I18N.t("text.183") : "下一步");
  }

  function openTutorial() {
    tutIdx = 0;
    paintTutorial();
    UI.openModal('tutorial-modal', { focus: '#b-tut-next' });
  }

  function closeTutorial() {
    Store.tutorialDone(true);
    UI.closeModal('tutorial-modal');
  }

  /* ------------------------------------------------------------ 設定 */

  var sliders = {};
  var pendingConfirm = null;

  function syncSettingsUi() {
    UI.setSwitch($('set-music'), Sound.isMusicOn());
    UI.setSwitch($('set-sfx'), Sound.isSfxOn());
    UI.setSwitch($('set-chatcue'), Sound.isChatCueOn());
    UI.setSwitch($('set-haptic'), Sound.isHapticOn());
    UI.setSwitch($('set-motion'), Store.reduceMotion());
    UI.setSwitch($('set-mark'), Store.bigTag());
    UI.setSwitch($('set-cursor'), Store.cursor());
    sliders.music.set(Math.round(Sound.getMusicVolume() * 100));
    sliders.sfx.set(Math.round(Sound.getSfxVolume() * 100));
    $('set-audio-note').textContent = Sound.isUnlocked()
      ? '' : (globalThis.I18N ? globalThis.I18N.t("text.182") : "瀏覽器規定要先碰一下畫面才會出聲，按任何一顆按鈕就會解鎖。");
  }

  function applyDisplayPrefs() {
    document.body.classList.toggle('reduce-motion', Store.reduceMotion());
    Stage.setOptions({ reduceMotion: Store.reduceMotion(), bigTag: Store.bigTag(), cursor: Store.cursor() });
  }

  function askConfirm(title, message, onConfirm, okLabel) {
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('b-confirm-ok').querySelector('span').textContent = okLabel || (globalThis.I18N ? globalThis.I18N.t("text.181") : "確定");
    pendingConfirm = onConfirm;
    UI.openModal('confirm-modal', { focus: '#b-confirm-cancel' });
  }

  /* ============================================================
   * 射擊事件的共同處理（單機、線上都走這裡）
   * ============================================================ */

  function rowOf(id) {
    if (!S.match) return null;
    for (var i = 0; i < S.match.standings.length; i++) if (S.match.standings[i].id === id) return S.match.standings[i];
    return null;
  }
  function nameOfId(id) { var r = rowOf(id); return r ? r.name : ''; }
  function colorOfId(id) { var r = rowOf(id); return r ? colorHex(r.color) : null; }
  function meId() { return S.mode === 'solo' ? 'me' : (S.view && S.view.you ? S.view.you.id : null); }

  function say(text) { $('live-say').textContent = text; }

  function handleEvents(events) {
    var tr = w.I18N.t;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var mine = !!ev.by && ev.by === meId();

      if (ev.k === 'go') { Sound.play('start'); Stage.shout((globalThis.I18N ? globalThis.I18N.t("text.180") : "開始！"), 'go'); continue; }
      if (ev.k === 'spawn') {
        if (ev.balloon && ev.balloon.type === 'boss') {
          Sound.play('stage');
          Stage.shout(tr('boss.appear'), 'boss', 1500);
          say(tr('boss.appear'));
        }
        continue;
      }
      if (ev.k === 'escape') {
        if (ev.type === 'boss') { Stage.shout(tr('boss.escaped'), 'bosslost', 1300); say(tr('boss.escaped')); continue; }
        if (ev.side === 'pop') Sound.play('escape');
        continue;
      }
      if (ev.k === 'miss') {
        Stage.effect(ev, { mine: mine });
        if (mine) { Sound.play('whiff'); say(ev.late ? (globalThis.I18N ? globalThis.I18N.t("text.179") : "慢了一步，氣球已經被射破了。") : (globalThis.I18N ? globalThis.I18N.t("text.178") : "射空了。")); }
        continue;
      }
      if (ev.k === 'hit') {
        Stage.effect(ev, { who: mine ? '' : nameOfId(ev.by), color: colorOfId(ev.by), mine: mine });
        var t = Rules.typeOf(ev.type);
        if (mine) {
          if (t.lucky) say(tr('say.lucky', { n: (ev.gain > 0 ? '+' : '') + ev.gain }));
          else if (t.boss) { if (ev.killed) say(tr('boss.killed')); }
          else say(Rules.describeEvent(ev, function () { return (globalThis.I18N ? globalThis.I18N.t("text.177") : "你"); }));
        }
        if (ev.bad) {
          if (mine) { Sound.play('oops'); Sound.vibrate([30, 40, 30]); }
        } else if (!ev.killed) {
          if (mine) { Sound.play('bonk'); Sound.vibrate(12); }
        } else if (mine) {
          if (ev.type === 'golden' || ev.type === 'rainbow' || (t.lucky && ev.gain >= 70)) { Sound.play('shiny'); Sound.vibrate([12, 30, 18]); }
          else { Sound.play(t.hp > 1 ? 'smash' : 'pop'); Sound.vibrate(t.hp > 1 ? [14, 24, 20] : 12); }
          if (ev.type === 'rainbow') { Sound.play('buff', 0.15); Stage.shout((globalThis.I18N ? globalThis.I18N.t("text.176") : "分數加倍 6 秒！"), 'buff', 1100); }
        }
        if (ev.bossReward) {
          /* Boss 被擊破：全場都看得到，自己有分到獎勵就一起寫在畫面中央 */
          var my = null;
          for (var k = 0; k < ev.bossReward.length; k++) if (ev.bossReward[k].id === meId()) my = ev.bossReward[k];
          Sound.play('shiny'); Sound.vibrate([20, 40, 20, 40, 30]);
          Stage.shout(tr('boss.killed') + (my ? '\n' + tr('boss.reward', { n: my.gain }) : ''), 'boss', 1800);
          say(tr('boss.killed') + (my ? ' ' + tr('boss.reward', { n: my.gain }) : ''));
        }
        if (mine) {
          if (ev.bad || !ev.combo) Stage.comboHide();
          else Stage.combo(ev.combo, Rules.comboMultiplier(ev.combo));
          if (!ev.bad && ev.combo && ev.combo % Rules.COMBO_STEP === 0) Sound.play('combo');
        }
      }
    }
  }

  /* 線上：用事件在本機把畫面補到下一次同步之前（不自己算分，分數只信伺服器） */
  function applyEventToSnap(snap, ev) {
    if (!snap) return;
    var i;
    if (ev.k === 'spawn') {
      for (i = 0; i < snap.balloons.length; i++) if (snap.balloons[i].id === ev.balloon.id) return;
      snap.balloons.push(ev.balloon);
      if (ev.balloon.type === 'boss') snap.bossState = 'live';
      return;
    }
    if (ev.k === 'escape') {
      snap.balloons = snap.balloons.filter(function (b) { return b.id !== ev.id; });
      if (ev.type === 'boss') snap.bossState = 'escaped';
      return;
    }
    if (ev.k === 'hit') {
      if (ev.killed) snap.balloons = snap.balloons.filter(function (b) { return b.id !== ev.id; });
      else for (i = 0; i < snap.balloons.length; i++) if (snap.balloons[i].id === ev.id) snap.balloons[i].hpLeft = ev.hpLeft;
      if (ev.type === 'boss' && ev.killed) snap.bossState = 'killed';
      for (i = 0; i < snap.standings.length; i++) {
        var r = snap.standings[i];
        if (r.id !== ev.by) {
          /* Boss 擊破的獎勵：沒補最後一下的貢獻者也要加分 */
          if (ev.bossReward) ev.bossReward.forEach(function (rw) { if (rw.id === r.id) r.score += rw.gain; });
          continue;
        }
        r.score = ev.score; r.combo = ev.combo; r.buffUntil = ev.buffUntil; r.shots += 1;
        if (ev.bad) r.badHits += 1; else r.hits += 1;
        if (ev.combo > r.bestCombo) r.bestCombo = ev.combo;
        r.accuracy = r.shots ? r.hits / r.shots : 0;
      }
      snap.standings.sort(function (a, b) { return b.score - a.score || b.hits - a.hits; });
      for (i = 0; i < snap.standings.length; i++) snap.standings[i].rank = i + 1;
      return;
    }
    if (ev.k === 'miss') {
      for (i = 0; i < snap.standings.length; i++) {
        if (snap.standings[i].id === ev.by) {
          snap.standings[i].shots += 1;
          snap.standings[i].accuracy = snap.standings[i].hits / snap.standings[i].shots;
        }
      }
    }
  }

  function pruneExpired(snap, now) {
    if (!snap) return;
    snap.balloons = snap.balloons.filter(function (b) { return now < b.expireAt + Rules.GRACE_MS; });
  }

  /* ============================================================
   * 單機模式
   * ============================================================ */

  function localGameSettings() {
    var rawRoundSec = Number(Store.roundSec());
    return {
      pace: Rules.paceOf(Store.pace()).key,
      roundSec: Rules.ROUND_SECONDS.indexOf(rawRoundSec) >= 0 ? rawRoundSec : null
    };
  }

  function startSolo(opts) {
    opts = opts || {};
    var settings = localGameSettings();
    var level = opts.pace || settings.pace;
    var count = opts.aiCount !== undefined ? opts.aiCount : (Number(Store.aiCount()) || 0);
    var seed = RNG.randomSeed();
    var now = Date.now();

    var roster = [{ id: 'me', name: S.name || (globalThis.I18N ? globalThis.I18N.t("text.016") : "我") }];
    S.solo.brains = {};
    S.solo.ids = ['me'];
    for (var i = 0; i < count; i++) {
      var id = 'ai:' + i;
      roster.push({ id: id, name: AI.aiName(level, i), ai: level, nameIdx: i });
      S.solo.brains[id] = AI.createBrain(level, 'solo:' + seed + ':' + i);
      S.solo.ids.push(id);
    }

    S.mode = 'solo';
    S.closed = false;
    S.clockOffset = 0;
    S.view = null;
    S.solo.paused = false;
    S.solo.pace = level;
    S.solo.state = Rules.createMatch({ seed: seed, players: roster, now: now, pace: level,
      roundMs: Rules.roundMsOf(settings.roundSec) });
    S.solo.rng = RNG.createRng('spawn:solo:' + seed);
    S.match = Rules.snapshot(S.solo.state, now);
    GameAnalytics.start({ mode: 'solo', difficulty: level, players: roster.length });
    S.lastStage = 0; S.warned = false;

    enterGameScreen();
  }

  function soloStep(now) {
    var st = S.solo.state;
    if (!st) return;
    if (!st.pausedAt) {
      var events = Rules.tick(st, now, S.solo.rng);
      if (!st.over && now >= st.startAt) {
        var snap = Rules.snapshot(st, now);
        for (var i = 0; i < S.solo.ids.length; i++) {
          var id = S.solo.ids[i];
          var brain = S.solo.brains[id];
          if (!brain) continue;
          var aim = brain.step(snap, now);
          if (!aim) continue;
          var res = Rules.shoot(st, id, aim, now);
          if (res.ok) { events.push(res.event); if (res.extra) events = events.concat(res.extra); }
        }
      }
      S.match = Rules.snapshot(st, now);
      if (events.length) handleEvents(events);
    }
    if (st.over && !S.soloResultShown) { S.soloResultShown = true; onSoloOver(); }
  }

  /* 一局結束：存最高分／累計／最近對局，並判定這局解鎖的成就（只存在本機） */
  function recordMatch(mode, m, row, outcome) {
    var prev = Store.best();
    var newBest = (prev.score || 0) > 0 && row.score > prev.score;
    Store.best({ score: row.score, combo: row.bestCombo, accuracy: row.accuracy });
    var paceKey = Rules.paceOf(m.pace).key;
    Store.setBestPace(paceKey, row.score);
    var totals = Store.addTotals(row);
    var fresh = Store.unlock(w.Achievements.evaluate(row, { outcome: outcome, players: m.standings.length, games: totals.games }));
    Store.addRecord({
      t: Date.now(), mode: mode, pace: paceKey, players: m.standings.length, rank: row.rank, outcome: outcome,
      score: row.score, hits: row.hits, bad: row.badHits, acc: Math.round((row.accuracy || 0) * 100), combo: row.bestCombo
    });
    S.lastRecord = { newBest: newBest, fresh: fresh };
  }

  /* ---- 結算：我的成績卡（命中率圓環、四格數字、射破的氣球、Boss、新紀錄與新成就） ---- */
  function ringSvg(pct) {
    var c = 2 * Math.PI * 26;
    return '<svg class="accring" viewBox="0 0 64 64" aria-hidden="true" focusable="false">'
      + '<circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,241,214,.18)" stroke-width="8"/>'
      + '<circle cx="32" cy="32" r="26" fill="none" stroke="#5BF0C8" stroke-width="8" stroke-linecap="round" transform="rotate(-90 32 32)" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - pct)).toFixed(1) + '"/></svg>';
  }

  function resultStatsHtml(m, me) {
    var tr = w.I18N.t;
    var row = null;
    for (var i = 0; i < m.standings.length; i++) if (m.standings[i].id === me) row = m.standings[i];
    var html = '';
    if (m.bossState === 'killed' || m.bossState === 'escaped') {
      html += '<div class="resboss ' + m.bossState + '"><span class="rb-ico">' + Art.balloonSvg('boss', m.bossState === 'killed' ? 1 : 12, undefined, 12) + '</span><span>'
        + esc(tr(m.bossState === 'killed' ? 'res.bossKilled' : 'res.bossEscaped'))
        + (row && row.bossHits ? '<small>' + esc(tr('res.bossShare', { n: row.bossHits })) + '</small>' : '') + '</span></div>';
    }
    if (!row) return html;
    var acc = row.accuracy || 0;
    html += '<div class="mycard"><div class="myring">' + ringSvg(acc) + '<b>' + Math.round(acc * 100) + '<small>%</small></b><span>' + esc(tr('res.acc')) + '</span></div>'
      + '<div class="myfacts">'
      + '<div><b>' + row.score + '</b><span>' + esc(tr('res.score')) + '</span></div>'
      + '<div><b>' + row.hits + '</b><span>' + esc(tr('res.hits')) + '</span></div>'
      + '<div><b>' + row.badHits + '</b><span>' + esc(tr('res.bad')) + '</span></div>'
      + '<div><b>' + row.bestCombo + '</b><span>' + esc(tr('res.combo')) + '</span></div></div></div>';

    var chips = '';
    Rules.ORDER.forEach(function (k) {
      var n = row.byType && row.byType[k];
      if (!n) return;
      var t = Rules.typeOf(k);
      chips += '<span class="popchip ' + t.side + '" title="' + esc(t.label) + '"><span class="pc-pic">' + Art.balloonSvg(k, t.hp, undefined, t.hp) + '</span><b>×' + n + '</b><span class="pc-nm">' + esc(t.label) + '</span></span>';
    });
    html += '<div class="poplist"><span class="pl-title">' + esc(tr('res.popped')) + '</span>'
      + (chips ? '<div class="pl-chips">' + chips + '</div>' : '<p class="pl-none">' + esc(tr('res.noPop')) + '</p>') + '</div>';

    var rec = S.lastRecord;
    if (rec && (rec.newBest || rec.fresh.length)) {
      html += '<div class="newrec">';
      if (rec.newBest) html += '<span class="nr-best">' + esc(tr('res.newBest')) + '</span>';
      rec.fresh.forEach(function (id) {
        var a = w.Achievements.byId(id);
        if (!a) return;
        html += '<span class="nr-ach"><span class="nr-pic">' + Art.badge(a.glyph, a.tier, true) + '</span><span><small>' + esc(tr('res.newAch')) + '</small>' + esc(tr('ach.' + id + '.name')) + '</span></span>';
      });
      html += '</div>';
    }
    return html;
  }

  function onSoloOver() {
    var rank = S.match.standings;
    var me = rank.filter(function (r) { return r.id === 'me'; })[0];
    var outcome = 'draw';
    if (me) {
      if (S.match.draw && me.rank === 1) outcome = 'draw';
      else if (rank.length === 1) outcome = 'win';
      else outcome = me.rank === 1 ? 'win' : 'lose';
      Store.recordResult('solo', outcome);
      recordMatch('solo', S.match, me, outcome);
    }
    Sound.play(outcome === 'lose' ? 'lose' : 'win');
    showResult();
  }

  function pauseSolo() {
    var st = S.solo.state;
    if (S.mode !== 'solo' || !st || st.over || st.pausedAt) return;
    if (Rules.phaseOf(st, Date.now()) !== 'playing') return;
    Rules.pause(st, Date.now());
    S.solo.paused = true;
    $('ov-pause').hidden = false;
    syncBlocking();
    $('b-resume').focus();
    UI.refreshScroll($('ov-pause'));
  }

  function resumeSolo() {
    var st = S.solo.state;
    if (S.mode !== 'solo' || !st || !st.pausedAt) return;
    Rules.resume(st, Date.now());
    S.solo.paused = false;
    $('ov-pause').hidden = true;
    syncBlocking();
    try { $('field').focus({ preventScroll: true }); } catch (e) {}
  }

  /* ============================================================
   * 對戰畫面：HUD、左側摘要、浮層
   * ============================================================ */

  function enterGameScreen() {
    document.body.classList.remove('playing');
    S.soloResultShown = false;
    S.lastRecord = null;
    S.voted = false;
    lastChatId = 0;
    S.unread = 0;
    $('chat-input').disabled = false; $('b-chat-send').disabled = false;
    chatState('');
    $('ov-result').hidden = true;
    $('ov-wait').hidden = true;
    $('ov-pause').hidden = true;
    $('ov-closed').hidden = true;
    syncBlocking();
    Stage.clear();
    applyDisplayPrefs();
    var online = S.mode === 'online';
    $('side-chat').hidden = !online;
    $('b-open-chat').hidden = !online;
    $('b-pause').hidden = online;
    var wide = !isNarrow();
    $('game-shell').classList.toggle('side-collapsed', wide && !Store.sideOpen());
    $('b-side-toggle').setAttribute('aria-expanded', String(!(wide && !Store.sideOpen())));
    closeSide(true);
    S.sigs = {};
    show('s-game');
    Stage.measure();
    startLoop();
    refreshAll();
  }

  function leaveGame() {
    document.body.classList.remove('playing');
    stopLoop();
    if (S.mode === 'online' && S.view && !S.closed) Online.send('room:leave', {});
    S.mode = null; S.solo.state = null; S.match = null; S.view = null; S.closed = false;
    Stage.clear();
    if (w.NetworkLatency) w.NetworkLatency.setActive(false);
    show('s-home');
  }

  function startLoop() {
    if (S.raf) return;
    var tick = function () {
      S.raf = w.requestAnimationFrame(tick);
      var now = clockNow();
      if (S.mode === 'solo') soloStep(Date.now());
      else pruneExpired(S.match, now);
      if (S.match && !S.closed) {
        /* 結算之後天空是空的，補畫最後一幀就停，之後不必每幀重畫（省電） */
        var still = S.match.phase === 'over';
        if (!still || !S.drewOver) {
          var drawAt = (S.mode === 'solo' && S.solo.state && S.solo.state.pausedAt) ? S.solo.state.pausedAt : now;
          Stage.draw(S.match, drawAt);
          S.drewOver = still;
        }
      }
      if (now - S.lastPaint > 80) { S.lastPaint = now; paintHud(); paintSummary(); paintPlayingFlag(); }
    };
    S.raf = w.requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (S.raf) w.cancelAnimationFrame(S.raf);
    S.raf = 0;
  }

  function myRow() { return rowOf(meId()); }

  function paintIdleHud() {
    var v = S.view;
    var sec = v && v.roundSec ? v.roundSec : Rules.roundSecOf(Store.roundSec());
    $('hud-clock').textContent = sec;
    $('hud-time').classList.remove('low');
    $('hud-stage').textContent = (globalThis.I18N ? globalThis.I18N.t("text.161") : "準備中");
    $('hud-stage').className = 'hud-stage';
    $('hud-score').textContent = '0';
    $('hud-combo').hidden = true;
    $('hud-buff').hidden = true;
    $('timebar-fill').style.width = '100%';
    $('timebar-fill').className = '';
    $('countdown').hidden = true;
  }

  function paintHud() {
    var m = S.match;
    if (!m) { paintIdleHud(); return; }
    var now = clockNow();
    var ref = (S.mode === 'solo' && S.solo.state && S.solo.state.pausedAt) ? S.solo.state.pausedAt : now;
    var over = m.phase === 'over';
    var remain = over ? 0 : (m.phase === 'playing' || m.phase === 'paused'
      ? Math.max(0, m.endAt - ref) : Math.max(0, m.endAt - m.startAt));
    var sec = Math.ceil(remain / 1000);
    var clock = $('hud-clock');
    if (clock.textContent !== String(sec)) clock.textContent = sec;
    $('hud-time').classList.toggle('low', m.phase === 'playing' && sec <= 10);
    if (m.phase === 'playing' && sec <= 10 && !S.warned) { S.warned = true; Sound.play('warn'); }

    var st = $('hud-stage');
    st.innerHTML = over ? (globalThis.I18N ? globalThis.I18N.t("text.115") : "時間到")
      : (m.phase === 'paused' ? (globalThis.I18N ? globalThis.I18N.t("text.163") : "暫停中") : (globalThis.I18N ? globalThis.I18N.t("text.174") : "<span class=\"stage-no\">第 ") + m.stage.no + (globalThis.I18N ? globalThis.I18N.t("text.173") : " 階段・</span>") + esc(w.I18N.t('stage.' + m.stage.no)));
    st.className = 'hud-stage' + (!over && m.stage.no > 1 ? ' s' + m.stage.no : '');
    if (m.phase === 'playing' && m.stage.no !== S.lastStage) {
      if (S.lastStage) { Sound.play('stage'); Stage.shout(w.I18N.t('stage.' + m.stage.no) + (globalThis.I18N ? globalThis.I18N.t("text.172") : "！氣球變快了"), 'stage', 1100); }
      S.lastStage = m.stage.no;
    }

    var fill = $('timebar-fill');
    fill.style.width = (remain / Math.max(1, m.endAt - m.startAt) * 100).toFixed(1) + '%';
    fill.className = m.stage.no > 1 ? 's' + m.stage.no : '';

    var me = myRow();
    /* 觀戰者沒有自己的分數，不顯示「我的分數」 */
    $('hud-score-box').hidden = S.mode === 'online' && !!S.view && S.view.you.role !== 'player';
    $('hud-score').textContent = me ? me.score : 0;
    var cb = $('hud-combo');
    if (!over && me && me.combo >= 2) { cb.hidden = false; $('hud-combo-n').textContent = me.combo; }
    else cb.hidden = true;

    var cd = $('countdown');
    if (m.phase === 'countdown') {
      var n = Math.max(1, Math.ceil(Math.max(0, m.startAt - now) / 1000));
      cd.hidden = false;
      if (cd.textContent !== String(n)) { cd.textContent = n; Sound.play('count'); }
    } else if (!cd.hidden) {
      cd.hidden = true;
    }

    $('b-pause').disabled = !(S.mode === 'solo' && m.phase === 'playing');
  }

  function roleLabel(you) {
    return you.role === 'player' ? (globalThis.I18N ? globalThis.I18N.t("text.002") : "玩家") : (you.role === 'spectator' ? (globalThis.I18N ? globalThis.I18N.t("text.044") : "觀戰") : (globalThis.I18N ? globalThis.I18N.t("text.171") : "訪客"));
  }

  function connText() {
    if (S.mode !== 'online') return '';
    var st = Online.status();
    if (st.status === 'connected') return (globalThis.I18N ? globalThis.I18N.t("text.170") : "連線正常");
    if (st.status === 'idle') return (globalThis.I18N ? globalThis.I18N.t("text.090") : "尚未連線");
    return (globalThis.I18N ? globalThis.I18N.t("text.169") : "連線中斷，重新連線中…");
  }

  function paintSumState(phase) {
    var el = $('sum-state');
    var cls = 'sum-state', text = '';
    if (S.mode === 'online') {
      var v = S.view;
      var spectator = v && v.you.role !== 'player';
      var net = Online.status().status;
      if (net !== 'connected') { text = (globalThis.I18N ? globalThis.I18N.t("text.168") : "連線中斷，重新連線中"); }
      else if (spectator) { cls += ' watch'; text = (globalThis.I18N ? globalThis.I18N.t("text.167") : "觀戰中・看得到完整天空，不能射擊"); }
      else if (phase === 'playing') { cls += ' you'; text = (globalThis.I18N ? globalThis.I18N.t("text.165") : "輪到你：點氣球射擊"); }
      else if (phase === 'countdown') text = (globalThis.I18N ? globalThis.I18N.t("text.164") : "倒數中，準備射擊");
      else if (phase === 'over') text = (globalThis.I18N ? globalThis.I18N.t("text.162") : "這一局結束了");
      else text = (globalThis.I18N ? globalThis.I18N.t("text.166") : "等待房主開始");
    } else {
      if (phase === 'playing') { cls += ' you'; text = (globalThis.I18N ? globalThis.I18N.t("text.165") : "輪到你：點氣球射擊"); }
      else if (phase === 'countdown') text = (globalThis.I18N ? globalThis.I18N.t("text.164") : "倒數中，準備射擊");
      else if (phase === 'paused') text = (globalThis.I18N ? globalThis.I18N.t("text.163") : "暫停中");
      else if (phase === 'over') text = (globalThis.I18N ? globalThis.I18N.t("text.162") : "這一局結束了");
      else text = (globalThis.I18N ? globalThis.I18N.t("text.161") : "準備中");
    }
    el.className = cls;
    if (el.textContent !== text) el.textContent = text;
  }

  function paintSummary() {
    var m = S.match;
    var phase = m ? m.phase : (S.view ? S.view.phase : 'lobby');
    paintSumState(phase);
    $('sum-goal').textContent = (globalThis.I18N ? globalThis.I18N.t("text.160") : "目標：在時間內射破最多氣球，分數最高的獲勝。");
    $('sum-how').textContent = (globalThis.I18N ? globalThis.I18N.t("text.159") : "點氣球射擊（鍵盤：方向鍵＋空白鍵）。不能射：白鴿氣球、祈福天燈、炸彈氣球。");

    var room = $('sum-room');
    var me = meId();
    if (S.mode === 'online' && S.view) {
      var you = S.view.you;
      room.innerHTML = (globalThis.I18N ? globalThis.I18N.t("text.158") : "房號 <b>") + esc(S.view.code) + '</b>・' + roleLabel(you) + (you.host ? (globalThis.I18N ? globalThis.I18N.t("text.157") : "・房主") : '')
        + '・' + (S.view.seats - S.view.seatsFree) + '/' + S.view.seats + (globalThis.I18N ? globalThis.I18N.t("text.156") : " 人・") + esc(connText());
    } else if (S.mode === 'solo') {
      room.textContent = (globalThis.I18N ? globalThis.I18N.t("text.155") : "單機・") + Rules.paceOf(S.solo.pace).label + (globalThis.I18N ? globalThis.I18N.t("text.154") : "・電腦對手 ") + (S.solo.ids.length - 1) + (globalThis.I18N ? globalThis.I18N.t("text.153") : " 位");
    } else room.textContent = '';

    var rows = [];
    if (m) {
      rows = m.standings.map(function (p) {
        return { no: p.rank, name: playerName(p), hex: colorHex(p.color), me: p.id === me,
          sc: p.score, get sub() { return p.combo >= 2 ? p.combo + (globalThis.I18N ? globalThis.I18N.t("text.152") : " 連") : ''; } };
      });
    } else if (S.view) {
      var v = S.view;
      v.members.filter(function (mm) { return mm.role === 'player'; }).forEach(function (mm, i) {
        rows.push({ no: i + 1, name: mm.name, hex: colorHex(Rules.PLAYER_COLORS[i % 5]), me: mm.id === v.you.id,
          sc: null, get sub() { return mm.connected === false ? (globalThis.I18N ? globalThis.I18N.t("text.151") : "斷線") : (mm.ready ? (globalThis.I18N ? globalThis.I18N.t("text.139") : "準備好") : (globalThis.I18N ? globalThis.I18N.t("text.138") : "還沒準備")); } });
      });
      (v.ai || []).forEach(function (a) { rows.push({ no: '•', name: playerName(a), hex: '#B9B2D6', sc: null, get sub() { return globalThis.I18N ? globalThis.I18N.t("text.150") : "電腦"; } }); });
      v.members.filter(function (mm) { return mm.role === 'spectator'; }).forEach(function (mm) {
        rows.push({ no: '•', name: mm.name, hex: '#B9B2D6', me: mm.id === v.you.id, sc: null, get sub() { return globalThis.I18N ? globalThis.I18N.t("text.044") : "觀戰"; } });
      });
    }
    var html = rows.map(function (r) {
      return '<li class="rankrow' + (r.me ? ' me' : '') + '" style="--who:' + r.hex + '">'
        + '<span class="no">' + r.no + '</span><span class="nm">' + esc(r.name) + '</span>'
        + '<span class="sc">' + (r.sc === null ? '' : r.sc) + (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + '</span></li>';
    }).join('');
    paintOnce('rank', html, function () { $('rank-list').innerHTML = html; });

    var lb = $('live-bar');
    var showLive = m && (m.standings.length > 1 || !m.standings.some(function (p) { return p.id === me; }));
    var lbHtml = showLive ? m.standings.slice(0, 5).map(function (p) {
      return '<span class="lchip' + (p.id === me ? ' me' : '') + '" style="--who:' + colorHex(p.color) + '">'
        + '<b>' + p.rank + '</b><span class="ln">' + esc(playerName(p)) + '</span><i>' + p.score + '</i></span>';
    }).join('') : '';
    paintOnce('live', lbHtml, function () { lb.innerHTML = lbHtml; });

    var r = myRow();
    var ais = S.mode === 'solo' ? S.solo.ids.length - 1 : (S.view ? (S.view.ai || []).length : 0);
    var stat;
    if (r) {
      stat = (globalThis.I18N ? globalThis.I18N.t("text.149") : "命中 ") + r.hits + (globalThis.I18N ? globalThis.I18N.t("text.112") : "・誤射 ") + r.badHits + (globalThis.I18N ? globalThis.I18N.t("text.148") : "・準度 ") + Math.round((r.accuracy || 0) * 100) + '%'
        + (r.bestCombo >= 2 ? (globalThis.I18N ? globalThis.I18N.t("text.111") : "・最佳連擊 ") + r.bestCombo : '');
    } else if (S.view && !m) {
      stat = (globalThis.I18N ? globalThis.I18N.t("text.132") : "一局 ") + S.view.roundSec + (globalThis.I18N ? globalThis.I18N.t("text.131") : " 秒・難度「") + Rules.paceOf(S.view.pace).label + '」';
    } else stat = (globalThis.I18N ? globalThis.I18N.t("text.147") : "觀戰中，看得到完整天空");
    if (ais && m && m.phase === 'playing') stat += (globalThis.I18N ? globalThis.I18N.t("text.146") : "・電腦對手出手中");
    var ms = $('my-stat');
    if (ms.textContent !== stat) ms.textContent = stat;

    var buffLeft = m && m.phase === 'playing' && r && r.buffUntil ? Math.max(0, r.buffUntil - clockNow()) : 0;
    $('hud-buff').hidden = buffLeft <= 0;
    if (buffLeft > 0) $('hud-buff').textContent = (globalThis.I18N ? globalThis.I18N.t("text.145") : "加倍中 ") + Math.ceil(buffLeft / 1000) + 's';

    paintSideActions();
  }

  function paintSideActions() {
    var html = '';
    if (S.mode === 'online' && S.view && !S.closed) {
      var can = S.view.you.can || {};
      if (can.invite) html += (globalThis.I18N ? globalThis.I18N.t("text.144") : "<button class=\"tk tk-sm\" data-tone=\"sky\" data-act=\"invite\" type=\"button\" data-icon=\"link\"><span>邀請</span></button>");
      if (can.sit) html += (globalThis.I18N ? globalThis.I18N.t("text.097") : "<button class=\"tk tk-sm\" data-tone=\"teal\" data-act=\"sit\" type=\"button\"><span>下場對戰</span></button>");
      if (can.stand) html += (globalThis.I18N ? globalThis.I18N.t("text.096") : "<button class=\"tk tk-sm\" data-tone=\"paper\" data-act=\"stand\" type=\"button\"><span>改成觀戰</span></button>");
    }
    html += (globalThis.I18N ? globalThis.I18N.t("text.143") : "<button class=\"tk tk-sm\" data-tone=\"paper\" data-act=\"quit\" type=\"button\" data-icon=\"door\"><span>離開</span></button>");
    paintOnce('sideactions', html, function () {
      $('side-actions').innerHTML = html;
      UI.decorate($('side-actions'));
    });
  }

  /* ---- 等待浮層（線上準備階段） ---- */

  function paintWaitOverlay() {
    var v = S.view;
    if (S.mode !== 'online' || !v || S.closed) { $('ov-wait').hidden = true; return; }
    var waiting = v.phase === 'lobby';
    $('ov-wait').hidden = !waiting;
    if (!waiting) return;

    $('ov-wait-title').textContent = (globalThis.I18N ? globalThis.I18N.t("text.142") : "準備開始・房號 ") + v.code;
    var can = v.you.can || {};
    var sig = JSON.stringify([v.members.map(function (m) { return [m.id, m.name, m.role, m.ready, m.connected, m.host]; }),
      v.ai, v.seatsFree, v.roundSec, v.pace, can, v.you.ready, v.you.role, v.you.startBlockedBy, v.code]);
    paintOnce('wait', sig, function () {
      var seats = [];
      v.members.filter(function (m) { return m.role === 'player'; }).forEach(function (m, i) {
        seats.push('<div class="seatrow" style="--who:' + colorHex(Rules.PLAYER_COLORS[i % 5]) + '">'
          + '<span class="nm">' + esc(m.name) + (m.id === v.you.id ? (globalThis.I18N ? globalThis.I18N.t("text.114") : "（你）") : '') + '</span>'
          + (m.host ? (globalThis.I18N ? globalThis.I18N.t("text.141") : "<span class=\"tag host\">房主</span>") : '')
          + (m.connected ? '' : (globalThis.I18N ? globalThis.I18N.t("text.140") : "<span class=\"tag off\">斷線</span>"))
          + '<span class="tag' + (m.ready ? ' ready' : '') + '">' + (m.ready ? (globalThis.I18N ? globalThis.I18N.t("text.139") : "準備好") : (globalThis.I18N ? globalThis.I18N.t("text.138") : "還沒準備")) + '</span></div>');
      });
      v.ai.forEach(function (a) {
        seats.push('<div class="seatrow" style="--who:#B9B2D6"><span class="nm">' + esc(playerName(a)) + (globalThis.I18N ? globalThis.I18N.t("text.137") : "</span><span class=\"tag ai\">電腦</span>")
          + (can.manageAi ? '<button class="x" type="button" data-rmai="' + esc(a.id) + (globalThis.I18N ? globalThis.I18N.t("text.136") : "\" aria-label=\"移除 ") + esc(playerName(a)) + '">' + UI.icon('close') + '</button>' : '')
          + '</div>');
      });
      var specs = v.members.filter(function (m) { return m.role === 'spectator'; });
      if (specs.length) {
        seats.push((globalThis.I18N ? globalThis.I18N.t("text.135") : "<div class=\"seatrow\"><span class=\"nm\">觀戰 ") + specs.length + (globalThis.I18N ? globalThis.I18N.t("text.134") : " 人：")
          + esc(specs.map(function (m) { return m.name; }).join('、')) + '</span></div>');
      }
      $('seat-list').innerHTML = seats.join('');

      $('ai-manage').hidden = !can.manageAi;
      if (can.manageAi) {
        UI.seg($('ai-add'), AI.ORDER.map(function (k) {
          return { value: k, label: AI.levelOf(k).label, get sub() { return globalThis.I18N ? globalThis.I18N.t("text.133") : "＋電腦"; }, disabled: v.seatsFree <= 0 };
        }), null, function (k) { Online.send('room:addAi', { level: k }); }, { mode: 'action' });
      }
      $('round-manage').hidden = !can.setRound;
      if (can.setRound) {
        UI.seg($('round-pick'), (v.rounds || []).map(function (sec) { return { value: sec, get label() { return sec + (globalThis.I18N ? globalThis.I18N.t("text.028") : " 秒"); } }; }),
          v.roundSec, function (sec) { Sound.play('tick'); Online.send('room:setRound', { roundSec: Number(sec) }); });
      }
      $('pace-manage').hidden = !can.setPace;
      if (can.setPace) {
        UI.seg($('pace-pick'), (v.paces || []).map(function (P) { return { value: P.key, label: P.label }; }),
          v.pace, function (k) { Sound.play('tick'); Online.send('room:setPace', { pace: k }); });
      }

      var note = [];
      note.push((globalThis.I18N ? globalThis.I18N.t("text.132") : "一局 ") + v.roundSec + (globalThis.I18N ? globalThis.I18N.t("text.131") : " 秒・難度「") + Rules.paceOf(v.pace).label + '」。');
      note.push((globalThis.I18N ? globalThis.I18N.t("text.130") : "座位 ") + (v.seats - v.seatsFree) + '/' + v.seats + (globalThis.I18N ? globalThis.I18N.t("text.129") : "，最多 ") + v.seats + (globalThis.I18N ? globalThis.I18N.t("text.128") : " 人共用同一片天空。"));
      if (v.you.role === 'spectator') note.push((globalThis.I18N ? globalThis.I18N.t("text.127") : "你目前是觀戰身分。"));
      if (v.you.startBlockedBy) note.push(w.I18N.message(v.you.startBlockedBy));
      $('ov-wait-note').textContent = note.join(' ');

      var btns = '';
      if (can.ready) {
        btns += '<button class="tk tk-lg" data-tone="' + (v.you.ready ? 'paper' : 'teal') + '" data-act="ready" type="button" data-icon="check"><span>'
          + (v.you.ready ? (globalThis.I18N ? globalThis.I18N.t("text.126") : "取消準備") : (globalThis.I18N ? globalThis.I18N.t("text.125") : "準備好了")) + '</span></button>';
      }
      if (v.you.host) {
        btns += '<button class="tk tk-lg" data-tone="gold" data-act="start" type="button"' + (can.start ? '' : ' disabled') + (globalThis.I18N ? globalThis.I18N.t("text.124") : " data-icon=\"play\"><span>開始這一局</span></button>");
      }
      if (can.sit) btns += (globalThis.I18N ? globalThis.I18N.t("text.123") : "<button class=\"tk\" data-tone=\"teal\" data-act=\"sit\" type=\"button\"><span>下場對戰</span></button>");
      if (can.stand) btns += (globalThis.I18N ? globalThis.I18N.t("text.122") : "<button class=\"tk\" data-tone=\"paper\" data-act=\"stand\" type=\"button\"><span>改成觀戰</span></button>");
      if (can.invite) btns += (globalThis.I18N ? globalThis.I18N.t("text.121") : "<button class=\"tk\" data-tone=\"sky\" data-act=\"invite\" type=\"button\" data-icon=\"link\"><span>邀請朋友</span></button>");
      btns += (globalThis.I18N ? globalThis.I18N.t("text.120") : "<button class=\"tk\" data-tone=\"paper\" data-act=\"quit\" type=\"button\" data-icon=\"door\"><span>離開房間</span></button>");
      $('ov-wait-btns').innerHTML = btns;
      UI.decorate($('ov-wait-btns'));
      UI.refreshScroll($('ov-wait'));
    });
  }

  /* ---- 結算浮層：疊在天空上，固定三個動作 ---- */

  function setBtn(id, o) {
    var b = $(id);
    var span = b.querySelector('span');
    if (o.label !== undefined && span.textContent !== o.label) span.textContent = o.label;
    b.disabled = !!o.disabled;
    b.title = o.title || '';
    if (o.busy !== undefined) b.setAttribute('aria-busy', String(!!o.busy));
  }

  function showResult() {
    var m = S.match;
    if (!m) return;
    var me = meId();
    $('ov-trophy').innerHTML = Art.trophy();
    var champs = m.standings.filter(function (p) { return p.rank === 1; });
    var iWon = champs.some(function (p) { return p.id === me; });
    GameAnalytics.end({ result: m.draw ? 'draw' : (iWon ? 'win' : 'lose') });
    $('ov-result-title').textContent = m.draw
      ? (globalThis.I18N ? globalThis.I18N.t("text.119") : "平手！") + champs.map(function (p) { return playerName(p); }).join('、') + (globalThis.I18N ? globalThis.I18N.t("text.118") : " 同分")
      : (iWon ? (globalThis.I18N ? globalThis.I18N.t("text.117") : "你贏了！") : (champs[0] ? champs[0].name + (globalThis.I18N ? globalThis.I18N.t("text.116") : " 獲勝") : (globalThis.I18N ? globalThis.I18N.t("text.115") : "時間到")));

    var html = m.standings.map(function (p) {
      return '<div class="resrow' + (p.rank === 1 ? ' win' : '') + '" style="--who:' + colorHex(p.color) + '">'
        + '<span class="no">' + p.rank + '</span>'
        + '<span class="nm">' + esc(playerName(p)) + (p.id === me ? (globalThis.I18N ? globalThis.I18N.t("text.114") : "（你）") : '')
        + (p.rank === 1 && m.standings.length > 1 ? ' <em class="mvp">' + esc(w.I18N.t('res.mvp')) + '</em>' : '')
        + (globalThis.I18N ? globalThis.I18N.t("text.113") : "<small>射中 ") + p.hits + (globalThis.I18N ? globalThis.I18N.t("text.112") : "・誤射 ") + p.badHits + (globalThis.I18N ? globalThis.I18N.t("text.111") : "・最佳連擊 ") + p.bestCombo
        + (globalThis.I18N ? globalThis.I18N.t("text.110") : "・命中率 ") + Math.round((p.accuracy || 0) * 100) + '%</small></span>'
        + '<span class="sc">' + p.score + '</span></div>';
    }).join('');
    paintOnce('result', html, function () { $('result-table').innerHTML = html; });
    var statsHtml = resultStatsHtml(m, me);
    paintOnce('resultstats', statsHtml + '|' + w.I18N.lang, function () { $('result-stats').innerHTML = statsHtml; });

    var note = '', extra = '';
    if (S.mode === 'solo') {
      setBtn('b-again', { get label() { return globalThis.I18N ? globalThis.I18N.t("text.103") : "再來一局"; } });
      setBtn('b-toroom', { get label() { return globalThis.I18N ? globalThis.I18N.t("text.100") : "回到房間"; }, disabled: true, get title() { return globalThis.I18N ? globalThis.I18N.t("text.109") : "單機模式沒有房間"; } });
      note = (globalThis.I18N ? globalThis.I18N.t("text.108") : "單機模式沒有房間，所以「回到房間」不能用。");
    } else if (S.view) {
      var v = S.view, can = v.you.can || {};
      if (can.rematch) {
        setBtn('b-again', { get label() { return S.voted ? (globalThis.I18N ? globalThis.I18N.t("text.107") : "等其他人（") + v.rematch.votes + '/' + v.rematch.need + '）' : (globalThis.I18N ? globalThis.I18N.t("text.106") : "再來一局（") + v.rematch.votes + '/' + v.rematch.need + '）'; }, disabled: S.voted });
        note = S.voted ? (globalThis.I18N ? globalThis.I18N.t("text.105") : "你已經投票再來一局，等其他玩家同意就會開始。") : (globalThis.I18N ? globalThis.I18N.t("text.104") : "所有玩家都按「再來一局」就會馬上開始新的一局。");
      } else {
        setBtn('b-again', { get label() { return globalThis.I18N ? globalThis.I18N.t("text.103") : "再來一局"; }, disabled: true, get title() { return globalThis.I18N ? globalThis.I18N.t("text.102") : "觀戰中不能投票"; } });
        note = (globalThis.I18N ? globalThis.I18N.t("text.101") : "你是觀戰身分，不能投票再來一局。想參加下一局可以按「下場對戰」。");
      }
      if (can.reset) setBtn('b-toroom', { get label() { return globalThis.I18N ? globalThis.I18N.t("text.100") : "回到房間"; } });
      else {
        setBtn('b-toroom', { get label() { return globalThis.I18N ? globalThis.I18N.t("text.100") : "回到房間"; }, disabled: true, get title() { return globalThis.I18N ? globalThis.I18N.t("text.099") : "只有房主可以回到房間設定"; } });
        note += (globalThis.I18N ? globalThis.I18N.t("text.098") : " 「回到房間」只有房主能按。");
      }
      if (can.sit) extra += (globalThis.I18N ? globalThis.I18N.t("text.097") : "<button class=\"tk tk-sm\" data-tone=\"teal\" data-act=\"sit\" type=\"button\"><span>下場對戰</span></button>");
      if (can.stand) extra += (globalThis.I18N ? globalThis.I18N.t("text.096") : "<button class=\"tk tk-sm\" data-tone=\"paper\" data-act=\"stand\" type=\"button\"><span>改成觀戰</span></button>");
    }
    setBtn('b-tohome', { get label() { return globalThis.I18N ? globalThis.I18N.t("text.095") : "回到首頁"; } });
    $('ov-result-note').textContent = note;
    paintOnce('resultextra', extra, function () { $('ov-result-extra').innerHTML = extra; UI.decorate($('ov-result-extra')); });
    $('ov-result').hidden = false;
    syncBlocking();
    UI.refreshScroll($('ov-result'));
    if (!S.resultFocused) {
      S.resultFocused = true;
      var first = $('b-again').disabled ? $('b-tohome') : $('b-again');
      try { first.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function hideResult() { $('ov-result').hidden = true; S.resultFocused = false; S.sigs.result = null; syncBlocking(); }

  /* 結算／暫停／房間結束時，背景的射擊場不能被操作（也拿不到焦點） */
  function blockingOverlay() {
    var ids = ['ov-result', 'ov-pause', 'ov-closed'];
    for (var i = 0; i < ids.length; i++) if (!$(ids[i]).hidden) return $(ids[i]);
    return null;
  }
  function syncBlocking() {
    var f = $('field');
    var on = !!blockingOverlay();
    if ('inert' in f) f.inert = on;
    f.setAttribute('aria-disabled', on ? 'true' : 'false');
  }
  /* 焦點只在浮層內循環 */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || UI.topModal()) return;
    var ov = blockingOverlay();
    if (!ov) return;
    var f = [].slice.call(ov.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (!ov.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, true);

  /* ---- 房間已結束 ---- */
  function showClosed(reason) {
    S.closed = true;
    stopLoop();
    Stage.clear();
    ['ov-wait', 'ov-result', 'ov-pause'].forEach(function (id) { $(id).hidden = true; });
    $('countdown').hidden = true;
    document.body.classList.remove('playing');
    if (w.NetworkLatency) w.NetworkLatency.setActive(false);
    $('ov-closed-note').textContent = (w.I18N.message(reason) || (globalThis.I18N ? globalThis.I18N.t("text.094") : "房間裡已經沒有玩家了")) + (globalThis.I18N ? globalThis.I18N.t("text.093") : " 邀請連結也已經失效，這間房不會再重新開啟。");
    $('ov-closed').hidden = false;
    syncBlocking();
    paintSumState('closed');
    $('sum-state').textContent = (globalThis.I18N ? globalThis.I18N.t("text.092") : "房間已結束");
    $('side-actions').innerHTML = '';
    $('hud-stage').textContent = (globalThis.I18N ? globalThis.I18N.t("text.092") : "房間已結束");
    $('chat-input').disabled = true; $('b-chat-send').disabled = true;
    chatState((globalThis.I18N ? globalThis.I18N.t("text.091") : "房間已結束，不能再發言。"), true);
    closeSide(true);
    try { $('b-closed-lobby').focus(); } catch (e) {}
  }

  /* ============================================================
   * 線上模式
   * ============================================================ */

  function connStatus(st) {
    S.connection = st;
    if (st.status !== 'connected') S.onlineCount = null;
    paintOnlineCount();
    var dot = $('conn-dot'), txt = $('conn-text');
    var map = {
      idle: ['', (globalThis.I18N ? globalThis.I18N.t("text.090") : "尚未連線")], loading: ['warn', (globalThis.I18N ? globalThis.I18N.t("text.089") : "正在載入連線程式…")],
      connecting: ['warn', (st.key ? w.I18N.message(st) : w.I18N.message(st.message)) || (globalThis.I18N ? globalThis.I18N.t("text.088") : "連線中…（免費方案冷啟動可能要十幾秒）")],
      connected: ['ok', (globalThis.I18N ? globalThis.I18N.t("text.087") : "已連上 ") + Config.describe()],
      error: ['bad', (st.key ? w.I18N.message(st) : w.I18N.message(st.message)) || (globalThis.I18N ? globalThis.I18N.t("text.086") : "連線失敗")],
      offline: ['bad', (st.key ? w.I18N.message(st) : w.I18N.message(st.message)) || (globalThis.I18N ? globalThis.I18N.t("text.085") : "沒有可用的伺服器，只能玩單機")]
    };
    var m = map[st.status] || ['', st.status];
    dot.className = 'dot ' + m[0];
    txt.textContent = m[1];
    $('b-reconnect').hidden = !(st.status === 'error' || st.status === 'offline');
    if (S.mode === 'online') paintSumState(S.view ? S.view.phase : 'lobby');
  }

  function connect(nameOverride) {
    S.name = (nameOverride || $('lobby-nick').value || Store.nick() || '').trim() || (globalThis.I18N ? globalThis.I18N.t("text.002") : "玩家");
    return Online.connect({ clientId: S.clientId, name: S.name })
      .then(function () { Online.send('lobby:subscribe', {}); return true; })
      .catch(function (err) { toast(err.message || (globalThis.I18N ? globalThis.I18N.t("text.072") : "連不上伺服器")); throw err; });
  }

  function paintRoomList(payload) {
    S.roomList = payload;
    S.onlineCount = Number.isInteger(payload.online) && payload.online >= 0 ? payload.online : null;
    paintOnlineCount();
    $('rooms-count').textContent = payload.total || 0;
    var list = payload.rooms || [];
    if (!list.length) {
      $('room-list').innerHTML = (globalThis.I18N ? globalThis.I18N.t("text.084") : "<div class=\"empty\">目前沒有公開房間。按上面的「建立房間」開一間，把房號或邀請連結給朋友就好。</div>");
      return;
    }
    $('room-list').innerHTML = list.map(function (r) {
      var tag = r.phase === 'playing' || r.phase === 'countdown' ? (globalThis.I18N ? globalThis.I18N.t("text.083") : "<span class=\"tag playing\">對戰中</span>")
        : (r.phase === 'over' ? (globalThis.I18N ? globalThis.I18N.t("text.082") : "<span class=\"tag over\">剛打完</span>") : (globalThis.I18N ? globalThis.I18N.t("text.081") : "<span class=\"tag\">等待中</span>"));
      var canPlay = r.seatsFree > 0 && r.phase !== 'playing' && r.phase !== 'countdown';
      return '<div class="roomrow">'
        + '<span class="rname">' + esc(r.name) + (globalThis.I18N ? globalThis.I18N.t("text.080") : "<small>房號 ") + esc(r.code) + '</small></span>'
        + tag
        + '<button class="tk tk-sm" data-tone="' + (canPlay ? 'teal' : 'sky') + '" type="button" data-joincode="' + esc(r.code) + '" data-icon="' + (canPlay ? 'door' : 'eye') + '"><span>'
        + (canPlay ? (globalThis.I18N ? globalThis.I18N.t("text.079") : "加入") : (globalThis.I18N ? globalThis.I18N.t("text.044") : "觀戰")) + '</span></button>'
        + (globalThis.I18N ? globalThis.I18N.t("text.078") : "<span class=\"rmeta\">玩家 ") + (r.players + r.ai) + '/' + r.seats + (r.spectators ? (globalThis.I18N ? globalThis.I18N.t("text.077") : "・觀戰 ") + r.spectators : '')
        + (r.ai ? (globalThis.I18N ? globalThis.I18N.t("text.076") : "・含電腦 ") + r.ai : '') + (' ・' + r.roundSec + (globalThis.I18N ? globalThis.I18N.t("text.028") : " 秒")) + '</span>'
        + '</div>';
    }).join('');
    UI.decorate($('room-list'));
  }

  function paintOnlineCount() {
    var el = $('online-count');
    var visible = S.connection && S.connection.status === 'connected' && Number.isInteger(S.onlineCount);
    el.hidden = !visible;
    el.textContent = visible ? w.I18N.t('lobby.onlineCount', { n: S.onlineCount }) : '';
  }

  function joinRoom(code, token, role, name) {
    return connect(name).then(function () {
      S.mode = 'online';
      S.closed = false;
      return new Promise(function (resolve) {
        Online.send('room:join', { code: code, name: S.name, token: token || null, role: role || null }, function (res) {
          if (!res || !res.ok) {
            if (!S.view) S.mode = null;
            toast((res && res.error) || (globalThis.I18N ? globalThis.I18N.t("text.075") : "加入失敗"), 4200);
            return resolve({ ok: false, error: (res && res.error) || (globalThis.I18N ? globalThis.I18N.t("text.075") : "加入失敗") });
          }
          S.mode = 'online';
          if (res.name) { S.name = res.name; Store.nick(res.name); }
          if (res.downgraded) toast((globalThis.I18N ? globalThis.I18N.t("text.074") : "玩家席位已滿，你先以觀戰身分進來了。"), 3600);
          else if (res.waiting) toast((globalThis.I18N ? globalThis.I18N.t("text.073") : "這局已經開打，你先觀戰，下一局就能下場。"), 3600);
          else if (res.note) toast(res.note, 3600);
          Sound.play('join');
          resolve({ ok: true, role: res.role });
        });
      });
    }).catch(function () { return { ok: false, get error() { return globalThis.I18N ? globalThis.I18N.t("text.072") : "連不上伺服器"; } }; });
  }

  /* ---- 邀請落地：先停在大廳，確認名字後才送出加入請求 ---- */

  function setInviteMeta(text, bad) {
    var m = $('invite-meta');
    m.textContent = text;
    m.classList.toggle('bad', !!bad);
  }

  function showInviteError(text) {
    var e = $('invite-nick-err');
    e.textContent = text || '';
    e.hidden = !text;
    $('invite-nick').classList.toggle('bad', !!text);
    $('invite-nick').setAttribute('aria-invalid', text ? 'true' : 'false');
  }

  function openInviteCard(entry) {
    S.joinIntent = { room: entry.room, invite: entry.invite || null, ok: false, role: null };
    $('invite-card').hidden = false;
    $('invite-nick').value = Store.nick() || '';
    $('join-code').value = entry.room;
    $('b-invite-join').disabled = true;
    showInviteError('');
    setInviteMeta((globalThis.I18N ? globalThis.I18N.t("text.070") : "房號 ") + entry.room + (globalThis.I18N ? globalThis.I18N.t("text.071") : "：正在確認邀請連結…"));
    show('s-lobby');
    connect($('invite-nick').value).then(function () {
      if (!entry.invite) {
        S.joinIntent.ok = true;
        setInviteMeta((globalThis.I18N ? globalThis.I18N.t("text.070") : "房號 ") + entry.room + (globalThis.I18N ? globalThis.I18N.t("text.069") : "。確認名字後按「確認並加入」。"));
        $('b-invite-join').disabled = false;
        return;
      }
      Online.send('invite:check', { code: entry.room, token: entry.invite }, function (res) {
        if (!res || !res.ok) {
          setInviteMeta((res && res.error) || (globalThis.I18N ? globalThis.I18N.t("text.068") : "這個邀請連結不能用了。"), true);
          return;
        }
        S.joinIntent.ok = true; S.joinIntent.role = res.role;
        setInviteMeta((globalThis.I18N ? globalThis.I18N.t("text.067") : "房間「") + res.room.name + '」（' + entry.room + (globalThis.I18N ? globalThis.I18N.t("text.066") : "）・你會以「") + (res.role === 'spectator' ? (globalThis.I18N ? globalThis.I18N.t("text.044") : "觀戰") : (globalThis.I18N ? globalThis.I18N.t("text.002") : "玩家"))
          + (globalThis.I18N ? globalThis.I18N.t("text.065") : "」身分加入") + (res.note ? '。' + res.note : '。'));
        $('b-invite-join').disabled = false;
      });
    }).catch(function () { setInviteMeta((globalThis.I18N ? globalThis.I18N.t("text.064") : "連不上伺服器，請稍後按「重新連線」。"), true); });
    try { $('invite-nick').focus(); } catch (e) {}
  }

  function confirmInviteJoin() {
    var it = S.joinIntent;
    if (!it || !it.ok) return;
    var name = ($('invite-nick').value || '').trim();
    if (!name) { showInviteError((globalThis.I18N ? globalThis.I18N.t("text.063") : "請先輸入你在房間裡的名字。")); $('invite-nick').focus(); return; }
    if (name.length > 12) { showInviteError((globalThis.I18N ? globalThis.I18N.t("text.062") : "名字最多 12 個字。")); $('invite-nick').focus(); return; }
    showInviteError('');
    setBtn('b-invite-join', { busy: true, disabled: true });
    /* 這一步才真的送出 room:join；角色由 token 決定，名字只是顯示用 */
    joinRoom(it.room, it.invite, it.role, name).then(function (res) {
      setBtn('b-invite-join', { busy: false, disabled: false });
      if (res.ok) { $('invite-card').hidden = true; S.joinIntent = null; return; }
      showInviteError(res.error + (globalThis.I18N ? globalThis.I18N.t("text.061") : "（可以改個名字再試一次）"));
    });
  }

  function createRoom() {
    return connect().then(function () {
      S.mode = 'online'; S.closed = false;
      var settings = localGameSettings();
      var payload = {
        name: S.name,
        roomName: $('room-name').value,
        private: UI.getSwitch($('room-private')),
        pace: settings.pace
      };
      if (settings.roundSec !== null) payload.roundSec = settings.roundSec;
      setBtn('b-create', { busy: true });
      Online.send('room:create', payload, function (res) {
        setBtn('b-create', { busy: false });
        if (!res || !res.ok) {
          if (!S.view) S.mode = null;
          return toast((res && res.error) || (globalThis.I18N ? globalThis.I18N.t("text.060") : "建立失敗"));
        }
        S.mode = 'online';
        Sound.play('join');
      });
    }).catch(function () { setBtn('b-create', { busy: false }); });
  }

  function onSync(view) {
    /* 已離開房間／房間已關閉時，路上還沒到的同步包要丟掉，不然會被拉回對戰畫面 */
    if (S.mode !== 'online' || S.closed) return;
    if (view.match && view.phase !== 'over') GameAnalytics.sync(view.phase, view.code + '|' + view.match.seed, {
      mode: 'online', difficulty: view.pace, players: view.match.standings.length,
      spectator: !view.you || view.you.role !== 'player'
    });
    var wasPhase = S.view ? S.view.phase : null;
    S.view = view;
    if (w.NetworkLatency) w.NetworkLatency.setActive(S.screen === 's-game' && view.phase === 'playing');
    S.match = view.match;
    if (S.screen !== 's-game') {
      S.mode = 'online';
      $('invite-card').hidden = true;
      enterGameScreen();
    }
    if (view.phase === 'countdown' && wasPhase !== 'countdown') {
      S.lastStage = 0; S.warned = false; S.voted = false; S.lastRecord = null;
      hideResult();
      Stage.clear();
      S.drewOver = false;
    }
    if (view.phase === 'lobby' && wasPhase && wasPhase !== 'lobby') { S.voted = false; hideResult(); Stage.clear(); S.drewOver = false; }
    if (view.phase === 'over' && wasPhase !== 'over') {
      var me = meId();
      var r = (view.match ? view.match.standings : []).filter(function (p) { return p.id === me; })[0];
      if (r) {
        var outcome = r.rank === 1 ? (view.match.draw ? 'draw' : 'win') : 'lose';
        Store.recordResult('online', outcome);
        recordMatch('online', view.match, r, outcome);
        Sound.play(outcome === 'lose' ? 'lose' : 'win');
      }
    }
    if (view.phase === 'over') { if (w.NetworkLatency) w.NetworkLatency.setActive(false); showResult(); }
    else hideResult();
    paintWaitOverlay();
    paintChat(view.chat);
    paintInviteList(view.invites);
    paintHud(); paintSummary();
  }

  /* ---- 聊天室 ---- */

  var lastChatId = 0;
  function sideVisible() {
    var side = $('side');
    return isNarrow() ? side.classList.contains('open') : !$('game-shell').classList.contains('side-collapsed');
  }

  function paintChat(list) {
    if (!list) return;
    var me = meId();
    var log = $('chat-log');
    var atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
    var html = list.length ? list.map(function (m) {
      if (m.system) return '<div class="msg sys">' + esc(m.system ? w.I18N.message(m.key ? m : m.text) : m.text) + '</div>';
      var cls = 'msg' + (m.from === me ? ' me' : '') + (m.role === 'spectator' ? ' spec' : '');
      return '<div class="' + cls + '"><span class="who">' + esc(m.name) + (m.role === 'spectator' ? (globalThis.I18N ? globalThis.I18N.t("text.059") : "（觀戰）") : '') + '</span>' + esc(m.system ? w.I18N.message(m.key ? m : m.text) : m.text) + '</div>';
    }).join('') : (globalThis.I18N ? globalThis.I18N.t("text.058") : "<div class=\"msg sys\">還沒有訊息，說聲嗨吧。</div>");
    paintOnce('chat', html, function () {
      log.innerHTML = html;
      if (atBottom) log.scrollTop = log.scrollHeight;
    });
    var newest = list.length ? list[list.length - 1].id : 0;
    if (newest > lastChatId) {
      if (!sideVisible()) {
        var added = list.filter(function (m) { return m.id > lastChatId && !m.system && m.from !== me; }).length;
        if (added) { S.unread += added; paintUnread(); Sound.playChat(); }
      }
      lastChatId = newest;
    }
  }

  function paintUnread() {
    var show = S.unread > 0;
    var txt = S.unread > 99 ? '99+' : String(S.unread);
    ['chat-unread', 'chat-unread2', 'chat-unread3'].forEach(function (id) {
      var e = $(id);
      e.hidden = !show;
      e.textContent = txt;
    });
  }

  function chatState(text, bad) {
    var el = $('chat-state');
    el.textContent = text || '';
    el.classList.toggle('bad', !!bad);
  }

  /* ---- 邀請彈窗 ---- */

  var inv = { role: 'player', ttl: 30, uses: 5 };

  function buildInviteOptions() {
    UI.seg($('inv-role'), [
      { value: 'player', get label() { return globalThis.I18N ? globalThis.I18N.t("text.002") : "玩家"; }, get sub() { return globalThis.I18N ? globalThis.I18N.t("text.057") : "席位滿了會轉觀戰"; } },
      { value: 'spectator', get label() { return globalThis.I18N ? globalThis.I18N.t("text.044") : "觀戰"; }, get sub() { return globalThis.I18N ? globalThis.I18N.t("text.056") : "只能看"; } }
    ], inv.role, function (v) { inv.role = v; });
    UI.seg($('inv-ttl'), [{ value: 10, get label() { return globalThis.I18N ? globalThis.I18N.t("text.055") : "10 分鐘"; } }, { value: 30, get label() { return globalThis.I18N ? globalThis.I18N.t("text.054") : "30 分鐘"; } }, { value: 120, get label() { return globalThis.I18N ? globalThis.I18N.t("text.053") : "2 小時"; } }],
      inv.ttl, function (v) { inv.ttl = Number(v); });
    UI.seg($('inv-uses'), [{ value: 1, get label() { return globalThis.I18N ? globalThis.I18N.t("text.052") : "1 次"; } }, { value: 5, get label() { return globalThis.I18N ? globalThis.I18N.t("text.051") : "5 次"; } }, { value: 20, get label() { return globalThis.I18N ? globalThis.I18N.t("text.050") : "20 次"; } }],
      inv.uses, function (v) { inv.uses = Number(v); });
  }

  function paintInviteList(list) {
    var box = $('invite-list');
    if (!list || !list.length) {
      paintOnce('invlist', 'empty', function () { box.innerHTML = (globalThis.I18N ? globalThis.I18N.t("text.049") : "<div class=\"empty\">還沒有產生過邀請連結。</div>"); });
      return;
    }
    var now = srvNow();
    var html = list.map(function (iv) {
      var dead = iv.revoked || iv.expiresAt < now || iv.uses >= iv.maxUses;
      var why = iv.revoked ? (globalThis.I18N ? globalThis.I18N.t("text.048") : "已撤銷") : (iv.expiresAt < now ? (globalThis.I18N ? globalThis.I18N.t("text.047") : "已過期")
        : (iv.uses >= iv.maxUses ? (globalThis.I18N ? globalThis.I18N.t("text.046") : "次數用完") : Math.ceil((iv.expiresAt - now) / 60000) + (globalThis.I18N ? globalThis.I18N.t("text.045") : " 分鐘後過期")));
      return '<div class="invrow' + (dead ? ' dead' : '') + '">'
        + '<span class="txt">' + (iv.role === 'spectator' ? (globalThis.I18N ? globalThis.I18N.t("text.044") : "觀戰") : (globalThis.I18N ? globalThis.I18N.t("text.002") : "玩家")) + '・' + iv.uses + '/' + iv.maxUses + (globalThis.I18N ? globalThis.I18N.t("text.043") : " 次・") + why + '</span>'
        + (dead ? '' : '<button class="tk tk-icon tk-sm" data-tone="teal" type="button" data-copyinv="' + esc(iv.token) + (globalThis.I18N ? globalThis.I18N.t("text.042") : "\" aria-label=\"複製這個邀請連結\" data-icon=\"copy\"></button>")
          + '<button class="tk tk-icon tk-sm" data-tone="red" type="button" data-revoke="' + esc(iv.token) + (globalThis.I18N ? globalThis.I18N.t("text.041") : "\" aria-label=\"撤銷這個邀請連結\" data-icon=\"close\"></button>"))
        + '</div>';
    }).join('');
    paintOnce('invlist', html, function () { box.innerHTML = html; UI.decorate(box); });
  }

  function makeInvite() {
    setBtn('b-invite-make', { busy: true });
    Online.send('room:invite', { role: inv.role, ttlMinutes: inv.ttl, maxUses: inv.uses }, function (res) {
      setBtn('b-invite-make', { busy: false });
      if (!res || !res.ok) return toast((res && res.error) || (globalThis.I18N ? globalThis.I18N.t("text.040") : "產生失敗"));
      var url = Config.inviteUrl(S.view.code, res.token);
      $('invite-url').value = url;
      $('invite-out').hidden = false;
      $('b-invite-share').hidden = !(w.navigator && w.navigator.share);
      copyText(url, (globalThis.I18N ? globalThis.I18N.t("text.039") : "邀請連結已經複製，貼給朋友就可以了。"));
    });
  }

  function copyText(text, okMsg) {
    var done = function () { toast(okMsg || (globalThis.I18N ? globalThis.I18N.t("text.038") : "已複製")); };
    if (w.navigator && w.navigator.clipboard && w.navigator.clipboard.writeText) {
      w.navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
    function fallback() {
      var i = $('invite-url');
      i.value = text; $('invite-out').hidden = false;
      i.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { toast((globalThis.I18N ? globalThis.I18N.t("text.037") : "複製失敗，請手動選取連結複製。")); }
    }
  }

  /* ---- 側欄開合 ---- */

  function isNarrow() { return getComputedStyle($('side-fab')).display !== 'none'; }

  function openSide(returnTo) {
    var side = $('side');
    side.classList.add('open');
    $('side-mask').hidden = false;
    S.sideReturn = returnTo || document.activeElement;
    if (S.unread) { S.unread = 0; paintUnread(); }
    UI.refreshScroll(side);
    var c = $('chat-log');
    c.scrollTop = c.scrollHeight;
    try { $('b-side-close').focus({ preventScroll: true }); } catch (e) {}
  }

  function closeSide(silent) {
    var side = $('side');
    var was = side.classList.contains('open');
    side.classList.remove('open');
    $('side-mask').hidden = true;
    if (was && !silent && S.sideReturn && S.sideReturn.focus) { try { S.sideReturn.focus(); } catch (e) {} }
    if (was) S.sideReturn = null;
  }

  function toggleWideSide() {
    var shell = $('game-shell');
    var collapsed = shell.classList.toggle('side-collapsed');
    Store.sideOpen(!collapsed);
    $('b-side-toggle').setAttribute('aria-expanded', String(!collapsed));
    if (!collapsed && S.unread) { S.unread = 0; paintUnread(); }
    setTimeout(function () { Stage.measure(); }, 0);
  }

  function refreshAll() {
    paintWaitOverlay();
    paintHud();
    paintSummary();
    paintUnread();
    paintPlayingFlag();
  }

  function paintPlayingFlag() {
    var phase = S.mode === 'online' ? (S.view && S.view.phase) : (S.match && S.match.phase);
    document.body.classList.toggle('playing', phase === 'playing');
  }

  /* ============================================================
   * 操作綁定
   * ============================================================ */

  function quitAction() {
    var live = S.mode === 'online'
      ? !!(S.view && S.view.phase === 'playing' && S.view.you.role === 'player')
      : !!(S.match && (S.match.phase === 'playing' || S.match.phase === 'paused'));
    if (live) {
      if (S.mode === 'solo') pauseSolo();
      askConfirm((globalThis.I18N ? globalThis.I18N.t("text.036") : "離開這一局？"), S.mode === 'online'
        ? (globalThis.I18N ? globalThis.I18N.t("text.035") : "這一局還沒打完，你的分數會留在排行榜上。")
        : (globalThis.I18N ? globalThis.I18N.t("text.034") : "這一局還沒打完，離開就不會計入戰績。"), leaveGame, (globalThis.I18N ? globalThis.I18N.t("text.033") : "離開"));
      return;
    }
    leaveGame();
  }

  function doAction(act) {
    if (act === 'quit') return quitAction();
    if (S.mode !== 'online' || !S.view) return;
    if (act === 'ready') Online.send('room:ready', { ready: !S.view.you.ready });
    else if (act === 'start') Online.send('room:start', {});
    else if (act === 'sit') Online.send('room:sit', {});
    else if (act === 'stand') Online.send('room:stand', {});
    else if (act === 'invite') { buildInviteOptions(); UI.openModal('invite-modal'); }
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-act],[data-back],[data-joincode],[data-rmai],[data-revoke],[data-copyinv]') : null;
    if (!t || t.disabled) return;
    if (t.dataset.back) { show(t.dataset.back); Sound.play('click'); return; }
    if (t.dataset.act) { Sound.play('click'); doAction(t.dataset.act); return; }
    if (t.dataset.joincode) {
      Sound.play('click');
      S.name = ($('lobby-nick').value || Store.nick() || '').trim() || (globalThis.I18N ? globalThis.I18N.t("text.002") : "玩家");
      Store.nick(S.name);
      joinRoom(t.dataset.joincode);
      return;
    }
    if (t.dataset.rmai) { Online.send('room:removeAi', { id: t.dataset.rmai }); return; }
    if (t.dataset.revoke) { Online.send('room:revokeInvite', { token: t.dataset.revoke }); return; }
    if (t.dataset.copyinv) { copyText(Config.inviteUrl(S.view.code, t.dataset.copyinv)); return; }
  });

  /* 第一次手勢解鎖音訊（瀏覽器規定） */
  ['pointerdown', 'keydown'].forEach(function (evt) {
    w.addEventListener(evt, function once() {
      Sound.unlock();
      if (Sound.isMusicOn()) Sound.startBgm();
      w.removeEventListener(evt, once);
    }, { once: true });
  });

  function onShoot(balloonId, aim) {
    if (S.mode === 'solo') {
      var st = S.solo.state;
      if (!st || st.pausedAt) return;
      var now = Date.now();
      if (Rules.phaseOf(st, now) !== 'playing') return;
      Sound.play('twang');
      Stage.dart(aim.px, aim.py);
      var res = Rules.shoot(st, 'me', { balloonId: balloonId, x: aim.x, y: aim.y }, now);
      if (res.ok) { S.match = Rules.snapshot(st, now); handleEvents([res.event].concat(res.extra || [])); }
      return;
    }
    if (S.mode === 'online') {
      if (!S.view || !S.view.you.can.shoot || S.closed) return;
      Sound.play('twang');
      Stage.dart(aim.px, aim.py);
      Online.send('room:shoot', { balloonId: balloonId || 0, x: aim.x, y: aim.y });
    }
  }

  function paintSoloOptions() {
    var pace = Rules.paceOf(Store.pace()).key;
    UI.seg($('opt-pace'), Rules.PACE_ORDER.map(function (k) { return { value: k, label: Rules.paceOf(k).label }; }),
      pace, function (k) { Store.pace(k); Sound.play('tick'); paintPaceBlurb(); });
    paintPaceBlurb();
    UI.seg($('opt-aicount'), [
      { value: 0, label: '0', get sub() { return globalThis.I18N ? globalThis.I18N.t("text.032") : "挑戰高分"; } }, { value: 1, label: '1', get sub() { return globalThis.I18N ? globalThis.I18N.t("text.031") : "一對一"; } },
      { value: 2, label: '2', get sub() { return globalThis.I18N ? globalThis.I18N.t("text.030") : "三人混戰"; } }, { value: 4, label: '4', get sub() { return globalThis.I18N ? globalThis.I18N.t("text.029") : "滿場五人"; } }
    ], String(Store.aiCount()), function (v) { Store.aiCount(v); Sound.play('tick'); });
    var rs = Rules.roundSecOf(Store.roundSec());
    UI.seg($('opt-round'), Rules.ROUND_SECONDS.map(function (sec) {
      return { value: sec, get label() { return sec + (globalThis.I18N ? globalThis.I18N.t("text.028") : " 秒"); }, get sub() { return sec === 60 ? (globalThis.I18N ? globalThis.I18N.t("text.027") : "快一場") : (sec === 75 ? (globalThis.I18N ? globalThis.I18N.t("text.026") : "中等") : (globalThis.I18N ? globalThis.I18N.t("text.025") : "完整一局")); } };
    }), rs, function (v) { Store.roundSec(v); Sound.play('tick'); });
  }

  function paintPaceBlurb() {
    var P = Rules.paceOf(Store.pace());
    $('pace-blurb').textContent = P.blurb + (globalThis.I18N ? globalThis.I18N.t("text.024") : "電腦對手：") + AI.levelOf(P.key).blurb;
  }

  function paintStats() {
    var tr = w.I18N.t;
    var s = Store.stats(), b = Store.best();
    var cells = [
      [(globalThis.I18N ? globalThis.I18N.t("text.023") : "單機勝"), s.solo.win], [(globalThis.I18N ? globalThis.I18N.t("text.022") : "單機敗"), s.solo.lose],
      [(globalThis.I18N ? globalThis.I18N.t("text.021") : "線上勝"), s.online.win], [(globalThis.I18N ? globalThis.I18N.t("text.020") : "線上敗"), s.online.lose],
      [(globalThis.I18N ? globalThis.I18N.t("text.019") : "最高分"), b.score || 0], [(globalThis.I18N ? globalThis.I18N.t("text.018") : "最長連擊"), b.combo || 0],
      [(globalThis.I18N ? globalThis.I18N.t("text.017") : "最佳命中率"), Math.round((b.accuracy || 0) * 100) + '%']
    ];
    $('stat-grid').innerHTML = cells.map(function (c) {
      return '<div class="statcard"><b>' + c[1] + '</b><span>' + esc(c[0]) + '</span></div>';
    }).join('');

    /* 累計 */
    var t = Store.totals();
    var overall = t.shots ? Math.round(t.hits / t.shots * 100) + '%' : tr('stats.none');
    $('stat-totals').innerHTML = [
      [t.games, tr('stats.games')], [t.hits, tr('stats.hits')], [t.shots, tr('stats.shots')], [overall, tr('stats.acc')]
    ].map(function (c) { return '<div class="statcard"><b>' + c[0] + '</b><span>' + esc(c[1]) + '</span></div>'; }).join('');

    /* 各難度最高分 */
    var bp = Store.bestPace();
    $('stat-pace').innerHTML = Rules.PACE_ORDER.map(function (k) {
      return '<div class="statcard"><b>' + (bp[k] ? bp[k] : tr('stats.none')) + '</b><span>' + esc(Rules.paceOf(k).label) + '</span></div>';
    }).join('');

    /* 最近的對局 */
    var recs = Store.records();
    $('stat-recent').innerHTML = recs.length ? recs.map(function (r) {
      var res = r.outcome === 'win' ? 'win' : (r.outcome === 'draw' ? 'draw' : 'lose');
      return '<li class="recrow ' + res + '"><span class="rr-res">' + esc(tr('stats.' + res)) + '</span>'
        + '<span class="rr-main"><b>' + esc(tr(r.mode === 'online' ? 'stats.modeOnline' : 'stats.modeSolo')) + '・' + esc(Rules.paceOf(r.pace).label) + '</b>'
        + '<small>' + esc(tr('stats.rank', { n: r.rank })) + '・' + esc(tr('res.acc')) + ' ' + r.acc + '%・' + esc(tr('res.combo')) + ' ' + r.combo + '</small></span>'
        + '<span class="rr-score">' + r.score + '</span></li>';
    }).join('') : '<li class="empty">' + esc(tr('stats.recentEmpty')) + '</li>';

    /* 成就徽章 */
    var got = Store.achievements();
    var n = 0;
    var cards = w.Achievements.LIST.map(function (a) {
      var on = !!got[a.id];
      if (on) n += 1;
      return '<div class="ach' + (on ? ' on' : '') + '"><span class="ach-pic">' + Art.badge(a.glyph, a.tier, on) + '</span>'
        + '<span class="ach-tx"><b>' + esc(tr('ach.' + a.id + '.name')) + '</b><small>' + esc(tr('ach.' + a.id + '.desc')) + '</small></span></div>';
    }).join('');
    $('stat-ach').innerHTML = cards;
    $('stat-ach-count').textContent = tr('stats.achCount', { n: n, m: w.Achievements.LIST.length });
  }

  function bindUi() {
    /* 首頁 */
    $('b-solo').addEventListener('click', function () {
      $('solo-nick').value = Store.nick();
      paintSoloOptions();
      show('s-solo');
      if (!Store.tutorialDone()) openTutorial();
    });
    $('b-online').addEventListener('click', function () {
      $('lobby-nick').value = Store.nick();
      show('s-lobby');
      connect().catch(function () {});
    });
    $('b-help').addEventListener('click', function () { show('s-help'); });
    $('b-stats').addEventListener('click', function () { paintStats(); show('s-stats'); });
    $('b-help-tutorial').addEventListener('click', openTutorial);
    $('b-solo-tutorial').addEventListener('click', openTutorial);
    $('b-settings-tutorial').addEventListener('click', function () { UI.closeModal('settings-modal'); openTutorial(); });

    /* 單機設定 */
    $('solo-nick').addEventListener('change', function () { Store.nick(this.value.trim()); });
    $('b-solo-start').addEventListener('click', function () {
      S.name = ($('solo-nick').value || '').trim() || (globalThis.I18N ? globalThis.I18N.t("text.016") : "我");
      Store.nick(S.name);
      startSolo();
    });

    /* 教學 */
    $('b-tut-close').addEventListener('click', closeTutorial);
    $('b-tut-skip').addEventListener('click', closeTutorial);
    $('b-tut-prev').addEventListener('click', function () { if (tutIdx > 0) { tutIdx--; paintTutorial(); } });
    $('b-tut-next').addEventListener('click', function () {
      if (tutIdx < TUT.length - 1) { tutIdx++; paintTutorial(); return; }
      closeTutorial();
      S.name = (Store.nick() || '').trim() || (globalThis.I18N ? globalThis.I18N.t("text.016") : "我");
      startSolo({ pace: 'easy', aiCount: 0 });
    });
    $('tutorial-modal').addEventListener('modalclose', function () { Store.tutorialDone(true); });

    /* 大廳 */
    $('lobby-nick').addEventListener('change', function () { Store.nick(this.value.trim()); });
    $('b-create').addEventListener('click', createRoom);
    $('b-join').addEventListener('click', function () {
      var code = ($('join-code').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length < 4) return toast((globalThis.I18N ? globalThis.I18N.t("text.015") : "請輸入完整的房號。"));
      S.name = ($('lobby-nick').value || Store.nick() || '').trim() || (globalThis.I18N ? globalThis.I18N.t("text.002") : "玩家");
      Store.nick(S.name);
      joinRoom(code);
    });
    $('join-code').addEventListener('input', function () {
      this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    });
    $('b-reconnect').addEventListener('click', function () { connect().catch(function () {}); });
    $('b-invite-join').addEventListener('click', confirmInviteJoin);
    $('invite-nick').addEventListener('input', function () { showInviteError(''); });
    $('invite-nick').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); confirmInviteJoin(); } });
    $('b-invite-skip').addEventListener('click', function () { $('invite-card').hidden = true; S.joinIntent = null; });

    /* 對戰畫面 */
    $('b-quit').addEventListener('click', quitAction);
    $('b-pause').addEventListener('click', pauseSolo);
    $('b-resume').addEventListener('click', resumeSolo);
    $('b-pause-quit').addEventListener('click', function () { leaveGame(); });
    $('b-side-toggle').addEventListener('click', toggleWideSide);
    $('b-side-close').addEventListener('click', function () { if (isNarrow()) closeSide(); else toggleWideSide(); });
    $('b-open-sum').addEventListener('click', function () { openSide(this); });
    $('b-open-chat').addEventListener('click', function () {
      openSide(this);
      try { $('chat-input').focus({ preventScroll: true }); } catch (e) {}
    });
    $('side-mask').addEventListener('click', function () { closeSide(); });

    /* 結算三個動作 */
    $('b-again').addEventListener('click', function () {
      if (S.mode === 'solo') { hideResult(); startSolo(); return; }
      if (S.mode === 'online' && S.view && S.view.you.can.rematch && !S.voted) {
        S.voted = true;
        setBtn('b-again', { busy: true, disabled: true, get label() { return globalThis.I18N ? globalThis.I18N.t("text.013") : "送出中…"; } });
        Online.send('room:rematch', {});
        setTimeout(function () { setBtn('b-again', { busy: false }); if (S.view && S.view.phase === 'over') showResult(); }, 600);
      }
    });
    $('b-toroom').addEventListener('click', function () {
      if (S.mode === 'online' && S.view && S.view.you.can.reset) {
        setBtn('b-toroom', { busy: true, disabled: true });
        Online.send('room:reset', {});
        setTimeout(function () { setBtn('b-toroom', { busy: false }); if (S.view && S.view.phase === 'over') showResult(); }, 1500);
      }
    });
    $('b-tohome').addEventListener('click', function () { hideResult(); leaveGame(); });
    $('b-closed-home').addEventListener('click', function () { $('ov-closed').hidden = true; syncBlocking(); leaveGame(); });
    $('b-closed-lobby').addEventListener('click', function () {
      $('ov-closed').hidden = true;
      syncBlocking();
      leaveGame();
      $('lobby-nick').value = Store.nick();
      show('s-lobby');
      connect().catch(function () {});
    });

    /* 聊天 */
    $('chat-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('chat-input').value.trim();
      if (!v) return chatState((globalThis.I18N ? globalThis.I18N.t("text.014") : "訊息是空的。"), true);
      if (S.mode !== 'online') return;
      chatState((globalThis.I18N ? globalThis.I18N.t("text.013") : "送出中…"));
      var ok = Online.send('room:chat', { text: v });
      if (!ok) return chatState((globalThis.I18N ? globalThis.I18N.t("text.012") : "目前離線，訊息還沒送出，連上後再按一次送出。"), true);
      $('chat-input').value = '';
    });

    /* 設定 */
    $('b-settings').addEventListener('click', function () { syncSettingsUi(); $('b-settings').setAttribute('aria-expanded', 'true'); UI.openModal('settings-modal'); });
    $('settings-modal').addEventListener('modalclose', function () { $('b-settings').setAttribute('aria-expanded', 'false'); });
    $('b-settings-close').addEventListener('click', function () { UI.closeModal('settings-modal'); });
    $('b-settings-ok').addEventListener('click', function () { UI.closeModal('settings-modal'); });
    $('b-confirm-close').addEventListener('click', function () { UI.closeModal('confirm-modal'); });
    $('b-confirm-cancel').addEventListener('click', function () { UI.closeModal('confirm-modal'); });
    $('confirm-modal').addEventListener('modalclose', function () {
      pendingConfirm = null;
      if (S.mode === 'solo' && S.solo.paused) { /* 取消離開：保持暫停，讓玩家自己按繼續 */ }
    });
    $('b-confirm-ok').addEventListener('click', function () {
      var fn = pendingConfirm; pendingConfirm = null;
      UI.closeModal('confirm-modal');
      if (fn) fn();
    });
    sliders.music = UI.slider($('set-music-vol'), { onInput: function (v) { Sound.setMusicVolume(v / 100); } });
    sliders.sfx = UI.slider($('set-sfx-vol'), { onChange: function (v) { Sound.setSfxVolume(v / 100); Sound.play('click'); } });
    document.addEventListener('swchange', function (e) {
      var id = e.target.id, on = e.detail.on;
      if (id === 'set-music') Sound.setMusic(on);
      else if (id === 'set-sfx') Sound.setSfx(on);
      else if (id === 'set-chatcue') Sound.setChatCue(on);
      else if (id === 'set-haptic') { Sound.setHaptic(on); Sound.vibrate(15); }
      else if (id === 'set-motion') { Store.reduceMotion(on); applyDisplayPrefs(); }
      else if (id === 'set-mark') { Store.bigTag(on); applyDisplayPrefs(); }
      else if (id === 'set-cursor') { Store.cursor(on); applyDisplayPrefs(); }
    });
    $('b-settings-reset').addEventListener('click', function () {
      Sound.resetDefaults(); Store.resetDefaults(); applyDisplayPrefs(); syncSettingsUi();
      toast((globalThis.I18N ? globalThis.I18N.t("text.011") : "已恢復預設設定。"));
    });

    /* 邀請彈窗 */
    $('b-invite-close').addEventListener('click', function () { UI.closeModal('invite-modal'); });
    $('b-invite-done').addEventListener('click', function () { UI.closeModal('invite-modal'); });
    $('b-invite-make').addEventListener('click', makeInvite);
    $('b-invite-copy').addEventListener('click', function () { copyText($('invite-url').value); });
    $('b-invite-share').addEventListener('click', function () {
      if (w.navigator.share) w.navigator.share({ get title() { return globalThis.I18N ? globalThis.I18N.t("text.010") : "射氣球"; }, get text() { return globalThis.I18N ? globalThis.I18N.t("text.009") : "一起來射氣球！"; }, url: $('invite-url').value }).catch(function () {});
    });

    /* 戰績 */
    $('b-stats-reset').addEventListener('click', function () {
      askConfirm((globalThis.I18N ? globalThis.I18N.t("text.008") : "清除本機戰績？"), (globalThis.I18N ? globalThis.I18N.t("text.007") : "清除後無法復原，確定要繼續嗎？"), function () {
        Store.clearProgress();
        paintStats();
        toast((globalThis.I18N ? globalThis.I18N.t("text.006") : "戰績已清除。"));
      }, (globalThis.I18N ? globalThis.I18N.t("text.005") : "清除"));
    });

    /* 鍵盤：P 暫停（單機）、Esc 先關側欄 */
    document.addEventListener('keydown', function (e) {
      if (UI.topModal()) return;
      var tag = (e.target && e.target.tagName) || '';
      /* 在聊天輸入框裡按 Esc 也要能收起資訊面板；其他快捷鍵打字時不觸發 */
      if (tag === 'INPUT') {
        if (e.key === 'Escape' && S.screen === 's-game' && $('side').classList.contains('open') && isNarrow()) { e.preventDefault(); closeSide(); }
        return;
      }
      if ((e.key === 'p' || e.key === 'P') && S.screen === 's-game' && S.mode === 'solo') {
        if (S.solo.state && S.solo.state.pausedAt) resumeSolo(); else pauseSolo();
      } else if (e.key === 'Escape' && S.screen === 's-game') {
        if ($('side').classList.contains('open')) { closeSide(); }
        else if (S.mode === 'solo' && S.solo.state && !S.solo.state.over && !S.solo.state.pausedAt) pauseSolo();
      }
    });

    /* 單機切到背景就自動暫停，回來由玩家自己按繼續 */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (S.mode === 'solo') pauseSolo(); return; }
      if (S.mode === 'online' && S.view && !S.closed) Online.send('room:join', { code: S.view.code, name: S.name });
    });

    w.addEventListener('resize', function () { Stage.measure(); UI.refreshScroll(); });
  }

  /* ------------------------------------------------------------ 線上事件 */

  function bindOnline() {
    Online.on('status', connStatus);
    Online.on('hello', function (res) { if (res && res.serverTime) S.clockOffset = res.serverTime - Date.now(); });
    Online.on('lobby:rooms', paintRoomList);
    Online.on('room:sync', onSync);
    Online.on('room:events', function (p) {
      if (!p || !p.events || S.mode !== 'online' || S.closed) return;
      for (var i = 0; i < p.events.length; i++) applyEventToSnap(S.match, p.events[i]);
      handleEvents(p.events);
    });
    Online.on('room:chat', function (p) {
      if (!S.view) return;
      S.view.chat = (S.view.chat || []).concat([p.message]).slice(-40);
      paintChat(S.view.chat);
      chatState('');
    });
    Online.on('room:error', function (p) {
      var codes = { rate: 1, muted: 1, empty: 1 };
      if (p && codes[p.code]) { chatState(w.I18N.message(p.key ? p : p.message), true); return; }
      toast((p && w.I18N.message(p.key ? p : p.message)) || (globalThis.I18N ? globalThis.I18N.t("text.004") : "操作失敗"));
    });
    Online.on('room:closed', function (p) { showClosed(p && p.reason); });
    Online.on('room:left', function () { Sound.play('leave'); });
    Online.on('reconnected', function () {
      if (S.mode === 'online' && S.view && !S.closed) {
        Online.send('room:join', { code: S.view.code, name: S.name }, function (res) {
          if (res && !res.ok && (res.code === 'gone' || res.code === 'closed')) showClosed((globalThis.I18N ? globalThis.I18N.t("text.003") : "房間已經不存在了。"));
        });
      }
    });
  }

  /* ------------------------------------------------------------ 啟動 */

  function boot() {

    var langToggle = w.I18N.mountToggle({ after: $('b-settings'), className: 'tk tk-icon' });
    langToggle.setAttribute('data-tone', 'paper');
    w.I18N.onChange(function () {
      S.sigs = {};
      if (S.connection) connStatus(S.connection);
      if (S.roomList) paintRoomList(S.roomList);
      buildDex(); paintSoloOptions(); paintStats(); syncSettingsUi();
      if (S.view) paintChat(S.view.chat);
      paintTutorial(); paintPaceBlurb();
      paintHud(); paintSummary(); paintSideActions(); paintWaitOverlay();
      if (S.match && S.match.phase === 'over') showResult();
      var link = document.querySelector('.lobby-home-link');
      if (link) link.href = w.I18N.withLang(link.href);
    });

    /* 背景：緩緩升空的剪影氣球 */
    var bg = $('bgdeco'), cols = ['#E8483A', '#FFB73D', '#2FC4AE', '#A98BFF', '#59B7FF'], bgh = '';
    for (var i = 0; i < 9; i++) {
      var size = 40 + (i % 4) * 22;
      bgh += '<span style="left:' + ((i * 11.3 + 4) % 94) + '%;width:' + size + 'px;height:' + (size * 1.25) + 'px;background:' + cols[i % 5]
        + ';animation-duration:' + (26 + (i % 5) * 7) + 's;animation-delay:-' + (i * 4.1) + 's"></span>';
    }
    bg.innerHTML = bgh;
    els('.bulbs').forEach(function (b) { b.innerHTML = Art.bulbString(14); });
    $('home-art').innerHTML = Art.homeArt();
    $('deco').innerHTML = Art.scene();
    $('counter').innerHTML = Art.prizes();
    document.documentElement.style.setProperty('--cur-aim', Art.crosshairCursor());

    buildDex();
    UI.mount();
    applyDisplayPrefs();
    bindUi();
    bindOnline();

    Stage.mount({ field: $('field'), layer: $('balloon-layer'), fx: $('fx'), xhair: $('xhair'), combo: $('combo-big'), now: clockNow, onShoot: onShoot });
    applyDisplayPrefs();

    var nick = Store.nick();
    $('solo-nick').value = nick;
    $('lobby-nick').value = nick;
    S.name = nick || (globalThis.I18N ? globalThis.I18N.t("text.002") : "玩家");

    if (!Config.isOnlineEnabled()) {
      $('b-online').addEventListener('click', function () {
        toast(Config.error || (globalThis.I18N ? globalThis.I18N.t("text.001") : "這份頁面沒有連到遊戲伺服器，只能玩單機。用 npm start 啟動伺服器後再開一次。"), 4200);
      }, true);
    }

    /* 邀請連結：?room=XXXXX&invite=token。先停在大廳確認名字，不會自動進房。 */
    var entry = Config.entry();
    if (entry.room && Config.isOnlineEnabled()) openInviteCard(entry);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  w.SB = { S: S, srvNow: srvNow, Stage: Stage };
}(window));
