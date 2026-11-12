/* ===== lobby-chat.js — 線上大廳聊天室（左下浮動氣泡＋面板，各遊戲共用） =====
 *
 * 版面（2026-11 定案）：
 *   - 所有裝置都在左下角放一顆浮動氣泡
 *   - 桌機／平板：點開是寬 300px、高約半個螢幕的半透明浮動面板（疊在房間列表上），可收合、記住上次，預設展開
 *   - 手機（窄或矮）：點開是全螢幕面板；右上 ✕、往下滑、按「上一頁」、按房間「加入」都會關閉
 *   - 收合時有新訊息：氣泡輕微彈跳＋旁邊浮出最新一則預覽 3 秒
 *   - 往上翻舊訊息時不自動捲到底，改顯示「↓ N 則新訊息」
 *   - 斷線：輸入框停用＋「連線中…」，重連後重拿歷史
 *   - 設定頁開關可整個關掉（關掉時氣泡完全不顯示、也不接收訊息）
 *
 * 用法（每款遊戲寫一個轉接層）：
 *   const chat = LobbyChat.create({
 *     game: 'fruit-link',                  // localStorage 前綴
 *     mount: '#app',                       // 放進哪個容器（預設 body；要跟設定彈窗同一個疊層）
 *     watch: '#s-lobby',                   // 這個元素看得到時才顯示氣泡（也可用 active: () => boolean）
 *     lang: () => 'zh-TW',                 // 'zh-TW' | 'zh-CN' | 'en'
 *     getName: () => '小明',               // 遊戲目前的暱稱（沒有回傳空字串）
 *     setName: (n) => {},                  // 面板改名時同步回遊戲（可省略）
 *     join: (name) => {}, leave: () => {}, send: (text, name) => {},
 *     joinRoom: (code) => {}               // 點系統訊息的「加入」
 *   });
 *   伺服器事件 → chat.history(msgs, online)、chat.add(msg)、chat.online(n)、chat.error(code)
 *   連線狀態   → chat.setConnected(true/false)
 *   設定開關   → chat.bindSetting({ input, label, sub, status, reset, event?, read? })
 *                或 chat.setEnabled(bool)、chat.isEnabled()
 *   畫面切換   → chat.refresh()（watch／active 判斷不到時手動呼叫）
 */
