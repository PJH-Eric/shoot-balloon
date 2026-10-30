'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const asset = path.join(__dirname, '../public/js/result-share.js');
  try {
    await page.route('https://games.test/**', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<html lang="zh-TW"><head><title>Game</title><style>body{margin:0}section{width:300px;background:white}h2{margin:0;height:40px}#scores{height:80px;overflow:auto}.red{height:64px;background:rgb(255,0,0)}.green{height:100px;background:rgb(0,255,0)}button{background:blue}</style></head><body><section data-result-share><h2>Score 123</h2><div id="scores"><div class="red">First</div><div class="green">Last</div></div><p hidden>PRIVATE</p><button>Play again</button></section><p>CHAT SECRET</p></body></html>'
    }));
    await page.goto('https://games.test/game/?token=secret#room');
    await page.addStyleTag({ content: '.red::before{content:"";display:block;width:8px;height:8px;box-shadow:0 0 2px color-mix(in srgb,red 55%,transparent)}' });
    await page.addScriptTag({ path: path.join(path.dirname(asset), 'locales/result-share.js') });
    // Exercise lazy loading from the helper's own deployment path.
    await page.route('https://games.test/game/vendor/html2canvas.min.js', route => route.fulfill({ path: path.join(path.dirname(asset), 'vendor/html2canvas.min.js'), contentType: 'text/javascript' }));
    await page.addScriptTag({ path: asset });
    await page.evaluate(() => {
      window.downloadClicks = 0;
      document.addEventListener('click', e => { if (e.target.matches('a[download]')) window.downloadClicks++; });
      Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: data => data.files[0].type === 'image/png' });
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: async data => {
        window.shared = { type: data.files[0].type, size: data.files[0].size, name: data.files[0].name, url: data.url, activation: navigator.userActivation.isActive };
      } });
      window.revoked = [];
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = value => { window.revoked.push(value); revoke(value); };
    });
    const prepare = page.locator('.result-share-image-prepare');
    const send = page.locator('.result-share-image-send');
    const panel = page.locator('.result-share-image-panel');
    await prepare.click();
    await page.waitForFunction(() => !!document.querySelector('.result-share-image').getAttribute('src'));
    const pixels = await page.locator('.result-share-image').evaluate(async img => {
      await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const bytes = ctx.getImageData(0, 0, c.width, c.height).data;
      let green = 0, blue = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        if (bytes[i] === 0 && bytes[i + 1] === 255 && bytes[i + 2] === 0) green++;
        if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 255) blue++;
      }
      return { width: c.width, height: c.height, green, blue, signature: Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer()).slice(0, 8)) };
    });
    assert.deepEqual(pixels.signature, [137,80,78,71,13,10,26,10]);
    assert.equal(pixels.width, 1080);
    assert.ok(pixels.height > 700 && pixels.height < 1600, JSON.stringify(pixels));
    assert.ok(pixels.green > 25000, JSON.stringify(pixels)); // Full offscreen ranking tail.
    assert.equal(pixels.blue, 0); // Original buttons and sharing UI excluded.
    assert.equal(await page.locator('.result-share-image-title').innerText(), '分享圖片預覽');
    assert.equal(await page.locator('#scores').evaluate(el => el.clientHeight), 80);
    await send.click();
    const shared = await page.evaluate(() => window.shared);
    assert.equal(shared.type, 'image/png'); assert.ok(shared.size > 1000);
    assert.equal(shared.url, 'https://games.test/game/'); assert.equal(shared.activation, true);
    await page.evaluate(() => { navigator.share = async () => { throw new DOMException('cancel', 'AbortError'); }; });
    await send.click();
    assert.equal(await page.locator('.result-share-status').innerText(), '已取消分享');
    assert.equal(await page.evaluate(() => window.downloadClicks), 0);
    await page.evaluate(() => { navigator.canShare = () => false; });
    await send.click();
    assert.match(await page.locator('.result-share-status').innerText(), /下載 PNG/);
    assert.equal(await page.evaluate(() => window.downloadClicks), 0);
    const downloadEvent = page.waitForEvent('download');
    await page.locator('.result-share-image-download').click();
    const download = await downloadEvent;
    assert.match(download.suggestedFilename(), /^game-result-\d+\.png$/);
    await page.evaluate(() => { document.querySelector('section > button').textContent = 'Again'; });
    assert.equal(await panel.isVisible(), true);
    await page.evaluate(() => { document.querySelector('h2').textContent = 'Score 999'; });
    await page.waitForFunction(() => document.querySelector('.result-share-image-panel').hidden);
    assert.equal(await page.evaluate(() => window.revoked.length), 1);
    // Capture failure can be retried; an in-flight old result never publishes a stale image.
    await page.evaluate(() => { window.realCapture = html2canvas; window.html2canvas = async () => { throw Error('fail'); }; });
    await prepare.click();
    await page.waitForFunction(() => !document.querySelector('.result-share-image-prepare').disabled);
    assert.match(await page.locator('.result-share-status').innerText(), /失敗/);
    await page.evaluate(() => { window.html2canvas = () => new Promise(resolve => { window.releaseCapture = resolve; }); });
    await prepare.click();
    await page.waitForFunction(() => !!window.releaseCapture);
    await page.evaluate(() => { document.querySelector('h2').textContent = 'New round'; });
    await page.waitForFunction(() => !document.querySelector('.result-share-image-prepare').disabled);
    await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 20; releaseCapture(c); });
    await page.waitForTimeout(50);
    assert.equal(await panel.isVisible(), false);
    await page.evaluate(() => { window.html2canvas = window.realCapture; document.documentElement.lang = 'en'; });
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await prepare.click();
      await page.waitForFunction(() => !!document.querySelector('.result-share-image').getAttribute('src'));
      assert.equal(await panel.isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.ok((await prepare.boundingBox()).height >= 48);
      // Invalidate for the next viewport, also exercising resource cleanup.
      await page.evaluate(() => { document.querySelector('h2').textContent += '!'; });
      await page.waitForFunction(() => document.querySelector('.result-share-image-panel').hidden);
    }
    await prepare.click();
    await page.waitForFunction(() => !!document.querySelector('.result-share-image').getAttribute('src'));
    const before = await page.evaluate(() => window.revoked.length);
    await page.evaluate(() => document.querySelector('section').remove());
    await page.waitForFunction(n => window.revoked.length > n, before);
    console.log('PASS PNG: real pixels, full scroll capture, privacy, lazy renderer, File share activation, cancel, download, retry, stale results, blob cleanup, 4 viewports');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
