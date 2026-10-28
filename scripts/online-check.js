/*
 * scripts/online-check.js — 真的開伺服器、用多個獨立 socket 用戶端打一場線上對戰
 *
 *   node scripts/online-check.js
 *
 * 涵蓋：建立／加入／離開、準備與開始、搶射先到先得、觀戰權限、邀請連結
 * （先確認不會加入、角色由 token 決定、撤銷／過期／次數）、聊天室限制、
 * 再來一局投票、回房間、斷線重連、零實體玩家自動關房（含只剩 AI 與觀戰者）。
 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3200 + Math.floor(Math.random() * 500);
const URL_ = 'http://localhost:' + PORT;
let pass = 0, failN = 0;
const fails = [];
function ok(c, name, extra) { if (c) { pass++; return true; } failN++; fails.push(name + (extra ? ' → ' + extra : '')); return false; }
function eq(a, b, name) { return ok(a === b, name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function group(t) { console.log('\n── ' + t); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitHealth() {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      http.get(URL_ + '/health', (res) => { res.resume(); resolve(); })
        .on('error', () => { if (Date.now() - t0 > 8000) reject(new Error('server did not start')); else setTimeout(poll, 150); });
    })();
  });
}

/* 一個獨立的用戶端：自己的 clientId、自己的 socket、記錄所有事件 */
function client(name, clientId) {
  const c = {
    name, clientId: clientId || ('cl' + Math.random().toString(36).slice(2, 12) + 'x'),
    view: null, events: [], errors: [], chats: [], closed: null, left: false, rooms: null
  };
  c.socket = io(URL_, { transports: ['websocket'], reconnection: false, forceNew: true });
  c.socket.on('room:sync', (v) => { c.view = v; });
  c.socket.on('room:events', (p) => { c.events.push(...p.events); });
  c.socket.on('room:error', (e) => { c.errors.push(e); });
  c.socket.on('room:chat', (p) => { c.chats.push(p.message); });
  c.socket.on('room:closed', (p) => { c.closed = p; });
  c.socket.on('room:left', () => { c.left = true; });
  c.socket.on('lobby:rooms', (p) => { c.rooms = p; });
  c.hello = () => new Promise((resolve) => {
    const go = () => c.socket.emit('hello', { clientId: c.clientId, name }, (res) => resolve(res));
    if (c.socket.connected) go(); else c.socket.once('connect', go);
  });
  c.ask = (evt, payload) => new Promise((resolve) => c.socket.emit(evt, payload || {}, (res) => resolve(res)));
  c.send = (evt, payload) => c.socket.emit(evt, payload || {});
  c.until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 3000)) { if (fn()) return true; await sleep(30); } return false; };
  c.lastError = () => c.errors[c.errors.length - 1];
  return c;
}

