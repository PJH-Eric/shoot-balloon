/*
 * lib/rooms.js — 房間、座位、邀請、聊天與對局生命週期
 *
 * 「誰可以做什麼」全部在這裡判斷，而且只在伺服器上跑。
 * 用戶端送過來的一律當成「意圖」，權限旗標由 viewFor() 算好之後才給前端用。
 *
 * 遊戲規則本身在 public/js/rules.js（前後端共用），這裡不重寫任何計分邏輯。
 */
'use strict';

const crypto = require('crypto');
const Rules = require('../public/js/rules.js');
const AI = require('../public/js/ai.js');
const RNG = require('../public/js/rng.js');

const CODE_CHARS = RNG.SEED_CHARS;          // 拿掉 0 O 1 I，方便用嘴巴唸房號
const CODE_LEN = 5;
const MAX_PLAYERS = Rules.MAX_PLAYERS;      // 5
const MAX_MEMBERS = 24;                     // 玩家 + 觀戰的總上限
const CHAT_KEEP = 60;
const CHAT_MIN_GAP_MS = 700;
const DISCONNECT_GRACE_MS = 60000;          // 斷線保留座位的時間
const EMPTY_ROOM_TTL_MS = 120000;           // 空房回收
const OVER_ROOM_TTL_MS = 600000;            // 打完之後沒人動的房間回收
const INVITE_TTL_MS = 30 * 60000;

/* ------------------------------------------------------------ 文字清洗 */
/* 控制字元、零寬字元、方向控制字元一律拿掉，
 * 避免有人拿它們排版、洗版或偽裝成別人的名字。
 * 用字串組出 RegExp 而不寫字面量，原始碼裡才不會真的藏著看不見的字元。 */
const JUNK = new RegExp(
  '[\\u0000-\\u001F\\u007F\\u00AD\\u200B-\\u200F\\u2028-\\u202E\\u2060\\uFEFF]', 'g'
);

function sanitizeName(input, fallback) {
  let s = String(input === undefined || input === null ? '' : input);
  s = s.replace(JUNK, '').trim().replace(/\s+/g, ' ');
  if (s.length > 12) s = s.slice(0, 12);
  return s || String(fallback || '玩家');
}

function sanitizeText(input, max) {
  let s = String(input === undefined || input === null ? '' : input);
  s = s.replace(JUNK, '').trim();
  const cap = max || 120;
  if (s.length > cap) s = s.slice(0, cap);
  return s;
}

function randomCode() {
  let out = '';
  const buf = crypto.randomBytes(CODE_LEN);
  for (let i = 0; i < CODE_LEN; i++) out += CODE_CHARS[buf[i] % CODE_CHARS.length];
  return out;
}

/* ------------------------------------------------------------ Room */

class Room {
  constructor(store, code, hostId, opts) {
    const now = opts.now;
    this.store = store;
    this.code = code;
    this.name = sanitizeText(opts.roomName, 24) || (sanitizeName(opts.name) + ' 的氣球攤');
    this.private = !!opts.private;
    /* 難度決定氣球的節奏（冒多快、飄多快），全房共用一片天空所以只能有一個值。
       電腦對手的強弱是每個 AI 座位各自的設定，兩者不一樣。 */
    this.pace = Rules.paceOf(opts.pace).key;
    /* 一局長度：房主可改，預設吃伺服器設定（環境變數），但一定會被
       收斂到合法的選項，不會出現 7 秒或 10 分鐘的房間。 */
    this.roundMs = Number(opts.roundMs) > 0 ? Number(opts.roundMs) : Rules.ROUND_MS;
    this.hostId = hostId;
    this.createdAt = now;
    this.touchedAt = now;

    this.members = new Map();   // clientId -> member
    this.aiSeats = [];          // {id, level, name}
    this.invites = new Map();   // token -> invite
    this.chat = [];
    this.rematch = new Set();

    this.phase = 'lobby';       // lobby | countdown | playing | over | closed
    this.seed = RNG.randomSeed();
    this.state = null;
    this.rng = null;
    this.brains = new Map();    // aiId -> brain
  }

