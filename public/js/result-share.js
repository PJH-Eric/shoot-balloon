/* Settlement sharing. Images are rendered locally; the renderer is a same-origin asset. */
(function (w) {
  'use strict';
  if (w.GameResultShare) return;

  var d = w.document;
  var selector = '[data-result-share]';
  var words = w.GameResultShareLocales;
  var scriptURL = d.currentScript && d.currentScript.src;
  var renderer;
  var previews = new Set();
  var openDialogs = new Set();

  // html2canvas 1.x does not parse modern computed color() / oklch() values.
  // Let the browser convert these colors to sRGB, only in the capture clone.
  function legacyColors(value) {
    return value.replace(/(?:color|oklch|oklab|lab|lch)\([^)]*\)/g, function (color) {
      var pixel = d.createElement('canvas');
      pixel.width = pixel.height = 1;
      var ctx = pixel.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      var rgba = ctx.getImageData(0, 0, 1, 1).data;
      return 'rgba(' + rgba[0] + ',' + rgba[1] + ',' + rgba[2] + ',' + rgba[3] / 255 + ')';
    });
  }

  function loadRenderer() {
    if (w.html2canvas) return Promise.resolve(w.html2canvas);
    if (renderer) return renderer;
    renderer = new Promise(function (resolve, reject) {
      var script = d.createElement('script');
      var timer = w.setTimeout(function () { finish(new Error('Renderer timeout')); }, 15000);
      function finish(error) {
        w.clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) { script.remove(); renderer = null; reject(error); }
        else resolve(w.html2canvas);
      }
      script.onload = function () { finish(w.html2canvas ? null : new Error('Renderer missing')); };
      script.onerror = function () { finish(new Error('Renderer unavailable')); };
      script.src = new URL('vendor/html2canvas.min.js', scriptURL || d.baseURI).href;
      d.head.appendChild(script);
    });
    return renderer;
  }

  async function capture(root) {
    var render = await loadRenderer();
    if (!root.isConnected) throw new Error('Settlement removed');
    var width = root.getBoundingClientRect().width;
    if (!width || width > 2048) throw new Error('Invalid settlement size');
    var background = root;
    var color = 'transparent';
    while (background && (color === 'transparent' || color === 'rgba(0, 0, 0, 0)')) {
      color = w.getComputedStyle(background).backgroundColor;
      background = background.parentElement;
    }
    var frame;
    var timer;
    var job = render(root, {
      logging: false, useCORS: true, allowTaint: false, imageTimeout: 5000,
      backgroundColor: color === 'transparent' || color === 'rgba(0, 0, 0, 0)' ? '#fffaf0' : legacyColors(color),
      scale: 2,
      ignoreElements: function (el) {
        return el.matches('.result-share, button, a, input, textarea, select, iframe, video, audio, [data-share-private]');
      },
      onclone: function (doc, clone) {
        frame = doc.defaultView.frameElement;
        clone.style.setProperty('width', width + 'px', 'important');
        clone.style.setProperty('box-sizing', 'border-box', 'important');
        // Expand only the cloned settlement and its scrolling containers.
        var colors = ['color', 'background-color', 'background-image', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'box-shadow', 'text-shadow', 'fill', 'stroke', 'text-decoration-color'];
        var pseudoRules = [];
        [clone].concat(Array.from(clone.querySelectorAll('*'))).forEach(function (el, index) {
          var style = doc.defaultView.getComputedStyle(el);
          colors.forEach(function (name) {
            var value = style.getPropertyValue(name);
            var converted = legacyColors(value);
            if (value !== converted) el.style.setProperty(name, converted, 'important');
          });
          ['::before', '::after'].forEach(function (pseudo) {
            var computed = doc.defaultView.getComputedStyle(el, pseudo);
            if (computed.content === 'none' || computed.content === 'normal') return;
            var declarations = [];
            colors.forEach(function (name) {
              var value = computed.getPropertyValue(name);
              var converted = legacyColors(value);
              if (value !== converted) declarations.push(name + ':' + converted + '!important');
            });
            if (declarations.length) {
              el.setAttribute('data-result-capture', String(index));
              pseudoRules.push('[data-result-capture="' + index + '"]' + pseudo + '{' + declarations.join(';') + '}');
            }
          });
          if (el === clone || /auto|scroll|hidden/.test(style.overflowY) && el.scrollHeight > el.clientHeight) {
            el.style.setProperty('height', 'auto', 'important');
            el.style.setProperty('max-height', 'none', 'important');
            el.style.setProperty('overflow', 'visible', 'important');
            el.scrollTop = 0;
          }
          el.style.setProperty('animation', 'none', 'important');
          el.style.setProperty('transition', 'none', 'important');
        });
        var fixes = doc.createElement('style');
        fixes.textContent = pseudoRules.join('\n');
        doc.head.appendChild(fixes);
        var size = clone.getBoundingClientRect();
        if (size.height > 8192 || size.width * size.height > 3000000) throw new Error('Settlement too large');
      }
    });
    var canvas;
    try {
      canvas = await Promise.race([job, new Promise(function (_, reject) {
        timer = w.setTimeout(function () { reject(new Error('Capture timeout')); }, 25000);
      })]);
      return await new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('PNG unavailable')); }, 'image/png');
      });
    } finally {
      w.clearTimeout(timer);
      if (canvas) canvas.width = canvas.height = 0;
      if (frame) frame.remove();
    }
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius);
    else {
      var r = Math.min(radius, width / 2, height / 2);
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + width, y, x + width, y + height, r);
      ctx.arcTo(x + width, y + height, x, y + height, r);
      ctx.arcTo(x, y + height, x, y, r);
      ctx.arcTo(x, y, x + width, y, r);
      ctx.closePath();
    }
  }

  async function decorate(blob, root) {
    var image = await w.createImageBitmap(blob);
    var gameName = d.title.split(/[｜|—–]/)[0].trim() || d.title;
    var data = payload(root);
    var width = 1080;
    var inset = 72;
    var contentWidth = width - inset * 2;
    var imageScale = Math.min(1.5, contentWidth / image.width, 7440 / image.height);
    var imageWidth = Math.round(image.width * imageScale);
    var imageHeight = Math.round(image.height * imageScale);
    var top = 270;
    var bottom = 222;
    var height = top + imageHeight + bottom;
    if (height > 8192 || width * height > 12000000) {
      imageScale = Math.min(imageScale, 7600 / image.height, 11000000 / (width * image.height));
      imageWidth = Math.round(image.width * imageScale);
      imageHeight = Math.round(image.height * imageScale);
      height = top + imageHeight + bottom;
    }
    if (height > 8192 || width * height > 12000000) {
      image.close();
      throw new Error('Designed image exceeds size limit');
    }

    var canvas = d.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    var background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#f4efff');
    background.addColorStop(0.54, '#edf4ff');
    background.addColorStop(1, '#fff0e7');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#d8c9ff';
    ctx.beginPath(); ctx.arc(1000, 75, 145, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd3b7';
    ctx.beginPath(); ctx.arc(22, height - 68, 115, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#6558d8';
    roundedRect(ctx, inset, 58, 52, 52, 18); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 29px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✦', inset + 26, 94);
    ctx.textAlign = 'start';
    ctx.fillStyle = '#665c93';
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.fillText(messages().artLabel, inset + 70, 92);

    ctx.fillStyle = '#211c3a';
    ctx.font = '800 54px system-ui, -apple-system, sans-serif';
    var title = gameName;
    while (ctx.measureText(title).width > contentWidth && title.length > 8) title = title.slice(0, -2) + '…';
    ctx.fillText(title, inset, 182);
    ctx.fillStyle = '#8a829f';
    roundedRect(ctx, inset, 220, contentWidth, 3, 2); ctx.fill();

    var cardX = inset - 12;
    var cardY = top - 18;
    var cardW = width - cardX * 2;
    var cardH = imageHeight + 36;
    ctx.save();
    ctx.shadowColor = 'rgba(42, 35, 85, .13)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = '#ffffff';
    roundedRect(ctx, cardX, cardY, cardW, cardH, 28); ctx.fill();
    ctx.restore();
    roundedRect(ctx, cardX, cardY, cardW, cardH, 28);
    ctx.strokeStyle = 'rgba(91, 77, 161, .12)';
    ctx.lineWidth = 2; ctx.stroke();
    var imageX = Math.round((width - imageWidth) / 2);
    ctx.save();
    roundedRect(ctx, imageX, top, imageWidth, imageHeight, 16); ctx.clip();
    ctx.drawImage(image, imageX, top, imageWidth, imageHeight);
    ctx.restore();
    image.close();

    ctx.fillStyle = '#302a49';
    ctx.font = '700 27px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(messages().artFooter, width / 2, height - 116);
    ctx.fillStyle = '#5c54b5';
    roundedRect(ctx, inset, height - 88, contentWidth, 56, 20); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '600 20px system-ui, sans-serif';
    var link = data.url;
    while (ctx.measureText(link).width > contentWidth - 40 && link.length > 32) link = link.slice(0, -4) + '…';
    ctx.fillText(link, width / 2, height - 53);
    ctx.textAlign = 'start';

    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (result) {
        canvas.width = canvas.height = 0;
        result ? resolve(result) : reject(new Error('Designed PNG unavailable'));
      }, 'image/png');
    });
  }

  function messages() {
    var lang = (d.documentElement.lang || 'zh-TW').toLowerCase();
    return lang.indexOf('en') === 0 ? words.en : /hans|cn/.test(lang) ? words['zh-Hans'] : words['zh-TW'];
  }

  function content(root) {
    var lines = [];
    var walker = d.createTreeWalker(root, w.NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var parent = node.parentElement;
      if (!parent || parent.closest('.result-share, button, a, script, style, svg, [hidden], [aria-hidden="true"]')) continue;
      var style = w.getComputedStyle(parent);
      if (!parent.getClientRects().length || style.visibility === 'hidden' || style.display === 'none') continue;
      var text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    }
    return lines.join('\n');
  }

  function payload(root) {
    // Keep the actual deployment path, including a monorepo prefix. Drop invitations and credentials.
    var url = new URL(w.location.href);
    url.search = '';
    url.hash = '';
    url.username = url.password = '';
    var title = d.title;
    return { title: title.split(/[｜|—–]/)[0].trim() || title, url: url.href };
  }

  function element(tag, cls, text) {
    var el = d.createElement(tag);
    el.className = cls;
    if (text) el.textContent = text;
    return el;
  }

  function mount(root) {
    if (root.querySelector('.result-share')) return;
    var ui = element('div', 'result-share');
    var actions = element('div', 'result-share-actions');
    var trigger = element('button', 'result-share-trigger');
    trigger.type = 'button';
    var layer = element('div', 'result-share-dialog-layer');
    layer.hidden = true;
    var dialog = element('section', 'result-share-dialog');
    var dialogId = 'result-share-title-' + Math.random().toString(36).slice(2, 8);
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', dialogId);
    dialog.tabIndex = -1;
    var header = element('header', 'result-share-dialog-header');
    var title = element('h2', 'result-share-dialog-title');
    title.id = dialogId;
    var close = element('button', 'result-share-dialog-close');
    close.type = 'button';
    var status = element('p', 'result-share-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var image = element('img', 'result-share-image');
    image.hidden = true;
    var actionsInside = element('div', 'result-share-actions result-share-dialog-actions');
    var share = element('button', 'result-share-button result-share-image-send');
    var download = element('button', 'result-share-button result-share-image-download');
    share.type = download.type = 'button';
    share.disabled = download.disabled = true;
    header.append(title, close);
    actionsInside.append(share, download);
    dialog.append(header, status, image, actionsInside);
    layer.append(dialog);
    actions.append(trigger);
    ui.append(actions);
    root.appendChild(ui);

    var busy = false;
    var statusKey = '';
    var revision = 0;
    var lastResult = content(root);
    var file;
    var objectURL;

    function clearImage() {
      if (objectURL) w.URL.revokeObjectURL(objectURL);
      objectURL = file = null;
      image.removeAttribute('src');
      image.hidden = true;
      previews.delete(ui);
    }
    function closeDialog(restoreFocus) {
      if (layer.parentNode) layer.remove();
      layer.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      d.removeEventListener('keydown', trapFocus, true);
      openDialogs.delete(ui);
      if (restoreFocus !== false && trigger.isConnected) trigger.focus({ preventScroll: true });
    }
    ui._resultShareDispose = function () {
      revision++;
      busy = false;
      statusKey = '';
      closeDialog(false);
      clearImage();
    };

    function paint() {
      var m = messages();
      trigger.textContent = m.open;
      trigger.setAttribute('aria-expanded', String(!layer.hidden));
      title.textContent = m.dialogTitle;
      close.textContent = '×';
      close.setAttribute('aria-label', m.close);
      image.alt = m.imageAlt;
      share.textContent = m.imageShare;
      download.textContent = m.download;
      status.textContent = statusKey ? m[statusKey] : '';
      dialog.setAttribute('aria-busy', String(busy));
      trigger.disabled = busy;
      share.disabled = download.disabled = busy || !file;
    }
    function trapFocus(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog(true);
      } else if (event.key === 'Tab') {
        var controls = Array.from(dialog.querySelectorAll('button:not([disabled])'));
        if (!controls.length) { event.preventDefault(); dialog.focus(); return; }
        var first = controls[0];
        var last = controls[controls.length - 1];
        if (event.shiftKey && d.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && d.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    function report(key, operation) {
      if (!ui.isConnected || operation !== revision) return;
      statusKey = key;
      paint();
    }
    async function makeImage() {
      if (busy || file) return;
      lastResult = content(root);
      var operation = ++revision;
      busy = true;
      statusKey = 'generating';
      paint();
      try {
        var resultRoot = root.closest('[data-result-image]') || root;
        var original = await capture(resultRoot);
        var blob;
        try { blob = await decorate(original, root); }
        finally { original = null; }
        if (!ui.isConnected || operation !== revision) return;
        file = new w.File([blob], 'game-result-' + Date.now() + '.png', { type: 'image/png' });
        objectURL = w.URL.createObjectURL(blob);
        previews.add(ui);
        image.src = objectURL;
        image.hidden = false;
        report('ready', operation);
      } catch (_) { report('imageError', operation); }
      finally {
        if (operation === revision) { busy = false; if (ui.isConnected) paint(); }
      }
    }

    trigger.addEventListener('click', function (event) {
      event.stopPropagation();
      if (busy) return;
      layer.hidden = false;
      d.body.appendChild(layer);
      openDialogs.add(ui);
      trigger.setAttribute('aria-expanded', 'true');
      d.addEventListener('keydown', trapFocus, true);
      close.focus({ preventScroll: true });
      if (file) image.src = objectURL;
      else makeImage();
    });
    close.addEventListener('click', function (event) {
      event.stopPropagation();
      closeDialog(true);
    });
    layer.addEventListener('click', function (event) {
      if (event.target === layer) closeDialog(true);
    });
    share.addEventListener('click', async function (event) {
      event.stopPropagation();
      if (busy || !file) return;
      var operation = ++revision;
      busy = true;
      paint();
      try {
        if (!w.navigator.share || !w.navigator.canShare || !w.navigator.canShare({ files: [file] })) {
          report('imageUnsupported', operation);
          return;
        }
        await w.navigator.share({ files: [file] });
        report('shared', operation);
      } catch (error) {
        report(error && error.name === 'AbortError' ? 'cancelled' : 'imageUnsupported', operation);
      } finally {
        if (operation === revision) { busy = false; if (ui.isConnected) paint(); }
      }
    });
    download.addEventListener('click', function (event) {
      event.stopPropagation();
      if (busy || !file || !objectURL) return;
      var link = d.createElement('a');
      link.href = objectURL;
      link.download = file.name;
      d.body.appendChild(link);
      link.click();
      link.remove();
    });

    ui._resultSharePaint = paint;
    ui._resultShareReset = function () {
      var nextResult = content(root);
      if (nextResult === lastResult) return;
      lastResult = nextResult;
      revision++;
      busy = false;
      statusKey = '';
      closeDialog(false);
      clearImage();
      paint();
    };
    paint();
  }

  function scan(node) {
    if (!node || node.nodeType !== 1 || node.closest('.result-share')) return;
    var owner = node.closest(selector);
    if (owner) mount(owner);
    node.querySelectorAll(selector).forEach(mount);
  }

  function start() {
    if (!d.getElementById('result-share-style')) {
      var style = element('style', '');
      style.id = 'result-share-style';
      style.textContent = '.result-share{box-sizing:border-box;flex:0 0 100%;width:100%;min-width:0;margin:12px 0 4px;font:inherit;color:inherit;text-align:center}.result-share *{box-sizing:border-box}.result-share-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}.result-share button,.result-share-dialog-layer button:not(.tk){appearance:none;position:static;display:inline-flex;align-items:center;justify-content:center;min-height:48px;max-width:100%;padding:10px 16px;border:2px solid currentColor;border-radius:12px;background:var(--paper,#fffaf0);color:var(--ink,#28354b);font:inherit;font-weight:700;line-height:1.4;white-space:normal;overflow-wrap:anywhere;cursor:pointer;touch-action:manipulation;box-shadow:0 3px 0 #0002}.result-share button:hover,.result-share-dialog-layer button:not(.tk):hover{filter:brightness(.96)}.result-share button:active,.result-share-dialog-layer button:not(.tk):active{transform:translateY(1px)}.result-share button:focus-visible,.result-share-dialog-layer button:focus-visible{outline:3px solid #2575cf;outline-offset:3px}.result-share button:disabled,.result-share-dialog-layer button:disabled{opacity:.6;cursor:wait}.result-share-status{font-size:.9em;margin:6px 0;white-space:normal;overflow-wrap:anywhere}.result-share-status:empty{display:none}';
      d.head.appendChild(style);
      style.textContent += '.result-share-dialog-layer{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(29,24,48,.68);backdrop-filter:blur(8px)}.result-share-dialog-layer[hidden]{display:none!important}.result-share-dialog{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;width:min(620px,100%);max-height:min(92vh,920px);overflow:auto;padding:20px;border:1px solid #e4dff4;border-radius:24px;background:linear-gradient(155deg,#fff,#f6f4ff);box-shadow:0 26px 90px #17112870;color:#2d2745;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#a9a0d2 #eeeaf8}.result-share-dialog-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0 12px;border-bottom:1px solid #ebe7f6}.result-share-dialog-title{margin:0;font-size:1.25rem;line-height:1.3;font-weight:850;letter-spacing:.01em}.result-share-dialog-close:not(.tk){appearance:none;display:grid;place-items:center;flex:0 0 48px;width:48px;height:48px;border:1px solid #e3dff0;border-radius:16px;background:#f6f4fc;color:#514976;font:500 30px/1 system-ui;cursor:pointer}.result-share-dialog-close:not(.tk):hover{background:#ece8fa}.result-share-dialog .result-share-status:not(:empty){display:block;margin:0;padding:10px 14px;border:1px solid #e5e0f6;border-radius:14px;background:#f5f2ff;color:#514786;text-align:center;font-weight:650}.result-share-image{display:block;width:auto;height:auto;max-width:100%;max-height:58vh;object-fit:contain;margin:0 auto;border:1px solid #e4e0ef;border-radius:16px;background:#fff;box-shadow:0 10px 28px #30225f20}.result-share-dialog-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px}.result-share button.result-share-image-send,.result-share-dialog-layer button.result-share-image-send:not(.tk){background:linear-gradient(135deg,#6558d8,#8270e6)!important;border-color:#5146bc!important;color:#fff!important;box-shadow:0 4px 0 #413897,0 8px 18px #6558d838}.result-share button.result-share-image-download,.result-share-dialog-layer button.result-share-image-download:not(.tk){background:#fff!important;border-color:#cbc5e5!important;color:#453c70!important}.result-share button.result-share-image-send::before,.result-share-dialog-layer button.result-share-image-send:not(.tk)::before{content:\"↗\";margin-inline-end:8px;font-size:1.1em}.result-share button.result-share-image-download::before,.result-share-dialog-layer button.result-share-image-download:not(.tk)::before{content:\"↓\";margin-inline-end:8px;font-size:1.15em}.result-share button.result-share-trigger:not(.tk){min-width:160px;background:linear-gradient(135deg,#6558d8,#8b68dc)!important;border-color:#5146bc!important;color:#fff!important;font-weight:800!important;box-shadow:0 4px 0 #413897,0 8px 18px #6558d838}.result-share button.result-share-trigger::before{content:\"✦\";margin-inline-end:8px}.result-share-dialog button:focus-visible{outline:3px solid #897bdf;outline-offset:3px}.result-share-dialog::-webkit-scrollbar{width:10px}.result-share-dialog::-webkit-scrollbar-track{border-radius:8px;background:#eeeaf8}.result-share-dialog::-webkit-scrollbar-thumb{border:2px solid #eeeaf8;border-radius:8px;background:#a9a0d2}@media(max-width:520px){.result-share-dialog-layer{padding:10px}.result-share-dialog{gap:12px;padding:14px;border-radius:20px}.result-share-dialog-actions{gap:8px}.result-share-dialog-actions button{flex:1 1 145px}}';
    }
    scan(d.body);
    new w.MutationObserver(function (changes) {
      previews.forEach(function (ui) { if (!ui.isConnected) ui._resultShareDispose(); });
      openDialogs.forEach(function (ui) { if (!ui.isConnected) ui._resultShareDispose(); });
      changes.forEach(function (change) {
        var target = change.target.nodeType === 1 ? change.target : change.target.parentElement;
        if (target && target.closest('.result-share')) return;
        var owner = target && target.closest(selector);
        if (owner) {
          var existing = owner.querySelector('.result-share');
          if (existing) existing._resultShareReset();
          else mount(owner);
        }
        change.addedNodes.forEach(scan);
      });
    }).observe(d.body, { childList: true, characterData: true, subtree: true });
    new w.MutationObserver(function () {
      d.querySelectorAll('.result-share').forEach(function (ui) { ui._resultShareDispose(); ui._resultSharePaint(); });
    }).observe(d.documentElement, { attributes: true, attributeFilter: ['lang'] });
    w.addEventListener('pagehide', function () {
      previews.forEach(function (ui) { ui._resultShareDispose(); });
      openDialogs.forEach(function (ui) { ui._resultShareDispose(); });
    });
  }

  w.GameResultShare = { payload: payload, mount: mount };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);
