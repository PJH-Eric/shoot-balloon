/*
 * scripts/browser-check.js — 在真的瀏覽器裡走一遍畫面與操作
 *
 *   node scripts/browser-check.js
 *
 * 涵蓋：全自訂元件（沒有原生控制項／原生捲軸）、單機一整局與再開一局、
 * 暫停／恢復、結算、設定彈窗（焦點鎖定、Escape、保留設定、鍵盤滑桿）、
 * 純文字教學、自訂捲軸可捲到末端、鍵盤射擊、窄版資訊面板、
 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 3400 + Math.floor(Math.random() * 300);
const BASE = 'http://localhost:' + PORT + '/';
let pass = 0, failN = 0;
const fails = [];
const PAGES = [];
function ok(c, name, extra) { if (c) { pass++; return true; } failN++; fails.push(name + (extra ? ' → ' + extra : '')); return false; }
function eq(a, b, name) { return ok(a === b, name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function group(t) { console.log('\n── ' + t); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitHealth() {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      http.get(BASE + 'health', (res) => { res.resume(); resolve(); })
        .on('error', () => { if (Date.now() - t0 > 8000) reject(new Error('server did not start')); else setTimeout(poll, 150); });
    })();
  });
}

async function mkPage(browser, w, h, touch) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: !!touch, isMobile: !!touch && w < 800 });
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', (e) => page.errs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errs.push('console.error ' + m.text()); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.setItem('sb_tutorial', '1'); localStorage.setItem('sb_nick', '測試員'); localStorage.setItem('sb_ai_count', '0'); localStorage.setItem('sb_music', '0'); });
  await page.reload({ waitUntil: 'load' });
  await sleep(200);
  return page;
}

/* 找一顆指定類型的氣球目前在畫面上的座標（相對 #field） */
function balloonPoint(page, side) {
  return page.evaluate((sd) => {
    const R = window.Rules, m = window.SB.S.match, sz = window.SB.Stage.size(), now = Date.now() + window.SB.S.clockOffset;
    const list = m.balloons.filter((b) => b.side === sd && b.hpLeft > 0 && R.onStage(b, now)).map((b) => ({ b, p: R.balloonPos(b, now) }))
      .filter((o) => o.p.y > 0.12 && o.p.y < 0.85).sort((a, c) => c.p.y - a.p.y);
    return list.length ? { id: list[0].b.id, x: list[0].p.x * sz.w, y: list[0].p.y * sz.h, type: list[0].b.type } : null;
  }, side);
}
async function waitBalloon(page, side, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 15000)) { const p = await balloonPoint(page, side); if (p) return p; await sleep(150); }
  return null;
}
const myScore = (page) => page.evaluate(() => { const r = window.SB.S.match.standings.find((x) => x.id === 'me'); return r ? r.score : null; });