  /* ---------------------------------------------------------- 成員 */

  member(clientId) { return this.members.get(String(clientId)) || null; }
  players() { return [...this.members.values()].filter((m) => m.role === 'player'); }
  spectators() { return [...this.members.values()].filter((m) => m.role === 'spectator'); }
  seatCount() { return this.players().length + this.aiSeats.length; }
  seatsFree() { return Math.max(0, MAX_PLAYERS - this.seatCount()); }
  isHost(clientId) { return String(clientId) === this.hostId; }
  touch(now) { this.touchedAt = now; }

  join(clientId, o) {
    const id = String(clientId);
    const now = o.now;
    if (this.phase === 'closed') {
      return { ok: false, error: '這間房已經結束了。', code: 'closed' };
    }
    this.touch(now);

    const existing = this.members.get(id);
    if (existing) {
      existing.connected = true;
      existing.lastSeen = now;
      existing.name = sanitizeName(o.name, existing.name);
      return { ok: true, member: existing, reconnected: true };
    }

    if (this.members.size >= MAX_MEMBERS) {
      return { ok: false, error: '這個房間人太多了（含觀戰上限 ' + MAX_MEMBERS + ' 人）。', code: 'full' };
    }

    /* 邀請連結：先驗證，token 決定進來的身分 */
    let wanted = o.role === 'spectator' ? 'spectator' : 'player';
    let note = null;
    if (o.token) {
      const chk = this.checkInvite(o.token, now);
      if (!chk.ok) return chk;
      if (chk.invite.role === 'spectator') wanted = 'spectator';
      chk.invite.uses += 1;
      note = chk.note;
    } else if (this.private && id !== this.hostId) {
      /* 房主自己開的私人房當然進得去，其他人一定要帶邀請 token */
      return { ok: false, error: '這是私人房間，需要邀請連結才能進來。', code: 'private' };
    }

    /* 玩家席位滿了就轉觀戰 —— 一定要明講，不能默默把觀戰者當成玩家 */
    let downgraded = false;
    if (wanted === 'player' && this.seatsFree() <= 0) { wanted = 'spectator'; downgraded = true; }
    /* 已經開打了就先觀戰，等這一局結束再下場 */
    let waiting = false;
    if (wanted === 'player' && (this.phase === 'playing' || this.phase === 'countdown')) {
      wanted = 'spectator'; waiting = true;
    }

    const member = {
      id,
      name: sanitizeName(o.name, '玩家' + (this.members.size + 1)),
      role: wanted,
      ready: false,
      connected: true,
      joinedAt: now,
      lastSeen: now,
      mutedUntil: 0,
      lastChatAt: 0
    };
    this.members.set(id, member);
    if (!this.members.has(this.hostId)) this.hostId = id;
    return { ok: true, member, downgraded, waiting, note };
  }

  leave(clientId, now) {
    const id = String(clientId);
    const m = this.members.get(id);
    if (!m) return { ok: false, error: '你不在這個房間裡。', code: 'gone' };
    this.members.delete(id);
    this.rematch.delete(id);
    this.touch(now);
    /* 共用盤面本來就各算各的分，有人離開不影響別人的成績；
     * 但如果一個連線中的真人玩家都不剩，就直接結算這一局。 */
    if (this.state && !this.state.over && this.livePlayersInMatch() === 0) {
      Rules.finish(this.state, now);
      this.phase = 'over';
    }
    if (this.hostId === id) {
      const next = [...this.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) this.hostId = next.id;
    }
    /* 最後一個人走了就不用留這間房 —— 交給呼叫端立刻關掉，
       不必等下一輪回收（最久要 2 秒）。 */
    return { ok: true, name: m.name, emptied: this.humanCount() === 0 };
  }

