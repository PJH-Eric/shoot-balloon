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
      scale: Math.min(2, w.devicePixelRatio || 1),
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
    return { title: title, text: title + '\n' + content(root).slice(0, 4000), url: url.href };
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
    var share = element('button', 'result-share-button');
    var prepare = element('button', 'result-share-image-prepare');
    var preview = element('button', 'result-share-preview');
    share.type = preview.type = prepare.type = 'button';
    var status = element('p', 'result-share-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var panel = element('div', 'result-share-panel');
    panel.hidden = true;
    var text = element('p', 'result-share-text');
    text.tabIndex = 0;
    var copy = element('button', 'result-share-button');
    copy.type = 'button';
    panel.append(text, copy);
    var imagePanel = element('div', 'result-share-panel result-share-image-panel');
    imagePanel.hidden = true;
    var image = element('img', 'result-share-image');
    var imageActions = element('div', 'result-share-actions');
    var sendImage = element('button', 'result-share-image-send');
    var download = element('button', 'result-share-image-download');
    sendImage.type = download.type = 'button';
    imageActions.append(sendImage, download);
    imagePanel.append(image, imageActions);
    actions.append(prepare, share, preview);
    ui.append(actions, status, imagePanel, panel);
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
      imagePanel.hidden = true;
      previews.delete(ui);
    }
    ui._resultShareDispose = function () { revision++; busy = false; statusKey = ''; clearImage(); };

    function currentText() {
      var data = payload(root);
      return data.text + '\n' + data.url;
    }

    function paint() {
      var m = messages();
      share.textContent = busy ? m.busy : m.share;
      prepare.textContent = busy ? m.busy : m.image;
      sendImage.textContent = m.imageShare;
      download.textContent = m.download;
      image.alt = m.imageAlt;
      preview.textContent = m.preview;
      preview.setAttribute('aria-expanded', String(!panel.hidden));
      copy.textContent = m.copy;
      text.setAttribute('aria-label', m.label);
      status.textContent = statusKey ? m[statusKey] : '';
      share.disabled = copy.disabled = prepare.disabled = busy;
      sendImage.disabled = download.disabled = busy || !file;
      if (!panel.hidden) {
        var value = currentText();
        if (text.textContent !== value) text.textContent = value;
      }
    }

    prepare.addEventListener('click', async function (event) {
      event.stopPropagation();
      if (busy) return;
      if (file) { imagePanel.hidden = !imagePanel.hidden; return; }
      lastResult = content(root);
      var operation = ++revision;
      busy = true;
      statusKey = 'generating';
      paint();
      try {
        var blob = await capture(root.closest('[data-result-image]') || root);
        if (!ui.isConnected || operation !== revision) return;
        file = new w.File([blob], 'game-result-' + Date.now() + '.png', { type: 'image/png' });
        objectURL = w.URL.createObjectURL(blob);
        previews.add(ui);
        image.src = objectURL;
        imagePanel.hidden = false;
        report('ready', operation);
      } catch (_) { report('imageError', operation); }
      finally {
        if (operation === revision) { busy = false; if (ui.isConnected) paint(); }
      }
    });
    sendImage.addEventListener('click', async function (event) {
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
        var data = payload(root);
        data.files = [file];
        // PNG preparation is complete before this click, preserving user activation.
        await w.navigator.share(data);
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

    function report(key, operation) {
      if (!ui.isConnected || operation !== revision) return;
      statusKey = key;
      paint();
    }

    async function copyText(value, operation) {
      try {
        if (!w.navigator.clipboard || !w.navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
        await w.navigator.clipboard.writeText(value);
        report('copied', operation);
      } catch (_) {
        if (!ui.isConnected || operation !== revision) return;
        panel.hidden = false;
        report('manual', operation);
        text.focus({ preventScroll: true });
        var range = d.createRange();
        range.selectNodeContents(text);
        var selection = w.getSelection();
        if (selection) { selection.removeAllRanges(); selection.addRange(range); }
      }
    }

    share.addEventListener('click', async function (event) {
      event.stopPropagation();
      if (busy) return;
      lastResult = content(root);
      var data = payload(root);
      var operation = ++revision;
      busy = true;
      statusKey = '';
      paint();
      try {
        if (typeof w.navigator.share === 'function') {
          try {
            // Call within the user's click activation; do not await preparatory work.
            await w.navigator.share(data);
            report('shared', operation);
          } catch (error) {
            if (error && error.name === 'AbortError') report('cancelled', operation);
            else if (operation === revision) await copyText(data.text + '\n' + data.url, operation);
          }
        } else await copyText(data.text + '\n' + data.url, operation);
      } finally {
        if (operation === revision) {
          busy = false;
          if (ui.isConnected) paint();
        }
      }
    });
    preview.addEventListener('click', function (event) {
      event.stopPropagation();
      lastResult = content(root);
      panel.hidden = !panel.hidden;
      paint();
    });
    copy.addEventListener('click', async function (event) {
      event.stopPropagation();
      if (busy) return;
      lastResult = content(root);
      var operation = ++revision;
      busy = true;
      paint();
      await copyText(currentText(), operation);
      if (operation === revision) {
        busy = false;
        if (ui.isConnected) paint();
      }
    });
    // Language changes are global; retain no listeners for removed settlements.
    ui._resultSharePaint = paint;
    ui._resultShareReset = function () {
      var nextResult = content(root);
      if (nextResult === lastResult) return;
      lastResult = nextResult;
      revision++;
      busy = false;
      statusKey = '';
      panel.hidden = true;
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
      style.textContent = '.result-share{box-sizing:border-box;flex:0 0 100%;width:100%;min-width:0;margin:12px 0 4px;font:inherit;color:inherit;text-align:center}.result-share *{box-sizing:border-box}.result-share-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}.result-share button{appearance:none;position:static;display:inline-flex;align-items:center;justify-content:center;min-height:48px;max-width:100%;padding:10px 16px;border:2px solid currentColor;border-radius:12px;background:var(--paper,#fffaf0);color:var(--ink,#28354b);font:inherit;font-weight:700;line-height:1.4;white-space:normal;overflow-wrap:anywhere;cursor:pointer;touch-action:manipulation;box-shadow:0 3px 0 #0002}.result-share button:hover{filter:brightness(.96)}.result-share button:active{transform:translateY(1px)}.result-share button:focus-visible,.result-share-text:focus-visible{outline:3px solid #2575cf;outline-offset:3px}.result-share button:disabled{opacity:.6;cursor:wait}.result-share-status{font-size:.9em;margin:6px 0;white-space:normal;overflow-wrap:anywhere}.result-share-status:empty{display:none}.result-share-panel{margin-top:10px;padding:12px;border:1px solid currentColor;border-radius:10px;min-width:0}.result-share-panel[hidden]{display:none!important}.result-share-text{white-space:pre-wrap;overflow-wrap:anywhere;text-align:start;user-select:text;-webkit-user-select:text;font:inherit;line-height:1.5;margin:0 0 10px}.result-share-preview{font-size:.9em!important}';
      d.head.appendChild(style);
      style.textContent += '.result-share-image{display:block;max-width:100%;max-height:50vh;width:auto;height:auto;object-fit:contain;margin:0 auto 12px}.result-share-image-prepare{font-weight:800!important}';
    }
    scan(d.body);
    new w.MutationObserver(function (changes) {
      previews.forEach(function (ui) { if (!ui.isConnected) ui._resultShareDispose(); });
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
    });
  }

  w.GameResultShare = { payload: payload, mount: mount };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);
