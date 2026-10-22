(function (global) {
  'use strict';
  if (global.GameAnalytics) return;

  var active = null;
  var roundKeys = [];
  var pendingRoom = null;
  var joinedRoom = null;
  var config = null;
  var activeScreen = '';
  var allowedEvents = ['game_start', 'game_end', 'room_create', 'room_join', 'lobby_click',
    'select_content', 'view_game_details', 'filter_games', 'favorite_game'];

  function cleanUrl(value) {
    try {
      var url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.origin + url.pathname : '';
    } catch (error) { return ''; }
  }

  function init(options) {
    if (config || !options) return;
    var siteUrl = cleanUrl(options.page_location);
    if (!siteUrl || !/^[a-z0-9-]{1,40}$/.test(options.game_id || '')) return;
    config = { game_id: options.game_id, page_location: siteUrl };
    // 本機、預覽及 file:// 不載入 Google tag；仍提供完整的無副作用 API。
    if (!global.location || global.location.hostname !== new URL(siteUrl).hostname ||
        global.location.hostname !== 'pjh-eric.github.io' || !/^G-[A-Z0-9]+$/.test(options.measurement_id || '')) return;
    global.dataLayer = global.dataLayer || [];
    global.gtag = global.gtag || function () { global.dataLayer.push(arguments); };
    global.gtag('js', new Date());
    global.gtag('config', options.measurement_id, {
      game_id: config.game_id,
      page_location: siteUrl,
      page_referrer: cleanUrl(global.document.referrer),
      send_page_view: options.manual_page_view !== true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
    var script = global.document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + options.measurement_id;
    global.document.head.appendChild(script);
  }

  function parameters(input) {
    var params = input || {};
    var out = {};
    if (config) out.game_id = config.game_id;
    // 僅允許固定維度；不接受姓名、房號、seed、邀請 token 或任意網址。
    ['game_id', 'target_game_id', 'source_game_id', 'variant', 'difficulty', 'content_type',
      'item_id', 'content_id', 'entry_point', 'category', 'action', 'target'].forEach(function (key) {
      var value = params[key];
      if ((typeof value === 'string' || typeof value === 'number') && /^[a-zA-Z0-9_-]{1,40}$/.test(String(value))) out[key] = String(value);
    });
    if (['solo', 'ai', 'online', 'practice', 'solo_random'].indexOf(params.mode) !== -1) {
      out.mode = params.mode === 'online' ? 'online' :
        (params.mode === 'ai' || params.players > 1 ? 'ai' : 'solo');
      if (params.mode === 'practice' || params.mode === 'solo_random') out.variant = params.mode;
    }
    if (Number.isInteger(params.players) && params.players >= 1 && params.players <= 32) out.players = params.players;
    if (Number.isFinite(params.duration_sec) && params.duration_sec >= 0) out.duration_sec = Math.round(params.duration_sec);
    if (['win', 'lose', 'loss', 'draw', 'complete', 'dnf'].indexOf(params.result) !== -1) out.result = params.result === 'loss' ? 'lose' : params.result;
    if (['lobby', 'invite_link'].indexOf(params.via) !== -1) out.via = params.via;
    if (['add', 'remove'].indexOf(params.action) === -1) delete out.action;
    var lang = global.I18N && global.I18N.lang;
    out.app_language = lang === 'en' ? 'en' : 'zh-Hant';
    out.transport_type = 'beacon';
    return out;
  }

  function track(name, params) {
    if (allowedEvents.indexOf(name) === -1) return;
    try {
      if (typeof global.gtag === 'function') global.gtag('event', name, parameters(params));
    } catch (error) { /* 統計服務失敗不影響遊戲。 */ }
  }

  function start(params, key) {
    if (params && params.spectator) { active = null; return; }
    if (key != null && roundKeys.indexOf(key) !== -1) return;
    if (key != null) {
      roundKeys.push(key);
      if (roundKeys.length > 100) roundKeys.shift();
    }
    active = { params: parameters(params), key: key, at: Date.now() };
    track('game_start', active.params);
  }

  function end(params, key) {
    if (!active || (key != null && active.key !== key)) return;
    var match = active;
    active = null;
    track('game_end', Object.assign({}, match.params, {
      duration_sec: Math.max(0, Math.round((Date.now() - match.at) / 1000))
    }, params || {}));
  }

  function reset() { active = null; }

  function sync(phase, key, params, result) {
    if (params && params.spectator) { active = null; return; }
    if (['countdown', 'playing', 'running'].indexOf(phase) !== -1) start(params, key);
    else if (result && ['over', 'ended', 'finished'].indexOf(phase) !== -1) end(result, key);
  }

  function roomRequest(message) {
    if (!message) return;
    var action = message.type || message.t;
    if (action === 'invite:resolve') action = 'join';
    if (action === 'create' || action === 'join') pendingRoom = {
      action: action, via: message.token || message.invite ? 'invite_link' : 'lobby'
    };
    else if (action === 'leave') roomLeft();
  }

  function roomAccepted(action, key, via) {
    if (action !== 'create' && action !== 'join') return;
    if (key != null && key === joinedRoom) return;
    joinedRoom = key == null ? null : key;
    track('room_' + action, { mode: 'online', via: via || 'lobby' });
  }

  function roomLeft() { pendingRoom = null; joinedRoom = null; active = null; }

  function roomResponse(type, hasRoom) {
    if (type === 'closed' || type === 'left') { roomLeft(); return; }
    if (pendingRoom && (type === 'joined' || (type === 'room' && hasRoom))) {
      roomAccepted(pendingRoom.action, typeof hasRoom === 'string' ? hasRoom : null, pendingRoom.via);
      pendingRoom = null;
    } else if (type === 'error' || type === 'err') pendingRoom = null;
  }

  function pageView(screen) {
    if (!config || !/^[a-z0-9_-]{1,40}$/.test(screen || '') || screen === activeScreen) return;
    activeScreen = screen;
    try {
      if (typeof global.gtag === 'function') global.gtag('event', 'page_view', {
        game_id: config.game_id,
        page_location: config.page_location + '#/' + screen,
        page_referrer: cleanUrl(global.document.referrer),
        page_title: global.document.title + ' - ' + screen,
        screen_name: screen
      });
    } catch (error) { /* 畫面追蹤失敗不影響操作。 */ }
  }

  global.GameAnalytics = {
    init: init, track: track, start: start, end: end, reset: reset, sync: sync, pageView: pageView,
    roomRequest: roomRequest, roomResponse: roomResponse, roomAccepted: roomAccepted, roomLeft: roomLeft
  };
  if (global.MR_CONFIG) {
    global.MR_ANALYTICS = global.GameAnalytics;
    init({ game_id: 'maze-roll', measurement_id: global.MR_CONFIG.ga4MeasurementId,
      page_location: 'https://pjh-eric.github.io/maze-roll/', manual_page_view: true });
  } else init(global.GAME_ANALYTICS_CONFIG);

  if (global.document) global.document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    try {
      var url = new URL(link.href, global.location.href);
      if (url.origin === 'https://pjh-eric.github.io' && url.pathname === '/game-lobby/') {
        track('lobby_click', { target: 'lobby_home_link', source_game_id: config && config.game_id });
      }
    } catch (error) { /* 無效連結不影響導覽。 */ }
  });
})(window);