  disconnect(clientId, now) {
    const m = this.members.get(String(clientId));
    if (!m) return { ok: false };
    m.connected = false;
    m.lastSeen = now;
    this.touch(now);
    return { ok: true, member: m };
  }

  /** 實體玩家數：只算玩家席的真人（含斷線保留中的）。AI 席位與觀戰者不算。 */
  humanCount() { return this.players().length; }

  /**
   * 關房：撤銷所有邀請、停掉對局與 AI，之後任何人（含重連）都進不來。
   * 由呼叫端負責從 store 拿掉並廣播 closed。
   */
  close(now) {
    this.phase = 'closed';
    this.invites.clear();
    this.brains = new Map();
    this.state = null;
    this.rng = null;
    this.rematch.clear();
    this.touch(now);
  }

  /** 對局中還連著線的真人玩家數 */
  livePlayersInMatch() {
    if (!this.state) return 0;
    let n = 0;
    for (const id of this.state.order) {
      if (String(id).indexOf('ai:') === 0) continue;
      const m = this.members.get(id);
      if (m && m.connected) n += 1;
    }
    return n;
  }

  /* ---------------------------------------------------------- 座位 */

  becomePlayer(clientId) {
    const m = this.member(clientId);
    if (!m) return { ok: false, error: '你不在這個房間裡。', code: 'gone' };
    if (m.role === 'player') return { ok: true, member: m };
    if (this.phase === 'countdown' || this.phase === 'playing') {
      return { ok: false, error: '這一局已經開始了，等結束之後才能下場。', code: 'phase' };
    }
    if (this.seatsFree() <= 0) {
      return { ok: false, error: '玩家席位已經滿了（最多 ' + MAX_PLAYERS + ' 人），可以先觀戰。', code: 'full' };
    }
    m.role = 'player';
    m.ready = false;
    return { ok: true, member: m };
  }

  becomeSpectator(clientId) {
    const m = this.member(clientId);
    if (!m) return { ok: false, error: '你不在這個房間裡。', code: 'gone' };
    if (this.phase === 'countdown' || this.phase === 'playing') {
      return { ok: false, error: '對局進行中不能中途離席。', code: 'phase' };
    }
    if (m.role === 'player' && this.humanCount() <= 1) {
      return { ok: false, error: '你是房間裡唯一的玩家，改成觀戰房間就會關閉；想離開請按「離開」。', code: 'lastplayer' };
    }
    m.role = 'spectator';
    m.ready = false;
    return { ok: true, member: m };
  }

  setReady(clientId, ready) {
    const m = this.member(clientId);
    if (!m) return { ok: false, error: '你不在這個房間裡。', code: 'gone' };
    if (m.role !== 'player') return { ok: false, error: '觀戰中不需要準備。', code: 'role' };
    if (this.phase === 'countdown' || this.phase === 'playing') {
      return { ok: false, error: '對局進行中不能改準備狀態。', code: 'phase' };
    }
    m.ready = !!ready;
    return { ok: true, member: m };
  }

  /* ---------------------------------------------------------- AI 座位 */

  addAi(clientId, level) {
    if (!this.isHost(clientId)) return { ok: false, error: '只有房主可以加電腦對手。', code: 'perm' };
    if (this.phase === 'countdown' || this.phase === 'playing') {
      return { ok: false, error: '對局進行中不能加電腦對手。', code: 'phase' };
    }
    if (this.seatsFree() <= 0) {
      return { ok: false, error: '座位已經滿了（最多 ' + MAX_PLAYERS + ' 人）。', code: 'full' };
    }
    const lv = AI.levelOf(level).key;
    const seat = {
      id: 'ai:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      level: lv,
      name: AI.aiName(lv, this.aiSeats.length)
    };
    this.aiSeats.push(seat);
    return { ok: true, seat };
  }

