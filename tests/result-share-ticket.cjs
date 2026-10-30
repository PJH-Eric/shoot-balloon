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
    for (const file of ['js/ui.js', 'js/locales/result-share.js', 'js/result-share.js']) await page.addScriptTag({ path: asset(file) });
    await page.waitForFunction(() => document.querySelectorAll('.result-share button.tk').length === 6);
    const primary = page.locator('.result-share-actions .result-share-button');
    const appearance = await primary.evaluate(button => {
      const style = getComputedStyle(button);
      return { border: style.borderTopWidth, radius: style.borderRadius, height: button.getBoundingClientRect().height, type: button.type, background: style.backgroundColor };
    });
    assert.equal(appearance.border, '3px');
    assert.equal(appearance.radius, '6px');
    assert.ok(appearance.height >= 48);
    assert.equal(appearance.type, 'button');
    assert.notEqual(appearance.background, await page.locator('.result-share-preview').evaluate(button => getComputedStyle(button).backgroundColor));
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.shared = data; } }));
    await primary.click();
    assert.match(await page.evaluate(() => window.shared.text), /Score 123/);
    await page.evaluate(() => { document.documentElement.lang = 'en'; });
    await page.waitForFunction(() => document.querySelector('.result-share-actions .result-share-button').textContent === 'Share result');
    assert.equal(await primary.evaluate(button => getComputedStyle(button).borderTopWidth), '3px');
    await page.locator('.result-share-preview').click();
    assert.equal(await page.locator('.result-share-panel:not(.result-share-image-panel) .tk').count(), 1);
    console.log('PASS ticket share controls: native ticket appearance, theme tones, 48px targets, retained share handlers and localization');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
