/* ===== audio.js — Web Audio 即時合成的背景音樂與音效 =====
 *
 * 不需要任何外部音檔：所有聲音都是用振盪器＋噪音即時合成，
 * 因此沒有授權問題，也不會有載入失敗。
 * 要換成正式音檔時，只要保留 Sound.play / startBgm / stopBgm 這幾個介面即可
 * （交付摘要有列出這一點）。
 *
 * 瀏覽器規定必須在使用者第一次手勢之後才能播放聲音，
 * 所以 unlock() 由 app.js 綁在第一次 pointerdown / keydown 上。
 */
(function (w) {
  'use strict';

  var ctx = null, master = null, musicGain = null, sfxGain = null;
  var musicOn = true, sfxOn = true, musicVolume = 0.6, sfxVolume = 1, hapticOn = true, chatCueOn = true;
  var timer = null, step = 0, nextTime = 0, curTrack = 'menu';
  var TEMPO = 112;                       // BPM，夜市攤位的輕快節奏
  var STEP = 15 / TEMPO;                 // 十六分音符秒數

  var KEY = {
    music: 'sb_music', sfx: 'sb_sfx',
    musicVol: 'sb_music_volume', sfxVol: 'sb_sfx_volume',
    haptic: 'sb_haptic', chatCue: 'sb_chat_cue'
  };

  function loadFlag(k, d) {
    try { var v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch (e) { return d; }
  }
  function saveFlag(k, v) { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) {} }
  function loadVolume(k, d) {
    try {
      var v = parseFloat(localStorage.getItem(k));
      return isFinite(v) ? Math.max(0, Math.min(1, v)) : d;
    } catch (e) { return d; }
  }
  function saveVolume(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }

  musicOn = loadFlag(KEY.music, true);
  sfxOn = loadFlag(KEY.sfx, true);
  musicVolume = loadVolume(KEY.musicVol, 0.6);
  sfxVolume = loadVolume(KEY.sfxVol, 1);
  hapticOn = loadFlag(KEY.haptic, true);
  chatCueOn = loadFlag(KEY.chatCue, true);

  function applyGain() {
    if (musicGain) musicGain.gain.value = musicOn ? 0.12 * musicVolume : 0;
    if (sfxGain) sfxGain.gain.value = sfxOn ? 0.5 * sfxVolume : 0;
  }

  function ensure() {
    if (ctx) return ctx;
    var AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.connect(master);
    applyGain();
    return ctx;
  }
  function unlock() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }
  function isUnlocked() { return !!ctx && ctx.state === 'running'; }

  function hz(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  function tone(o) {
    if (!ctx) return;
    var t0 = o.t || ctx.currentTime;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.type || 'triangle';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + (o.dur || 0.2));
    var peak = o.v === undefined ? 0.5 : o.v;
    var atk = o.atk === undefined ? 0.008 : o.atk;
    var dur = o.dur || 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(o.bus || sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(o) {
    if (!ctx) return;
    var t0 = o.t || ctx.currentTime, dur = o.dur || 0.12;
    var n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, o.decay || 1);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var bp = ctx.createBiquadFilter(); bp.type = o.type || 'bandpass';
    bp.frequency.value = o.f || 2200; bp.Q.value = o.q || 1.1;
    var g = ctx.createGain(); g.gain.value = o.v === undefined ? 0.28 : o.v;
    src.connect(bp); bp.connect(g); g.connect(o.bus || sfxGain);
    src.start(t0);
  }

  /* ---- 音效語彙 ----
   * 點擊、瞄準微調、發射、飛行咻聲、命中、擦邊、自爆、落空、
   * 換回合、倒數、勝利、失敗、聊天、加入、離開。
   * 每個玩家行動都至少對應一個聲音，但靜音時遊戲仍完整可玩。 */
  /* ---- 音效表 ---- 全部即時合成，換成正式音檔時只要保留同樣的鍵名 */
  var SFX = {
    click: function (t) { tone({ t: t, f: 620, f2: 880, dur: 0.08, type: 'square', v: 0.22 }); },
    tick: function (t) { tone({ t: t, f: 1040, dur: 0.035, type: 'sine', v: 0.14 }); },
    /* 氣球破掉：一聲「啵」+ 一點橡膠碎裂的噪音 */
    pop: function (t) {
      noise({ t: t, f: 3200, q: 0.8, dur: 0.1, v: 0.3, decay: 0.6, type: 'highpass' });
      tone({ t: t, f: 760, f2: 240, dur: 0.1, type: 'triangle', v: 0.34 });
    },
    /* 飛鏢出手：短促的咻 */
    twang: function (t) { noise({ t: t, f: 2600, q: 0.9, dur: 0.07, v: 0.1, decay: 0.7 }); },
    /* 射中多層氣球但還沒破：橡膠的悶響 */
    bonk: function (t) {
      noise({ t: t, f: 900, q: 1.1, dur: 0.12, v: 0.26, decay: 0.5 });
      tone({ t: t, f: 260, f2: 120, dur: 0.14, type: 'triangle', v: 0.3 });
    },
    /* 射破多層氣球的最後一發：多一串亮亮的鈴 */
    smash: function (t) {
      SFX.pop(t);
      [79, 84, 88].forEach(function (n, i) { tone({ t: t + 0.05 + i * 0.045, f: hz(n), dur: 0.2, type: 'sine', v: 0.22 }); });
    },
    /* 誤射不能射的氣球：低沉的錯誤音 */
    oops: function (t) {
      tone({ t: t, f: 300, f2: 150, dur: 0.3, type: 'sawtooth', v: 0.26 });
      tone({ t: t + 0.09, f: 210, f2: 110, dur: 0.3, type: 'sine', v: 0.2 });
    },
    /* 射空：短促的氣流聲 */
    whiff: function (t) { noise({ t: t, f: 2200, q: 0.7, dur: 0.09, v: 0.12, decay: 0.4 }); },
    /* 金色／彩虹氣球：閃亮亮的琶音 */
    shiny: function (t) {
      [84, 88, 91, 96].forEach(function (n, i) { tone({ t: t + i * 0.045, f: hz(n), dur: 0.22, type: 'sine', v: 0.2 }); });
    },
    /* 彩虹加倍開始 */
    buff: function (t) {
      [72, 76, 79, 84].forEach(function (n, i) { tone({ t: t + i * 0.05, f: hz(n), dur: 0.3, type: 'triangle', v: 0.2 }); });
    },
    /* 連擊里程碑 */
    combo: function (t) { tone({ t: t, f: 880, f2: 1320, dur: 0.12, type: 'square', v: 0.18 }); },
    /* 氣球飄走 */
    escape: function (t) { tone({ t: t, f: 520, f2: 240, dur: 0.16, type: 'sine', v: 0.13 }); },
    /* 開賽倒數 */
    count: function (t) { tone({ t: t, f: 660, dur: 0.12, type: 'square', v: 0.24 }); },
    start: function (t) {
      [72, 79, 84].forEach(function (n, i) { tone({ t: t + i * 0.07, f: hz(n), dur: 0.24, type: 'triangle', v: 0.26 }); });
    },
    /* 最後 10 秒的警示 */
    warn: function (t) { tone({ t: t, f: hz(80), dur: 0.1, type: 'square', v: 0.2 }); },
    /* 換階段 */
    stage: function (t) {
      [67, 74, 79].forEach(function (n, i) { tone({ t: t + i * 0.06, f: hz(n), dur: 0.26, type: 'square', v: 0.2 }); });
    },
    win: function (t) {
      [72, 76, 79, 84, 88].forEach(function (n, i) { tone({ t: t + i * 0.1, f: hz(n), dur: 0.3, type: 'triangle', v: 0.3 }); });
    },
    lose: function (t) {
      [72, 69, 65, 60].forEach(function (n, i) { tone({ t: t + i * 0.13, f: hz(n), dur: 0.34, type: 'sine', v: 0.26 }); });
    },
    chat: function (t) { tone({ t: t, f: 880, f2: 1180, dur: 0.09, type: 'sine', v: 0.16 }); },
    join: function (t) { tone({ t: t, f: hz(67), f2: hz(79), dur: 0.26, type: 'sine', v: 0.22 }); },
    leave: function (t) { tone({ t: t, f: hz(79), f2: hz(67), dur: 0.26, type: 'sine', v: 0.22 }); }
  };

  function play(name, delay) {
    if (!sfxOn) return;
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    var f = SFX[name];
    if (f) f(ctx.currentTime + (delay || 0));
  }

  /* ---- 背景音樂：輕快的循環，選單與戰鬥各一條 ---- */
  var MEL = {
    menu: [72, null, 76, null, 79, null, 76, null, 74, null, 77, null, 81, null, null, null,
           72, null, 76, null, 81, null, 79, null, 77, null, 74, null, 72, null, null, null],
    battle: [79, 81, 83, null, 84, null, 83, 81, 79, null, 76, null, 74, null, null, null,
             77, 79, 81, null, 83, null, 81, 79, 77, null, 74, null, 72, null, null, null]
  };
  var BASS = {
    menu: [48, null, null, null, 55, null, null, null, 50, null, null, null, 53, null, null, null,
           48, null, null, null, 55, null, null, null, 52, null, null, null, 53, null, null, null],
    battle: [40, null, 40, null, 47, null, 40, null, 45, null, 45, null, 52, null, 45, null,
             38, null, 38, null, 45, null, 38, null, 43, null, 43, null, 50, null, 43, null]
  };

  function schedule() {
    if (!ctx) return;
    while (nextTime < ctx.currentTime + 0.22) {
      var i = step % 32;
      var m = MEL[curTrack][i];
      if (m !== null && m !== undefined) {
        tone({ t: nextTime, f: hz(m), dur: STEP * 3.2, type: 'triangle', v: 0.42, bus: musicGain, atk: 0.03 });
        tone({ t: nextTime, f: hz(m + 12), dur: STEP * 2, type: 'sine', v: 0.08, bus: musicGain, atk: 0.04 });
      }
      var b = BASS[curTrack][i];
      if (b !== null && b !== undefined) tone({ t: nextTime, f: hz(b), dur: STEP * 4, type: 'sine', v: 0.6, bus: musicGain, atk: 0.02 });
      if (i % 8 === 4) noise({ t: nextTime, f: 6400, dur: 0.04, v: 0.028, bus: musicGain });
      nextTime += STEP;
      step++;
    }
  }

  function startBgm(track) {
    if (track && MEL[track]) curTrack = track;
    if (!musicOn) return;
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (timer) return;
    nextTime = ctx.currentTime + 0.08;
    timer = setInterval(schedule, 40);
  }
  function stopBgm() { if (timer) { clearInterval(timer); timer = null; } }
  function setTrack(t) {
    if (!MEL[t] || curTrack === t) return;
    curTrack = t; step = 0;
  }

  function setMusic(on) {
    musicOn = !!on; saveFlag(KEY.music, musicOn);
    ensure(); applyGain();
    if (musicOn) startBgm(); else stopBgm();
    return musicOn;
  }
  function setSfx(on) {
    sfxOn = !!on; saveFlag(KEY.sfx, sfxOn);
    ensure(); applyGain();
    if (sfxOn) play('click');
    return sfxOn;
  }
  function setMusicVolume(value) {
    musicVolume = Math.max(0, Math.min(1, Number(value) || 0));
    saveVolume(KEY.musicVol, musicVolume);
    ensure(); applyGain();
    return musicVolume;
  }
  function setSfxVolume(value) {
    sfxVolume = Math.max(0, Math.min(1, Number(value) || 0));
    saveVolume(KEY.sfxVol, sfxVolume);
    ensure(); applyGain();
    return sfxVolume;
  }
  function setHaptic(on) { hapticOn = !!on; saveFlag(KEY.haptic, hapticOn); return hapticOn; }

  /* 聊天提示音是獨立開關，但仍受「遊戲音效」總開關管：音效關掉就一律不出聲 */
  function setChatCue(on) {
    chatCueOn = !!on; saveFlag(KEY.chatCue, chatCueOn);
    if (chatCueOn) play('chat');
    return chatCueOn;
  }
  function playChat() { if (chatCueOn) play('chat'); }

  function vibrate(pattern) {
    if (!hapticOn || !w.navigator || typeof w.navigator.vibrate !== 'function') return;
    /* 使用者還沒真的碰過畫面就呼叫 vibrate，瀏覽器會擋下並留下警告，先跳過 */
    var ua = w.navigator.userActivation;
    if (ua && ua.hasBeenActive === false) return;
    try { w.navigator.vibrate(pattern || 10); } catch (e) {}
  }

  /* 切到背景分頁時停掉音樂，回來再依設定恢復，避免疊播 */
  if (w.document && w.document.addEventListener) {
    w.document.addEventListener('visibilitychange', function () {
      if (w.document.hidden) stopBgm();
      else if (musicOn && isUnlocked()) startBgm();
    });
  }

  w.Sound = {
    unlock: unlock, isUnlocked: isUnlocked, play: play,
    startBgm: startBgm, stopBgm: stopBgm, setTrack: setTrack,
    setMusic: setMusic, setSfx: setSfx,
    setMusicVolume: setMusicVolume, setSfxVolume: setSfxVolume,
    setHaptic: setHaptic, vibrate: vibrate,
    setChatCue: setChatCue, playChat: playChat,
    isMusicOn: function () { return musicOn; },
    isSfxOn: function () { return sfxOn; },
    getMusicVolume: function () { return musicVolume; },
    getSfxVolume: function () { return sfxVolume; },
    isHapticOn: function () { return hapticOn; },
    isChatCueOn: function () { return chatCueOn; },
    resetDefaults: function () {
      setMusic(true); setSfx(true); setMusicVolume(0.6); setSfxVolume(1); setHaptic(true);
      chatCueOn = true; saveFlag(KEY.chatCue, true);
    }
  };
}(typeof window !== 'undefined' ? window : globalThis));