  removeAi(clientId, aiId) {
    if (!this.isHost(clientId)) return { ok: false, error: '只有房主可以移除電腦對手。', code: 'perm' };
    if (this.phase === 'countdown' || this.phase === 'playing') {
      return { ok: false, error: '對局進行中不能移除電腦對手。', code: 'phase' };
    }
    const i = this.aiSeats.findIndex((s) => s.id === aiId);
    if (i < 0) return { ok: false, error: '找不到這個電腦對手。', code: 'gone' };
    const [seat] = this.aiSeats.splice(i, 1);
    return { ok: true, seat };
  }

  /* ---------------------------------------------------------- 對局 */

  canStart() {
    if (this.phase === 'countdown' || this.phase === 'playing') {
      return { ok: false, reason: '這一局已經在進行中' };
    }
    if (this.seatCount() < 1) return { ok: false, reason: '至少要有一位玩家或一個電腦對手' };
    const notReady = this.players().filter((m) => !m.ready);
    if (notReady.length) {
      return { ok: false, reason: notReady.map((m) => m.name).join('、') + ' 還沒按準備' };
    }
    return { ok: true };
  }

  /** 房主換難度。開打之後才改會讓進行中的氣球節奏突然變掉。 */
  setPace(clientId, key) {
    if (!this.isHost(clientId)) return { ok: false, error: '只有房主可以改難度。', code: 'perm' };
    if (this.phase !== 'lobby' && this.phase !== 'over') {
      return { ok: false, error: '對局進行中不能改難度。', code: 'phase' };
    }
    const P = Rules.paceOf(key);
    if (P.key !== key) return { ok: false, error: '沒有這種難度。', code: 'badpace' };
    if (P.key === this.pace) return { ok: true, pace: this.pace, changed: false };
    this.pace = P.key;
    return { ok: true, pace: this.pace, changed: true, label: P.label };
  }

  /** 房主改一局長度。和盤面、難度一樣，開打之後不能改。 */
  setRound(clientId, sec) {
    if (!this.isHost(clientId)) return { ok: false, error: '只有房主可以改一局長度。', code: 'perm' };
    if (this.phase !== 'lobby' && this.phase !== 'over') {
      return { ok: false, error: '對局進行中不能改一局長度。', code: 'phase' };
    }
    const n = Math.round(Number(sec));
    if (Rules.ROUND_SECONDS.indexOf(n) < 0) {
      return { ok: false, error: '一局長度只能選 ' + Rules.ROUND_SECONDS.join('／') + ' 秒。', code: 'badround' };
    }
    const ms = Rules.roundMsOf(n);
    if (ms === this.roundMs) return { ok: true, roundMs: ms, changed: false };
    this.roundMs = ms;
    return { ok: true, roundMs: ms, changed: true, sec: n };
  }

  start(clientId, now, opts) {
    if (clientId !== null && !this.isHost(clientId)) {
      return { ok: false, error: '只有房主可以開始。', code: 'perm' };
    }
    const chk = this.canStart();
    if (!chk.ok) return { ok: false, error: chk.reason + '，還不能開始。', code: 'notready' };

    const roster = [];
    this.players().forEach((m) => roster.push({ id: m.id, name: m.name }));
    this.aiSeats.forEach((s) => roster.push({ id: s.id, name: s.name, ai: s.level }));

    this.seed = RNG.randomSeed();
    this.state = Rules.createMatch({
      seed: this.seed,
      players: roster,
      now,
      pace: this.pace,
      roundMs: this.roundMs,
      countdownMs: (opts && opts.countdownMs) !== undefined ? opts.countdownMs
        : (this.store && this.store.opts && this.store.opts.countdownMs !== undefined ? this.store.opts.countdownMs : Rules.COUNTDOWN_MS)
    });
    /* 氣球序列綁在房號 + 種子上：同一個種子重播會長出同一批氣球 */
    this.rng = RNG.createRng('spawn:' + this.code + ':' + this.seed);
    this.brains = new Map();
    this.aiSeats.forEach((s, i) => {
      this.brains.set(s.id, AI.createBrain(s.level, 'ai:' + this.code + ':' + this.seed + ':' + i));
    });
    this.phase = 'countdown';
    this.rematch.clear();
    this.touch(now);
    return { ok: true, state: this.state };
  }

