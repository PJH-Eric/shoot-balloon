'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.setContent('<html lang="zh-TW"><head><meta charset="utf-8"></head><body><div id="ov-result"><section data-result-share><h2>Result</h2><p>Score 123</p></section></div></body></html>');
    const asset = name => path.join(__dirname, '../public/', name);
    await page.addStyleTag({ path: asset('css/style.css') });
    await page.addScriptTag({ content: "window.html2canvas = async root => { const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(root.getBoundingClientRect().width)); canvas.height = 240; const context = canvas.getContext('2d'); context.fillStyle = '#f8f1dc'; context.fillRect(0, 0, canvas.width, canvas.height); return canvas; };" });
    for (const file of ['js/ui.js', 'js/locales/result-share.js', 'js/result-share.js']) await page.addScriptTag({ path: asset(file) });
    const trigger = page.locator('.result-share-trigger');
    assert.equal(await page.locator('.result-share button').count(), 1);
    await trigger.click();
    const layer = page.locator('.result-share-dialog-layer');
    await page.waitForFunction(() => document.querySelectorAll('.result-share-dialog-layer button.tk').length === 3);
    const controls = page.locator('.result-share-dialog-layer button.tk');
    assert.equal(await controls.count(), 3);
    const metrics = await controls.first().evaluate(button => {
      const style = getComputedStyle(button);
      return { border: style.borderTopWidth, radius: style.borderRadius, height: button.getBoundingClientRect().height };
    });
    assert.equal(metrics.border, '3px');
    assert.equal(metrics.radius, '6px');
    assert.ok(metrics.height >= 48);
    assert.equal(await page.locator('.result-share-image-send').getAttribute('data-tone'), 'gold');
    assert.equal(await page.locator('.result-share-image-download').getAttribute('data-tone'), 'paper');
    await page.waitForFunction(() => document.querySelector('.result-share-image').naturalWidth > 100);
    await page.evaluate(() => { Object.defineProperty(navigator, 'canShare', { configurable: true, value: data => data.files.length === 1 }); Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.shared = data; } }); });
    await page.locator('.result-share-image-send').click();
    const payload = await page.evaluate(() => ({ keys: Object.keys(window.shared).sort(), type: window.shared.files[0].type }));
    assert.deepEqual(payload, { keys: ['files'], type: 'image/png' });
    await page.evaluate(() => { document.documentElement.lang = 'en'; });
    await page.waitForFunction(() => document.querySelector('.result-share-trigger').textContent === 'Share result');
    assert.equal(await trigger.evaluate(button => getComputedStyle(button).borderTopWidth), '3px');
    await trigger.click();
    await page.waitForFunction(() => document.querySelectorAll('.result-share-dialog-layer button.tk').length === 3);
    assert.equal(await layer.locator('button.tk').count(), 3);
    console.log('PASS ticket share UI: single result trigger, image-only dialog, native ticket skin, gold/paper tones, 48px targets, file-only sharing, localization');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
