'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const publicDir = fs.existsSync(path.join(root, 'public/index.html')) ? path.join(root, 'public') : root;
const jsDir = fs.existsSync(path.join(publicDir, 'js')) ? path.join(publicDir, 'js') : publicDir;
const read = file => fs.readFileSync(file, 'utf8');
const dicts = {};
const api = { register(lang, values) { Object.assign(dicts[lang] ||= {}, values); return api; } };
const box = { I18N: api };
box.window = box; box.self = box;
for (const file of ['msgs.js', 'locales.js', 'ui-locales.js']) {
  if (fs.existsSync(path.join(jsDir, file))) vm.runInNewContext(read(path.join(jsDir, file)), box);
}
assert.deepEqual(Object.keys(dicts.en).sort(), Object.keys(dicts['zh-Hant']).sort(), 'Both locales must have the same keys');
for (const [key, value] of Object.entries(dicts.en)) {
  if (typeof value !== 'string') continue;
  if (!/^lang\./.test(key)) assert.ok(!/[\u3400-\u9fff]/.test(value), 'Untranslated English: ' + key);
  const params = s => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort();
  if (typeof dicts['zh-Hant'][key] === 'string') assert.deepEqual(params(value), params(dicts['zh-Hant'][key]), 'Interpolation parameters: ' + key);
}
const html = read(path.join(publicDir, 'index.html'));
const used = new Set();
for (const m of html.matchAll(/data-i18n(?:-html|-title|-content)?="([^"]+)"/g)) used.add(m[1]);
for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(';')) used.add(pair.split('=')[1]?.trim());
for (const file of fs.readdirSync(jsDir).filter(f => f.endsWith('.js') && !/^(locales|ui-locales|i18n|msgs)\.js$/.test(f))) {
  for (const m of read(path.join(jsDir, file)).matchAll(/\b(?:t|T)\(['"]([\w.-]+)['"]\s*[,)]/g)) used.add(m[1]);
}
for (const key of used) assert.ok(key in dicts.en, 'Missing translation key: ' + key);
const core = read(path.join(jsDir, 'i18n.js'));
const memory = new Map();
const runtime = { URL, URLSearchParams, console, localStorage: { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) }, location: { href: 'https://example.com/?lang=en', search: '?lang=en' }, history: { replaceState(_state, _title, url) { runtime.location.href = String(url); runtime.location.search = new URL(url).search; } } };
runtime.window = runtime;
vm.runInNewContext(core, runtime);
runtime.I18N.register('zh-Hant', { hello: '你好，{name}' }).register('en', { hello: 'Hello, {name}' });
assert.equal(runtime.I18N.lang, 'en');
assert.equal(runtime.I18N.message('你好，小明'), 'Hello, 小明', 'System-message interpolation preserves names');
runtime.I18N.setLang('zh-TW');
assert.equal(runtime.I18N.lang, 'zh-Hant');
assert.equal(memory.get('game-island-lang'), 'zh-Hant');
assert.equal(new URL(runtime.location.href).searchParams.get('lang'), 'zh-Hant', 'Reload must retain the latest choice');
runtime.I18N.setLang('en');
assert.match(runtime.I18N.withLang('https://example.com/game?room=ABCD'), /room=ABCD&lang=en/);
runtime.I18N.register('zh-Hant', { nested: '難度：{level}', normal: '普通' }).register('en', { nested: 'Difficulty: {level}', normal: 'Normal' });
assert.equal(runtime.I18N.message({ key: 'nested', params: { level: { key: 'normal' } } }), 'Difficulty: Normal');
let input = { id: 'nickname', tagName: 'INPUT', type: 'text', value: '玩家 Alice', selectionStart: 2, selectionEnd: 4, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; } };
runtime.document = {
  documentElement: { setAttribute() {}, getAttribute() { return null; } },
  querySelectorAll(selector) { return selector === 'input[id], textarea[id]' ? [input] : []; },
  querySelector() { return null; },
  getElementById() { return input; }
};
runtime.I18N.onChange(() => { input = { ...input, value: '' }; });
runtime.I18N.setLang('zh-TW');
assert.equal(input.value, '玩家 Alice', 'Rebuilt forms preserve player input');
assert.equal(input.selectionStart, 2);
console.log('Localization verified: ' + Object.keys(dicts.en).length + ' keys, persistence and message interpolation');
