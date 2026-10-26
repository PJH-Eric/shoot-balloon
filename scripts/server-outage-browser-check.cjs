const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const projects = [path.basename(root)];
const sizes = [[390, 844], [844, 390], [820, 1180], [1180, 820], [1440, 900]];
const shots = path.join(root, 'screenshots', 'server-outage');
fs.mkdirSync(shots, { recursive: true });
const server = http.createServer((req, res) => {
  const parts = new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean);
  const project = parts.shift();
  if (!projects.includes(project)) { res.writeHead(503); res.end('Unavailable'); return; }
  const file = path.resolve(root, 'public', parts.join('/') || 'index.html');
  if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(503); res.end('Unavailable'); return; }
  const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const results = [];
  try {
    for (const project of projects.filter(name => !process.argv[2] || process.argv.slice(2).includes(name))) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', async dialog => { errors.push('Native dialog: ' + dialog.message()); await dialog.dismiss(); });
      await page.route('**/*', route => {
        if (route.request().url().startsWith(base)) return route.continue();
        return route.abort();
      });
      await page.clock.install();
      await page.goto(`${base}/${project}/?server=${encodeURIComponent(base)}`);
      await page.waitForTimeout(150);
      assert.equal(await page.locator('.server-outage-mask').count(), 0, project + ': homepage no notice');
      const skip = page.getByRole('button', { name: /跳過教學/ });
      if (await skip.isVisible()) await skip.click();
      const online = page.getByRole('button', { name: /線上|线上|跟別人玩/ }).first();
      if (!await online.isVisible()) throw new Error(project + ': missing online entry; ' + await page.locator('button:visible').allTextContents());
      await online.click();
      if (project === 'stair-kids') await page.locator('[data-go="lobby"]').click();
      await page.waitForTimeout(150);
      await page.clock.fastForward(20000);
      assert.equal(await page.locator('.server-outage-mask').count(), 0, project + ': no premature cold-start notice');
      await page.clock.fastForward(11000);
      await page.getByRole('alertdialog').waitFor({ timeout: 2000 });
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        const bounds = await page.getByRole('alertdialog').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height, project + ': dialog fits viewport');
        const button = await page.locator('.server-outage-button').boundingBox();
        assert.ok(button.height >= 48 && button.y + button.height <= height, project + ': reachable touch target');
        await page.screenshot({ path: path.join(shots, `${project}-${width}x${height}.png`) });
      }
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('.server-outage-button').evaluate(el => document.activeElement === el), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('alertdialog').count(), 0);
      assert.equal(await page.locator('body > [inert]').count(), 0);
      await page.clock.fastForward(120000);
      assert.equal(await page.getByRole('alertdialog').count(), 0, project + ': no repeat nag');
      // Exercise the real transport's cancellation, including late HTTP/script errors.
      await page.evaluate(() => sessionStorage.clear());
      await page.goto(`${base}/${project}/?server=${encodeURIComponent(base)}`);
      if (await skip.isVisible()) await skip.click();
      await online.click({ timeout: 3000 }).catch(async error => {
        console.log(project + ': buttons after reload ' + JSON.stringify(await page.locator('button:visible').allTextContents()));
        console.log(project + ': page errors ' + JSON.stringify(errors));
        await page.screenshot({ path: path.join(shots, project + '-cancel-failure.png') });
        throw error;
      });
      if (project === 'stair-kids') await page.locator('[data-go="lobby"]').click();
      if (project === 'stair-kids') await page.locator('#btn-back').click();
      else await page.evaluate(async project => {
        if (project === 'amaze-go') window.AmazeOnline.enterLocal();
        else if (project === 'maze-roll') (await import('./js/net.js')).net.close();
        else if (window.Online && window.Online.disconnect) window.Online.disconnect();
        else if (window.Net && window.Net.close) window.Net.close();
        else if (window.Net && window.Net.disconnect) window.Net.disconnect();
        else throw new Error('No cancellation adapter for ' + project);
      }, project);
      await page.waitForTimeout(100);
      await page.clock.fastForward(31000);
      assert.equal(await page.getByRole('alertdialog').count(), 0, project + ': leaving cancels pending notice');
      for (const lang of ['zh-Hans', 'en']) {
        await page.evaluate(lang => {
          document.documentElement.lang = lang;
          window.ServerOutage.state('idle');
          window.ServerOutage.state('begin');
        }, lang);
        await page.clock.fastForward(30000);
        const text = await page.getByRole('alertdialog').innerText();
        assert.match(text, lang === 'en' ? /keep playing offline/ : /单机版/);
        await page.setViewportSize({ width: 390, height: 844 });
        const bounds = await page.getByRole('alertdialog').boundingBox();
        assert.ok(bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844, project + ': translation fits phone');
        await page.screenshot({ path: path.join(shots, `${project}-${lang}-390x844.png`) });
        await page.locator('.server-outage-button').click();
      }
      assert.deepEqual(errors, [], project + ': no uncaught JS/native alerts');
      console.log(project + ': PASS real connection failure, 5 viewports, keyboard, no native alerts');
      results.push({ project, pass: true });
      await page.close();
    }
  } finally {
    fs.writeFileSync(path.join(shots, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
    await browser.close(); server.close();
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
