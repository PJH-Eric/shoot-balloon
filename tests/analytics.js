'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const sourcePath = fs.existsSync(path.join(root, 'public/js/analytics.js'))
  ? path.join(root, 'public/js/analytics.js') : path.join(root, 'analytics.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function client(hostname = 'pjh-eric.github.io', options = {}) {
  const calls = [], scripts = [], listeners = {};
  let time = 1000;
  class Clock extends Date { static now() { return time; } }
  const browser = {
    GAME_ANALYTICS_CONFIG: { measurement_id: 'G-TEST123', game_id: 'test-game', page_location: 'https://pjh-eric.github.io/test-game/' },
    location: { hostname, href: 'https://' + hostname + '/test-game/?token=private-token#private-hash' },
    document: {
      referrer: 'https://pjh-eric.github.io/other/?name=private-name#private-hash', title: 'Test',
      createElement() { return {}; }, head: { appendChild(script) { scripts.push(script); } },
      addEventListener(name, fn) { listeners[name] = fn; }
    },
    I18N: { lang: 'en' },
    ...options
  };
  if (hostname === 'pjh-eric.github.io') browser.gtag = (...args) => calls.push(args);
  const context = { window: browser, URL, Date: Clock };
  vm.runInNewContext(source, context);
  return { browser, api: browser.GameAnalytics, calls, scripts, listeners, context, advance(ms) { time += ms; } };
}

const c = client();
assert.equal(c.scripts.length, 1, '只載入一次 Google tag');
const config = c.calls.find(call => call[0] === 'config')[2];
assert.equal(config.page_location, 'https://pjh-eric.github.io/test-game/');
assert.equal(config.page_referrer, 'https://pjh-eric.github.io/other/');
assert.equal(config.send_page_view, true);
assert.equal(config.allow_google_signals, false);
c.api.init(c.browser.GAME_ANALYTICS_CONFIG);
vm.runInNewContext(source, c.context);
assert.equal(c.scripts.length, 1, '初始化／腳本重複載入不重送 config 或 page_view');

const events = () => c.calls.filter(call => call[0] === 'event');
c.api.start({ mode: 'solo', players: 3, difficulty: 'hard', nickname: 'private-name', token: 'private-token' }, 'round-a');
c.api.start({ mode: 'solo', players: 3 }, 'round-a');
c.advance(3200);
c.api.end({ result: 'loss', room_id: 'private-room' });
c.api.end({ result: 'win' });
assert.equal(events().length, 2);
assert.equal(events()[0][2].mode, 'ai', '單機含電腦對手統一歸入 ai');
assert.equal(events()[1][2].result, 'lose');
assert.equal(events()[1][2].duration_sec, 3);
assert.equal(events()[1][2].game_id, 'test-game');
assert.equal(events()[1][2].app_language, 'en');
assert.equal(events()[1][2].transport_type, 'beacon');
assert.ok(!JSON.stringify(c.calls).includes('private-'), '參數、page_location、referrer 不帶玩家或邀請資料');

c.api.start({ mode: 'online', players: 2 }, 'round-b');
c.api.start({ mode: 'online', players: 2 }, 'round-a');
assert.equal(events().length, 3, '舊對局快照不可重開');
c.api.sync('over', 'round-a', { mode: 'online' }, { result: 'win' });
assert.equal(events().length, 3, '舊結算不可結束新對局');
c.api.sync('over', 'round-b', { mode: 'online' }, { result: 'draw' });
assert.equal(events().length, 4);
c.api.reset();
c.api.start({ mode: 'online' }, 'round-b');
assert.equal(events().length, 4, '離開／返回不清除已計數對局');
c.api.sync('playing', 'spectator', { mode: 'online', spectator: true });
c.api.end({ result: 'win' });
assert.equal(events().length, 4, '觀戰不計開局或結算');
c.api.start({ mode: 'practice', players: 1 });
c.api.end({ result: 'complete' });
assert.equal(events()[4][2].mode, 'solo');
assert.equal(events()[4][2].variant, 'practice');
c.api.start({ mode: 'solo_random', players: 1 });
c.api.end({ result: 'complete' });
assert.equal(events()[6][2].variant, 'solo_random');

const beforeRoom = events().length;
c.api.roomRequest({ t: 'invite:peek', token: 'private-token' });
c.api.roomResponse('room', true);
assert.equal(events().length, beforeRoom, '預覽邀請不等於成功入房');
c.api.roomRequest({ t: 'join', token: 'private-token' });
c.api.roomResponse('err', false);
c.api.roomResponse('joined', true);
assert.equal(events().length, beforeRoom, '失敗入房不計數');
c.api.roomRequest({ type: 'create', name: 'private-name' });
c.api.roomResponse('joined', 'room-a');
c.api.roomResponse('room', 'room-a');
assert.equal(events().at(-1)[1], 'room_create');
c.api.roomAccepted('join', 'room-a');
assert.equal(events().length, beforeRoom + 1, '重連同房不重複計數');
c.api.roomResponse('closed', false);
c.api.roomAccepted('join', 'room-a', 'invite_link');
assert.equal(events().length, beforeRoom + 2, '關房後清除房間追蹤狀態');
assert.equal(events().at(-1)[2].via, 'invite_link');
c.api.roomLeft();
c.api.roomRequest({ type: 'invite:resolve', token: 'private-token', name: 'private-name' });
c.api.roomResponse('joined', 'room-b');
assert.equal(events().at(-1)[1], 'room_join', '確認邀請並成功加入要計數');
assert.equal(events().at(-1)[2].via, 'invite_link');

const beforeInvalid = events().length;
c.api.track('nickname', { name: 'private-name' });
assert.equal(events().length, beforeInvalid, '只接受已定義事件');
c.api.track('game_end', { mode: 'unknown', players: Infinity, duration_sec: -1, result: 'private-name', url: 'private-url' });
for (const key of ['mode', 'players', 'duration_sec', 'result', 'url']) assert.equal(events().at(-1)[2][key], undefined);
c.browser.gtag = () => { throw new Error('blocked'); };
assert.doesNotThrow(() => c.api.track('game_start'));
delete c.browser.gtag;
assert.doesNotThrow(() => c.api.track('game_start'));

for (const hostname of ['localhost', '127.0.0.1', 'preview.example', '']) {
  const local = client(hostname);
  assert.equal(local.scripts.length, 0);
  assert.equal(local.browser.gtag, undefined);
  assert.doesNotThrow(() => local.api.start({ mode: 'solo', players: 1 }));
}
const maze = client('pjh-eric.github.io', { MR_CONFIG: { ga4MeasurementId: 'G-MAZE123' } });
assert.equal(maze.browser.MR_ANALYTICS, maze.api, '保留迷宮滾球畫面追蹤 API');
assert.equal(maze.calls.find(call => call[0] === 'config')[2].send_page_view, false);
maze.api.pageView('home');
maze.api.pageView('home');
maze.api.pageView('game');
assert.equal(maze.calls.filter(call => call[1] === 'page_view').length, 2);
assert.ok(!JSON.stringify(maze.calls).includes('private-'));
console.log('GA4 verified: initialization, local isolation, lifecycle deduplication, spectator, room flow, parameters and native screen views');
