'use strict';
const assert = require('node:assert/strict');
const { createHub } = require('../lib/lobby-chat.js');

const events = [];
const hub = createHub({ send: (id, msg) => events.push({ id, msg }) });
const send = (id, op, extra = {}) => hub.handle(id, { type: 'lobbychat', op, ...extra });
const last = (id, op) => events.filter((event) => event.id === id && event.msg.op === op).at(-1)?.msg;

send('first', 'join', { name: 'First' });
assert.deepEqual(last('first', 'history').history, []);
assert.equal(last('first', 'history').online, 1, '初次加入時在線人數為 1');
assert.equal(last('first', 'online').online, 1, '加入後推送在線人數 1');
send('first', 'send', { text: '本次連線訊息' });
assert.equal(last('first', 'msg').msg.text, '本次連線訊息');

send('second', 'join', { name: 'Second' });
assert.deepEqual(last('second', 'history').history, [], '新連線不會收到先前訊息');
assert.equal(last('second', 'history').online, 2, '加入回應的人數為 2');
assert.equal(last('first', 'online').online, 2, '既有連線收到更新後的人數 2');
assert.equal(last('second', 'online').online, 2, '新連線收到更新後的人數 2');
send('second', 'send', { text: '即時訊息' });
assert.equal(last('first', 'msg').msg.text, '即時訊息', '目前在線的人仍會即時收到新訊息');

send('second', 'leave');
assert.equal(last('first', 'online').online, 1, '離開後人數降回 1');
send('second', 'join', { name: 'Second' });
assert.deepEqual(last('second', 'history').history, [], '離開後重新加入也從空白開始');
assert.equal(last('second', 'history').online, 2, '重新加入後人數回到 2');
hub.drop('second');
assert.equal(last('first', 'online').online, 1, '斷線後人數降回 1');
hub.drop('first');
console.log('Lobby chat starts empty, updates online counts, and delivers live messages');
