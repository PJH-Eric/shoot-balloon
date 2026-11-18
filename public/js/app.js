/* ===== app.js — 畫面流程、單機主迴圈、線上房間串接 =====
 *
 * 分工：
 *   rules.js  規則與計分（前後端共用，唯一真相）
 *   ai.js     電腦射手（單機在這裡跑，線上在伺服器跑，同一份程式）
 *   stage.js  射擊場繪製與瞄準
 *   ui.js     自訂元件（按鈕、開關、滑桿、分段選單、捲動區、彈窗）
 *   app.js    只做「把上面幾個接起來 + 使用者介面」
 *
 * 線上模式一律不自己判斷分數：畫面上的每一分都來自伺服器的事件或同步包。
 */
(function (w) {
  'use strict';

  var Rules = w.Rules, AI = w.AI, RNG = w.RNG, Art = w.Art, Stage = w.Stage, UI = w.UI;
  var Store = w.Store, Sound = w.Sound;

  var $ = function (id) { return document.getElementById(id); };
  var els = function (sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); };
  var esc = UI.esc;
  var toast = function (value, ms) { UI.toast(w.I18N.message(value), ms); };

  /* ------------------------------------------------------------ 狀態 */

  var S = {
    screen: 's-home',
    mode: null,
    name: '',
    solo: { state: null, rng: null, brains: {}, ids: [], paused: false },
    match: null,
    lastStage: 0,
    warned: false,
    raf: 0,
    lastPaint: 0,
    drewOver: false,
    sideReturn: null,
    soloResultShown: false,
    sigs: {}
  };

  function clockNow() { return Date.now(); }

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
    els('.screen').forEach(function (s) { s.classList.toggle('active', s.id === id); });
    S.screen = id;
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
    * 射擊事件處理
   * ============================================================ */

  function rowOf(id) {
    if (!S.match) return null;
    for (var i = 0; i < S.match.standings.length; i++) if (S.match.standings[i].id === id) return S.match.standings[i];
    return null;
  }
  function nameOfId(id) { var r = rowOf(id); return r ? r.name : ''; }
  function colorOfId(id) { var r = rowOf(id); return r ? colorHex(r.color) : null; }
  function meId() { return 'me'; }

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
    S.clockOffset = 0;
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
    S.drewOver = false;
    S.resultFocused = false;
    S.lastRecord = null;
    $('ov-result').hidden = true;
    $('ov-pause').hidden = true;
    syncBlocking();
    Stage.clear();
    applyDisplayPrefs();
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
    S.mode = null; S.solo.state = null; S.match = null;
    Stage.clear();
    show('s-home');
  }

  function startLoop() {
    if (S.raf) return;
    var tick = function () {
      S.raf = w.requestAnimationFrame(tick);
      var now = clockNow();
      soloStep(now);
      if (S.match) {
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

  function paintSumState(phase) {
    var el = $('sum-state');
    var cls = 'sum-state', text = '';
    if (phase === 'playing') { cls += ' you'; text = (globalThis.I18N ? globalThis.I18N.t("text.165") : "輪到你：點氣球射擊"); }
    else if (phase === 'countdown') text = (globalThis.I18N ? globalThis.I18N.t("text.164") : "倒數中，準備射擊");
    else if (phase === 'paused') text = (globalThis.I18N ? globalThis.I18N.t("text.163") : "暫停中");
    else if (phase === 'over') text = (globalThis.I18N ? globalThis.I18N.t("text.162") : "這一局結束了");
    else text = (globalThis.I18N ? globalThis.I18N.t("text.161") : "準備中");
    el.className = cls;
    if (el.textContent !== text) el.textContent = text;
  }

  function paintSummary() {
    var m = S.match;
    var phase = m ? m.phase : 'countdown';
    paintSumState(phase);
    $('sum-goal').textContent = (globalThis.I18N ? globalThis.I18N.t("text.160") : "目標：在時間內射破最多氣球，分數最高的獲勝。");
    $('sum-how').textContent = (globalThis.I18N ? globalThis.I18N.t("text.159") : "點氣球射擊（鍵盤：方向鍵＋空白鍵）。不能射：白鴿氣球、祈福天燈、炸彈氣球。");

    var summary = $('sum-mode');
    var me = meId();
    summary.textContent = (globalThis.I18N ? globalThis.I18N.t("text.155") : "單機・") + Rules.paceOf(S.solo.pace).label + (globalThis.I18N ? globalThis.I18N.t("text.154") : "・電腦對手 ") + (S.solo.ids.length - 1) + (globalThis.I18N ? globalThis.I18N.t("text.153") : " 位");

    var rows = [];
    if (m) {
      rows = m.standings.map(function (p) {
        return { no: p.rank, name: playerName(p), hex: colorHex(p.color), me: p.id === me,
          sc: p.score, get sub() { return p.combo >= 2 ? p.combo + (globalThis.I18N ? globalThis.I18N.t("text.152") : " 連") : ''; } };
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
    var ais = S.solo.ids.length - 1;
    var stat;
    if (r) {
      stat = (globalThis.I18N ? globalThis.I18N.t("text.149") : "命中 ") + r.hits + (globalThis.I18N ? globalThis.I18N.t("text.112") : "・誤射 ") + r.badHits + (globalThis.I18N ? globalThis.I18N.t("text.148") : "・準度 ") + Math.round((r.accuracy || 0) * 100) + '%'
        + (r.bestCombo >= 2 ? (globalThis.I18N ? globalThis.I18N.t("text.111") : "・最佳連擊 ") + r.bestCombo : '');
    } else stat = '';
    if (ais && m && m.phase === 'playing') stat += (globalThis.I18N ? globalThis.I18N.t("text.146") : "・電腦對手出手中");
    var ms = $('my-stat');
    if (ms.textContent !== stat) ms.textContent = stat;

    var buffLeft = m && m.phase === 'playing' && r && r.buffUntil ? Math.max(0, r.buffUntil - clockNow()) : 0;
    $('hud-buff').hidden = buffLeft <= 0;
    if (buffLeft > 0) $('hud-buff').textContent = (globalThis.I18N ? globalThis.I18N.t("text.145") : "加倍中 ") + Math.ceil(buffLeft / 1000) + 's';

    paintSideActions();
  }

  function paintSideActions() {
    var html = (globalThis.I18N ? globalThis.I18N.t("text.143") : "<button class=\"tk tk-sm\" data-tone=\"paper\" data-act=\"quit\" type=\"button\" data-icon=\"door\"><span>離開</span></button>");
    paintOnce('sideactions', html, function () {
      $('side-actions').innerHTML = html;
      UI.decorate($('side-actions'));
    });
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

  /* 結算或暫停時，背景的射擊場不能被操作（也拿不到焦點） */
  function blockingOverlay() {
    var ids = ['ov-result', 'ov-pause'];
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

  /* ---- 側欄開合 ---- */

  function isNarrow() { return getComputedStyle($('side-fab')).display !== 'none'; }

  function openSide(returnTo) {
    var side = $('side');
    side.classList.add('open');
    $('side-mask').hidden = false;
    S.sideReturn = returnTo || document.activeElement;
    UI.refreshScroll(side);
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
    setTimeout(function () { Stage.measure(); }, 0);
  }

  function refreshAll() {
    paintHud();
    paintSummary();
    paintPlayingFlag();
  }

  function paintPlayingFlag() {
    var phase = S.match && S.match.phase;
    document.body.classList.toggle('playing', phase === 'playing');
  }

  /* ============================================================
   * 操作綁定
   * ============================================================ */

  function quitAction() {
    var live = S.match && (S.match.phase === 'playing' || S.match.phase === 'paused');
    if (live) {
      if (S.mode === 'solo') pauseSolo();
      askConfirm(w.I18N.t('text.036'), w.I18N.t('text.034'), leaveGame, w.I18N.t('text.033'));
      return;
    }
    leaveGame();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-act],[data-back]') : null;
    if (!t || t.disabled) return;
    if (t.dataset.back) { show(t.dataset.back); Sound.play('click'); return; }
    if (t.dataset.act === 'quit') { Sound.play('click'); quitAction(); }
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

    /* 對戰畫面 */
    $('b-quit').addEventListener('click', quitAction);
    $('b-pause').addEventListener('click', pauseSolo);
    $('b-resume').addEventListener('click', resumeSolo);
    $('b-pause-quit').addEventListener('click', function () { leaveGame(); });
    $('b-side-toggle').addEventListener('click', toggleWideSide);
    $('b-side-close').addEventListener('click', function () { if (isNarrow()) closeSide(); else toggleWideSide(); });
    $('b-open-sum').addEventListener('click', function () { openSide(this); });
    $('side-mask').addEventListener('click', function () { closeSide(); });

    $('b-again').addEventListener('click', function () { hideResult(); startSolo(); });
    $('b-tohome').addEventListener('click', function () { hideResult(); leaveGame(); });
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
      else if (id === 'set-haptic') { Sound.setHaptic(on); Sound.vibrate(15); }
      else if (id === 'set-motion') { Store.reduceMotion(on); applyDisplayPrefs(); }
      else if (id === 'set-mark') { Store.bigTag(on); applyDisplayPrefs(); }
      else if (id === 'set-cursor') { Store.cursor(on); applyDisplayPrefs(); }
    });
    $('b-settings-reset').addEventListener('click', function () {
      Sound.resetDefaults(); Store.resetDefaults(); applyDisplayPrefs(); syncSettingsUi();
      toast((globalThis.I18N ? globalThis.I18N.t("text.011") : "已恢復預設設定。"));
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
      /* 輸入文字時停用遊戲快捷鍵 */
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
    });

    w.addEventListener('resize', function () { Stage.measure(); UI.refreshScroll(); });
  }

  /* ------------------------------------------------------------ 啟動 */

  function boot() {

    var langToggle = w.I18N.mountToggle({ after: $('b-settings'), className: 'tk tk-icon' });
    langToggle.setAttribute('data-tone', 'paper');
    w.I18N.onChange(function () {
      S.sigs = {};
      buildDex(); paintSoloOptions(); paintStats(); syncSettingsUi();
      paintTutorial(); paintPaceBlurb();
      paintHud(); paintSummary();
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

    Stage.mount({ field: $('field'), layer: $('balloon-layer'), fx: $('fx'), xhair: $('xhair'), combo: $('combo-big'), now: clockNow, onShoot: onShoot });
    applyDisplayPrefs();

    var nick = Store.nick();
    $('solo-nick').value = nick;
    S.name = nick || (globalThis.I18N ? globalThis.I18N.t("text.002") : "玩家");

  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  w.SB = { S: S, Stage: Stage };
}(window));
