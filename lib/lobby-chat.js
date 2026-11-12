/* ===== lobby-chat-core.js — 大廳聊天室伺服器核心（與傳輸層無關，Socket.IO／ws 共用） =====
 *
 * 規則（2026-11 定案）：
 *   - 每款遊戲各自一個大廳頻道，與房間聊天完全分開
 *   - 保留最近 50 則（只存在記憶體，伺服器重開就清空），進大廳時送出
 *   - 每則最多 60 字；不雅字詞換成＊；同一人連續送出相同內容會被擋
 *   - 系統訊息只有一種：「某某開了新房間」（附房號，前端顯示「加入」按鈕；私人房不公告）
 *
 * 用法：
 *   const { LobbyChat } = require('./lib/lobby-chat.js');
 *   const chat = new LobbyChat();
 *   chat.join(id, name)            → { history, online }
 *   chat.leave(id)                 → 是否真的離開（用來決定要不要廣播人數）
 *   chat.post(id, name, text)      → { ok:true, msg } 或 { ok:false, code }（msg 內含發言者代號 from，送出前用 view() 換成 mine）
 *   chat.view(msg, viewerId)       → 給某人看的版本：自己的訊息帶 mine:true
 *   chat.roomOpened({ code, roomName, host, isPrivate }) → msg 或 null
 *   chat.members()                 → 目前在大廳聊天的 id 陣列
 */
'use strict';

const MAX_HISTORY = 50;
const MAX_LEN = 60;
const NAME_LEN = 16;

/* 簡易不雅字詞清單（繁中／簡中／英文）；比對時忽略大小寫與空白 */
/* 中文：子字串比對（避免單字誤殺「幹嘛」「能幹」這類正常用語） */
const BAD_ZH = [
  '幹你娘', '幹您娘', '干你娘', '操你媽', '操你妈', '肏你', '靠北', '靠杯', '機掰', '雞掰', '鸡掰', '機巴', '雞巴', '鸡巴', '賤人', '贱人', '婊子',
  '王八蛋', '混蛋', '白癡', '白痴', '智障', '腦殘', '脑残', '去死', '傻逼', '傻屄', '煞筆', '沙比', '他媽的', '他妈的', '媽的', '妈的', '尼瑪', '尼玛',
  '草泥馬', '草泥马', '低能', '垃圾人', '廢物', '废物'
];
/* 英文：整字比對（避免 Dickens、class 之類誤殺） */
const BAD_EN = ['fuck', 'fucking', 'fucker', 'motherfucker', 'fck', 'fuk', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'pussy', 'slut', 'whore', 'wtf', 'stfu', 'nigger', 'nigga', 'retard'];

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const BAD_RE = new RegExp(
  BAD_ZH.slice().sort((a, b) => b.length - a.length).map((w) => Array.from(w).map(escapeRe).join('\\s*'))
    .concat(BAD_EN.slice().sort((a, b) => b.length - a.length).map((w) => '\\b' + escapeRe(w) + '\\b'))
    .join('|'), 'gi');

/** 把不雅字詞換成同長度的「＊」 */
function censor(text) {
  return String(text).replace(BAD_RE, (m) => '＊'.repeat(Array.from(m.replace(/\s+/g, '')).length));
}

/** 清理文字：去掉控制字元、合併空白、限制字數（以字元計，emoji 算一個） */
function cleanText(input, max) {
  const s = String(input == null ? '' : input)
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, max).join('');
}

function cleanName(input, fallback) {
  return censor(cleanText(input, NAME_LEN)) || fallback || '玩家';
}

class LobbyChat {
  constructor(opts) {
    const o = opts || {};
    this.maxHistory = o.maxHistory || MAX_HISTORY;
    this.maxLen = o.maxLen || MAX_LEN;
    this.now = o.now || (() => Date.now());
    this.history = [];
    this.seq = 0;
    this.people = new Map();   // id → { name, last }
  }

  _push(msg) {
    this.history.push(msg);
    if (this.history.length > this.maxHistory) this.history.splice(0, this.history.length - this.maxHistory);
    return msg;
  }

  /** 進入大廳聊天（重複呼叫只會更新暱稱） */
  join(id, name) {
    const key = String(id);
    const p = this.people.get(key);
    if (p) p.name = cleanName(name, p.name);
    else this.people.set(key, { name: cleanName(name), last: '' });
    return { history: this.history.map((m) => this.view(m, key)), online: this.people.size };
  }

  /** 給某個人看的版本：拿掉發言者代號，改成 mine（是不是自己說的） */
  view(msg, viewer) {
    const out = Object.assign({}, msg);
    delete out.from;
    if (msg.from != null && String(msg.from) === String(viewer)) out.mine = true;
    return out;
  }

  leave(id) { return this.people.delete(String(id)); }

  has(id) { return this.people.has(String(id)); }

  members() { return Array.from(this.people.keys()); }

  online() { return this.people.size; }