async function main() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), ROUND_MS: '5000', COUNTDOWN_MS: '300', GAME_ALLOWED_ORIGIN: '*' }),
    stdio: 'ignore'
  });
  const all = [];
  const mk = (n, id) => { const c = client(n, id); all.push(c); return c; };
  const helloed = async (n) => { const c = mk(n); await c.hello(); return c; };
  try {
    await waitHealth();

    group('健康檢查與大廳');
    const health = await new Promise((r) => http.get(URL_ + '/health', (res) => { let d = ''; res.on('data', (x) => d += x); res.on('end', () => r(JSON.parse(d))); }));
    ok(health.ok === true && health.service === 'shoot-balloon', '/health 回報服務名稱');

    const H = mk('房主'), P = mk('乙乙'), S = mk('觀戰甲');
    for (const c of [H, P, S]) await c.hello();

    group('建立房間、加入、準備、開始');
    const made = await H.ask('room:create', { name: '房主', roomName: '測試攤位', pace: 'normal' });
    ok(made.ok && made.code.length === 5, '建立房間拿到 5 碼房號');
    const code = made.code;
    await H.until(() => H.view);
    eq(H.view.you.role, 'player', '房主是玩家');
    ok(H.view.you.host, '房主標示');
    ok(!('board' in H.view) && H.view.pace === 'normal', '房間設定只有難度與局長（沒有盤面）');

    P.send('lobby:subscribe');
    await P.until(() => P.rooms && P.rooms.rooms.some((r) => r.code === code));
    ok(P.rooms.rooms.some((r) => r.code === code && r.name === '測試攤位'), '大廳列表看得到公開房間');
    eq(P.rooms.online, 3, '在線人數包含房間內的玩家');
    const countProbe = await helloed('人數測試');
    ok(await P.until(() => P.rooms.online === 4), '新連線更新在線人數');
    countProbe.socket.disconnect();
    ok(await P.until(() => P.rooms.online === 3), '斷線更新在線人數');

    const jP = await P.ask('room:join', { code, name: '乙乙' });
    ok(jP.ok && jP.role === 'player' && jP.name === '乙乙', '玩家加入，回傳最終暱稱');
    const jS = await S.ask('room:join', { code, name: '觀戰甲', role: 'spectator' });
    eq(jS.role, 'spectator', '觀戰者加入');
    await H.until(() => H.view.members.length === 3);

    S.send('room:ready', { ready: true });
    await S.until(() => S.lastError());
    eq(S.lastError().code, 'role', '觀戰者不能準備');
    S.send('room:start');
    await S.until(() => S.errors.length >= 2);
    eq(S.lastError().code, 'perm', '非房主不能開始');

    H.send('room:ready', { ready: true });
    H.send('room:start');
    await H.until(() => H.errors.length);
    ok(/還沒按準備/.test(H.lastError().message), '有人沒準備不能開始', JSON.stringify(H.lastError()));
    P.send('room:ready', { ready: true });
    await H.until(() => H.view.members.find((m) => m.id === P.clientId).ready);
    H.send('room:addAi', { level: 'easy' });
    await H.until(() => H.view.ai.length === 1);
    eq(H.view.ai.length, 1, '房主加了一個電腦對手');
    P.send('room:addAi', { level: 'hard' });
    await P.until(() => P.errors.length);
    eq(P.lastError().code, 'perm', '非房主不能加電腦對手');

    H.send('room:start');
    await H.until(() => H.view.phase === 'countdown');
    eq(H.view.phase, 'countdown', '進入倒數');
    await P.until(() => P.view.phase === 'countdown');
    await S.until(() => S.view && S.view.phase === 'countdown');
    ok(S.view.phase === 'countdown', '觀戰者同步看到倒數');
    await H.until(() => H.view.phase === 'playing', 3000);
    eq(H.view.phase, 'playing', '倒數完進入對戰');

    group('搶射：先到先得、觀戰不能射擊');
    /* 等一顆氣球飄進舞台 */
    await H.until(() => H.events.some((e) => e.k === 'spawn'), 4000);
    const spawn = H.events.find((e) => e.k === 'spawn');
    ok(!!spawn, '伺服器廣播冒出事件');
    ok(spawn.balloon && typeof spawn.balloon.lane === 'number' && spawn.balloon.upMs > 0, '冒出事件帶有完整的飛行參數');
    await sleep(900);
    const target = H.events.filter((e) => e.k === 'spawn').map((e) => e.balloon).find((b) => Date.now() < b.expireAt - 1500);
    ok(!!target, '找到一顆還在天上的氣球');
    S.errors.length = 0;
    S.send('room:shoot', { balloonId: target.id, x: 0.5, y: 0.5 });
    await S.until(() => S.errors.length);
    eq(S.lastError().code, 'role', '觀戰者射擊被擋下');

    H.events.length = 0; P.events.length = 0; S.events.length = 0;
    H.send('room:shoot', { balloonId: target.id, x: 0.5, y: 0.5 });
    P.send('room:shoot', { balloonId: target.id, x: 0.5, y: 0.5 });
    await H.until(() => H.events.filter((e) => e.k === 'hit' || (e.k === 'miss' && e.by)).length >= 2, 2500);
    const hits = H.events.filter((e) => e.k === 'hit' && e.id === target.id);
    const lateMiss = H.events.filter((e) => e.k === 'miss' && e.late);
    eq(hits.length, 1, '同一顆氣球只有一個人拿到分');
    ok(lateMiss.length >= 1 || hits.length === 1, '另一個人慢一步', JSON.stringify(H.events));
    ok(S.events.some((e) => e.k === 'hit'), '觀戰者也收到命中事件');
    ok(typeof hits[0].score === 'number' && hits[0].gain === Rules().typeOf(target.type).points, '伺服器算分且與規則一致', JSON.stringify(hits[0]));

    /* 用戶端自稱的位置不能影響分數：id 不存在就是射空 */
    H.events.length = 0;
    H.send('room:shoot', { balloonId: 99999, x: 0.5, y: 0.5 });
    await H.until(() => H.events.some((e) => e.k === 'miss'));
    ok(H.events.some((e) => e.k === 'miss' && e.by === H.clientId), '不存在的氣球編號算射空');

    group('聊天室：頻率限制、消毒、觀戰者可讀');
    H.send('room:chat', { text: '大家好' });
    await S.until(() => S.chats.length >= 1);
    eq(S.chats[0].text, '大家好', '觀戰者收得到聊天');
    H.errors.length = 0;
    H.send('room:chat', { text: '連發' });
    await H.until(() => H.errors.length);
    eq(H.lastError().code, 'rate', '短時間連發被擋');
    await sleep(800);
    H.send('room:chat', { text: 'a\u0000b​c' + 'x'.repeat(300) });
    await S.until(() => S.chats.length >= 2);
    ok(S.chats[1].text.length === 120 && !/[\u0000​]/.test(S.chats[1].text), '訊息長度被限制、控制字元被拿掉');

    group('斷線重連');
    P.socket.close();
    await H.until(() => { const m = H.view.members.find((x) => x.id === P.clientId); return m && m.connected === false; }, 3000);
    ok(H.view.members.find((x) => x.id === P.clientId).connected === false, '斷線的人標示斷線但座位保留');
    const P2 = mk('乙乙', P.clientId);
    await P2.hello();
    const re = await P2.ask('room:join', { code, name: '乙乙' });
    ok(re.ok && re.reconnected && re.role === 'player', '同一個 clientId 重連回到原位');
    await H.until(() => H.view.members.find((x) => x.id === P.clientId).connected === true);
    eq(H.view.members.filter((m) => m.role === 'player').length, 2, '重連不會多出一個座位');

    group('結算、再來一局、回房間');
    await H.until(() => H.view.phase === 'over', 8000);
    eq(H.view.phase, 'over', '時間到進入結算');
    ok(H.view.match.over && H.view.match.standings.length === 3, '結算排行含 2 位玩家與 1 個電腦');
    S.errors.length = 0;
    S.send('room:rematch');
    await S.until(() => S.errors.length);
    eq(S.lastError().code, 'role', '觀戰者不能投票再來一局');
    P2.errors.length = 0;
    P2.send('room:reset');
    await P2.until(() => P2.errors.length);
    eq(P2.lastError().code, 'perm', '非房主不能回房間');
    H.send('room:rematch');
    await H.until(() => H.view.rematch.votes === 1);
    eq(H.view.phase, 'over', '只有一票不會開始');
    P2.send('room:rematch');
    await H.until(() => H.view.phase === 'countdown', 3000);
    eq(H.view.phase, 'countdown', '全員同意重開');
    ok(H.view.match.standings.every((r) => r.score === 0), '重開後分數歸零');
    eq(H.view.match.balloons.length, 0, '重開後天上沒有舊氣球');
    await H.until(() => H.view.phase === 'over', 9000);
    H.send('room:reset');
    await H.until(() => H.view.phase === 'lobby');
    eq(H.view.phase, 'lobby', '房主回房間');
    eq(H.view.match, null, '回房間清掉對局');

    group('邀請連結');
    const ivRes = await H.ask('room:invite', { role: 'spectator', ttlMinutes: 10, maxUses: 2 });
    ok(ivRes.ok && /^[a-f0-9]{24}$/.test(ivRes.token), '房主產生邀請');
    const G = mk('訪客'); await G.hello();
    const membersBefore = H.view.members.length;
    const chk = await G.ask('invite:check', { code, token: ivRes.token });
    ok(chk.ok && chk.role === 'spectator' && chk.room.code === code, 'invite:check 回報角色與房間資訊');
    await sleep(200);
    eq(H.view.members.length, membersBefore, '只檢查邀請不會讓人加入房間');
    const bad = await G.ask('invite:check', { code, token: 'deadbeef' });
    eq(bad.code, 'badinvite', '無效 token');
    const jG = await G.ask('room:join', { code, name: '  新名字  ', token: ivRes.token, role: 'player' });
    ok(jG.ok && jG.role === 'spectator', '角色由 token 決定（要求玩家也只能觀戰）');
    eq(jG.name, '新名字', '伺服器消毒暱稱後回傳最終名字');
    await H.until(() => H.view.members.some((m) => m.name === '新名字'));
    ok(H.view.members.some((m) => m.name === '新名字' && m.role === 'spectator'), '新暱稱顯示在房間成員');
    const nm = await (await helloed('長名字')).ask('room:join', { code, name: '一二三四五六七八九十甲乙丙丁', token: ivRes.token });
    ok(!nm.ok || nm.name.length <= 12, '過長的暱稱被截斷');
    const used = await (await helloed('超額')).ask('room:join', { code, name: '三', token: ivRes.token }).catch(() => null);
    ok(used && (used.code === 'used' || used.code === undefined), '次數用完不能再用');
    const rv = await H.ask('room:invite', { role: 'player', ttlMinutes: 10, maxUses: 5 });
    H.send('room:revokeInvite', { token: rv.token });
    await sleep(150);
    const revoked = await (await helloed('撤銷')).ask('invite:check', { code, token: rv.token });
    eq(revoked.code, 'revoked', '撤銷後的連結顯示已撤銷');
    const gone = await G.ask('invite:check', { code: 'ZZZZZ', token: rv.token });
    eq(gone.code, 'gone', '指向不存在的房間');

    group('私人房');
    const Pv = mk('私房主'); await Pv.hello();
    const pm = await Pv.ask('room:create', { name: '私房主', private: true });
    const stranger = mk('路人'); await stranger.hello();
    const sj = await stranger.ask('room:join', { code: pm.code, name: '路人' });
    eq(sj.code, 'private', '沒有邀請進不了私人房');
    ok(!(stranger.rooms || { rooms: [] }).rooms.some((r) => r.code === pm.code), '私人房不出現在大廳列表');
    Pv.send('room:leave');

    group('零實體玩家自動關房（AI 與觀戰者不算）');
    /* 現在房裡：H(玩家)、P2(玩家)、電腦 1 個、觀戰：S、G */
    const spec2 = mk('觀戰乙'); await spec2.hello();
    const closeInvite = await H.ask('room:invite', { role: 'player', ttlMinutes: 10, maxUses: 5 });
    await spec2.ask('room:join', { code, name: '觀戰乙', role: 'spectator' });
    P2.send('room:leave');
    await P2.until(() => P2.left);
    ok(!S.closed, '還有一位實體玩家，房間不關');
    await sleep(200);
    eq(S.closed, null, '觀戰者沒有收到 closed');
    H.send('room:leave');
    await S.until(() => S.closed, 2000);
    ok(S.closed && /結束/.test(S.closed.reason), '最後一位實體玩家離開：觀戰者收到房間已結束');
    ok(spec2.closed && G.closed, '所有觀戰者都收到 closed');
    const afterChk = await (await helloed('晚到')).ask('invite:check', { code, token: closeInvite.token });
    eq(afterChk.code, 'gone', '關房後邀請連結失效');
    const afterJoin = await (await helloed('晚到2')).ask('room:join', { code, name: '晚到', token: closeInvite.token });
    eq(afterJoin.code, 'gone', '關房後不能加入');
    const afterRe = await S.ask('room:join', { code, name: '觀戰甲' });
    eq(afterRe.code, 'gone', '關房後觀戰者重連也不能復活房間');
    const list = await new Promise((r) => http.get(URL_ + '/api/rooms', (res) => { let d = ''; res.on('data', (x) => d += x); res.on('end', () => r(JSON.parse(d))); }));
    ok(!list.rooms.some((r) => r.code === code), '大廳列表已移除該房');

    group('斷線過期後只剩觀戰者也要關房');
    /* 另開一間：房主斷線，不會立刻關（寬限期內），但一旦離開就關 */
    const H2 = mk('房主二'); await H2.hello();
    const m2 = await H2.ask('room:create', { name: '房主二' });
    const W = mk('旁觀'); await W.hello();
    await W.ask('room:join', { code: m2.code, name: '旁觀', role: 'spectator' });
    H2.socket.close();
    await W.until(() => W.view && W.view.members.some((m) => m.connected === false));
    ok(W.view.members.some((m) => m.role === 'player' && m.connected === false), '房主斷線：寬限期內房間保留');
    eq(W.closed, null, '寬限期內不關房');
  } finally {
    all.forEach((c) => { try { c.socket.close(); } catch (e) {} });
    srv.kill();
  }

  console.log('\n══════════ 結果 ══════════');
  console.log('通過 ' + pass + ' 項，失敗 ' + failN + ' 項');
  if (failN) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('全部通過 ✔');
  process.exit(0);
}

function Rules() { return require('../public/js/rules.js'); }

main().catch((e) => { console.error(e); process.exit(1); });