(function (root) {
  'use strict';

  const MAX_LEN = 60;

  const DICT = {
    'zh-TW': {
      set: '大廳聊天室', setSub: '在線上大廳左下角顯示聊天氣泡', mine: '（我）', on: '開啟', off: '關閉',
      title: '大廳聊天', online: '大廳 {n} 人', open: '打開大廳聊天', collapse: '收合聊天室', close: '關閉聊天室',
      ph: '跟大廳的人說點什麼…', phOff: '連線中…', send: '送出', phrases: '快捷短語', me: '我的暱稱', rename: '改暱稱',
      renameOk: '確定', renameCancel: '取消', namePh: '輸入暱稱',
      newMsgs: '↓ {n} 則新訊息', empty: '還沒有人說話，打聲招呼吧！', log: '大廳聊天訊息',
      opened: '開了新房間（房號 {c}）', openedRoom: '開了新房間「{r}」', join: '加入',
      'err.dup': '跟上一句一樣，換句話說吧～', 'err.long': '最多 60 個字喔', 'err.empty': '先輸入內容再送出',
      'err.notjoined': '還沒連上大廳，稍等一下', 'err.default': '訊息沒送出去，再試一次',
      list: ['嗨～', '來一局！', '缺一人！', '快進房～', '等我一下', '謝謝', '拜拜'],
      adj: ['開心的', '愛睡的', '勇敢的', '圓滾滾的', '害羞的', '跳跳', '甜甜的', '好奇的', '軟綿綿的', '亮晶晶的', '慢吞吞的', '笑咪咪的'],
      animal: ['小貓', '小狗', '兔兔', '企鵝', '熊貓', '小熊', '松鼠', '小象', '海豚', '刺蝟', '無尾熊', '小鴨']
    },
    'zh-CN': {
      set: '大厅聊天室', setSub: '在线上大厅左下角显示聊天气泡', mine: '（我）', on: '开启', off: '关闭',
      title: '大厅聊天', online: '大厅 {n} 人', open: '打开大厅聊天', collapse: '收起聊天室', close: '关闭聊天室',
      ph: '跟大厅的人说点什么…', phOff: '连接中…', send: '发送', phrases: '快捷短语', me: '我的昵称', rename: '改昵称',
      renameOk: '确定', renameCancel: '取消', namePh: '输入昵称',
      newMsgs: '↓ {n} 条新消息', empty: '还没有人说话，打声招呼吧！', log: '大厅聊天消息',
      opened: '开了新房间（房号 {c}）', openedRoom: '开了新房间「{r}」', join: '加入',
      'err.dup': '跟上一句一样，换句话说吧～', 'err.long': '最多 60 个字哦', 'err.empty': '先输入内容再发送',
      'err.notjoined': '还没连上大厅，稍等一下', 'err.default': '消息没发出去，再试一次',
      list: ['嗨～', '来一局！', '缺一人！', '快进房～', '等我一下', '谢谢', '拜拜'],
      adj: ['开心的', '爱睡的', '勇敢的', '圆滚滚的', '害羞的', '跳跳', '甜甜的', '好奇的', '软绵绵的', '亮晶晶的', '慢吞吞的', '笑眯眯的'],
      animal: ['小猫', '小狗', '兔兔', '企鹅', '熊猫', '小熊', '松鼠', '小象', '海豚', '刺猬', '考拉', '小鸭']
    },
    en: {
      set: 'Lobby chat', setSub: 'Show the chat bubble at the bottom-left of the online lobby', mine: ' (me)', on: 'On', off: 'Off',
      title: 'Lobby chat', online: '{n} in lobby', open: 'Open lobby chat', collapse: 'Collapse chat', close: 'Close chat',
      ph: 'Say hi to the lobby…', phOff: 'Connecting…', send: 'Send', phrases: 'Quick phrases', me: 'My name', rename: 'Rename',
      renameOk: 'OK', renameCancel: 'Cancel', namePh: 'Your nickname',
      newMsgs: '↓ {n} new', empty: 'No messages yet — say hello!', log: 'Lobby chat messages',
      opened: 'opened room {c}', openedRoom: 'opened “{r}”', join: 'Join',
      'err.dup': 'Same as your last message — try something new', 'err.long': '60 characters max', 'err.empty': 'Type something first',
      'err.notjoined': 'Not connected yet, hold on', 'err.default': 'Message not sent, try again',
      list: ['Hi!', 'Play a round!', 'Need one more!', 'Join my room!', 'Wait for me', 'Thanks', 'Bye'],
      adj: ['Happy', 'Sleepy', 'Brave', 'Chubby', 'Shy', 'Bouncy', 'Sweet', 'Curious', 'Fluffy', 'Sparkly', 'Slowpoke', 'Smiley'],
      animal: ['Kitty', 'Puppy', 'Bunny', 'Penguin', 'Panda', 'Bear', 'Squirrel', 'Elephant', 'Dolphin', 'Hedgehog', 'Koala', 'Duckling']
    }
  };

  const ICON_CHAT = '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M6 6.5h20a3.5 3.5 0 0 1 3.5 3.5v10a3.5 3.5 0 0 1-3.5 3.5H15l-6.2 4.6c-.7.5-1.6 0-1.6-.8v-3.8H6A3.5 3.5 0 0 1 2.5 20V10A3.5 3.5 0 0 1 6 6.5z" fill="currentColor"/><circle cx="10.5" cy="15" r="1.9" fill="var(--lc-bubble-dot,#fff)"/><circle cx="16" cy="15" r="1.9" fill="var(--lc-bubble-dot,#fff)"/><circle cx="21.5" cy="15" r="1.9" fill="var(--lc-bubble-dot,#fff)"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.4 11.1 19.6 4.3c.9-.4 1.8.5 1.4 1.4l-6.8 16.2c-.4.9-1.7.9-2-.1l-1.6-5.4-5.4-1.6c-1-.3-1-1.6-.1-2z" fill="currentColor"/></svg>';
  const ICON_PHRASE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5h16v3H4zM4 10.5h11v3H4zM4 16h8v3H4z" fill="currentColor"/></svg>';
  const ICON_MIN = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 11h14v2.6H5z" fill="currentColor"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.3 4.5 12 10.2l5.7-5.7 1.8 1.8-5.7 5.7 5.7 5.7-1.8 1.8-5.7-5.7-5.7 5.7-1.8-1.8 5.7-5.7-5.7-5.7z" fill="currentColor"/></svg>';
  const ICON_PEN = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15.2 4.3 4.5 4.5L9 19.5 3.8 20.2l.7-5.2zM16.6 2.9l1.4-1.4 4.5 4.5-1.4 1.4z" fill="currentColor"/></svg>';

  /* 「上一頁」先關手機全螢幕面板：要比遊戲自己的 popstate 監聽先註冊，所以放在載入時 */
  const instances = [];
  if (root.addEventListener) {
    /* capture：在目標階段會比遊戲自己（非 capture）的 popstate 監聽先跑，不管腳本載入順序 */
    root.addEventListener('popstate', (e) => {
      for (const c of instances) if (c._onPop(e)) { e.stopImmediatePropagation(); return; }
    }, true);
  }

  function store(key, val) {
    try {
      if (val === undefined) return root.localStorage.getItem(key);
      root.localStorage.setItem(key, val);
    } catch (e) { /* 私密模式等情況：只是記不住，不影響使用 */ }
    return null;
  }

  function el(tag, cls, attrs) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function fmt(s, vars) { return String(s).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : '')); }

  function hhmm(ts) {
    const d = new Date(ts || Date.now());
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function create(opts) {
    const o = opts || {};
    const game = o.game || 'game';
    const K = (k) => 'lobbyChat:' + game + ':' + k;
    const mql = root.matchMedia ? root.matchMedia('(max-width: 640px), (max-height: 500px)') : { matches: false, addEventListener() {} };

    const state = {
      enabled: store(K('enabled')) !== '0',
      openWide: store(K('open')) !== '0',        // 桌機／平板：預設展開、記住上次
      openNarrow: false,                         // 手機：每次都從氣泡開始
      shown: false,          // 遊戲目前在大廳畫面
      joined: false,
      connected: false,
      msgs: [],
      unseen: 0,             // 往上翻時累積的新訊息
      onlineN: 0,
      lastText: '',
      pushed: false          // 手機面板是否推了一筆 history
    };

    const L = () => {
      let l = typeof o.lang === 'function' ? o.lang() : o.lang;
      if (!l) l = (root.I18N && root.I18N.lang) || document.documentElement.lang || 'zh-TW';
      if (DICT[l]) return DICT[l];
      if (/^zh-(cn|hans|sg)/i.test(l)) return DICT['zh-CN'];
      if (/^zh/i.test(l)) return DICT['zh-TW'];
      if (/^en/i.test(l)) return DICT.en;
      return DICT['zh-TW'];
    };
    const say = (k, v) => fmt(L()[k] != null ? L()[k] : DICT['zh-TW'][k], v);

    function randomName() {
      const d = L();
      return d.adj[Math.floor(Math.random() * d.adj.length)] + d.animal[Math.floor(Math.random() * d.animal.length)];
    }
    function myName() {
      let n = '';
      try { n = String((o.getName && o.getName()) || '').trim(); } catch (e) { n = ''; }
      if (!n) n = store(K('name')) || '';
      if (!n) { n = randomName(); store(K('name'), n); }
      return Array.from(n).slice(0, 16).join('');
    }

    /* ---------- DOM ---------- */
    const rootEl = el('div', 'lc-root', { 'data-game': game });
    rootEl.hidden = true;
    const bubble = el('button', 'lc-bubble', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    bubble.innerHTML = ICON_CHAT;
    const peek = el('div', 'lc-peek', { 'aria-hidden': 'true' });
    peek.hidden = true;

    const panel = el('section', 'lc-panel', { role: 'dialog', 'aria-modal': 'false' });
    panel.hidden = true;
    const head = el('header', 'lc-head');
    const grab = el('div', 'lc-grab', { 'aria-hidden': 'true' });
    const title = el('h2', 'lc-title');
    const onlineEl = el('span', 'lc-online');
    const titleWrap = el('div', 'lc-titlewrap');
    titleWrap.append(title, onlineEl);
    const meBtn = el('button', 'lc-me', { type: 'button' });
    const meName = el('span', 'lc-me-name');
    const mePen = el('span', 'lc-me-pen', { 'aria-hidden': 'true' });
    mePen.innerHTML = ICON_PEN;
    meBtn.append(meName, mePen);
    const minBtn = el('button', 'lc-iconbtn lc-min', { type: 'button' });
    head.append(grab, titleWrap, meBtn, minBtn);

    const renameRow = el('form', 'lc-rename', { autocomplete: 'off' });
    renameRow.hidden = true;
    const renameInput = el('input', 'lc-input', { type: 'text', maxlength: '16', enterkeyhint: 'done' });
    const renameOk = el('button', 'lc-btn lc-btn-main', { type: 'submit' });
    const renameCancel = el('button', 'lc-btn', { type: 'button' });
    renameRow.append(renameInput, renameOk, renameCancel);

    const body = el('div', 'lc-body');
    const log = el('div', 'lc-log', { role: 'log', 'aria-live': 'polite', tabindex: '0' });
    const track = el('div', 'lc-track', { 'aria-hidden': 'true' });
    const thumb = el('div', 'lc-thumb');
    track.append(thumb);
    const newBtn = el('button', 'lc-new', { type: 'button' });
    newBtn.hidden = true;
    const emptyEl = el('p', 'lc-empty');
    body.append(log, track, newBtn, emptyEl);

    const tray = el('div', 'lc-tray', { role: 'group' });
    tray.hidden = true;

    const form = el('form', 'lc-form', { autocomplete: 'off' });
    const phraseBtn = el('button', 'lc-iconbtn lc-phrase', { type: 'button', 'aria-expanded': 'false' });
    phraseBtn.innerHTML = ICON_PHRASE;
    const inputWrap = el('div', 'lc-inputwrap');
    const input = el('input', 'lc-input', { type: 'text', maxlength: String(MAX_LEN), enterkeyhint: 'send' });
    const count = el('span', 'lc-count', { 'aria-hidden': 'true' });
    inputWrap.append(input, count);
    const sendBtn = el('button', 'lc-iconbtn lc-send', { type: 'submit' });
    sendBtn.innerHTML = ICON_SEND;
    form.append(phraseBtn, inputWrap, sendBtn);
    const tip = el('p', 'lc-tip', { role: 'status' });

    panel.append(head, renameRow, body, tray, tip, form);
    rootEl.append(panel, bubble, peek);

    /* mount：放進跟遊戲彈窗同一個疊層容器（例如 #app 有 z-index 時），彈窗才蓋得住聊天室 */
    function hostEl() { return (typeof o.mount === 'string' ? document.querySelector(o.mount) : o.mount) || document.body; }
    function mount() {
      if (rootEl.isConnected || !document.body) return;
      hostEl().appendChild(rootEl);
    }
    /* 手機全螢幕面板要蓋過遊戲所有按鈕，暫時移到 body 最上層；收起來再放回原容器 */
    function placeFor(fullscreen) {
      if (!document.body) return;
      const want = fullscreen ? document.body : hostEl();
      if (rootEl.parentNode !== want) {
        const had = rootEl.contains(document.activeElement) ? document.activeElement : null;
        want.appendChild(rootEl);
        if (had) had.focus();
      }
    }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

    /* ---------- 文字 ---------- */
    function applyText() {
      const d = L();
      bubble.setAttribute('aria-label', say('open'));
      bubble.title = say('open');
      panel.setAttribute('aria-label', say('title'));
      title.textContent = say('title');
      onlineEl.textContent = say('online', { n: state.onlineN });
      meBtn.setAttribute('aria-label', say('rename') + '：' + myName());
      meBtn.title = say('rename');
      meName.textContent = myName();
      minBtn.innerHTML = isNarrow() ? ICON_X : ICON_MIN;
      minBtn.setAttribute('aria-label', isNarrow() ? say('close') : say('collapse'));
      minBtn.title = minBtn.getAttribute('aria-label');
      renameInput.placeholder = say('namePh');
      renameInput.setAttribute('aria-label', say('me'));
      renameOk.textContent = say('renameOk');
      renameCancel.textContent = say('renameCancel');
      log.setAttribute('aria-label', say('log'));
      emptyEl.textContent = say('empty');
      phraseBtn.setAttribute('aria-label', say('phrases'));
      phraseBtn.title = say('phrases');
      tray.setAttribute('aria-label', say('phrases'));
      sendBtn.setAttribute('aria-label', say('send'));
      sendBtn.title = say('send');
      input.placeholder = state.connected && state.joined ? say('ph') : say('phOff');
      input.setAttribute('aria-label', say('ph'));
      tray.textContent = '';
      for (const p of d.list) {
        const b = el('button', 'lc-chip', { type: 'button' });
        b.textContent = p;
        b.addEventListener('click', () => { sendText(p); toggleTray(false); });
        tray.append(b);
      }
      newBtn.textContent = say('newMsgs', { n: state.unseen });
      updateCount();
      renderAll();
    }

    /* ---------- 版面狀態 ---------- */
    function isNarrow() { return !!mql.matches; }
    function isOpen() { return isNarrow() ? state.openNarrow : state.openWide; }

    function layout() {
      const visible = state.enabled && state.shown;
      rootEl.hidden = !visible;
      rootEl.classList.toggle('lc-narrow', isNarrow());
      const open = visible && isOpen();
      rootEl.classList.toggle('lc-open', open);
      panel.hidden = !open;
      bubble.hidden = open;
      bubble.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { peek.hidden = true; stickBottom(true); }
      if (!open || !isNarrow()) dropHistory();
      document.documentElement.classList.toggle('lc-lock', open && isNarrow());
      placeFor(open && isNarrow());
      syncJoin();
    }

    function syncJoin() {
      const want = state.enabled && state.shown && state.connected;
      if (want && !state.joined) {
        state.joined = true;
        try { o.join && o.join(myName()); } catch (e) { /* 轉接層錯誤不影響畫面 */ }
      } else if (!want && state.joined) {
        state.joined = false;
        if (state.connected) { try { o.leave && o.leave(); } catch (e) { /* 同上 */ } }
      }
      const ready = state.connected && state.joined;
      input.disabled = !ready;
      sendBtn.disabled = !ready;
      input.placeholder = ready ? say('ph') : say('phOff');
      rootEl.classList.toggle('lc-offline', !ready);
    }

    function open(focus) {
      if (isNarrow()) {
        state.openNarrow = true;
        if (!state.pushed && root.history && root.history.pushState) {
          try { root.history.pushState(Object.assign({}, root.history.state, { lobbyChat: game }), ''); state.pushed = true; } catch (e) { state.pushed = false; }
        }
      } else {
        state.openWide = true;
        store(K('open'), '1');
      }
      layout();
      if (focus) setTimeout(() => { if (!input.disabled) input.focus(); else minBtn.focus(); }, 30);
    }

    function close(focusBubble) {
      if (isNarrow()) {
        state.openNarrow = false;
        if (state.pushed) { state.pushed = false; state.skipPop = true; try { root.history.back(); } catch (e) { state.skipPop = false; } }
      } else {
        state.openWide = false;
        store(K('open'), '0');
      }
      toggleTray(false);
      cancelRename();
      layout();
      if (focusBubble) bubble.focus();
    }

    function dropHistory() {
      if (state.pushed && !(state.enabled && state.shown && isNarrow() && state.openNarrow)) {
        state.pushed = false; state.skipPop = true;
        try { root.history.back(); } catch (e) { state.skipPop = false; }
      }
    }

    function onPop() {
      if (state.skipPop) {
        state.skipPop = false;
        const f = state.afterPop; state.afterPop = null;
        if (f) setTimeout(f, 0);
        return true;
      }
      if (state.pushed && state.openNarrow) {
        state.pushed = false;
        state.openNarrow = false;
        toggleTray(false);
        layout();
        return true;
      }
      return false;
    }

    /* ---------- 訊息呈現 ---------- */
    function nodeFor(m) {
      const row = el('div', 'lc-msg' + (m.kind === 'room' ? ' lc-sys' : ''));
      const time = el('time', 'lc-time');
      time.textContent = hhmm(m.ts);
      time.dateTime = new Date(m.ts || Date.now()).toISOString();
      if (m.kind === 'room') {
        const txt = el('span', 'lc-text');
        const who = el('b', 'lc-name');
        who.textContent = m.name;
        txt.append(who, document.createTextNode(' ' + (m.room ? say('openedRoom', { r: m.room }) : say('opened', { c: m.code }))));
        const jb = el('button', 'lc-join', { type: 'button' });
        jb.textContent = say('join');
        jb.setAttribute('aria-label', say('join') + '：' + (m.room || m.name));
        jb.addEventListener('click', () => {
          const go = () => { try { o.joinRoom && o.joinRoom(m.code, m); } catch (e) { /* 轉接層錯誤 */ } };
          if (isNarrow() && state.openNarrow && state.pushed) {
            /* 先等「關面板」的上一頁跑完再進房，免得遊戲推入的新紀錄被這次上一頁吃掉 */
            let done = false;
            const once = () => { if (!done) { done = true; go(); } };
            state.afterPop = once;
            setTimeout(once, 400);
            close(false);
          } else {
            if (isNarrow() && state.openNarrow) close(false);
            go();
          }
        });
        row.append(time, txt, jb);
      } else {
        const who = el('b', 'lc-name');
        who.textContent = m.name;
        if (m.mine) {
          row.classList.add('lc-mine');
          const tag = el('span', 'lc-me-tag');
          tag.textContent = say('mine');
          who.append(tag);
        }
        const txt = el('span', 'lc-text');
        txt.textContent = m.text;
        row.append(time, who, txt);
      }
      return row;
    }

    function renderAll() {
      log.textContent = '';
      const frag = document.createDocumentFragment();
      for (const m of state.msgs) frag.append(nodeFor(m));
      log.append(frag);
      emptyEl.hidden = state.msgs.length > 0;
      state.unseen = 0;
      newBtn.hidden = true;
      stickBottom(true);
    }

    function atBottom() { return log.scrollHeight - log.scrollTop - log.clientHeight < 24; }

    function stickBottom(force) {
      if (force || atBottom()) {
        requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; updateThumb(); });
      }
      updateThumb();
    }

    function append(m) {
      const wasBottom = atBottom() || panel.hidden || !!(m && m.mine);   /* 自己剛送出的一定捲到看得到 */
      state.msgs.push(m);
      if (state.msgs.length > 50) {
        state.msgs.splice(0, state.msgs.length - 50);
        if (log.firstChild) log.removeChild(log.firstChild);
      }
      log.append(nodeFor(m));
      emptyEl.hidden = true;
      if (wasBottom) stickBottom(true);
      else {
        state.unseen++;
        newBtn.textContent = say('newMsgs', { n: state.unseen });
        newBtn.hidden = false;
        updateThumb();
      }
    }

    /* ---------- 自繪捲軸 ---------- */
    function updateThumb() {
      const h = log.clientHeight, sh = log.scrollHeight;
      if (!h || sh <= h + 1) { track.hidden = true; return; }
      track.hidden = false;
      const th = Math.max(28, h * h / sh);
      const top = (h - th) * (log.scrollTop / (sh - h));
      thumb.style.height = th + 'px';
      thumb.style.transform = 'translateY(' + top + 'px)';
    }
    log.addEventListener('scroll', () => {
      updateThumb();
      if (atBottom() && state.unseen) { state.unseen = 0; newBtn.hidden = true; }
    }, { passive: true });
    let drag = null;
    thumb.addEventListener('pointerdown', (e) => {
      drag = { y: e.clientY, top: log.scrollTop };
      thumb.setPointerCapture(e.pointerId);
      thumb.classList.add('lc-drag');
      e.preventDefault();
    });
    thumb.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const h = log.clientHeight, sh = log.scrollHeight;
      const th = thumb.offsetHeight;
      log.scrollTop = drag.top + (e.clientY - drag.y) * ((sh - h) / Math.max(1, h - th));
    });
    const endDrag = () => { drag = null; thumb.classList.remove('lc-drag'); };
    thumb.addEventListener('pointerup', endDrag);
    thumb.addEventListener('pointercancel', endDrag);
    track.addEventListener('pointerdown', (e) => {
      if (e.target !== track) return;
      const r = track.getBoundingClientRect();
      log.scrollTop += (e.clientY < r.top + thumb.offsetTop ? -1 : 1) * log.clientHeight * 0.9;
    });
    if (root.ResizeObserver) new root.ResizeObserver(() => updateThumb()).observe(log);

    newBtn.addEventListener('click', () => { state.unseen = 0; newBtn.hidden = true; stickBottom(true); });

    /* ---------- 收合時的提示 ---------- */
    let peekTimer = 0;
    function notify(m) {
      if (isOpen() || rootEl.hidden || (m && m.mine)) return;   /* 自己說的話不用提示自己 */
      peek.textContent = '';
      const who = el('b');
      who.textContent = m.name;
      peek.append(who, document.createTextNode(m.kind === 'room' ? ' ' + (m.room ? say('openedRoom', { r: m.room }) : say('opened', { c: m.code })) : '：' + m.text));
      peek.hidden = false;
      peek.classList.remove('lc-in');
      void peek.offsetWidth;
      peek.classList.add('lc-in');
      clearTimeout(peekTimer);
      peekTimer = setTimeout(() => { peek.hidden = true; }, 3000);
      bubble.classList.remove('lc-bounce');
      void bubble.offsetWidth;
      bubble.classList.add('lc-bounce');
    }
    peek.addEventListener('click', () => open(true));
    bubble.addEventListener('animationend', () => bubble.classList.remove('lc-bounce'));

    /* ---------- 送出 ---------- */
    let tipTimer = 0;
    function showTip(text) {
      tip.textContent = text;
      tip.hidden = !text;
      clearTimeout(tipTimer);
      if (text) tipTimer = setTimeout(() => { tip.hidden = true; }, 2600);
    }
    tip.hidden = true;

    function sendText(raw) {
      const text = Array.from(String(raw || '').replace(/\s+/g, ' ').trim()).slice(0, MAX_LEN).join('');
      if (!text) { showTip(say('err.empty')); return false; }
      if (!state.connected || !state.joined) { showTip(say('err.notjoined')); return false; }
      if (text.toLowerCase().replace(/\s+/g, '') === state.lastText) { showTip(say('err.dup')); return false; }
      state.lastText = text.toLowerCase().replace(/\s+/g, '');
      try { o.send && o.send(text, myName()); } catch (e) { showTip(say('err.default')); return false; }
      return true;
    }

    function updateCount() {
      const n = Array.from(input.value).length;
      count.textContent = n ? n + '/' + MAX_LEN : '';
      count.classList.toggle('lc-max', n >= MAX_LEN);
    }
    input.addEventListener('input', updateCount);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (sendText(input.value)) { input.value = ''; updateCount(); }
      input.focus();
    });

    function toggleTray(force) {
      const on = force == null ? tray.hidden : !!force;
      const bottom = atBottom();
      tray.hidden = !on;
      if (bottom) stickBottom(true);
      phraseBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
      phraseBtn.classList.toggle('lc-on', on);
      updateThumb();
    }
    phraseBtn.addEventListener('click', () => toggleTray());

    /* ---------- 改暱稱 ---------- */
    function startRename() {
      renameInput.value = myName();
      renameRow.hidden = false;
      renameInput.focus();
      renameInput.select();
    }
    function cancelRename() { renameRow.hidden = true; }
    meBtn.addEventListener('click', startRename);
    renameCancel.addEventListener('click', () => { cancelRename(); meBtn.focus(); });
    renameRow.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = Array.from(renameInput.value.replace(/\s+/g, ' ').trim()).slice(0, 16).join('');
      if (n) {
        store(K('name'), n);
        try { o.setName && o.setName(n); } catch (err) { /* 轉接層錯誤 */ }
        if (state.joined && state.connected) { try { o.join && o.join(n); } catch (err) { /* 同上 */ } }
      }
      cancelRename();
      applyText();
      meBtn.focus();
    });
    renameInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); cancelRename(); meBtn.focus(); } });

    /* ---------- 互動 ---------- */
    bubble.addEventListener('click', () => open(true));
    minBtn.addEventListener('click', () => close(true));
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); close(true); }
    });

    /* 手機：抓住標題列往下滑關閉 */
    let swipe = null;
    head.addEventListener('pointerdown', (e) => {
      if (!isNarrow() || e.target.closest('button')) return;
      swipe = { y: e.clientY, id: e.pointerId };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const dy = Math.max(0, e.clientY - swipe.y);
      panel.style.transform = 'translateY(' + dy + 'px)';
      panel.style.transition = 'none';
    });
    const endSwipe = (e) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const dy = Math.max(0, e.clientY - swipe.y);
      swipe = null;
      panel.style.transition = '';
      panel.style.transform = '';
      if (dy > 90) close(true);
    };
    head.addEventListener('pointerup', endSwipe);
    head.addEventListener('pointercancel', endSwipe);

    const onMql = () => { applyText(); layout(); };
    if (mql.addEventListener) mql.addEventListener('change', onMql); else if (mql.addListener) mql.addListener(onMql);

    /* ---------- 大廳畫面偵測 ---------- */
    function isShown() {
      if (typeof o.active === 'function') { try { return !!o.active(); } catch (e) { return false; } }
      const t = typeof o.watch === 'string' ? document.querySelector(o.watch) : o.watch;
      if (!t || !t.isConnected) return false;
      if (t.hidden || t.closest('[hidden]')) return false;
      if (!t.getClientRects().length) return false;
      const cs = root.getComputedStyle(t);
      return cs.visibility !== 'hidden' && cs.display !== 'none';
    }
    let raf = 0;
    function refresh() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const s = isShown();
        if (s !== state.shown) {
          state.shown = s;
          if (!s) { peek.hidden = true; toggleTray(false); cancelRename(); }
          applyText();
          layout();
        }
      });
    }
    function observe() {
      const t = typeof o.watch === 'string' ? document.querySelector(o.watch) : o.watch;
      if (!t || !root.MutationObserver) return;
      const mo = new root.MutationObserver(refresh);
      for (let n = t; n && n !== document.documentElement; n = n.parentElement) {
        mo.observe(n, { attributes: true, attributeFilter: ['class', 'hidden', 'style', 'aria-hidden'] });
      }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { observe(); refresh(); });
    else { observe(); refresh(); }
    root.addEventListener('resize', refresh);

    const binds = [];
    function paintBinds() { for (const f of binds) f(); }
    document.addEventListener('i18n:change', () => { applyText(); paintBinds(); });

    /** 把設定頁的開關接上（checkbox 或 aria-checked／aria-pressed 的自訂按鈕都可以） */
    function bindSetting(b) {
      const q = (x) => (typeof x === 'string' ? document.querySelector(x) : x);
      const ctl = q(b.input);
      if (!ctl) return;
      const isBox = ctl.tagName === 'INPUT' && /checkbox|radio/i.test(ctl.type);
      const paint = () => {
        const on = state.enabled;
        if (isBox) ctl.checked = on;
        else {
          if (ctl.hasAttribute('aria-pressed')) ctl.setAttribute('aria-pressed', on ? 'true' : 'false');
          else ctl.setAttribute('aria-checked', on ? 'true' : 'false');
          ctl.classList.toggle(b.onClass || 'on', on);
        }
        const lb = q(b.label), sb = q(b.sub), st = q(b.status);
        if (lb) lb.textContent = say('set');
        if (sb) sb.textContent = say('setSub');
        if (st) st.textContent = on ? say('on') : say('off');
        if (b.paint) b.paint(on);
      };
      if (b.event) {
        /* 遊戲自己的開關元件會自己切換狀態，只要在它的事件裡讀回來 */
        ctl.addEventListener(b.event, () => {
          const on = b.read ? !!b.read(ctl) : (isBox ? ctl.checked : (ctl.getAttribute('aria-checked') || ctl.getAttribute('aria-pressed')) === 'true');
          api.setEnabled(on); paint();
        });
      } else if (isBox) ctl.addEventListener('change', () => { api.setEnabled(ctl.checked); paint(); });
      else ctl.addEventListener('click', () => { api.setEnabled(!state.enabled); paint(); });
      const rs = q(b.reset);
      if (rs) rs.addEventListener('click', () => { api.setEnabled(true); paint(); });
      binds.push(paint);
      paint();
    }

    const api = {
      _onPop: onPop,
      bindSetting,
      paintSetting: paintBinds,
      text: say,
      el: rootEl,
      history(msgs, n) {
        state.msgs = Array.isArray(msgs) ? msgs.slice(-50) : [];
        if (n != null) state.onlineN = Number(n) || 0;
        onlineEl.textContent = say('online', { n: state.onlineN });
        renderAll();
      },
      add(m) {
        if (!m) return;
        append(m);
        notify(m);
      },
      online(n) { state.onlineN = Number(n) || 0; onlineEl.textContent = say('online', { n: state.onlineN }); },
      error(code) {
        if (code === 'dup' || code === 'long' || code === 'empty') state.lastText = '';
        showTip(L()['err.' + code] ? say('err.' + code) : say('err.default'));
      },
      setConnected(on) {
        const was = state.connected;
        state.connected = !!on;
        if (!on) state.joined = false;          // 斷線後伺服器那邊已經忘了，重連要重新加入
        if (on && !was) state.lastText = '';
        layout();
      },
      setEnabled(on) {
        state.enabled = !!on;
        store(K('enabled'), on ? '1' : '0');
        if (!on) peek.hidden = true;
        layout();
      },
      isEnabled() { return state.enabled; },
      refresh() { refresh(); },
      relabel() { applyText(); },
      open() { open(true); },
      close() { close(false); },
      isOpen() { return !panel.hidden; },
      isJoined() { return state.joined; }
    };
    instances.push(api);
    applyText();
    layout();
    return api;
  }

  const LobbyChat = { create, DICT };
  root.LobbyChat = LobbyChat;
  if (typeof module === 'object' && module.exports) module.exports = LobbyChat;
})(typeof window !== 'undefined' ? window : globalThis);