  post(id, name, text) {
    const key = String(id);
    const p = this.people.get(key);
    if (!p) return { ok: false, code: 'notjoined' };
    if (name != null) p.name = cleanName(name, p.name);
    const raw = cleanText(text, this.maxLen + 1);
    if (!raw) return { ok: false, code: 'empty' };
    if (Array.from(raw).length > this.maxLen) return { ok: false, code: 'long' };
    const body = cleanText(raw, this.maxLen);
    const norm = body.toLowerCase().replace(/\s+/g, '');
    if (norm === p.last) return { ok: false, code: 'dup' };
    p.last = norm;
    const msg = { id: ++this.seq, kind: 'msg', name: p.name, text: censor(body), ts: this.now(), from: key };
    return { ok: true, msg: this._push(msg) };
  }

  /** 公開房間建立時呼叫；私人房間不公告，回傳 null */
  roomOpened(info) {
    const i = info || {};
    if (i.isPrivate || !i.code) return null;
    const msg = {
      id: ++this.seq, kind: 'room',
      name: cleanName(i.host),
      room: censor(cleanText(i.roomName || '', 24)),
      code: String(i.code).slice(0, 32),
      ts: this.now()
    };
    return this._push(msg);
  }
}

module.exports = { LobbyChat, censor, cleanText, MAX_LEN, MAX_HISTORY };

/**
 * Socket.IO 接頭：事件 lobbychat:join／leave／send → lobbychat:history／msg／online／error
 * 回傳 { chat, roomOpened(info) }，開公開房時呼叫 roomOpened 會在大廳聊天公告。
 */
function attachSocketIo(io, opts) {
  const chat = new LobbyChat(opts);
  const CH = 'lobbychat';
  const bcastOnline = () => io.to(CH).emit('lobbychat:online', { online: chat.online() });
  /* 每個人收到的版本不同（自己的訊息帶 mine），所以逐一送 */
  const sendMsg = (m) => {
    for (const id of chat.members()) {
      const s = io.sockets.sockets.get(id);
      if (s) s.emit('lobbychat:msg', { msg: chat.view(m, id) });
    }
  };
  io.on('connection', (socket) => {
    socket.on('lobbychat:join', (p) => {
      const r = chat.join(socket.id, p && p.name);
      socket.join(CH);
      socket.emit('lobbychat:history', r);
      bcastOnline();
    });
    socket.on('lobbychat:leave', () => {
      socket.leave(CH);
      if (chat.leave(socket.id)) bcastOnline();
    });
    socket.on('lobbychat:send', (p) => {
      const r = chat.post(socket.id, p && p.name, p && p.text);
      if (r.ok) sendMsg(r.msg);
      else socket.emit('lobbychat:error', { code: r.code });
    });
    socket.on('disconnect', () => { if (chat.leave(socket.id)) bcastOnline(); });
  });
  return {
    chat,
    roomOpened(info) {
      const m = chat.roomOpened(info);
      if (m) sendMsg(m);
      return m;
    }
  };
}

/**
 * 自寫 WebSocket／訊息物件版接頭（與傳輸無關）：
 *   const lc = createHub({ send: (id, obj) => ..., key: 'type' })
 *   lc.handle(id, msg)   收到 { [key]:'lobbychat', op:'join'|'leave'|'send', name, text } 時呼叫，回傳是否處理
 *   lc.drop(id)          斷線時呼叫
 *   lc.roomOpened(info)  開公開房時呼叫
 * 送出的訊息：{ [key]:'lobbychat', op:'history'|'msg'|'online'|'error', ... }
 */
function createHub(opts) {
  const o = opts || {};
  const key = o.key || 'type';
  const chat = new LobbyChat(o);
  const out = (id, op, extra) => { try { o.send(id, Object.assign({ [key]: 'lobbychat', op }, extra)); } catch (e) { /* 對方已斷線 */ } };
  const all = (op, extra) => { for (const id of chat.members()) out(id, op, extra); };
  const bcastOnline = () => all('online', { online: chat.online() });
  return {
    chat,
    handle(id, m) {
      if (!m || m[key] !== 'lobbychat') return false;
      if (m.op === 'join') {
        const r = chat.join(id, m.name);
        out(id, 'history', r);
        bcastOnline();
      } else if (m.op === 'leave') {
        if (chat.leave(id)) bcastOnline();
      } else if (m.op === 'send') {
        const r = chat.post(id, m.name, m.text);
        if (r.ok) for (const to of chat.members()) out(to, 'msg', { msg: chat.view(r.msg, to) });
        else out(id, 'error', { code: r.code });
      }
      return true;
    },
    drop(id) { if (chat.leave(id)) bcastOnline(); },
    roomOpened(info) {
      const m = chat.roomOpened(info);
      if (m) for (const to of chat.members()) out(to, 'msg', { msg: chat.view(m, to) });
      return m;
    }
  };
}

module.exports.attachSocketIo = attachSocketIo;
module.exports.createHub = createHub;
