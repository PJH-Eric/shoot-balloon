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
      body: '<html lang="zh-TW"><head><title>Fruit Link</title></head><body><section data-result-share><h2>勝利</h2><p id="score">分數 123</p><p hidden>SECRET</p><button>再來一局</button></section><p>CHAT SECRET</p></body></html>'
    }));
    await page.goto('https://games.test/island/fruit-link/?room=secret&token=credential#watch');
    const asset = path.join(__dirname, '../public/js/result-share.js');
    await page.addScriptTag({ path: path.join(path.dirname(asset), 'locales/result-share.js') });
    await page.addScriptTag({ path: asset });
    const keys = await page.evaluate(() => Object.values(GameResultShareLocales).map(dict => Object.keys(dict).sort()));
    assert.deepEqual(keys[0], keys[1]);
    assert.deepEqual(keys[1], keys[2]);
    const share = page.locator('.result-share-actions .result-share-button');
    await share.waitFor();
    await page.evaluate(() => {
      window.calls = [];
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: async data => window.calls.push(data) });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copied = value; } } });
    });
    await share.click();
    const [data] = await page.evaluate(() => window.calls);
    assert.equal(data.url, 'https://games.test/island/fruit-link/');
    assert.match(data.text, /勝利\n分數 123/);
    assert.doesNotMatch(data.text, /SECRET|再來一局|預覽|分享結果/);
    await page.evaluate(() => { navigator.share = async () => { throw new DOMException('cancel', 'AbortError'); }; });
    await share.click();
    assert.equal(await page.evaluate(() => window.copied), undefined);
    assert.equal(await page.locator('.result-share-status').innerText(), '已取消分享');
    await page.evaluate(() => { navigator.share = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
    await share.click();
    assert.match(await page.evaluate(() => window.copied), /分數 123\nhttps:\/\/games.test\/island\/fruit-link\/$/);
    await page.evaluate(() => { navigator.share = undefined; navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
    await share.click();
    assert.equal(await page.locator('.result-share-panel').isVisible(), true);
    assert.match(await page.locator('.result-share-text').innerText(), /分數 123/);
    assert.match(await page.evaluate(() => getSelection().toString()), /分數 123/);
    await page.evaluate(() => { document.documentElement.lang = 'en'; });
    await page.waitForFunction(() => document.querySelector('.result-share-actions .result-share-button').textContent === 'Share result');
    await page.evaluate(() => { document.querySelector('#score').textContent = 'Score 999'; navigator.clipboard.writeText = async value => { window.copied = value; }; });
    await share.click();
    assert.match(await page.evaluate(() => window.copied), /Score 999/);
    await page.evaluate(() => { GameResultShare.mount(document.querySelector('[data-result-share]')); });
    assert.equal(await page.locator('.result-share').count(), 1);
    await page.evaluate(() => { document.querySelector('[data-result-share]').innerHTML = '<h2>New round</h2><p>Score 42</p>'; });
    await share.waitFor();
    assert.equal(await page.locator('.result-share').count(), 1);
    await share.click();
    assert.match(await page.evaluate(() => window.copied), /Score 42/);
    assert.doesNotMatch(await page.evaluate(() => window.copied), /999|123/);
    await page.evaluate(() => {
      window.count = 0;
      navigator.share = () => { window.count++; return new Promise(resolve => { window.release = resolve; }); };
    });
    await share.click();
    assert.equal(await share.isDisabled(), true);
    await page.evaluate(() => { document.querySelector('.result-share-actions .result-share-button').click(); });
    assert.equal(await page.evaluate(() => window.count), 1);
    await page.evaluate(() => window.release());
    await page.waitForFunction(() => !document.querySelector('.result-share-actions .result-share-button').disabled);
    await share.click();
    await page.evaluate(() => {
      document.querySelector('[data-result-share] h2').textContent = 'A different round';
    });
    await page.waitForFunction(() => !document.querySelector('.result-share-actions .result-share-button').disabled);
    await page.evaluate(() => window.release());
    assert.equal(await page.locator('.result-share-status').innerText(), '');
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.ok((await share.boundingBox()).height >= 48);
    }
    console.log('PASS result sharing: native, cancel, clipboard, manual, locale, fresh results, idempotency, busy guard, 4 viewports');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
