'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.route('https://games.test/**', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<html lang="zh-TW"><head><title>Fruit Link</title></head><body><section data-result-share><h2>勝利</h2><p>分數 123</p><button>再來一局</button></section><p>CHAT SECRET</p></body></html>'
    }));
    await page.goto('https://games.test/island/fruit-link/?room=secret&token=credential#watch');
    const asset = path.join(__dirname, '../public/js/result-share.js');
    await page.addScriptTag({ path: path.join(path.dirname(asset), 'locales/result-share.js') });
    await page.route('https://games.test/island/fruit-link/vendor/html2canvas.min.js', route => route.fulfill({
      path: path.join(path.dirname(asset), 'vendor/html2canvas.min.js'), contentType: 'text/javascript'
    }));
    await page.addScriptTag({ path: asset });
    const keys = await page.evaluate(() => Object.values(GameResultShareLocales).map(dict => Object.keys(dict).sort()));
    assert.deepEqual(keys[0], keys[1]);
    assert.deepEqual(keys[1], keys[2]);
    const trigger = page.locator('.result-share-trigger');
    assert.equal(await trigger.innerText(), '分享結果');
    assert.equal(await page.locator('.result-share button').count(), 1);
    assert.equal(await page.locator('.result-share-dialog-layer').isVisible(), false);

    await page.evaluate(() => {
      window.downloadClicks = 0;
      window.shareCalls = [];
      document.addEventListener('click', event => { if (event.target.matches('a[download]')) window.downloadClicks++; });
      Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: data => data.files.length === 1 && data.files[0].type === 'image/png' });
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: async data => {
        window.shareCalls.push({ keys: Object.keys(data).sort(), type: data.files[0].type, activation: navigator.userActivation.isActive });
      } });
    });
    await trigger.click();
    await page.waitForFunction(() => document.querySelector('.result-share-image').naturalWidth > 100);
    const share = page.locator('.result-share-image-send');
    await share.click();
    const [call] = await page.evaluate(() => window.shareCalls);
    assert.deepEqual(call.keys, ['files']);
    assert.equal(call.type, 'image/png');
    assert.equal(call.activation, true);
    await page.evaluate(() => { navigator.share = async () => { throw new DOMException('cancel', 'AbortError'); }; });
    await share.click();
    assert.equal(await page.locator('.result-share-status').innerText(), '已取消分享');
    assert.equal(await page.evaluate(() => window.downloadClicks), 0);
    await page.evaluate(() => { navigator.canShare = () => false; });
    await share.click();
    assert.match(await page.locator('.result-share-status').innerText(), /下載 PNG/);
    assert.equal(await page.evaluate(() => window.downloadClicks), 0);

    const close = page.locator('.result-share-dialog-close');
    await close.click();
    assert.equal(await trigger.evaluate(button => document.activeElement === button), true);
    assert.equal(await page.locator('.result-share-dialog-layer').isVisible(), false);
    await trigger.click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.result-share-dialog-layer').isVisible(), false);
    await trigger.click();
    await page.locator('.result-share-dialog-layer').click({ position: { x: 2, y: 2 } });
    assert.equal(await page.locator('.result-share-dialog-layer').isVisible(), false);

    await page.evaluate(() => { document.querySelector('section p:not([hidden])').textContent = '分數 456'; });
    await page.waitForTimeout(30);
    assert.equal(await page.locator('.result-share button').count(), 1);
    assert.equal(await page.locator('.result-share-dialog-layer').count(), 0);
    await page.evaluate(() => { document.documentElement.lang = 'en'; });
    await page.waitForFunction(() => document.querySelector('.result-share-trigger').textContent === 'Share result');
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.ok((await trigger.boundingBox()).height >= 48);
      await trigger.click();
      const bounds = await page.locator('.result-share-dialog').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height + 1);
      await page.keyboard.press('Escape');
    }
    console.log('PASS image-only flow: one result button, lazy image dialog, File-only native share, cancel, download fallback, close/Escape/backdrop, fresh result, locales, 4 viewports');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