  /** 由伺服器主迴圈呼叫：推進氣球、讓 AI 出手、處理階段轉換 */
  step(now) {
    if (!this.state || this.phase === 'lobby' || this.phase === 'over') return { events: [] };

    const events = Rules.tick(this.state, now, this.rng);
    if (this.phase === 'countdown' && now >= this.state.startAt && !this.state.over) {
      this.phase = 'playing';
      events.unshift({ k: 'go' });
    }

    if (this.phase === 'playing' && !this.state.over) {
      const snap = Rules.snapshot(this.state, now);
      for (const seat of this.aiSeats) {
        const brain = this.brains.get(seat.id);
        if (!brain) continue;
        const aim = brain.step(snap, now);
        if (!aim) continue;
        /* AI 也走跟真人完全一樣的 Rules.shoot，不能走捷徑 */
        const res = Rules.shoot(this.state, seat.id, aim, now);
        if (res.ok) events.push(res.event);
      }
    }

    if (this.state.over && this.phase !== 'over') {
      this.phase = 'over';
      this.touch(now);
      for (const m of this.members.values()) m.ready = false;
    }
    return { events };
  }

  shoot(clientId, aim, now) {
    const m = this.member(clientId);
    if (!m) return { ok: false, error: '你不在這個房間裡。', code: 'gone' };
    if (m.role !== 'player') return { ok: false, error: '觀戰中不能射擊。', code: 'role' };
    if (!this.state || this.phase !== 'playing') {
      return { ok: false, error: '現在還不能射擊。', code: 'phase' };
    }
    this.touch(now);
    return Rules.shoot(this.state, m.id, aim, now);
  }

  voteRematch(clientId, now) {
    const m = this.member(clientId);
    if (!m) return { ok: false, error: '你不在這個房間裡。', code: 'gone' };
    if (this.phase !== 'over') return { ok: false, error: '這一局還沒結束。', code: 'phase' };
    if (m.role !== 'player') return { ok: false, error: '觀戰中不能投票再來一局。', code: 'role' };
    this.rematch.add(m.id);
    this.touch(now);
    const need = this.players().length;
    const votes = this.rematch.size;
    const r = this.maybeRematchStart(now);
    if (r.started) return { ok: true, started: true, votes, need };
    return { ok: true, started: false, votes, need, error: r.error };
  }

  /**
   * 投票都到齊就開下一局。投票時要檢查，有人離開（需要的票數變少）時也要再檢查一次，
   * 不然剩下的人早就投過票了，房間會卡在結算畫面。
   */
  maybeRematchStart(now) {
    if (this.phase !== 'over') return { started: false };
    const need = this.players().length;
    if (!(need > 0 && this.rematch.size >= need)) return { started: false };
    for (const p of this.players()) p.ready = true;
    this.phase = 'lobby';
    const res = this.start(null, now);
    if (res.ok) return { started: true };
    this.phase = 'over';
    return { started: false, error: res.error };
  }

  /** 結算畫面按「回房間」：回到可以換座位、加 AI 的等待狀態 */
  backToLobby(clientId, now) {
    if (!this.isHost(clientId)) return { ok: false, error: '只有房主可以重開房間。', code: 'perm' };
    if (this.phase === 'countdown' || this.phase === 'playing') {
      return { ok: false, error: '對局還在進行中。', code: 'phase' };
    }
    this.phase = 'lobby';
    this.state = null;
    this.rematch.clear();
    for (const m of this.members.values()) m.ready = false;
    this.touch(now);
    return { ok: true };
  }

