/*
 * scripts/shots.js — 從「正在執行的遊戲」擷取各畫面、各尺寸、各方向的實際截圖，
 * 並順手做版面稽核（水平溢出、被裁切的控制、過小的觸控目標、設定鈕被蓋住）。
 *
 *   node scripts/shots.js [輸出資料夾] [尺寸名稱…]
 *
 * 預設輸出到 screenshots/（已在 .gitignore，不會被提交）。
 * 尺寸名稱：phone-p phone-l tablet-p tablet-l desktop
 * 需要先 npm install（會用到 playwright 的 Chromium）。
 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const OUT = path.resolve(process.argv[2] && !/^(phone|tablet|desktop)/.test(process.argv[2]) ? process.argv[2] : path.join(__dirname, '..', 'screenshots'));
const ONLY = process.argv.slice(2).filter((a) => /^(phone|tablet|desktop)/.test(a));
const PORT = 3700 + Math.floor(Math.random() * 200);
const BASE = 'http://localhost:' + PORT + '/';

const VIEWPORTS = {
  'phone-p': { w: 390, h: 844, touch: true, label: '手機直向 390×844' },
  'phone-l': { w: 844, h: 390, touch: true, label: '手機橫向 844×390' },
  'tablet-p': { w: 768, h: 1024, touch: true, label: '平板直向 768×1024' },
  'tablet-l': { w: 1024, h: 768, touch: true, label: '平板橫向 1024×768' },
  desktop: { w: 1440, h: 900, touch: false, label: '桌機 1440×900' }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const issues = [];

function waitHealth() {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      http.get(BASE + 'health', (res) => { res.resume(); resolve(); })
        .on('error', () => { if (Date.now() - t0 > 8000) reject(new Error('server did not start')); else setTimeout(poll, 150); });
    })();
  });
}

/* 版面稽核：在頁面裡跑，回傳問題清單 */
async function audit(page, tag) {
  const found = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight, out = [];
    const shown = (el) => {
      if (el.closest('[hidden]')) return false;
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none' || r.width < 1 || r.height < 1) return false;
      for (let n = el; n && n !== document.body; n = n.parentElement) { if (getComputedStyle(n).visibility === 'hidden') return false; }
      return true;
    };
    const label = (el) => (el.id ? '#' + el.id : '') + '.' + String(el.className).split(' ').filter(Boolean).slice(0, 2).join('.') + '「' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12) + '」';
    if (document.documentElement.scrollWidth > vw + 1) out.push('整頁水平溢出 scrollWidth=' + document.documentElement.scrollWidth + ' > ' + vw);
    /* 被自訂捲動區裁切的元素算「可捲動到達」，不算問題 */
    const inScroller = (el) => { const v = el.closest('.sa-view'); return !!v && v.scrollHeight > v.clientHeight + 1; };
    const modal = document.querySelector('.modal:not([hidden])');
    const scope = modal || document;
    scope.querySelectorAll('button, .tk, .seg-btn, .sw, .sl, .fld-in, a[href]').forEach((el) => {
      if (!shown(el)) return;
      if (modal === null && el.closest('.modal')) return;
      const r = el.getBoundingClientRect();
      const clipped = r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1;
      if (clipped && !inScroller(el)) out.push('控制超出視窗 ' + label(el) + ' ' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(','));
      const small = Math.min(r.width, r.height);
      if (!clipped && small < 40 && !el.closest('.sa-thumb') && !el.classList.contains('x')) out.push('觸控目標過小 ' + label(el) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
    });
    const fab = document.querySelector('.settings-fab');
    if (fab && shown(fab) && !modal) {
      const r = fab.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top !== fab && !fab.contains(top)) out.push('設定鈕被蓋住：' + label(top || document.body));
    }
    /* 文字過小 */
    document.querySelectorAll('p, span, small, b, h1, h2, h3, h4, li, label, .tag').forEach((el) => {
      if (!shown(el) || !el.childNodes.length) return;
      const direct = [].some.call(el.childNodes, (n) => n.nodeType === 3 && n.nodeValue.trim());
      if (!direct) return;
      if (modal === null && el.closest('.modal')) return;
      const fs_ = parseFloat(getComputedStyle(el).fontSize);
      if (fs_ < 11) out.push('文字過小 ' + fs_ + 'px ' + label(el));
    });
    /* 原生控制項 */
    const natives = document.querySelectorAll('select, textarea, input[type=checkbox], input[type=radio], input[type=range], progress, meter, details, dialog');
    if (natives.length) out.push('出現原生控制項 ×' + natives.length);
    return out;
  });
  found.forEach((f) => issues.push(tag + '：' + f));
  return found;
}

