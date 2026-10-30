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
    await page.route('https://games.test/game/vendor/html2canvas.min.js', route => route.fulfill({
      path: path.join(path.dirname(asset), 'vendor/html2canvas.min.js'), contentType: 'text/javascript'
    }));
    await page.addScriptTag({ path: asset });
    const prepare = page.locator('.result-share-trigger');
    const layer = page.locator('.result-share-dialog-layer');
    const image = page.locator('.result-share-image');
    const share = page.locator('.result-share-image-send');
    const downloadButton = page.locator('.result-share-image-download');
    assert.equal(await page.locator('.result-share button').count(), 1);
    assert.equal(await prepare.innerText(), '分享結果');
    assert.equal(await page.locator('.result-share-preview,.result-share-text,.result-share-copy').count(), 0);
    assert.equal(await layer.isVisible(), false);

    await page.evaluate(() => {
      window.downloadClicks = 0;
      window.shared = null;
      document.addEventListener('click', event => { if (event.target.matches('a[download]')) window.downloadClicks++; });
      Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: data => data.files.length === 1 && data.files[0].type === 'image/png' });
      Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: async data => {
        window.shared = { keys: Object.keys(data).sort(), type: data.files[0].type, size: data.files[0].size, name: data.files[0].name, activation: navigator.userActivation.isActive };
      } });
      window.revoked = [];
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = value => { window.revoked.push(value); revoke(value); };
    });
    await prepare.click();
    await page.waitForFunction(() => { const img = document.querySelector('.result-share-image'); return img.complete && img.naturalWidth > 100; });
    assert.equal(await layer.isVisible(), true);
    assert.equal(await page.locator('.result-share-dialog-title').innerText(), '分享結算圖片');
    const pixels = await image.evaluate(async img => {
      await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
      const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let green = 0, blue = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        if (bytes[i] === 0 && bytes[i + 1] === 255 && bytes[i + 2] === 0) green++;
        if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 255) blue++;
      }
      return { width: canvas.width, height: canvas.height, green, blue, background: Array.from(bytes.slice(0, 4)), signature: Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer()).slice(0, 8)) };
    });
    assert.deepEqual(pixels.signature, [137,80,78,71,13,10,26,10]);
    assert.equal(pixels.width, 1080);
    assert.ok(pixels.height > 700 && pixels.height < 1600, JSON.stringify(pixels));
    assert.ok(pixels.green > 25000, JSON.stringify(pixels)); // The complete offscreen ranking tail is present.
    assert.equal(pixels.blue, 0); // The result actions and sharing dialog are excluded.
    assert.notDeepEqual(pixels.background, [255, 255, 255, 255]);
    assert.equal(await page.locator('#scores').evaluate(el => el.clientHeight), 80);
    await share.click();
    const shared = await page.evaluate(() => window.shared);
    assert.deepEqual(shared.keys, ['files']);
    assert.equal(shared.type, 'image/png'); assert.ok(shared.size > 1000);
    assert.equal(shared.activation, true);
    assert.match(shared.name, /^game-result-\d+\.png$/);

    await page.evaluate(() => { navigator.share = async () => { throw new DOMException('cancel', 'AbortError'); }; });
    await share.click();
    assert.equal(await page.locator('.result-share-status').innerText(), '已取消分享');
    assert.equal(await page.evaluate(() => window.downloadClicks), 0);
    await page.evaluate(() => { navigator.canShare = () => false; });
    await share.click();
    assert.match(await page.locator('.result-share-status').innerText(), /下載 PNG/);
    assert.equal(await page.evaluate(() => window.downloadClicks), 0);
    const downloadEvent = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadEvent;
    assert.match(download.suggestedFilename(), /^game-result-\d+\.png$/);
    if (process.env.SAVE_SHARE_PREVIEW === '1') {
      await download.saveAs(path.resolve(__dirname, '../../../../docs/result-share-image-evidence/screenshots/share-card-preview.png'));
    }
    await page.locator('.result-share-dialog-close').click();
    assert.equal(await prepare.evaluate(button => document.activeElement === button), true);
    assert.equal(await layer.isVisible(), false);

    // Result changes close the dialog and revoke the stale image. A failed render is retryable.
    await page.evaluate(() => { document.querySelector('.red').textContent = 'Round changed'; });
    await page.waitForTimeout(30);
    assert.equal(await layer.count(), 0);
    assert.equal(await page.evaluate(() => window.revoked.length), 1);
    await page.evaluate(() => { window.realCapture = html2canvas; window.html2canvas = async () => { throw Error('fail'); }; });
    await prepare.click();
    await page.waitForFunction(() => document.querySelector('.result-share-status').textContent.includes('失敗'));
    assert.equal(await share.isDisabled(), true);
    await page.evaluate(() => { window.html2canvas = () => new Promise(resolve => { window.releaseCapture = resolve; }); });
    await page.locator('.result-share-dialog-close').click();
    await prepare.click();
    await page.waitForFunction(() => !!window.releaseCapture);
    await page.evaluate(() => { document.querySelector('h2').textContent = 'New round'; });
    await page.waitForFunction(() => !document.querySelector('.result-share-dialog-layer'));
    await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 20; window.releaseCapture(canvas); });
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.result-share-trigger').isDisabled(), false);

    await page.evaluate(() => { window.html2canvas = window.realCapture; document.documentElement.lang = 'en'; });
    await page.waitForFunction(() => document.querySelector('.result-share-trigger').textContent === 'Share result');
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.ok((await prepare.boundingBox()).height >= 48);
      await prepare.click();
      await page.waitForFunction(() => document.querySelector('.result-share-image').naturalWidth > 100);
      const bounds = await page.locator('.result-share-dialog').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height + 1);
      await page.keyboard.press('Escape');
    }
    await prepare.click();
    await page.waitForFunction(() => document.querySelector('.result-share-image').naturalWidth > 100);
    const before = await page.evaluate(() => window.revoked.length);
    await page.evaluate(() => document.querySelector('section').remove());
    await page.waitForFunction(n => window.revoked.length > n, before);
    console.log('PASS image-only result dialog: decorated PNG pixels, full scroll capture, privacy, file-only share, cancel, download, retry, stale results, focus, blob cleanup, 4 viewports');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