  /* ---------------------------------------------------------- 聊天 */

  say(clientId, text, now) {
    const m = this.member(clientId);
    if (!m) return { ok: false, error: '你不在這個房間裡。', code: 'gone' };
    if (now < m.mutedUntil) {
      const sec = Math.ceil((m.mutedUntil - now) / 1000);
      return { ok: false, error: '你被暫時禁言，還要等 ' + sec + ' 秒。', code: 'muted' };
    }
    if (now - m.lastChatAt < CHAT_MIN_GAP_MS) {
      return { ok: false, error: '打字慢一點，別洗版。', code: 'rate' };
    }
    const body = sanitizeText(text, 120);
    if (!body) return { ok: false, error: '訊息是空的。', code: 'empty' };
    m.lastChatAt = now;
    const msg = {
      id: this.chat.length + 1, from: m.id, name: m.name,
      role: m.role, text: body, at: now, system: false
    };
    this.chat.push(msg);
    if (this.chat.length > CHAT_KEEP) this.chat.shift();
    this.touch(now);
    return { ok: true, message: msg };
  }

  system(text, now) {
    const msg = {
      id: this.chat.length + 1, from: null, name: '系統',
      role: 'system', text: sanitizeText(text, 160), at: now, system: true
    };
    this.chat.push(msg);
    if (this.chat.length > CHAT_KEEP) this.chat.shift();
    return msg;
  }

  mute(clientId, targetId, seconds, now) {
    if (!this.isHost(clientId)) return { ok: false, error: '只有房主可以禁言。', code: 'perm' };
    const t = this.member(targetId);
    if (!t) return { ok: false, error: '找不到這個人。', code: 'gone' };
    if (t.id === this.hostId) return { ok: false, error: '不能禁言自己。', code: 'self' };
    const sec = Math.max(10, Math.min(600, Number(seconds) || 120));
    t.mutedUntil = now + sec * 1000;
    return { ok: true, name: t.name, seconds: sec };
  }

  /* ---------------------------------------------------------- 邀請連結 */

  createInvite(clientId, o) {
    if (!this.isHost(clientId)) return { ok: false, error: '只有房主可以產生邀請連結。', code: 'perm' };
    const now = o.now;
    const role = o.role === 'spectator' ? 'spectator' : 'player';
    const ttl = Math.max(60000, Math.min(24 * 3600000, Number(o.ttlMs) || INVITE_TTL_MS));
    const maxUses = Math.max(1, Math.min(20, Number(o.maxUses) || 5));

    /* 順手清掉已經沒用的邀請，一間房最多留 8 張 */
    for (const [tk, iv] of this.invites) {
      if (iv.revoked || iv.expiresAt < now || iv.uses >= iv.maxUses) this.invites.delete(tk);
    }
    if (this.invites.size >= 8) {
      const oldest = [...this.invites.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) this.invites.delete(oldest.token);
    }

    const invite = {
      token: crypto.randomBytes(12).toString('hex'),
      role,
      createdBy: String(clientId),
      createdAt: now,
      expiresAt: now + ttl,
      maxUses,
      uses: 0,
      revoked: false
    };
    this.invites.set(invite.token, invite);
    this.touch(now);
    return { ok: true, invite };
  }

  revokeInvite(clientId, token) {
    if (!this.isHost(clientId)) return { ok: false, error: '只有房主可以撤銷邀請連結。', code: 'perm' };
    const iv = this.invites.get(String(token));
    if (!iv) return { ok: false, error: '找不到這張邀請。', code: 'gone' };
    iv.revoked = true;
    return { ok: true, invite: iv };
  }