async function shot(page, vp, name) {
  const dir = path.join(OUT, vp);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name + '.png');
  await page.screenshot({ path: file });
  const found = await audit(page, vp + '/' + name);
  console.log('  ' + (found.length ? '⚠ ' : '✓ ') + name + (found.length ? '  ' + found.length + ' 項問題' : ''));
  return file;
}

async function newPage(browser, vp, o) {
  const V = VIEWPORTS[vp];
  const ctx = await browser.newContext({
    viewport: { width: V.w, height: V.h }, hasTouch: V.touch, isMobile: V.touch && V.w < 800 ? true : false,
    deviceScaleFactor: 1, ...(o || {})
  });
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', (e) => page.errs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errs.push('console.error ' + m.text()); });
  return page;
}

async function openHome(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.setItem('sb_tutorial', '1'); localStorage.setItem('sb_nick', '攤主小明'); localStorage.setItem('sb_ai_count', '0'); } catch (e) {} });
  await page.reload({ waitUntil: 'load' });
  await sleep(250);
}

async function runViewport(browser, vp) {
  const V = VIEWPORTS[vp];
  console.log('\n■ ' + V.label);
  const page = await newPage(browser, vp);
  await openHome(page);
  await shot(page, vp, '01-首頁');

  await page.click('#b-solo'); await sleep(200);
  await shot(page, vp, '02-單機設定');
  await page.click('#b-solo-tutorial'); await sleep(250);
  await shot(page, vp, '03-教學彈窗');
  await page.keyboard.press('Escape'); await sleep(150);

  /* 單機對戰：0 個電腦，等氣球飄滿 */
  await page.click('#b-solo-start');
  await sleep(3000 + 6500);
  await shot(page, vp, '04-單機對戰');
  const fieldBox = await page.locator('#field').boundingBox();
  /* 射一發：點最近的氣球 */
  const aim = await page.evaluate(() => {
    const st = window.SB.S.match; const sz = window.SB.Stage.size(); const now = Date.now();
    const R = window.Rules;
    const list = st.balloons.filter((b) => b.side === 'pop' && R.onStage(b, now)).map((b) => ({ b, p: R.balloonPos(b, now) })).sort((a, c) => c.p.y - a.p.y);
    return list.length ? { x: list[0].p.x * sz.w, y: list[0].p.y * sz.h } : null;
  });
  if (aim) { await page.mouse.click(fieldBox.x + aim.x, fieldBox.y + aim.y); await sleep(120); await shot(page, vp, '05-射中特效'); }
  await page.click('#b-pause'); await sleep(200);
  await shot(page, vp, '06-暫停');
  await page.click('#b-resume'); await sleep(100);

  /* 窄版：打開資訊面板 */
  const narrow = await page.evaluate(() => getComputedStyle(document.getElementById('side-fab')).display !== 'none');
  if (narrow) {
    await page.click('#b-open-sum'); await sleep(300);
    await shot(page, vp, '07-資訊面板');
    await page.click('#b-side-close'); await sleep(250);
  }

  /* 結算：把結束時間拉到 0.4 秒後 */
  await page.evaluate(() => { const st = window.SB.S.solo.state; st.endAt = Date.now() + 400; });
  await sleep(1400);
  await shot(page, vp, '08-結算浮層');
  await page.click('#b-tohome'); await sleep(250);

  await page.click('#b-settings'); await sleep(250);
  await shot(page, vp, '09-設定彈窗');
  await page.keyboard.press('Escape'); await sleep(150);

  await page.click('#b-help'); await sleep(250);
  await shot(page, vp, '10-玩法與圖鑑');
  await page.click('.screen.active [data-back="s-home"]'); await sleep(150);
  await page.click('#b-stats'); await sleep(200);
  await shot(page, vp, '11-戰績');
  await page.click('.screen.active [data-back="s-home"]'); await sleep(150);

  await page.click('#b-online'); await sleep(900);
  await shot(page, vp, '12-線上大廳');
  if (page.errs.length) page.errs.forEach((e) => issues.push(vp + '：' + e));
  await page.context().close();
}

