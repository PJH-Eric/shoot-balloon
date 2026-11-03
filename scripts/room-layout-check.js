'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PORT = 4100 + Math.floor(Math.random() * 300);
const BASE = 'http://127.0.0.1:' + PORT;
const OUT = path.join(__dirname, '..', 'screenshots', 'room-layout');
const sizes = [[320, 568], [390, 844], [667, 375], [844, 390], [768, 1024], [1024, 768], [1440, 900]];

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore'
  });
  let browser;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(BASE + '/health');
        assert(response.ok);
        break;
      } catch (error) {
        if (attempt >= 50) throw error;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const host = await context.newPage();
    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    for (const page of [host, guest]) {
      await page.addInitScript(() => {
        localStorage.setItem('sb_tutorial', '1');
        localStorage.setItem('sb_music', '0');
      });
      await page.goto(BASE);
      await page.click('#b-online');
      await page.waitForSelector('#conn-dot.ok');
      await page.fill('#lobby-nick', page === host ? '手機房間長暱稱測試玩家' : 'LongNickname');
    }
    await host.click('#b-create');
    await host.waitForSelector('#ov-wait:not([hidden])');
    const code = await host.evaluate(() => SB.S.view.code);
    await guest.fill('#join-code', code);
    await guest.click('#b-join');
    await guest.waitForSelector('#ov-wait:not([hidden])');
    for (let count = 1; count <= 3; count++) {
      await host.locator('#ai-add [data-v="normal"]').click();
      await host.waitForFunction(n => SB.S.view.ai.length === n, count);
    }
    fs.mkdirSync(OUT, { recursive: true });
    for (const [width, height] of sizes) {
      await host.setViewportSize({ width, height });
      for (const lang of ['zh-Hant', 'en']) {
        await host.evaluate(code => I18N.setLang(code), lang);
        const label = width + 'x' + height + '-' + lang;
        const issues = await host.evaluate(() => {
          const problems = [];
          const buttons = [...document.querySelectorAll('#ov-wait-btns button')];
          const rects = buttons.map(button => button.getBoundingClientRect());
          buttons.forEach((button, i) => {
            const r = rects[i];
            if (r.width < 44 || r.height < 44) problems.push('small action: ' + button.dataset.act);
            if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) problems.push('clipped action: ' + button.dataset.act);
            for (const child of button.children) {
              const content = child.getBoundingClientRect();
              if (content.left < r.left || content.right > r.right || content.top < r.top || content.bottom > r.bottom) problems.push('text overflow: ' + button.dataset.act);
            }
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            if (!button.contains(hit)) problems.push('covered action: ' + button.dataset.act);
            rects.slice(i + 1).forEach(other => {
              if (r.left < other.right && r.right > other.left && r.top < other.bottom && r.bottom > other.top) problems.push('overlapping actions');
            });
          });
          const view = document.querySelector('#ov-wait .sa-view');
          if (view.clientHeight < 80) problems.push('settings area too short');
          if (view.scrollWidth > view.clientWidth + 1) problems.push('settings overflow horizontally');
          const card = document.querySelector('#ov-wait .ovcard').getBoundingClientRect();
          const footer = document.getElementById('ov-wait-btns').getBoundingClientRect();
          if (footer.bottom > card.bottom) problems.push('actions escape room card');
          return problems;
        });
        assert.deepEqual(issues, [], label);
        for (const selector of ['#seat-list .seatrow:first-child', '#ai-add button:last-child', '#round-pick button:last-child', '#pace-pick button:last-child', '#ov-wait-note']) {
          const target = host.locator(selector);
          await target.scrollIntoViewIfNeeded();
          assert(await target.evaluate(element => {
            const r = element.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return element.contains(hit);
          }), label + ' unreachable: ' + selector);
        }
        await host.locator('#ov-wait .sa-view').evaluate(view => { view.scrollTop = 0; });
        await host.screenshot({ path: path.join(OUT, label + '.png') });
        console.log('PASS full room, long names, touch targets, scrolling: ' + label);
      }
    }
    await guest.locator('#ov-wait-btns [data-act="ready"]').click();
    await host.locator('#ov-wait-btns [data-act="ready"]').tap();
    await host.waitForFunction(() => SB.S.view.you.can.start);
    await host.locator('#ov-wait-btns [data-act="start"]').tap();
    await host.waitForFunction(() => SB.S.view.phase !== 'lobby');
    console.log('PASS guest ready + host touch ready/start');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
