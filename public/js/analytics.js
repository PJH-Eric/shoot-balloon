(function (global) {
  'use strict';
  var active = null;
  var lastKey = null;
  var pendingRoom = null;
  var joinedRoom = null;

  function track(name, params) {
    try {
      if (typeof global.gtag === 'function') global.gtag('event', name, params || {});
    } catch (error) { /* 統計服務失敗不影響遊戲。 */ }
  }

  function start(params, key) {
    if (key != null && key === lastKey) return;
    lastKey = key == null ? null : key;
    active = { params: params || {}, at: Date.now() };
    track('game_start', active.params);
  }

  function end(params) {
    if (!active) return;
    var match = active;
    active = null;
    track('game_end', Object.assign({}, match.params, {
      duration_sec: Math.max(0, Math.round((Date.now() - match.at) / 1000))
    }, params || {}));
  }

  function reset() { active = null; lastKey = null; }

  function sync(phase, key, params, result) {
    if (params && params.spectator) { active = null; return; }
    if (['countdown', 'playing', 'running'].indexOf(phase) !== -1) start(params, key);
    else if (result && ['over', 'ended', 'finished'].indexOf(phase) !== -1) end(result);
  }

  function roomRequest(message) {
    var action = message.type || message.t;
    if (action === 'invite:resolve') action = 'join';
    if (action === 'create' || action === 'join') pendingRoom = {
      action: action, via: message.token || message.invite ? 'invite_link' : 'lobby'
    };
    else if (action === 'leave') roomLeft();
  }

  function roomAccepted(action, key, via) {
    if (key != null && key === joinedRoom) return;
    joinedRoom = key == null ? null : key;
    track('room_' + action, { mode: 'online', via: via || 'lobby' });
  }

  function roomLeft() { pendingRoom = null; joinedRoom = null; active = null; }

  function roomResponse(type, hasRoom) {
    if (pendingRoom && (type === 'joined' || (type === 'room' && hasRoom))) {
      roomAccepted(pendingRoom.action, null, pendingRoom.via);
      pendingRoom = null;
    } else if (type === 'error' || type === 'err' || type === 'closed' || type === 'left') pendingRoom = null;
  }

  global.GameAnalytics = {
    track: track, start: start, end: end, reset: reset, sync: sync,
    roomRequest: roomRequest, roomResponse: roomResponse, roomAccepted: roomAccepted, roomLeft: roomLeft
  };
  if (global.document) global.document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    try {
      var url = new URL(link.href, global.location.href);
      if (url.origin === 'https://pjh-eric.github.io' && url.pathname === '/game-lobby/') {
        track('lobby_click', { target: 'lobby_home_link', transport_type: 'beacon' });
      }
    } catch (error) { /* 無效連結不影響導覽。 */ }
  });
})(window);