  /** 進房前先驗證，讓前端能顯示明確的原因，而不是只說「失敗」 */
  checkInvite(token, now) {
    const iv = this.invites.get(String(token || ''));
    if (!iv) return { ok: false, error: '這個邀請連結無效（可能已被撤銷，或房主重開了房間）。', code: 'badinvite' };
    if (iv.revoked) return { ok: false, error: '這個邀請連結已經被房主撤銷了。', code: 'revoked' };
    if (now > iv.expiresAt) return { ok: false, error: '這個邀請連結已經過期了。', code: 'expired' };
    if (iv.uses >= iv.maxUses) return { ok: false, error: '這個邀請連結的使用次數已經用完了。', code: 'used' };
    let note = null;
    if (iv.role === 'player' && this.seatsFree() <= 0) {
      note = '玩家席位已滿，進去之後會先變成觀戰。';
    }
    if (iv.role === 'player' && (this.phase === 'playing' || this.phase === 'countdown')) {
      note = '這間房正在對戰中，進去之後會先觀戰，下一局才能下場。';
    }
    return { ok: true, invite: iv, note };
  }

  /* ---------------------------------------------------------- 投影 */

  brief() {
    return {
      code: this.code,
      name: this.name,
      private: this.private,
      pace: this.pace,
      roundSec: Rules.roundSecOf(this.roundMs),
      phase: this.phase,
      players: this.players().length,
      ai: this.aiSeats.length,
      spectators: this.spectators().length,
      seats: MAX_PLAYERS,
      seatsFree: this.seatsFree(),
      createdAt: this.createdAt
    };
  }

  /**
   * 每個人拿到的是「自己這個角色看到的投影」。
   * 射氣球沒有隱藏資訊（天空本來就全場共用），所以觀戰者看到的畫面和玩家一樣，
   * 差別只在權限旗標 you.can 與只有房主看得到的邀請清單。
   */
  viewFor(clientId, now) {
    const me = this.member(clientId);
    const host = this.isHost(clientId);
    const startable = this.canStart();
    const lobbyish = this.phase === 'lobby' || this.phase === 'over';

    const members = [...this.members.values()].map((m) => ({
      id: m.id, name: m.name, role: m.role, ready: m.ready,
      connected: m.connected, host: m.id === this.hostId,
      muted: now < m.mutedUntil
    }));

    return {
      code: this.code,
      name: this.name,
      private: this.private,
      roundSec: Rules.roundSecOf(this.roundMs),
      rounds: Rules.ROUND_SECONDS.slice(),
      pace: this.pace,
      paces: Rules.PACE_ORDER.map((k) => {
        const P = Rules.paceOf(k);
        return { key: P.key, label: P.label, emoji: P.emoji, blurb: P.blurb };
      }),
      phase: this.phase,
      seats: MAX_PLAYERS,
      seatsFree: this.seatsFree(),
      hostId: this.hostId,
      seed: this.seed,
      members,
      ai: this.aiSeats.map((s) => ({ id: s.id, level: s.level, name: s.name })),
      chat: this.chat.slice(-40),
      match: this.state ? Rules.snapshot(this.state, now) : null,
      rematch: { votes: this.rematch.size, need: this.players().length },
      invites: host ? [...this.invites.values()].map((iv) => ({
        token: iv.token, role: iv.role, expiresAt: iv.expiresAt,
        uses: iv.uses, maxUses: iv.maxUses, revoked: iv.revoked
      })) : [],
      you: me ? {
        id: me.id,
        name: me.name,
        role: me.role,
        ready: me.ready,
        host,
        muted: now < me.mutedUntil,
        /* 權限一律由伺服器算好，前端只照著開關 UI，不自己判斷 */
        can: {
          shoot: me.role === 'player' && this.phase === 'playing',
          ready: me.role === 'player' && lobbyish,
          start: host && startable.ok,
          sit: me.role === 'spectator' && this.seatsFree() > 0 && lobbyish,
          stand: me.role === 'player' && lobbyish,
          manageAi: host && lobbyish,
          setPace: host && lobbyish,
          setRound: host && lobbyish,
          invite: host,
          mute: host,
          rematch: me.role === 'player' && this.phase === 'over',
          reset: host && this.phase === 'over'
        },
        startBlockedBy: startable.ok ? null : startable.reason
      } : { id: null, name: null, role: 'guest', can: {} }
    };
  }
}

