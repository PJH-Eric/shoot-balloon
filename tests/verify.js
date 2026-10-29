/*
 * tests/verify.js — 規則、AI、房間與設定解析的單元測試
 *
 * 不需要啟動伺服器，也不需要瀏覽器：
 *   node tests/verify.js
 *
 * 這裡驗的是「規則說了算」的部分。線上流程（真的開 socket 對打）
 * 由 scripts/online-check.js 負責。
 */
'use strict';

require('./seo.js');

const Rules = require('../public/js/rules.js');
const AI = require('../public/js/ai.js');
const RNG = require('../public/js/rng.js');
const { RoomStore, sanitizeName, sanitizeText, DISCONNECT_GRACE_MS } = require('../lib/rooms.js');

let pass = 0, fail = 0;
const fails = [];

function ok(cond, name, extra) {
  if (cond) { pass++; return true; }
  fail++;
  fails.push(name + (extra ? '  → ' + extra : ''));
  return false;
}
function eq(a, b, name) { return ok(a === b, name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function near(a, b, tol, name) { return ok(Math.abs(a - b) <= tol, name, 'got ' + a + ' want ~' + b); }
function group(title) { console.log('\n── ' + title); }

const T0 = 1700000000000;

/* 造一顆固定的氣球直接塞進對局，測試命中與計分用 */
function addBalloon(state, type, now, over) {
  const t = Rules.typeOf(type);
  const b = Object.assign({
    id: state.nextId++, type, side: t.side, hp: t.hp, hpLeft: t.hp,
    lane: 0.5, amp: 0, period: 2000, phase: 0, size: t.size,
    spawnAt: now, upMs: 8000, expireAt: now + 8000, stage: 1
  }, over || {});
  state.balloons.push(b);
  return b;
}
function fresh(players, o) {
  return Rules.createMatch(Object.assign({
    seed: 'TESTSEED', now: T0, countdownMs: 0, roundMs: 60000,
    players: players || [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
  }, o || {}));
}

/* ============================================================ 圖鑑 */
group('氣球圖鑑');

eq(Rules.ORDER.length, 14, '共 14 種氣球（含小分身、福袋、Boss）');
eq(Rules.POP_TYPES.length, 9, '圖鑑要射的 9 種（含分身與 Boss，小分身不另列）');
eq(Rules.LUCKY_TYPES.length, 1, '福袋 1 種');
eq(Rules.AVOID_TYPES.length, 3, '不能射的 3 種');
ok(Rules.POP_TYPES.every((k) => Rules.typeOf(k).points > 0), '要射的分數都是正的');
ok(Rules.typeOf('mini').points > 0 && Rules.typeOf('mini').child, '小分身是正分的附屬氣球');
ok(Rules.AVOID_TYPES.every((k) => Rules.typeOf(k).points < 0), '不能射的分數都是負的');
eq(new Set(Rules.ORDER.map((k) => Rules.typeOf(k).points)).size, 14, '14 種分數各不相同');
ok(Rules.ORDER.every((k) => Rules.typeOf(k).label && Rules.typeOf(k).hint), '每種都有名字與說明');
ok(Rules.ORDER.some((k) => Rules.typeOf(k).hp > 1), '有需要射多下的氣球');
for (let s = 1; s <= 3; s++) {
  const w = Rules.weightsFor(s);
  ok(w.length >= 4, '第 ' + s + ' 階段至少有 4 種氣球');
  ok(w.some((x) => Rules.typeOf(x.key).side === 'avoid'), '第 ' + s + ' 階段一定有不能射的');
  ok(w.some((x) => Rules.typeOf(x.key).side === 'pop'), '第 ' + s + ' 階段一定有要射的');
}
ok(Rules.weightsFor(3).length > Rules.weightsFor(1).length, '愈後面的階段種類愈多');
eq(Rules.typeOf('nope').key, 'red', '不認得的種類回到紅氣球，不丟例外');

/* ============================================================ 階段 */
group('階段節奏');

for (const sec of Rules.ROUND_SECONDS) {
  const ms = sec * 1000;
  eq(Rules.stageAt(0, ms).no, 1, sec + ' 秒局：開頭是第 1 階段');
  eq(Rules.stageAt(ms / 3 - 1, ms).no, 1, sec + ' 秒局：三分之一前還在第 1 階段');
  eq(Rules.stageAt(ms / 3, ms).no, 2, sec + ' 秒局：三分之一進第 2 階段');
  eq(Rules.stageAt(ms * 2 / 3, ms).no, 3, sec + ' 秒局：三分之二進第 3 階段');
  eq(Rules.stageAt(ms - 1, ms).no, 3, sec + ' 秒局：結束前是第 3 階段');
}
ok(Rules.STAGES[2].spawnMs < Rules.STAGES[0].spawnMs, '愈後面冒得愈快');
ok(Rules.STAGES[2].maxUp > Rules.STAGES[0].maxUp, '愈後面同時在場愈多');
ok(Rules.STAGES[2].upScale < Rules.STAGES[0].upScale, '愈後面飄得愈快');
eq(Rules.ROUND_SECONDS.join(','), '60,75,90', '一局長度可以選 60／75／90 秒');
eq(Rules.roundMsOf(75), 75000, '75 秒 → 75000 毫秒');
eq(Rules.roundMsOf(7), 60000, '不合法的秒數回到預設 60 秒');
eq(Rules.roundSecOf(14000), 14, '顯示用：14000 毫秒照實顯示 14 秒');

/* 難度：節奏有可觀察的差異 */
const norm = Rules.scaleStage(Rules.STAGES[1], 'normal');
const rook = Rules.scaleStage(Rules.STAGES[1], 'rookie');
const hard = Rules.scaleStage(Rules.STAGES[1], 'hard');
ok(rook.upScale > norm.upScale && norm.upScale > hard.upScale, '難度愈高氣球飄得愈快');
ok(rook.spawnMs > norm.spawnMs && norm.spawnMs > hard.spawnMs, '難度愈高冒得愈快');
ok(rook.maxUp < norm.maxUp && norm.maxUp < hard.maxUp, '難度愈高同時在場愈多');
eq(Rules.paceOf('zzz').key, 'normal', '不認得的難度回到普通');

/* ============================================================ 位置 */
group('氣球位置（時間的純函式）');

{
  const b = { lane: 0.5, amp: 0.1, period: 2000, phase: 0, spawnAt: T0, upMs: 8000 };
  const p0 = Rules.balloonPos(b, T0);
  near(p0.y, Rules.Y_START, 1e-9, '剛冒出時在舞台下方外面');
  ok(!Rules.onStage(b, T0), '剛冒出時還看不到');
  const pm = Rules.balloonPos(b, T0 + 4000);
  ok(pm.y > 0.2 && pm.y < 0.6, '飛到一半在舞台中間', 'y=' + pm.y);
  ok(Rules.onStage(b, T0 + 4000), '飛到一半看得到');
  near(Rules.balloonPos(b, T0 + 8000).y, Rules.Y_END, 1e-9, '飛完時在舞台上方外面');
  ok(!Rules.onStage(b, T0 + 8000), '飛完看不到');
  /* 左右搖擺不超過幅度 */
  let maxDx = 0;
  for (let t = 0; t < 8000; t += 50) maxDx = Math.max(maxDx, Math.abs(Rules.balloonPos(b, T0 + t).x - 0.5));
  ok(maxDx <= 0.1 + 1e-9 && maxDx > 0.08, '搖擺幅度符合 amp', 'max=' + maxDx);
  /* 同一時刻同一個結果 */
  eq(Rules.balloonPos(b, T0 + 1234).x, Rules.balloonPos(b, T0 + 1234).x, '同一時刻位置一致');
}

/* ============================================================ 計分 */
group('計分');

eq(Rules.scoreHit({ type: 'red', combo: 0 }).gain, 10, '紅氣球 +10');
eq(Rules.scoreHit({ type: 'golden', combo: 0 }).gain, 120, '金色氣球 +120');
eq(Rules.scoreHit({ type: 'twin', combo: 0, killed: false }).gain, 22, '雙層氣球第一下 +22');
eq(Rules.scoreHit({ type: 'twin', combo: 0, killed: true }).gain, 44, '雙層氣球補最後一下拿雙份 +44');
eq(Rules.scoreHit({ type: 'jumbo', combo: 0, killed: true }).gain, 64, '巨無霸最後一下 +64（32×2）');
eq(Rules.scoreHit({ type: 'dove', combo: 0 }).gain, -15, '白鴿 −15');
eq(Rules.scoreHit({ type: 'bomb', combo: 99, buffed: true }).gain, -50, '炸彈扣分不吃連擊與加倍');
eq(Rules.comboMultiplier(4), 1, '4 連擊沒有加成');
near(Rules.comboMultiplier(5), 1.1, 1e-9, '5 連擊 +10%');
near(Rules.comboMultiplier(25), 1.5, 1e-9, '25 連擊 +50%');
near(Rules.comboMultiplier(500), 1.5, 1e-9, '連擊加成最多 +50%');
eq(Rules.scoreHit({ type: 'red', combo: 5 }).gain, 11, '5 連擊的紅氣球 +11');
eq(Rules.scoreHit({ type: 'red', combo: 0, buffed: true }).gain, 20, '加倍中紅氣球 +20');
eq(Rules.scoreHit({ type: 'dove', combo: 0, buffed: true }).gain, -15, '加倍不放大扣分');

/* ============================================================ 射擊 */
group('射擊：合法、非法與先射先得');

{
  const st = fresh();
  const b = addBalloon(st, 'red', T0);
  let res = Rules.shoot(st, 'a', { balloonId: b.id }, T0 + 3000);
  ok(res.ok && res.event.k === 'hit', '射中紅氣球');
  eq(res.event.gain, 10, '得 10 分');
  eq(st.players.a.score, 10, '分數記在射手身上');
  eq(st.balloons.length, 0, '破掉的氣球被移除');
  ok(isFinite(res.event.x) && isFinite(res.event.y), '命中事件帶有位置（特效用）');

  /* 先射先得：同一顆氣球第二個人慢一步 */
  const b2 = addBalloon(st, 'golden', T0 + 100, { upMs: 9000, expireAt: T0 + 9100 });
  const r1 = Rules.shoot(st, 'a', { balloonId: b2.id }, T0 + 3100);
  const r2 = Rules.shoot(st, 'b', { balloonId: b2.id }, T0 + 3101);
  eq(r1.event.k, 'hit', '先射的人拿到氣球');
  eq(r2.event.k, 'miss', '慢一步的人落空');
  ok(r2.event.late === true, '慢一步會標記 late（畫面顯示「慢了一步」）');
  eq(st.players.b.score, 0, '慢一步的人沒分');
  eq(st.players.b.shots, 1, '慢一步仍算一次射擊（拉低命中率）');

  /* 射空不扣分 */
  const before = st.players.b.score;
  res = Rules.shoot(st, 'b', { balloonId: null, x: 0.2, y: 0.3 }, T0 + 4000);
  eq(res.event.k, 'miss', '沒有目標就是射空');
  eq(res.event.x, 0.2, '射空事件回傳座標');
  eq(st.players.b.score, before, '射空不扣分');
  eq(st.players.b.hits, 0, '射空不算命中');

  /* 誤射禁射氣球 */
  const d = addBalloon(st, 'dove', T0 + 4000);
  res = Rules.shoot(st, 'b', { balloonId: d.id }, T0 + 6000);
  eq(res.event.gain, -15, '誤射白鴿 −15');
  eq(st.players.b.badHits, 1, '記一次誤射');
  eq(st.players.b.combo, 0, '誤射連擊歸零');
  ok(st.players.b.score < 0, '分數可以是負的');

  /* 非法：不在局內、時間不對 */
  eq(Rules.shoot(st, 'zzz', { balloonId: 1 }, T0 + 1000).code, 'notplayer', '觀戰者／陌生人不能射擊');
  const early = Rules.createMatch({ seed: 'X', now: T0, countdownMs: 3000, players: [{ id: 'a', name: 'A' }] });
  eq(Rules.shoot(early, 'a', { balloonId: 1 }, T0 + 1000).code, 'phase', '倒數中不能射擊');
  eq(early.players.a.shots, 0, '被拒絕的射擊不計次數');
  const done = fresh();
  Rules.tick(done, T0 + 61000, RNG.createRng('x'));
  ok(done.over, '時間到結算');
  eq(Rules.shoot(done, 'a', { balloonId: 1 }, T0 + 61001).code, 'phase', '結算後不能再射擊');
}

group('射擊：多層氣球、連擊、彩虹加倍');

{
  const st = fresh([{ id: 'a', name: 'A' }]);
  const twin = addBalloon(st, 'twin', T0);
  let r = Rules.shoot(st, 'a', { balloonId: twin.id }, T0 + 2000);
  eq(r.event.killed, false, '雙層氣球第一下沒破');
  eq(r.event.hpLeft, 1, '剩 1 下');
  eq(st.balloons.length, 1, '沒破的氣球還在天上');
  r = Rules.shoot(st, 'a', { balloonId: twin.id }, T0 + 2100);
  eq(r.event.killed, true, '第二下破了');
  eq(st.players.a.score, 22 + 44, '兩下共 66 分（22 + 最後一下 44）');

  const j = addBalloon(st, 'jumbo', T0 + 2200);
  let hits = 0;
  while (st.balloons.includes(j) && hits < 10) { Rules.shoot(st, 'a', { balloonId: j.id }, T0 + 2300 + hits * 10); hits++; }
  eq(hits, 3, '巨無霸要射 3 下');

  /* 連擊 */
  const s2 = fresh([{ id: 'a', name: 'A' }]);
  for (let i = 0; i < 5; i++) {
    const b = addBalloon(s2, 'red', T0);
    Rules.shoot(s2, 'a', { balloonId: b.id }, T0 + 2000 + i);
  }
  eq(s2.players.a.combo, 5, '連續 5 次射中是 5 連擊');
  const b6 = addBalloon(s2, 'red', T0);
  eq(Rules.shoot(s2, 'a', { balloonId: b6.id }, T0 + 2100).event.gain, 11, '第 6 顆吃 +10% 加成');
  eq(s2.players.a.bestCombo, 6, '記錄最佳連擊');
  const dv = addBalloon(s2, 'dove', T0);
  Rules.shoot(s2, 'a', { balloonId: dv.id }, T0 + 2200);
  eq(s2.players.a.combo, 0, '誤射後連擊歸零');
  eq(s2.players.a.bestCombo, 6, '最佳連擊不會被歸零');

  /* 彩虹加倍：6 秒內正分加倍，扣分不加倍，過期恢復 */
  const s3 = fresh([{ id: 'a', name: 'A' }]);
  const rb = addBalloon(s3, 'rainbow', T0);
  Rules.shoot(s3, 'a', { balloonId: rb.id }, T0 + 2000);
  ok(s3.players.a.buffUntil > T0 + 2000, '射破彩虹氣球啟動加倍');
  const r1 = addBalloon(s3, 'red', T0);
  eq(Rules.shoot(s3, 'a', { balloonId: r1.id }, T0 + 3000).event.gain, 20, '加倍中紅氣球 +20');
  const r2 = addBalloon(s3, 'red', T0);
  eq(Rules.shoot(s3, 'a', { balloonId: r2.id }, T0 + 2000 + Rules.BUFF_MS + 10).event.gain <= 11, true, '加倍時間過了恢復正常');
}

/* ============================================================ tick */
group('冒出、飄走與結算（固定種子可重現）');

function runMatch(seed, players, until) {
  const st = Rules.createMatch({ seed, now: T0, countdownMs: 0, roundMs: 60000, players });
  const rng = RNG.createRng('spawn:' + seed);
  const log = [];
  for (let t = T0; t <= T0 + until; t += 50) {
    for (const ev of Rules.tick(st, t, rng)) if (ev.k === 'spawn') log.push(ev.balloon.id + ':' + ev.balloon.type + ':' + ev.balloon.lane.toFixed(3));
  }
  return { st, log };
}
{
  const a = runMatch('AAAA', [{ id: 'a', name: 'A' }], 61000);
  const b = runMatch('AAAA', [{ id: 'a', name: 'A' }], 61000);
  const c = runMatch('BBBB', [{ id: 'a', name: 'A' }], 61000);
  eq(a.log.join('|'), b.log.join('|'), '同一個種子長出同一批氣球');
  ok(a.log.join('|') !== c.log.join('|'), '不同種子長出不同氣球');
  ok(a.log.length >= 50, '一局會冒出夠多的氣球', 'n=' + a.log.length);
  ok(a.st.over, '時間到就結算');
  eq(a.st.balloons.length, 0, '結算時天空清空');
  ok(a.st.escaped > 0, '沒射的氣球會飄走');
  const types = new Set(a.log.map((x) => x.split(':')[1]));
  ok(types.size >= 7, '一局下來見得到大多數種類', 'types=' + types.size);

  /* 同時在場不超過上限 */
  const st = Rules.createMatch({ seed: 'CAP', now: T0, countdownMs: 0, roundMs: 60000, players: [{ id: 'a', name: 'A' }], pace: 'rookie' });
  const rng = RNG.createRng('cap');
  let peak = 0;
  for (let t = T0; t < T0 + 60000; t += 50) { Rules.tick(st, t, rng); peak = Math.max(peak, st.balloons.filter((b) => !Rules.typeOf(b.type).child && !Rules.typeOf(b.type).boss).length); }
  ok(peak <= Rules.scaleStage(Rules.STAGES[2], 'rookie').maxUp, '同時在場不超過階段上限', 'peak=' + peak);

  /* 倒數期間不冒氣球 */
  const cd = Rules.createMatch({ seed: 'CD', now: T0, countdownMs: 3000, players: [{ id: 'a', name: 'A' }] });
  Rules.tick(cd, T0 + 1000, RNG.createRng('cd'));
  eq(cd.balloons.length, 0, '倒數期間不冒氣球');
  eq(Rules.phaseOf(cd, T0 + 1000), 'countdown', '倒數階段');
  eq(Rules.phaseOf(cd, T0 + 3500), 'playing', '開打階段');

  /* 分頁切回來不會瞬間爆量 */
  const lag = Rules.createMatch({ seed: 'LAG', now: T0, countdownMs: 0, players: [{ id: 'a', name: 'A' }] });
  const ev = Rules.tick(lag, T0 + 30000, RNG.createRng('lag'));
  ok(ev.filter((e) => e.k === 'spawn').length <= 4, '一個 tick 最多補 4 顆');
}

group('暫停與恢復');
{
  const st = Rules.createMatch({ seed: 'PAUSE', now: T0, countdownMs: 0, roundMs: 60000, players: [{ id: 'a', name: 'A' }] });
  const rng = RNG.createRng('pause');
  for (let t = T0; t <= T0 + 8000; t += 50) Rules.tick(st, t, rng);
  const live = st.balloons.length;
  ok(live > 0, '暫停前天上有氣球');
  const b = st.balloons[0];
  const yBefore = Rules.balloonPos(b, T0 + 8000).y;
  ok(Rules.pause(st, T0 + 8000), '可以暫停');
  eq(Rules.phaseOf(st, T0 + 9000), 'paused', '暫停階段');
  eq(Rules.shoot(st, 'a', { balloonId: b.id }, T0 + 9000).code, 'phase', '暫停中不能射擊');
  eq(Rules.tick(st, T0 + 20000, rng).length, 0, '暫停中不冒氣球、不飄走');
  eq(st.balloons.length, live, '暫停中氣球數不變');
  eq(Rules.remainMs(st, T0 + 20000), 52000, '暫停中剩餘時間凍結');
  ok(!Rules.pause(st, T0 + 21000), '已經暫停不能重複暫停');
  ok(Rules.resume(st, T0 + 20000), '可以恢復');
  near(Rules.balloonPos(b, T0 + 20000).y, yBefore, 1e-9, '恢復後氣球從原位置接著飄');
  eq(Rules.phaseOf(st, T0 + 20000), 'playing', '恢復後繼續');
  ok(!Rules.resume(st, T0 + 20001), '沒暫停不能恢復');
  ok(!Rules.pause(Rules.finish(fresh(), T0), T0), '結算後不能暫停');
}

/* ============================================================ 排名 */
group('排名與結算');
{
  const st = fresh([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]);
  st.players.a.score = 50; st.players.b.score = 80; st.players.c.score = 80;
  st.players.b.hits = 3; st.players.c.hits = 5;
  let r = Rules.standings(st);
  eq(r[0].id, 'c', '同分時射中數多的在前');
  eq(r[0].rank, 1, '第一名名次 1');
  eq(r[1].rank, 1, '同分的名次相同（細項只決定排列順序）');
  eq(r[2].rank, 3, '同分兩人並列第一，下一名是第三');
  /* 平手 */
  const t = fresh([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  Rules.finish(t, T0 + 60000);
  ok(t.draw && t.winner === null, '同分是平手');
  const w = fresh([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  w.players.a.score = 10;
  Rules.finish(w, T0 + 60000);
  ok(!w.draw && w.winner === 'a', '分數高的是贏家');
  eq(Rules.snapshot(w, T0 + 60000).phase, 'over', '快照反映結算階段');
  ok(Array.isArray(Rules.snapshot(w, T0).balloons), '快照一定有氣球清單');
  ok(!('rng' in Rules.snapshot(w, T0)), '快照不含任何內部亂數');
}

/* ============================================================ AI */
group('電腦射手');

function aiRun(level, seed, pace) {
  const st = Rules.createMatch({ seed, now: T0, countdownMs: 0, roundMs: 60000, pace: pace || 'normal', players: [{ id: 'a', name: 'A', ai: level }] });
  const rng = RNG.createRng('spawn:' + seed);
  const brain = AI.createBrain(level, 'brain:' + seed);
  let calls = 0, maxMs = 0, illegal = 0;
  for (let t = T0; t <= T0 + 61000; t += 50) {
    Rules.tick(st, t, rng);
    if (st.over) break;
    const t1 = process.hrtime.bigint();
    const aim = brain.step(Rules.snapshot(st, t), t);
    maxMs = Math.max(maxMs, Number(process.hrtime.bigint() - t1) / 1e6);
    calls++;
    if (aim) {
      if (aim.balloonId && !Rules.liveBalloon(st, aim.balloonId)) illegal++;
      const res = Rules.shoot(st, 'a', aim, t);
      if (!res.ok) illegal++;
    }
  }
  return { p: st.players.a, illegal, maxMs, calls };
}
const avg = {};
for (const lv of AI.ORDER) {
  const runs = [1, 2, 3, 4, 5, 6].map((i) => aiRun(lv, 'S' + i));
  avg[lv] = {
    score: runs.reduce((s, r) => s + r.p.score, 0) / runs.length,
    bad: runs.reduce((s, r) => s + ['dove', 'lantern', 'bomb'].reduce((n, k) => n + (r.p.byType[k] || 0), 0), 0) / runs.length,
    shots: runs.reduce((s, r) => s + r.p.shots, 0) / runs.length,
    acc: runs.reduce((s, r) => s + Rules.accuracyOf(r.p), 0) / runs.length
  };
  ok(runs.every((r) => r.illegal === 0), lv + '：只產生合法射擊');
  ok(runs.every((r) => r.maxMs < 15), lv + '：單次思考小於 15ms', 'max=' + Math.max(...runs.map((r) => r.maxMs)).toFixed(2));
}
ok(avg.rookie.score < avg.easy.score && avg.easy.score < avg.normal.score && avg.normal.score < avg.hard.score,
  '難度愈高分數愈高', JSON.stringify(Object.keys(avg).map((k) => Math.round(avg[k].score))));
ok(avg.rookie.bad / avg.rookie.shots > avg.hard.bad / avg.hard.shots, '新手誤射率比困難高（只算白鴿／天燈／炸彈）', 'rookie=' + (avg.rookie.bad / avg.rookie.shots).toFixed(3) + ' hard=' + (avg.hard.bad / avg.hard.shots).toFixed(3));
ok(avg.rookie.acc < avg.hard.acc, '困難命中率比新手高', 'rookie=' + avg.rookie.acc.toFixed(2) + ' hard=' + avg.hard.acc.toFixed(2));
ok(avg.hard.shots > avg.rookie.shots, '困難出手比新手快（出手次數較多）');
console.log('   各難度平均（60 秒、單獨射）：' + AI.ORDER.map((k) => AI.levelOf(k).label + ' ' + Math.round(avg[k].score)).join('／'));
eq(AI.levelOf('???').key, 'normal', '不認得的 AI 難度回到普通');
for (const level of AI.ORDER) {
  const st = fresh([{ id: 'a', name: 'A', ai: level }]);
  const b = addBalloon(st, 'red', T0);
  const brain = AI.createBrain(level, 'visibility:' + level);
  const visibleAt = T0 + b.upMs * (Rules.Y_START - 0.85) / (Rules.Y_START - Rules.Y_END);
  let firstShot = null;
  for (let now = T0; now < b.expireAt; now += 20) {
    if (brain.step(Rules.snapshot(st, now), now)) { firstShot = now; break; }
  }
  ok(firstShot !== null && firstShot >= visibleAt + 450,
    level + '：氣球進入舞台安全區後至少留 450ms 反應時間', 'delay=' + Math.round(firstShot - visibleAt));

  const lateBrain = AI.createBrain(level, 'late:' + level);
  const lateAt = T0 + 3500;
  eq(lateBrain.step(Rules.snapshot(st, lateAt), lateAt), null,
    level + '：第一次看到已飛出的氣球仍須等待反應時間');
}
{
  /* 同一個種子 AI 行為可重現；AI 不會對還沒冒出／已被射掉的氣球出手 */
  const a = aiRun('normal', 'REPLAY'), b = aiRun('normal', 'REPLAY');
  eq(a.p.score, b.p.score, '固定種子：AI 結果可重現');
  /* 看不到的東西不會被射：剛冒出（還在舞台下方）的氣球 */
  const st = fresh([{ id: 'a', name: 'A', ai: 'hard' }]);
  const b1 = addBalloon(st, 'golden', T0);
  const brain = AI.createBrain('hard', 'x');
  eq(brain.step(Rules.snapshot(st, T0 + 200), T0 + 200), null, 'AI 不會射還沒飄進舞台的氣球');
}

/* ============================================================ 文字清洗 */
group('文字清洗');
eq(sanitizeName('  小明  '), '小明', '暱稱去頭尾空白');
eq(sanitizeName('A​B‮C'), 'ABC', '拿掉零寬與方向控制字元');
eq(sanitizeName('', '玩家9'), '玩家9', '空名字用預設');
eq(sanitizeName('一二三四五六七八九十甲乙丙丁').length, 12, '暱稱最多 12 字');
eq(sanitizeText('a'.repeat(300), 120).length, 120, '訊息最多 120 字');
eq(sanitizeText('\u0000\u0007hi'), 'hi', '拿掉控制字元');

/* ============================================================ 房間 */
group('房間：生命週期（實體玩家 / AI / 觀戰分開算）');
{
  const store = new RoomStore({});
  const made = store.create('host1', { name: '房主', now: T0 });
  ok(made.ok, '建立房間');
  const room = made.room;
  eq(room.code.length, 5, '房號 5 碼');
  ok(!/[01OI]/.test(room.code), '房號不含 0 O 1 I');
  eq(room.humanCount(), 1, '一位實體玩家');

  const j = room.join('p2', { name: '乙', now: T0 + 1 });
  ok(j.ok && j.member.role === 'player', '第二位進來是玩家');
  const sp = room.join('s1', { name: '觀', role: 'spectator', now: T0 + 2 });
  eq(sp.member.role, 'spectator', '指定觀戰就是觀戰');
  eq(room.humanCount(), 2, '觀戰者不算實體玩家');
  room.addAi('host1', 'easy');
  eq(room.humanCount(), 2, 'AI 席位不算實體玩家');
  eq(room.seatCount(), 3, 'AI 佔座位');

  /* 站起來守門：唯一的玩家不能改觀戰 */
  const lone = store.create('solo1', { name: '獨', now: T0 });
  eq(lone.room.becomeSpectator('solo1').code, 'lastplayer', '唯一的玩家不能改成觀戰');

  /* 玩家全走光、只剩 AI 與觀戰者 → 立刻判定要關 */
  room.createInvite('host1', { now: T0 + 3, role: 'player' });
  eq(room.invites.size, 1, '有一張邀請');
  const l1 = room.leave('host1', T0 + 10);
  ok(l1.ok && !l1.emptied, '還有一位玩家，不關');
  eq(room.hostId, 'p2', '房主離開後換人');
  const l2 = room.leave('p2', T0 + 11);
  ok(l2.emptied, '最後一位實體玩家離開（只剩 AI 與觀戰者）→ emptied');
  const closed = store.close(room.code);
  ok(closed && closed.phase === 'closed', '關房後 phase = closed');
  eq(closed.invites.size, 0, '關房後邀請全部失效');
  eq(closed.state, null, '關房後清掉對局');
  eq(store.get(room.code), null, '關房後房間查不到');
  eq(closed.join('late', { name: '遲', now: T0 + 20 }).code, 'closed', '已關閉的房間不能再加入（重連也不行）');
}

group('房間：斷線保留與回收');
{
  const store = new RoomStore({});
  const room = store.create('h', { name: 'H', now: T0 }).room;
  room.join('p', { name: 'P', now: T0 });
  room.disconnect('p', T0 + 1000);
  let swept = store.sweep(T0 + 1000 + DISCONNECT_GRACE_MS - 1);
  eq(swept.closed.length, 0, '寬限期內座位保留');
  ok(room.join('p', { name: 'P', now: T0 + 5000 }).reconnected, '寬限期內重連回到原位');
  /* 兩個人都斷線超過寬限 → 沒有實體玩家 → 回收並關房 */
  room.disconnect('p', T0 + 6000); room.disconnect('h', T0 + 6000);
  room.join('spec', { name: '觀', role: 'spectator', now: T0 + 6001 });
  swept = store.sweep(T0 + 6000 + DISCONNECT_GRACE_MS + 10);
  eq(swept.closed.length, 1, '玩家都斷線過期後，就算還有觀戰者也要關房');
  eq(swept.closed[0].phase, 'closed', '被回收的房間標記 closed');
  eq(store.size(), 0, '房間被移除');
}

group('房間：座位、準備、開始、規則設定');
{
  const store = new RoomStore({});
  const room = store.create('h', { name: 'H', now: T0 }).room;
  eq(room.canStart().ok, false, '房主沒準備不能開始');
  room.setReady('h', true);
  eq(room.canStart().ok, true, '準備好就能開始');
  eq(room.start('zzz', T0).code, 'perm', '非房主不能開始');
  const g = room.join('g', { name: 'G', now: T0 });
  eq(room.canStart().ok, false, '有人沒準備不能開始');
  room.setReady('g', true);
  ok(room.start('h', T0, { countdownMs: 0 }).ok, '房主可以開始');
  eq(room.phase, 'countdown', '開始後進倒數');
  eq(room.shoot('h', { balloonId: null }, T0 + 1).code, 'phase', '倒數期間射擊被擋下');
  eq(room.setPace('h', 'hard').code, 'phase', '對局中不能改難度');
  eq(room.setRound('h', 75).code, 'phase', '對局中不能改局長');
  eq(room.addAi('h', 'easy').code, 'phase', '對局中不能加 AI');
  const sp = room.join('s', { name: '觀', now: T0 });
  eq(sp.member.role, 'spectator', '對局中進來的人先觀戰');
  ok(sp.waiting, '標記為等下一局');
  eq(room.shoot('s', { balloonId: 1 }, T0 + 1000).code, 'role', '觀戰者不能射擊');
  eq(room.setReady('s', true).code, 'role', '觀戰者不能準備');

  /* 打完 → 重來投票 */
  Rules.tick(room.state, T0 + 61000, room.rng);
  room.step(T0 + 61000);
  eq(room.phase, 'over', '時間到進結算');
  eq(room.voteRematch('s', T0 + 62000).code, 'role', '觀戰者不能投票再來一局');
  ok(!room.voteRematch('h', T0 + 62000).started, '一個人投票還不夠');
  const rv = room.voteRematch('g', T0 + 62001);
  ok(rv.started, '所有玩家同意就重開');
  eq(room.phase, 'countdown', '重開進倒數');
  eq(room.state.players.h.score, 0, '重開後分數歸零');
  eq(room.state.balloons.length, 0, '重開後天上沒有舊氣球');

  /* 回房間：只有房主 */
  Rules.tick(room.state, T0 + 130000, room.rng); room.step(T0 + 130000);
  eq(room.backToLobby('g', T0 + 131000).code, 'perm', '非房主不能回房間');
  ok(room.backToLobby('h', T0 + 131000).ok, '房主可以回房間');
  eq(room.phase, 'lobby', '回到準備階段');
  eq(room.state, null, '回房間清掉舊對局');
  ok(room.members.get('h').ready === false, '回房間後準備狀態重置');
  ok(room.setRound('h', 90).ok && room.roundMs === 90000, '房主可以改局長');
  eq(room.setRound('h', 33).code, 'badround', '不合法的局長被擋下');
  ok(room.setPace('h', 'hard').ok, '房主可以改難度');
  eq(room.setPace('h', 'nope').code, 'badpace', '不合法的難度被擋下');
  eq(room.setPace('g', 'easy').code, 'perm', '非房主不能改難度');
}

group('房間：再來一局投票在有人離開後不會卡住（回歸測試）');
{
  const store = new RoomStore({ countdownMs: 0 });
  const room = store.create('a', { name: 'A', now: T0 }).room;
  room.join('b', { name: 'B', now: T0 });
  room.setReady('a', true); room.setReady('b', true);
  room.start('a', T0, { countdownMs: 0 });
  Rules.tick(room.state, T0 + 61000, room.rng); room.step(T0 + 61000);
  eq(room.phase, 'over', '先打完一局');
  ok(!room.voteRematch('a', T0 + 62000).started, 'A 先投票，還差 B');
  const lv = room.leave('b', T0 + 63000);
  ok(lv.ok && !lv.emptied, 'B 離開，房間還有 A');
  ok(room.maybeRematchStart(T0 + 63000).started, '需要的票數變少、A 已投過 → 自動開下一局（以前會卡在結算）');
  eq(room.phase, 'countdown', '進入倒數');
  eq(room.state.order.length, 1, '新的一局只有留下的玩家');
  eq(room.maybeRematchStart(T0 + 63001).started, false, '已經在打的局不會重複開始');
  /* 房間設定的倒數時間會被沿用 */
  eq(room.state.countdownMs, 0, '重開局沿用伺服器設定的倒數時間');
}

group('房間：邀請 token');
{
  const store = new RoomStore({});
  const room = store.create('h', { name: 'H', now: T0 }).room;
  eq(room.createInvite('x', { now: T0 }).code, 'perm', '非房主不能產生邀請');
  const iv = room.createInvite('h', { now: T0, role: 'spectator', maxUses: 2, ttlMs: 60000 }).invite;
  ok(/^[a-f0-9]{24}$/.test(iv.token), 'token 不可猜測（24 位十六進位）');
  const a = room.join('a', { name: 'A', role: 'player', token: iv.token, now: T0 + 1 });
  eq(a.member.role, 'spectator', '觀戰邀請：就算要求玩家也只能觀戰（角色由 token 決定）');
  eq(room.checkInvite('nope', T0).code, 'badinvite', '不存在的 token');
  eq(room.checkInvite(iv.token, T0 + 70000).code, 'expired', '過期');
  room.revokeInvite('h', iv.token);
  eq(room.checkInvite(iv.token, T0 + 2).code, 'revoked', '撤銷');
  const iv2 = room.createInvite('h', { now: T0, role: 'player', maxUses: 1 }).invite;
  room.join('b', { name: 'B', token: iv2.token, now: T0 + 1 });
  eq(room.checkInvite(iv2.token, T0 + 2).code, 'used', '次數用完');
  const priv = store.create('ph', { name: 'PH', private: true, now: T0 }).room;
  eq(priv.join('stranger', { name: 'S', now: T0 }).code, 'private', '私人房沒有 token 進不來');
  const iv3 = priv.createInvite('ph', { now: T0 }).invite;
  ok(priv.join('friend', { name: 'F', token: iv3.token, now: T0 }).ok, '私人房憑 token 進得來');
  ok(store.list().every((r) => !r.private), '大廳列表不列私人房');
  /* 滿房轉觀戰 */
  const full = store.create('fh', { name: 'FH', now: T0 }).room;
  for (let i = 0; i < 4; i++) full.join('p' + i, { name: 'P' + i, now: T0 });
  const over = full.join('extra', { name: 'E', now: T0 });
  eq(over.member.role, 'spectator', '席位滿了轉觀戰');
  ok(over.downgraded, '明確標記為降級觀戰');
  const brief = full.viewFor('extra', T0);
  eq(brief.you.can.shoot, false, '觀戰者沒有射擊權限旗標');
}

group('房間：聊天');
{
  const store = new RoomStore({});
  const room = store.create('h', { name: 'H', now: T0 }).room;
  room.join('g', { name: 'G', now: T0 });
  ok(room.say('h', '你好', T0 + 1000).ok, '可以發言');
  eq(room.say('h', '連發', T0 + 1100).code, 'rate', '頻率限制');
  eq(room.say('h', '   ', T0 + 5000).code, 'empty', '空訊息被擋');
  const long = room.say('h', 'x'.repeat(500), T0 + 9000);
  eq(long.message.text.length, 120, '長訊息被截到 120 字');
  const m = room.say('g', '<b>hi</b>', T0 + 12000);
  ok(m.ok && m.message.text === '<b>hi</b>', '伺服器不改寫 HTML（由前端轉義顯示）');
  eq(room.mute('g', 'h', 60, T0).code, 'perm', '非房主不能禁言');
  ok(room.mute('h', 'g', 60, T0 + 13000).ok, '房主可以禁言');
  eq(room.say('g', '還能說嗎', T0 + 14000).code, 'muted', '被禁言的人不能發言');
  ok(room.say('g', '禁言過了', T0 + 13000 + 61000).ok, '禁言到期恢復');
}

group('房間：觀戰者看到的投影');
{
  const store = new RoomStore({});
  const room = store.create('h', { name: 'H', now: T0 }).room;
  room.setReady('h', true);
  room.join('s', { name: '觀', role: 'spectator', now: T0 });
  room.start('h', T0, { countdownMs: 0 });
  Rules.tick(room.state, T0 + 3000, room.rng);
  const sv = room.viewFor('s', T0 + 3000), pv = room.viewFor('h', T0 + 3000);
  eq(JSON.stringify(sv.match.balloons), JSON.stringify(pv.match.balloons), '觀戰者與玩家看到同一片天空');
  eq(sv.invites.length, 0, '非房主看不到邀請清單');
  eq(sv.you.role, 'spectator', '投影標明自己的角色');
  ok(!JSON.stringify(sv).includes('"clientId"'), '投影不含 clientId');
}

/* ============================================================ 設定解析 */
group('server URL 設定解析');
{
  const Config = (() => {
    global.window = { location: { search: '', protocol: 'https:', origin: 'https://x.github.io', pathname: '/shoot/' } };
    delete require.cache[require.resolve('../public/js/config.js')];
    require('../public/js/config.js');
    return global.window.GameConfig;
  })();
  const r = Config._resolve;
  eq(r('', '', 'https:', 'https://game.example').source, 'same-origin', '沒設定 → 同源');
  eq(r('', '', 'file:', '').status, 'unset', 'file:// 沒設定 → 單機');
  eq(r('https://srv.example/', '', 'https:', 'https://x').url, 'https://srv.example', '注入值去掉結尾斜線');
  eq(r('https://srv.example', 'https://q.example', 'https:', 'https://x').url, 'https://q.example', '網址參數優先於注入');
  eq(r('http://srv.example', '', 'https:', 'https://x').status, 'invalid', 'https 頁面不能連 http');
  eq(r('ftp://srv.example', '', 'https:', 'https://x').status, 'invalid', '只接受 http/https');
  eq(r('not a url', '', 'https:', 'https://x').status, 'invalid', '格式不對被擋下');
  ok(Config.inviteUrl('ABCDE', 'tok').indexOf('room=ABCDE') > 0, '邀請連結帶房號');
  ok(!/localhost|onrender/.test(require('fs').readFileSync(require('path').join(__dirname, '../public/js/config.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), 'config.js 沒有寫死任何網域');
}

/* ============================================================ 分身／福袋／Boss */
group('分身氣球');
{
  const st = fresh([{ id: 'a', name: 'A' }]);
  const sp = addBalloon(st, 'split', T0, { lane: 0.5, upMs: 8000, expireAt: T0 + 8000 });
  const res = Rules.shoot(st, 'a', { balloonId: sp.id }, T0 + 2000);
  ok(res.ok && res.event.killed, '分身氣球一下就破');
  eq(res.event.gain, 35, '分身氣球 +35');
  eq(res.extra.length, 3, '射破後生出 3 顆小氣球');
  ok(res.extra.every((e) => e.k === 'spawn' && e.balloon.type === 'mini'), '附屬的都是小分身');
  eq(st.balloons.length, 3, '天上只剩 3 顆小分身');
  const ys = res.extra.map((e) => e.balloon.y0);
  ok(ys.every((y) => y === res.event.y), '小分身從爆開點起飛', JSON.stringify(ys) + ' vs ' + res.event.y);
  const xs0 = res.extra.map((e) => Rules.balloonPos(e.balloon, T0 + 2000).x);
  near(xs0[0], res.event.x, 0.002, '剛爆開時還在原位');
  const xs1 = res.extra.map((e) => Rules.balloonPos(e.balloon, T0 + 3000).x);
  ok(xs1[2] - xs1[0] > 0.08, '爆開後左右兩顆散開', JSON.stringify(xs1));
  const extraJson = JSON.stringify(res.extra);
  const again = Rules.shoot(st, 'a', { balloonId: res.extra[0].balloon.id }, T0 + 2700);
  eq(again.event.gain, 15, '小分身 +15');
  eq(again.extra.length, 0, '小分身不會再分裂');
  /* 同種子同結果 */
  const st2 = fresh([{ id: 'a', name: 'A' }]);
  const sp2 = addBalloon(st2, 'split', T0, { lane: 0.5, upMs: 8000, expireAt: T0 + 8000 });
  const res2 = Rules.shoot(st2, 'a', { balloonId: sp2.id }, T0 + 2000);
  eq(JSON.stringify(res2.extra), extraJson, '小分身只靠種子，可重現');
}

group('幸運福袋氣球');
{
  const seen = { good: 0, bad: 0 };
  const vals = new Set();
  for (let i = 1; i <= 400; i++) { const v = Rules.rollLuck('LUCKYSEED', i); vals.add(v); if (v > 0) seen.good++; else seen.bad++; }
  ok(seen.good > 0 && seen.bad > 0, '福袋有加分也有扣分', JSON.stringify(seen));
  ok([...vals].every((v) => [40, 70, 110, -20, -40].includes(v)), '福袋只開得出固定幾種分數', [...vals].join());
  ok(seen.good > seen.bad, '福袋期望值略偏正', JSON.stringify(seen));
  eq(Rules.rollLuck('S', 7), Rules.rollLuck('S', 7), '同一顆福袋結果固定');
  const st = fresh([{ id: 'a', name: 'A' }]);
  let goodSeen = false, badSeen = false;
  for (let i = 0; i < 60 && !(goodSeen && badSeen); i++) {
    const b = addBalloon(st, 'lucky', T0, { upMs: 8000, expireAt: T0 + 8000 });
    const before = st.players.a.score, combo = st.players.a.combo;
    const r = Rules.shoot(st, 'a', { balloonId: b.id }, T0 + 1000);
    eq(r.event.gain, st.players.a.score - before, '福袋分數與事件一致');
    if (r.event.gain > 0) { goodSeen = true; eq(st.players.a.combo, combo + 1, '福袋加分算連擊'); ok(!r.event.bad, '加分福袋不算誤射'); }
    else { badSeen = true; eq(st.players.a.combo, 0, '福袋扣分連擊歸零'); ok(r.event.bad, '扣分福袋算誤射'); }
  }
  ok(goodSeen && badSeen, '60 顆福袋裡兩種結果都出現');
  const flat = Rules.scoreHit({ type: 'lucky', combo: 99, buffed: true, luck: -40 });
  eq(flat.gain, -40, '福袋扣分不吃連擊與加倍');
  eq(Rules.scoreHit({ type: 'lucky', combo: 0, luck: 70 }).gain, 70, '福袋加分 +70');
}

group('Boss 氣球');
{
  const st = fresh([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  const rng = RNG.createRng('boss');
  let bossEv = null;
  for (let t = T0; t < T0 + 61000 && !bossEv; t += 50) {
    const evs = Rules.tick(st, t, rng);
    bossEv = evs.find((e) => e.k === 'spawn' && e.balloon.type === 'boss') || null;
    if (bossEv) bossEv.t = t;
  }
  ok(!!bossEv, '一局裡 Boss 會登場');
  ok(bossEv && bossEv.t - T0 >= 60000 * Rules.BOSS_AT - 100, 'Boss 在後段才登場', 't=' + (bossEv && bossEv.t - T0));
  eq(bossEv.balloon.hp, 13, '2 人的 Boss 血量 13');
  eq(Rules.snapshot(st, bossEv.t).bossState, 'live', '快照看得到 Boss 在場');
  let bossCount = 0;
  for (let t = bossEv.t; t < T0 + 60000; t += 50) {
    const evs = Rules.tick(st, t, rng);
    bossCount += evs.filter((e) => e.k === 'spawn' && e.balloon.type === 'boss').length;
  }
  eq(bossCount, 0, 'Boss 一局只出現一次');

  /* 手動打：A 打 8 下、B 打 5 下（B 補最後一下） */
  const s2 = fresh([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  const boss = addBalloon(s2, 'boss', T0, { hp: 13, hpLeft: 13, upMs: 14000, expireAt: T0 + 14000, contrib: {} });
  s2.bossState = 'live';
  let last = null;
  for (let i = 0; i < 8; i++) last = Rules.shoot(s2, 'a', { balloonId: boss.id }, T0 + 1000 + i * 10);
  ok(!last.event.killed, 'Boss 不是一兩下打得死');
  for (let i = 0; i < 5; i++) last = Rules.shoot(s2, 'b', { balloonId: boss.id }, T0 + 2000 + i * 10);
  ok(last.event.killed, '打滿血量就擊破');
  eq(s2.bossState, 'killed', '狀態變成已擊破');
  const rw = {}; last.event.bossReward.forEach((r) => { rw[r.id] = r.gain; });
  eq(rw.a, Math.round(Rules.BOSS_POOL * 8 / 13), '貢獻 8 下的 A 依比例拿獎勵');
  eq(rw.b, Math.round(Rules.BOSS_POOL * 5 / 13) + Rules.BOSS_LAST_BONUS, '補最後一下的 B 多拿加成');
  eq(last.event.score, s2.players.b.score, '事件上的分數已包含獎勵');
  eq(s2.players.b.bossKills, 1, '記下 B 擊破 Boss 一次');
  eq(s2.players.a.bossHits, 8, '記下 A 打了 8 下');
  eq(s2.balloons.length, 0, '擊破後天空清空');
  /* 沒打死、飄走 */
  const s3 = fresh([{ id: 'a', name: 'A' }]);
  addBalloon(s3, 'boss', T0, { hp: 10, hpLeft: 10, upMs: 4000, expireAt: T0 + 4000, contrib: {} });
  s3.bossState = 'live'; s3.bossAt = T0 + 999999;
  Rules.tick(s3, T0 + 4500, RNG.createRng('x'));
  eq(s3.bossState, 'escaped', 'Boss 飄走就算逃走');
  /* 暫停會順延登場時間 */
  const s4 = fresh([{ id: 'a', name: 'A' }]);
  const at0 = s4.bossAt;
  Rules.pause(s4, T0 + 1000); Rules.resume(s4, T0 + 6000);
  eq(s4.bossAt, at0 + 5000, '暫停會順延 Boss 登場時間');
  /* 小分身與 Boss 不佔同時在場名額 */
  const s5 = fresh([{ id: 'a', name: 'A' }]);
  addBalloon(s5, 'boss', T0, {}); addBalloon(s5, 'mini', T0, {});
  eq(Rules.snapshot(s5, T0).balloons.length, 2, '快照包含 Boss 與小分身');
}

console.log('\n══════════ 結果 ══════════');
console.log('通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
if (fail) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通過 ✔');