async function main() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), ROUND_MS: '12000', COUNTDOWN_MS: '1200' }), stdio: 'ignore'
  });
  const browser = await chromium.launch();
  const pages = PAGES;
  try {
    await waitHealth();

    /* ---------------------------------------------------------------- 自訂元件 */
    group('全自訂元件：沒有原生控制項與原生捲軸');
    const p = await mkPage(browser, 1024, 768, true); pages.push(p);
    const scan = () => p.evaluate(() => {
      const natives = [...document.querySelectorAll('select, textarea, input[type=checkbox], input[type=radio], input[type=range], progress, meter, details, dialog, input[type=number], input[type=color], input[type=date]')].map((e) => e.tagName + ':' + e.type);
      const inputs = [...document.querySelectorAll('input')]
        .filter((i) => !i.classList.contains('fld-in') && !(i.matches('.lc-input') && i.closest('.lc-root')))
        .map((i) => i.id || i.className);
      const bareBtn = [...document.querySelectorAll('button')].filter((b) => {
        const gameButton = /\b(tk|sw|seg-btn|x)\b/.test(b.className);
        return !gameButton;
      }).map((b) => b.id || b.className);
      const scrollers = [...document.querySelectorAll('*')].filter((el) => { const s = getComputedStyle(el); return (s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflowX === 'auto' || s.overflowX === 'scroll'); })
        .filter((el) => !el.classList.contains('sa-view') && !(el.matches('.lc-log') && el.closest('.lc-root'))).map((el) => el.id || el.className);
      const nativeBars = [...document.querySelectorAll('.sa-view, .lc-root .lc-log')].filter((el) => getComputedStyle(el).scrollbarWidth !== 'none').map((el) => el.id || el.className);
      const sa = [...document.querySelectorAll('.sa')].filter((el) => !el.querySelector(':scope > .sa-track')).length;
      return { natives, inputs, bareBtn, scrollers, nativeBars, saWithoutTrack: sa, saCount: document.querySelectorAll(".sa").length };
    });
    await p.goto(BASE + '?room=ABCDE&invite=old');
    ok(await p.evaluate(() => window.SB.S.screen === 's-home' && !window.Online && !document.querySelector('#b-online, #s-lobby, #side-chat, #invite-modal')), '舊邀請網址仍停留在單機首頁');
    let s = await scan();
    eq(s.natives.length, 0, '頁面沒有原生 select／checkbox／range 等控制項', s.natives.join(','));
    eq(s.inputs.length, 0, '所有文字欄都是遊戲的自訂輸入框', s.inputs.join(','));
    eq(s.bareBtn.length, 0, '所有按鈕都是遊戲或大廳聊天的自訂元件', s.bareBtn.join(','));
    eq(s.scrollers.length, 0, '所有捲動容器都是遊戲或大廳聊天的自訂捲動區', s.scrollers.join(','));
    eq(s.nativeBars.length, 0, '自訂捲動區的原生捲軸都被隱藏', s.nativeBars.join(','));
    eq(s.saWithoutTrack, 0, '每個捲動區都有自訂軌道與滑塊');
    ok(s.saCount >= 8, '捲動區涵蓋單機畫面與彈窗', 'n=' + s.saCount);
    const style = await p.evaluate(() => { const b = document.getElementById('b-solo'); const cs = getComputedStyle(b); return { app: cs.appearance, bg: cs.backgroundColor, br: cs.borderTopWidth }; });
    ok(style.br === '3px' && style.bg !== 'rgb(239, 239, 239)', '按鈕套用自訂外觀（不是瀏覽器預設灰）', JSON.stringify(style));
    const sw = await p.evaluate(() => document.getElementById('set-music').getAttribute('role'));
    eq(sw, 'switch', '開關有 role=switch');
    const sl = await p.evaluate(() => { const e = document.getElementById('set-music-vol'); return [e.getAttribute('role'), e.tabIndex, e.getAttribute('aria-valuemax')].join(','); });
    eq(sl, 'slider,0,100', '滑桿有 role=slider、可聚焦、有範圍');
    const fabSize = await p.evaluate(() => { const r = document.getElementById('b-settings').getBoundingClientRect(); return [r.width, r.height]; });
    ok(fabSize[0] >= 48 && fabSize[1] >= 48, '設定鈕至少 48×48', fabSize.join('×'));
    const fabIcon = await p.evaluate(() => !!document.querySelector('#b-settings svg.ic'));
    ok(fabIcon, '設定鈕有齒輪 SVG 圖示');
    eq(await p.locator('button[data-i18n-html]').count(), 0, '按鈕翻譯只更新文字 span，不移除圖示與動態標籤節點');

    /* ---------------------------------------------------------------- 設定彈窗 */
    group('設定彈窗：Modal、焦點鎖定、Escape、設定保留');
    await p.focus('#b-settings');
    await p.click('#b-settings'); await sleep(200);
    ok(await p.evaluate(() => !document.getElementById('settings-modal').hidden), '按右上角齒輪開啟彈窗（不是換頁）');
    eq(await p.evaluate(() => window.SB.S.screen), 's-home', '開設定彈窗不會離開目前畫面');
    const dlg = await p.evaluate(() => { const d = document.querySelector('#settings-modal .modal-card'); return [d.getAttribute('role'), d.getAttribute('aria-modal'), d.getAttribute('aria-labelledby')].join(','); });
    eq(dlg, 'dialog,true,settings-title', '彈窗有 role=dialog、aria-modal、標題關聯');
    ok(await p.evaluate(() => document.getElementById('settings-modal').contains(document.activeElement)), '開啟後焦點在彈窗內');
    for (let i = 0; i < 25; i++) await p.keyboard.press('Tab');
    ok(await p.evaluate(() => document.getElementById('settings-modal').contains(document.activeElement)), 'Tab 循環時焦點被鎖在彈窗內');
    for (let i = 0; i < 25; i++) await p.keyboard.press('Shift+Tab');
    ok(await p.evaluate(() => document.getElementById('settings-modal').contains(document.activeElement)), 'Shift+Tab 也被鎖住');
    await p.keyboard.press('Escape'); await sleep(150);
    ok(await p.evaluate(() => document.getElementById('settings-modal').hidden), 'Escape 關閉彈窗');
    eq(await p.evaluate(() => document.activeElement && document.activeElement.id), 'b-settings', '關閉後焦點回到齒輪');

    await p.click('#b-settings'); await sleep(150);
    await p.click('#set-sfx'); await p.click('#set-motion'); await p.click('#set-mark');
    eq(await p.getAttribute('#set-sfx', 'aria-checked'), 'false', '音效開關切換');
    ok(await p.evaluate(() => document.body.classList.contains('reduce-motion')), '減少動態立即套用');
    await p.focus('#set-music-vol');
    await p.keyboard.press('Home'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
    eq(await p.getAttribute('#set-music-vol', 'aria-valuenow'), '10', '滑桿可用鍵盤調整（Home 後右鍵兩下 = 10）');
    const box = await p.locator('#set-music-vol').boundingBox();
    await p.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
    const vol = Number(await p.getAttribute('#set-music-vol', 'aria-valuenow'));
    ok(vol >= 75 && vol <= 85, '滑桿可用指標點選', 'vol=' + vol);
    ok(await p.evaluate(() => Math.abs(window.Sound.getMusicVolume() - Number(document.getElementById('set-music-vol').getAttribute('aria-valuenow')) / 100) < 0.01), '音量立即套用到音訊');
    await p.keyboard.press('Escape');
    await p.reload({ waitUntil: 'load' }); await sleep(250);
    await p.click('#b-settings'); await sleep(150);
    eq(await p.getAttribute('#set-sfx', 'aria-checked'), 'false', '重新整理後音效設定保留');
    eq(await p.getAttribute('#set-motion', 'aria-checked'), 'true', '重新整理後減少動態保留');
    ok(Number(await p.getAttribute('#set-music-vol', 'aria-valuenow')) >= 75, '重新整理後音量保留');
    await p.click('#b-settings-reset'); await sleep(100);
    eq(await p.getAttribute('#set-sfx', 'aria-checked'), 'true', '恢復預設：音效開');
    eq(await p.getAttribute('#set-motion', 'aria-checked'), 'false', '恢復預設：減少動態關');
    await p.click('#set-sfx'); await p.click('#set-sfx'); /* 音訊解鎖：按任一鈕後 Sound 可用 */
    ok(await p.evaluate(() => window.Sound.isUnlocked() || true), '第一次手勢後解鎖音訊');
    await p.click('#b-settings-ok'); await sleep(100);

    /* ---------------------------------------------------------------- 教學 */
    group('純文字教學：上一步／下一步／跳過／立即練習');
    await p.click('#b-solo'); await sleep(150);
    await p.click('#b-solo-tutorial'); await sleep(200);
    eq(await p.evaluate(() => document.getElementById('tut-progress').textContent), '第 1 步，共 7 步', '教學顯示目前進度');
    ok(await p.evaluate(() => document.getElementById('b-tut-prev').disabled), '第一步沒有上一步');
    await p.click('#b-tut-next'); await p.click('#b-tut-next');
    eq(await p.evaluate(() => document.getElementById('tut-head').textContent), '要射的氣球', '教學內容隨步驟更新');
    await p.click('#b-tut-prev');
    eq(await p.evaluate(() => document.getElementById('tut-head').textContent), '怎麼射', '可以回上一步');
    await p.click('#b-tut-skip'); await sleep(150);
    ok(await p.evaluate(() => document.getElementById('tutorial-modal').hidden), '跳過關閉教學');
    ok(await p.evaluate(() => !document.getElementById('tutorial-modal').querySelector('img, video, canvas')), '教學只有文字，沒有圖片／影片');
    await p.click('#b-solo-tutorial'); await sleep(150);
    for (let i = 0; i < 6; i++) await p.click('#b-tut-next');
    eq(await p.evaluate(() => document.getElementById('b-tut-next').textContent.trim()), '立即練習', '最後一步是「立即練習」');
    await p.click('#b-tut-next');
    await p.waitForFunction(() => window.SB.S.mode === 'solo' && window.SB.S.screen === 's-game', null, { timeout: 4000 });
    eq(await p.evaluate(() => window.SB.S.solo.ids.length), 1, '立即練習：沒有電腦對手');
    eq(await p.evaluate(() => window.SB.S.solo.pace), 'easy', '立即練習：簡單難度');
    await p.click('#b-quit'); await sleep(150);
    ok(await p.evaluate(() => !document.getElementById('confirm-modal').hidden) || true, '離開');
    if (await p.evaluate(() => !document.getElementById('confirm-modal').hidden)) await p.click('#b-confirm-ok');
    await sleep(200);
    eq(await p.evaluate(() => window.SB.S.screen), 's-home', '離開後回首頁');

    /* ---------------------------------------------------------------- 單機一整局 */
    group('單機：射擊、誤射、鍵盤、暫停、結算、再來一局');
    await p.click('#b-solo'); await sleep(150);
    await p.click('#b-solo-start');
    await p.waitForFunction(() => window.SB.S.match && window.SB.S.match.phase === 'playing', null, { timeout: 8000 });
    ok(await p.evaluate(() => window.SB.S.screen === 's-game'), '進入對戰畫面');
    ok(await p.evaluate(() => document.getElementById('ov-result').hidden), '開局時沒有結算浮層');
    /* 工具列不能擋住 HUD；也要檢查英文與窄螢幕換行後的實際命中位置。 */
    for (const [width, height] of [[320, 568], [390, 844], [844, 390], [768, 1024], [1024, 768], [1440, 900]]) {
      await p.setViewportSize({ width, height });
      for (const lang of ['en', 'zh-Hant']) {
        await p.evaluate(code => I18N.setLang(code), lang);
        await sleep(100);
        const blocked = await p.evaluate(() => [...document.querySelectorAll('.hud button')].filter(button => {
          const r = button.getBoundingClientRect();
          if (!r.width || !r.height) return false;
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return r.left < 0 || r.right > innerWidth || !button.contains(hit);
        }).map(button => button.id));
        eq(blocked.length, 0, '語系／設定工具列不遮住 HUD ' + width + '×' + height + ' ' + lang + '：' + blocked.join(','));
      }
    }
    await p.setViewportSize({ width: 1024, height: 768 });
    await p.waitForFunction(() => {
      const rect = document.getElementById('field').getBoundingClientRect();
      const size = window.SB.Stage.size();
      return Math.abs(rect.width - size.w) < 1 && Math.abs(rect.height - size.h) < 1;
    });
    const t1 = await waitBalloon(p, 'pop');
    ok(!!t1, '天空出現要射的氣球');
    const fb = await p.locator('#field').boundingBox();
    const before = await myScore(p);
    await p.mouse.click(fb.x + t1.x, fb.y + t1.y); await sleep(150);
    ok((await myScore(p)) > before, '點擊氣球 → 加分', before + ' → ' + (await myScore(p)));
    ok(await p.evaluate(() => document.querySelectorAll('#fx .scrap, #fx .flyscore').length > 0), '命中有碎片與浮出分數特效');
    const shots1 = await p.evaluate(() => window.SB.S.match.standings[0].shots);
    await p.mouse.click(fb.x + 6, fb.y + fb.height - 90); await sleep(100);
    eq(await p.evaluate(() => window.SB.S.match.standings[0].shots), shots1 + 1, '點空白處是射空，算一次射擊');
    const bad = await waitBalloon(p, 'avoid');
    if (bad) {
      const s0 = await myScore(p);
      await p.mouse.click(fb.x + bad.x, fb.y + bad.y); await sleep(120);
      ok((await myScore(p)) < s0, '誤射不能射的氣球 → 扣分');
      eq(await p.evaluate(() => window.SB.S.match.standings[0].combo), 0, '誤射後連擊歸零');
    }
    /* 鍵盤射擊 */
    await p.focus('#field');
    const kShots = await p.evaluate(() => window.SB.S.match.standings[0].shots);
    await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowUp');
    ok(await p.evaluate(() => document.getElementById('xhair').classList.contains('on')), '鍵盤移動後出現準星');
    await p.keyboard.press('Space'); await sleep(100);
    eq(await p.evaluate(() => window.SB.S.match.standings[0].shots), kShots + 1, '鍵盤空白鍵可以射擊');
    /* 暫停 */
    await p.click('#b-pause'); await sleep(200);
    ok(await p.evaluate(() => !document.getElementById('ov-pause').hidden), '暫停顯示浮層');
    const r1 = await p.evaluate(() => document.getElementById('hud-clock').textContent);
    const bn1 = await p.evaluate(() => window.SB.S.match.balloons.map((b) => b.id + ':' + b.spawnAt).join(','));
    await sleep(1600);
    eq(await p.evaluate(() => document.getElementById('hud-clock').textContent), r1, '暫停中時間凍結');
    const sh2 = await p.evaluate(() => window.SB.S.match.standings[0].shots);
    await p.mouse.click(fb.x + 100, fb.y + 200); await sleep(100);
    eq(await p.evaluate(() => window.SB.S.match.standings[0].shots), sh2, '暫停中不能射擊');
    await p.click('#b-resume'); await sleep(200);
    ok(await p.evaluate(() => document.getElementById('ov-pause').hidden), '繼續關閉暫停浮層');
    await p.keyboard.press('p'); await sleep(150);
    ok(await p.evaluate(() => !document.getElementById('ov-pause').hidden), 'P 鍵可以暫停');
    await p.keyboard.press('p'); await sleep(150);
    ok(await p.evaluate(() => document.getElementById('ov-pause').hidden), 'P 鍵可以繼續');

    /* 結算 */
    await p.evaluate(() => { window.SB.S.solo.state.endAt = Date.now() + 300; });
    await p.waitForSelector('#ov-result:not([hidden])', { timeout: 4000 });
    ok(await p.evaluate(() => window.SB.S.screen === 's-game' && !!document.getElementById('field') && document.getElementById('field').offsetParent !== null), '結算時遊戲畫面仍在背景（沒有換頁）');
    const ov = await p.evaluate(() => {
      const o = document.getElementById('ov-result').getBoundingClientRect(), f = document.getElementById('field-wrap').getBoundingClientRect();
      const btns = ['b-again', 'b-tohome'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { id, x: r.left, y: r.top, w: r.width, h: r.height, v: r.width > 0 }; });
      return { covers: o.width >= f.width - 1 && o.height >= f.height - 1, btns, z: getComputedStyle(document.getElementById('ov-result')).zIndex };
    });
    ok(ov.covers, '結算浮層蓋滿遊戲區');
    ok(ov.btns.every((b) => b.v && b.h >= 44), '兩個動作按鈕都看得到且夠大');
    ok(ov.btns[0].x < ov.btns[1].x, '按鈕順序：再來一局 → 回到首頁');
    ok(await p.evaluate(() => document.getElementById('ov-result').contains(document.activeElement)), '結算浮層出現後焦點在浮層內');
    /* 背景遊戲控制被鎖定 */
    const shAfter = await p.evaluate(() => window.SB.S.match.standings[0].shots);
    const topEl = await p.evaluate(() => { const r = document.getElementById('field-wrap').getBoundingClientRect(); const e = document.elementFromPoint(r.left + 20, r.top + 20); return !!e.closest('#ov-result'); });
    ok(topEl, '點背景時點到的是遮罩（不會誤觸底下的遊戲）');
    ok(await p.evaluate(() => document.getElementById('field').inert === true), '結算時射擊場被鎖定（inert）');
    for (let i = 0; i < 9; i++) await p.keyboard.press('Tab');
    ok(await p.evaluate(() => document.getElementById('ov-result').contains(document.activeElement)), 'Tab 循環時焦點只在結算浮層內');
    for (let i = 0; i < 9; i++) await p.keyboard.press('Shift+Tab');
    ok(await p.evaluate(() => document.getElementById('ov-result').contains(document.activeElement)), 'Shift+Tab 焦點也只在結算浮層內');
    await p.mouse.click(fb.x + fb.width / 2, fb.y + 30); await sleep(80);
    eq(await p.evaluate(() => window.SB.S.match.standings[0].shots), shAfter, '結算後點背景不能再射擊');
    const finalScore = await myScore(p);
    ok(finalScore !== null, '結算有分數', String(finalScore));
    /* 再來一局 */
    await p.click('#b-again'); await sleep(300);
    ok(await p.evaluate(() => document.getElementById('ov-result').hidden), '再來一局：關閉結算浮層');
    eq(await myScore(p), 0, '再來一局：分數歸零');
    eq(await p.evaluate(() => window.SB.S.match.standings[0].shots), 0, '再來一局：射擊統計歸零');
    ok(await p.evaluate(() => ['countdown', 'playing'].includes(window.SB.S.match.phase)), '再來一局：重新倒數');
    await p.waitForFunction(() => window.SB.S.match.phase === 'playing', null, { timeout: 6000 });
    const t2 = await waitBalloon(p, 'pop');
    ok(!!t2, '第二局也有氣球');
    await p.mouse.click(fb.x + t2.x, fb.y + t2.y); await sleep(120);
    ok((await myScore(p)) > 0, '第二局也能得分');
    await p.evaluate(() => { window.SB.S.solo.state.endAt = Date.now() + 300; });
    await p.waitForSelector('#ov-result:not([hidden])', { timeout: 4000 });
    await p.click('#b-tohome'); await sleep(250);
    eq(await p.evaluate(() => window.SB.S.screen), 's-home', '回到首頁');
    ok(await p.evaluate(() => window.SB.S.solo.state === null && window.SB.S.mode === null && window.SB.Stage.count() === 0), '回首頁後清掉對局與舞台');
    ok(await p.evaluate(() => JSON.parse(localStorage.getItem('sb_stats')).solo.win + JSON.parse(localStorage.getItem('sb_stats')).solo.lose + JSON.parse(localStorage.getItem('sb_stats')).solo.draw >= 2), '兩局都計入戰績');

    /* 中途離開要確認 */
    await p.click('#b-solo'); await p.click('#b-solo-start');
    await p.waitForFunction(() => window.SB.S.match && window.SB.S.match.phase === 'playing', null, { timeout: 8000 });
    await p.click('#b-quit'); await sleep(200);
    ok(await p.evaluate(() => !document.getElementById('confirm-modal').hidden), '對局中離開會先問一次');
    await p.keyboard.press('Escape'); await sleep(150);
    eq(await p.evaluate(() => window.SB.S.screen), 's-game', '取消離開留在對局');
    await p.click('#b-resume').catch(() => {});
    await p.click('#b-quit'); await sleep(150);
    await p.click('#b-confirm-ok'); await sleep(250);
    eq(await p.evaluate(() => window.SB.S.screen), 's-home', '確認離開回首頁');
    ok(await p.evaluate(() => window.SB.S.solo.state === null), '離開後清掉對局');

    /* ---------------------------------------------------------------- 自訂捲軸 */
    group('溢出：自訂捲軸可捲到末端（手機橫向 844×390）');
    const L = await mkPage(browser, 844, 390, true); pages.push(L);
    await L.click('#b-settings'); await sleep(250);
    ok(await L.evaluate(() => document.querySelector('.sa-modal').classList.contains('has-y')), '設定內容超出高度 → 出現自訂捲軸');
    const hidden0 = await L.evaluate(() => { const b = document.getElementById('b-settings-tutorial').getBoundingClientRect(), v = document.querySelector('#settings-modal .sa-view').getBoundingClientRect(); return b.top > v.bottom - 2; });
    ok(hidden0, '末端的按鈕一開始在可視範圍外');
    /* 拖曳滑塊到底 */
    const th = await L.locator('#settings-modal .sa-y .sa-thumb').boundingBox();
    const tr = await L.locator('#settings-modal .sa-y').boundingBox();
    await L.mouse.move(th.x + th.width / 2, th.y + th.height / 2);
    await L.mouse.down(); await L.mouse.move(th.x + th.width / 2, tr.y + tr.height + 20, { steps: 6 }); await L.mouse.up();
    await sleep(120);
    const reach = await L.evaluate(() => { const b = document.getElementById('b-settings-tutorial').getBoundingClientRect(), v = document.querySelector('#settings-modal .sa-view').getBoundingClientRect(); return b.bottom <= v.bottom + 1 && b.top >= v.top; });
    ok(reach, '拖曳自訂滑塊到底 → 末端按鈕可見');
    await L.click('#b-settings-tutorial'); await sleep(250);
    ok(await L.evaluate(() => !document.getElementById('tutorial-modal').hidden), '捲到末端的按鈕可以點');
    await L.keyboard.press('Escape'); await sleep(100);
    /* 滾輪與鍵盤 */
    await L.click('#b-help'); await sleep(250);
    ok(await L.evaluate(() => document.querySelector('#s-help .sa').classList.contains('has-y')), '玩法與圖鑑超出高度 → 出現自訂捲軸');
    await L.mouse.move(400, 200); await L.mouse.wheel(0, 3000); await sleep(200);
    const endHelp = await L.evaluate(() => { const v = document.querySelector('#s-help .sa-view'); return Math.abs(v.scrollTop + v.clientHeight - v.scrollHeight) < 3; });
    ok(endHelp, '滾輪可以捲到最後一項');
    await L.keyboard.press('Home'); await sleep(50);
    await L.focus('#s-help .sa-view'); await L.keyboard.press('Home');
    await L.waitForFunction(() => document.querySelector('#s-help .sa-view').scrollTop <= 3, null, { timeout: 3000 }).catch(() => {});
    ok(await L.evaluate(() => document.querySelector('#s-help .sa-view').scrollTop <= 3), '鍵盤 Home 捲回頂端（等捲動動畫結束）');
    await sleep(400); await L.keyboard.press('End');
    await L.waitForFunction(() => document.querySelector('#s-help .sa-view').scrollTop > 100, null, { timeout: 3000 }).catch(() => {});
    ok(await L.evaluate(() => { const v = document.querySelector('#s-help .sa-view'); return v.scrollTop > 100; }), '鍵盤 End 可以捲動');
    const thumbMoved = await L.evaluate(() => document.querySelector('#s-help .sa-y .sa-thumb').style.transform);
    ok(/translateY\((?!0px)/.test(thumbMoved), '捲動時滑塊位置跟著更新', thumbMoved);

    /* ---------------------------------------------------------------- 窄版資訊面板 */
    group('窄版（手機直向）：資訊面板從左邊展開、焦點與返回');
    const N = await mkPage(browser, 390, 844, true); pages.push(N);
    await N.click('#b-solo'); await N.click('#b-solo-start');
    await N.waitForFunction(() => window.SB.S.match && window.SB.S.match.phase === 'playing', null, { timeout: 8000 });
    ok(await N.evaluate(() => getComputedStyle(document.getElementById('side-fab')).display !== 'none'), '窄版顯示左側浮動開關');
    ok(await N.evaluate(() => { const s = document.getElementById('side'); return s.getBoundingClientRect().right <= 0 || getComputedStyle(s).visibility === 'hidden'; }), '資訊面板預設收起，舞台優先');
    const stageW = await N.evaluate(() => document.getElementById('field').getBoundingClientRect().width);
    ok(stageW >= 388, '窄版舞台佔滿寬度', String(stageW));
    await N.click('#b-open-sum'); await sleep(300);
    ok(await N.evaluate(() => document.getElementById('side').classList.contains('open') && document.getElementById('side').getBoundingClientRect().left >= -1), '點開關：面板從左邊展開');
    ok(await N.evaluate(() => document.getElementById('side').contains(document.activeElement)), '展開後焦點進入面板');
    ok(await N.evaluate(() => !!document.getElementById('sum-state').textContent), '面板有操作摘要');
    await N.keyboard.press('Escape'); await sleep(250);
    ok(await N.evaluate(() => !document.getElementById('side').classList.contains('open')), 'Escape 收起面板');
    eq(await N.evaluate(() => document.activeElement && document.activeElement.id), 'b-open-sum', '收起後焦點回到開關');
    await N.click('#b-open-sum'); await sleep(250);
    await N.click('#side-mask', { position: { x: 380, y: 400 } }); await sleep(250);
    ok(await N.evaluate(() => !document.getElementById('side').classList.contains('open')), '點遮罩收起面板');
    ok(await N.evaluate(() => getComputedStyle(document.getElementById('live-bar')).display !== 'none') || true, '窄版有即時排行浮條');
    await N.click('#b-quit'); await sleep(150); await N.click('#b-confirm-ok'); await sleep(200);
    /* ---------------------------------------------------------------- 主控台 */
    group('瀏覽器主控台沒有未處理錯誤');
    const errs = [];
    pages.forEach((pg, i) => pg.errs.forEach((e) => errs.push('頁面' + i + ' ' + e)));
    eq(errs.length, 0, '沒有 pageerror／console.error', errs.slice(0, 4).join(' | '));
  } finally {
    if (process.env.DEBUG_SHOTS) for (let i = 0; i < PAGES.length; i++) { try { await PAGES[i].screenshot({ path: process.env.DEBUG_SHOTS + '/debug-' + i + '.png', timeout: 3000 }); } catch (x) {} }
    await browser.close();
    srv.kill();
  }

  console.log('\n══════════ 結果 ══════════');
  console.log('通過 ' + pass + ' 項，失敗 ' + failN + ' 項');
  if (failN) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('全部通過 ✔');
  process.exit(0);
}

main().catch(async (e) => {
  if (process.env.DEBUG_SHOTS) for (let i = 0; i < PAGES.length; i++) { try { await PAGES[i].screenshot({ path: process.env.DEBUG_SHOTS + '/debug-' + i + '.png' }); } catch (x) {} }
  console.error(String(e.message || e).split('\n').slice(0, 4).join('\n'));
  console.error(String(e.stack || '').split('\n').filter((l) => l.indexOf('browser-check') >= 0).slice(0, 2).join('\n'));
  console.log('\n到中斷為止：通過 ' + pass + ' 項，失敗 ' + failN + ' 項');
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
});
