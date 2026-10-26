'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  let clock = 0, next = 0;
  const timers = new Map();
  const keys = new Map();
  function element(tag) {
    return {
      tag, children: [], attributes: {}, inert: false, isConnected: true,
      setAttribute(k, v) { this.attributes[k] = v; },
      append(...nodes) { nodes.forEach(node => this.appendChild(node)); },
      appendChild(node) { this.children.push(node); node.parent = this; },
      addEventListener(k, fn) { this[k] = fn; },
      remove() { this.parent.children = this.parent.children.filter(node => node !== this); this.isConnected = false; },
      focus() { document.activeElement = this; },
      querySelector(tag) { for (const child of this.children) { if (child.tag === tag) return child; const match = child.querySelector(tag); if (match) return match; } return null; }
    };
  }
  const original = element('button');
  const document = {
    documentElement: { lang: 'zh-Hant' }, activeElement: original, body: element('body'),
    createElement: element,
    addEventListener(k, fn) { keys.set(k, fn); },
    removeEventListener(k) { keys.delete(k); }
  };
  document.body.appendChild(original);
  const window = {};
  const locales = fs.readFileSync(path.join(__dirname, '../public/js/locales.js'), 'utf8');
  vm.runInNewContext(locales.slice(locales.indexOf('/* Server outage translations')), { window });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/server-outage.js'), 'utf8'), {
    window, document, Date,
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { at: clock + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  return { api: window.ServerOutage, document, timers, original, keys, tick(ms) {
    clock += ms;
    for (const [id, timer] of timers) if (timer.at <= clock) { timers.delete(id); timer.fn(); }
  } };
}

const local = setup();
assert.equal(local.timers.size, 0, 'Homepage/offline starts no timer or network work');
local.api.state('offline'); local.api.state('unset');
assert.equal(local.timers.size, 0, 'Configuration errors and initial offline do not show reset advice');
local.api.state('connecting');
local.tick(20000);
assert.equal(local.document.body.children.length, 1, 'Allow a 20 second cold start');
local.api.state('waking'); local.api.state('retrying');
assert.equal(local.timers.size, 1, 'Retries do not restart or duplicate the deadline');
local.tick(10000);
const mask = local.document.body.children[1];
assert.ok(mask, 'Persistent outage opens a custom modal after 30 seconds');
assert.equal(mask.children[0].attributes.role, 'alertdialog');
assert.equal(local.original.inert, true, 'Background controls are blocked');
assert.equal(local.document.activeElement.tag, 'button', 'Dialog receives focus');
const tab = { key: 'Tab', preventDefault() { this.prevented = true; } };
local.keys.get('keydown')(tab);
assert.ok(tab.prevented, 'Tab stays within the dialog');
mask.querySelector('button').click();
assert.equal(local.original.inert, false, 'Dismissal restores background controls');
assert.equal(local.document.activeElement, local.original, 'Dismissal restores focus');
local.api.state('retrying'); local.tick(110000);
assert.equal(local.document.body.children.length, 1, 'Do not nag during the same outage');
local.api.state('idle'); local.api.state('connecting'); local.tick(30000);
assert.equal(local.document.body.children.length, 2, 'Explicitly re-entering online can show a new notice');
local.api.state('connected');
assert.equal(local.document.body.children.length, 1, 'A recovered server clears the notice');
local.api.state('connecting'); local.tick(10000); local.api.state('open'); local.tick(110000);
assert.equal(local.document.body.children.length, 1, 'Successful cold start cancels the notice');
local.api.state('connecting'); local.api.state('idle'); local.tick(110000);
assert.equal(local.document.body.children.length, 1, 'Leaving online cancels pending notices');
for (let month = 0; month < 12; month++) {
  const text = local.api.copy(new Date(2026, month, 28), 'zh-Hant')[1];
  assert.ok(text.includes(((month + 1) % 12 + 1) + ' 月 1 日'), 'Next month including December rollover');
}
assert.match(local.api.copy(new Date(2026, 11, 31), 'en')[1], /January 1/);
assert.match(local.api.copy(new Date(2026, 9, 31), 'zh-Hans')[1], /单机版/);
assert.match(local.api.copy(new Date(2026, 9, 31), 'zh-Hant')[1], /單機版/);
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert.match(html, /js\/server-outage\.js/);
assert.match(html, /css\/server-outage\.css/);
assert.ok(!/\b(?:alert|confirm|prompt)\s*\(/.test(fs.readFileSync(path.join(__dirname, '../public/js/server-outage.js'), 'utf8')), 'No browser-native alerts');
console.log('Server outage: timing, recovery, cancellation, deduplication, focus, translations and 12 month boundaries passed');
