'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const lobby = path.basename(root) === 'game-lobby';
const coreFile = lobby ? 'i18n.js' : 'public/js/i18n.js';
const localeFile = lobby ? 'locales.js' : 'public/js/locales.js';
const dictionaries = {};
const registry = {
  register(language, dict) {
    dictionaries[language] = Object.assign(dictionaries[language] || {}, dict);
    return registry;
  },
};

function loadLocales(file) {
  const sandbox = { I18N: registry, window: { I18N: registry }, module: { exports: {} } };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(read(file), sandbox, { filename: file });
  return sandbox;
}

if (path.basename(root) === 'maze-roll') {
  const localeSandbox = loadLocales(localeFile);
  const traditional = localeSandbox.window.MR_EN;
  const simplified = localeSandbox.window.MR_HANS;
  assert.ok(traditional && simplified, '迷宮滾球要同時載入英文與簡體字典');
  assert.equal(Object.keys(simplified).length, Object.keys(traditional).length, '簡體字典須涵蓋所有遊戲文字');
  assert.ok(Object.values(simplified).every((value) => typeof value === 'string' && value.length > 0), '簡體字典不可有空白內容');
  assert.ok(Object.values(simplified).some((value, index) => value !== Object.values(traditional)[index]), '簡體字典不可只是英文副本');
} else {
  loadLocales(localeFile);
  const uiLocaleFile = path.join(root, 'public/js/ui-locales.js');
  if (fs.existsSync(uiLocaleFile)) loadLocales('public/js/ui-locales.js');
  const hans = dictionaries['zh-Hans'];
  const hant = dictionaries['zh-Hant'];
  const english = dictionaries.en;
  assert.ok(hans && hant && english, '繁中、簡中與英文三種字典都要註冊');
  const keys = (dict) => Object.keys(dict).sort();
  assert.deepEqual(keys(hans), keys(hant), '繁中與簡中字典 key 必須一致');
  assert.deepEqual(keys(hans), keys(english), '簡中與英文字典 key 必須一致');
  const placeholders = (value) => typeof value === 'string' ? [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort() : [];
  for (const key of keys(hans)) {
    const value = hans[key];
    assert.ok(typeof value === 'function' || (typeof value === 'string' && (value.length > 0 || hant[key] === '')), `簡中字典 ${key} 不可為空`);
    if (typeof value === 'string' && typeof hant[key] === 'string') assert.deepEqual(placeholders(value), placeholders(hant[key]), `${key} 的動態參數必須保留`);
    if (typeof value === 'function') {
      const sample = { name: 'Player-XYZ', n: 3, a: 2, b: 4, moves: 5, time: '1:23', ms: 42, p: 1, hp: 3, near: 1, deep: 5, far: 2, speed: 1, every: 3, rate: 10, cap: 2, spike: 20, fake: 5, diff: '一般', players: 1, seats: 4, spectators: 0, w: 2, l: 1, m: 5, t: '2:00', tag: '完成', left: 2, s: 4, place: 1 };
      assert.equal(typeof value(sample), 'string', `簡中動態翻譯 ${key} 必須回傳文字`);
      if (value.toString().includes('p.name')) assert.ok(value(sample).includes('Player-XYZ'), `${key} 必須保留玩家名稱`);
    }
  }
  assert.ok(keys(hans).some((key) => typeof hans[key] === 'string' && hans[key] !== hant[key]), '簡中字典必須有簡體字內容');
}

function createI18n(language) {
  const sandbox = {
    URL,
    URLSearchParams,
    location: { href: 'https://example.test/', search: `?lang=${language}` },
    localStorage: { getItem() { return null; }, setItem() {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read(coreFile), sandbox, { filename: coreFile });
  return sandbox.I18N;
}

assert.deepEqual(Array.from(createI18n('zh-Hans').SUPPORTED), ['zh-Hant', 'zh-Hans', 'en']);
for (const alias of ['zh-Hans', 'zh-CN', 'zh-SG', 'zh_cn']) assert.equal(createI18n(alias).lang, 'zh-Hans', `${alias} 應使用簡體中文`);
for (const alias of ['zh-Hant', 'zh-TW', 'zh-HK']) assert.equal(createI18n(alias).lang, 'zh-Hant', `${alias} 應使用繁體中文`);
assert.equal(createI18n('en-US').lang, 'en');

if (lobby) {
  const config = JSON.parse(read('config/games.json'));
  assert.ok(config.i18n['zh-Hans'] && config.i18n['zh-Hans'].title, '大廳站名要有簡體版');
  for (const game of config.games) {
    const hans = game.i18n && game.i18n['zh-Hans'];
    assert.ok(hans, `${game.id} 缺少簡體遊戲資料`);
    for (const field of ['title', 'eyebrow', 'description', 'controls', 'badge']) assert.ok(typeof hans[field] === 'string' && hans[field].trim(), `${game.id} 缺少 zh-Hans.${field}`);
    for (const field of ['tags', 'modes']) assert.ok(Array.isArray(hans[field]) && hans[field].length === (game[field] || []).length, `${game.id} 的簡體 ${field} 數量不一致`);
  }
}

if (path.basename(root) === 'draw-guess') {
  const Words = require('../public/js/words.js');
  const hansWords = require('../public/js/words.zh-Hans.js');
  assert.equal(Object.keys(hansWords).length, Words.LIST.length, '簡體題庫要涵蓋全部題目');
  for (const word of Words.LIST) {
    const simplified = Words.localize(word, 'zh-Hans');
    assert.equal(simplified.lang, 'zh-Hans');
    assert.ok(simplified.text && simplified.id === word.id);
  }
}

const analyticsFile = fs.existsSync(path.join(root, 'public/js/analytics.js')) ? 'public/js/analytics.js' : 'analytics.js';
assert.match(read(analyticsFile), /lang === 'en' \|\| lang === 'zh-Hans'/, 'GA4 app_language 應保留簡體語系代碼');
console.log(`${path.basename(root)} zh-Hans localization checks passed`);