/* ------------------------------------------------------------ RoomStore */

class RoomStore {
  constructor(opts) {
    this.opts = opts || {};
    this.rooms = new Map();
  }

  size() { return this.rooms.size; }
  get(code) { return this.rooms.get(String(code || '').toUpperCase()) || null; }

  create(hostId, o) {
    if (this.rooms.size >= 200) {
      return { ok: false, error: '伺服器上的房間太多了，請稍後再試。', code: 'busy' };
    }
    let code = randomCode();
    let guard = 0;
    while (this.rooms.has(code) && guard++ < 50) code = randomCode();
    if (this.rooms.has(code)) return { ok: false, error: '產生房號失敗，請再試一次。', code: 'retry' };

    const room = new Room(this, code, String(hostId), o);
    this.rooms.set(code, room);
    const res = room.join(hostId, { name: o.name, role: 'player', now: o.now });
    if (!res.ok) { this.rooms.delete(code); return res; }
    return { ok: true, room };
  }

  /** 關掉一間房（最後一個人離開時立刻用得上） */
  close(code) {
    const key = String(code || '').toUpperCase();
    const room = this.rooms.get(key);
    if (!room) return null;
    this.rooms.delete(key);
    room.close(Date.now());
    return room;
  }

  /** 大廳列表：只列公開房 */
  list() {
    return [...this.rooms.values()]
      .filter((r) => !r.private)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 40)
      .map((r) => r.brief());
  }

  /** 需要每個 tick 推進的房間（倒數中或對戰中） */
  active() {
    return [...this.rooms.values()].filter((r) => r.phase === 'countdown' || r.phase === 'playing');
  }

  /**
   * 回收：斷線太久的人、沒人的空房、打完很久沒動的房。
   * 免費雲端的記憶體有限，房間又只存在記憶體裡，所以一定要定時清。
   */
  sweep(now) {
    const changed = [];
    const closed = [];
    for (const room of this.rooms.values()) {
      let dirty = false;
      for (const m of [...room.members.values()]) {
        if (!m.connected && now - m.lastSeen > DISCONNECT_GRACE_MS) {
          room.members.delete(m.id);
          room.rematch.delete(m.id);
          room.system(m.name + ' 太久沒回來，座位已經釋出。', now);
          dirty = true;
        }
      }
      if (dirty) {
        if (!room.members.has(room.hostId)) {
          const next = [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
          if (next) room.hostId = next.id;
        }
        if (room.state && !room.state.over && room.livePlayersInMatch() === 0) {
          Rules.finish(room.state, now);
          room.phase = 'over';
        }
        if (room.maybeRematchStart(now).started) room.system('大家都同意，新的一局開始了！', now);
        changed.push(room);
      }

      /* 沒人在房間就直接關掉，不留空房佔著房號與大廳版面。
         斷線的人還算「在房間」（座位保留 DISCONNECT_GRACE_MS），
         上面那段把過期的人清掉之後才會變成真的空房。 */
      /* 房間存活只看實體玩家：只剩 AI 或觀戰者也要關 */
      const empty = room.humanCount() === 0;
      const stale = empty
        || (room.phase === 'over' && now - room.touchedAt > OVER_ROOM_TTL_MS);
      if (stale) {
        room.close(now);
        this.rooms.delete(room.code);
        closed.push(room);
      }
    }
    return { changed, closed };
  }
}

module.exports = {
  Room,
  RoomStore,
  sanitizeName,
  sanitizeText,
  randomCode,
  MAX_PLAYERS,
  MAX_MEMBERS,
  DISCONNECT_GRACE_MS,
  EMPTY_ROOM_TTL_MS,
  OVER_ROOM_TTL_MS
};