async function runOnline(browser, vp) {
  const V = VIEWPORTS[vp];
  console.log('\n■ ' + V.label + '（線上）');
  const H = await newPage(browser, vp), G = await newPage(browser, vp), I = await newPage(browser, vp);
  try {
    await openHome(H);
    await H.click('#b-online'); await H.waitForSelector('#conn-dot.ok', { timeout: 8000 });
    await H.fill('#room-name', '週五夜市場');
    await H.click('#b-create');
    await H.waitForSelector('#ov-wait:not([hidden])', { timeout: 5000 });
    await sleep(300);
    const code = await H.evaluate(() => window.SB.S.view.code);

    await openHome(G);
    await G.evaluate(() => localStorage.setItem('sb_nick', '阿花'));
    await G.click('#b-online'); await G.waitForSelector('#conn-dot.ok', { timeout: 8000 });
    await G.fill('#join-code', code); await G.click('#b-join');
    await G.waitForSelector('#ov-wait:not([hidden])', { timeout: 5000 });

    /* 房主加電腦、產生觀戰邀請 */
    await H.evaluate(() => document.querySelector('#ai-add .seg-btn[data-v="normal"]').click());
    await sleep(300);
    await shot(H, vp, '13-線上房間等待');
    await H.click('#ov-wait-btns [data-act="invite"]'); await sleep(250);
    await H.evaluate(() => document.querySelector('#inv-role .seg-btn[data-v="spectator"]').click());
    await H.click('#b-invite-make'); await sleep(500);
    await shot(H, vp, '14-邀請彈窗');
    const url = await H.inputValue('#invite-url');
    await H.keyboard.press('Escape'); await sleep(150);

    /* 邀請落地：先停在大廳，確認名字才加入 */
    await I.goto(url, { waitUntil: 'load' }); await sleep(900);
    await shot(I, vp, '15-邀請落地（尚未加入）');
    const stillLobby = await I.evaluate(() => window.SB.S.screen === 's-lobby' && !window.SB.S.view);
    if (!stillLobby) issues.push(vp + '：邀請連結開啟後沒有停在大廳');
    await I.fill('#invite-nick', '路人觀眾');
    await I.click('#b-invite-join');
    await I.waitForSelector('#ov-wait:not([hidden])', { timeout: 5000 });

    /* 開打 */
    await G.click('#ov-wait-btns [data-act="ready"]');
    await H.click('#ov-wait-btns [data-act="ready"]'); await sleep(300);
    await H.click('#ov-wait-btns [data-act="start"]');
    await H.waitForFunction(() => window.SB.S.view && window.SB.S.view.phase === 'playing', null, { timeout: 8000 });
    await sleep(6000);
    await shot(H, vp, '16-線上對戰（玩家）');
    await shot(I, vp, '17-線上對戰（觀戰）');
    /* 聊天 */
    await G.evaluate(() => { document.getElementById('chat-input').value = '哈囉～準備好射氣球了嗎？'; document.getElementById('chat-form').requestSubmit(); });
    await sleep(400);
    const narrow = await H.evaluate(() => getComputedStyle(document.getElementById('side-fab')).display !== 'none');
    if (narrow) { await H.click('#b-open-chat'); await sleep(350); }
    await shot(H, vp, '18-聊天室與摘要');
    if (narrow) { await H.click('#b-side-close'); await sleep(250); }

    await H.waitForSelector('#ov-result:not([hidden])', { timeout: 30000 });
    await sleep(300);
    await shot(H, vp, '19-線上結算');
    await H.click('#b-toroom'); await sleep(700);
    await shot(H, vp, '20-回到房間');

    /* 玩家都離開 → 觀戰者看到房間已結束 */
    await G.click(await G.evaluate(() => (document.querySelector('#ov-wait-btns [data-act="quit"]') ? '#ov-wait-btns [data-act="quit"]' : '#side-actions [data-act="quit"]')));
    await sleep(300);
    await H.click('#ov-wait-btns [data-act="quit"]');
    await I.waitForSelector('#ov-closed:not([hidden])', { timeout: 5000 }).catch(() => issues.push(vp + '：觀戰者沒有看到房間已結束'));
    await sleep(300);
    await shot(I, vp, '21-房間已結束（觀戰）');
  } catch (e) {
    issues.push(vp + '：線上流程中斷 ' + e.message.split('\n')[0]);
    console.log('  ✗ 線上流程中斷：' + e.message.split('\n')[0]);
  }
  for (const p of [H, G, I]) { p.errs.forEach((e) => issues.push(vp + '：' + e)); await p.context().close(); }
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), ROUND_MS: '14000', COUNTDOWN_MS: '1500' }), stdio: 'ignore'
  });
  const browser = await chromium.launch();
  try {
    await waitHealth();
    const names = ONLY.length ? ONLY : Object.keys(VIEWPORTS);
    for (const vp of names) {
      await runViewport(browser, vp);
      if (process.env.SKIP_ONLINE !== '1') await runOnline(browser, vp);
    }
  } finally {
    await browser.close();
    srv.kill();
  }
  console.log('\n══════════ 版面稽核 ══════════');
  if (!issues.length) console.log('沒有發現問題 ✔');
  else issues.forEach((i) => console.log('  ⚠ ' + i));
  console.log('截圖已存到 ' + OUT);
  process.exit(issues.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
