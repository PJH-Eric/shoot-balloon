'use strict';

const fs = require('fs');
const path = require('path');
const MARK = '<!--SEO:HEAD-->';
const END = '<!--SEO:END-->';
const esc = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');

function validate(cfg, gaId) {
  for (const key of ['id', 'siteUrl', 'title', 'description', 'lobbyUrl', 'genre', 'players']) {
    if (typeof cfg[key] !== 'string' || !cfg[key].trim()) throw new Error('seo.config.json 缺少欄位：' + key);
  }
  if (!/^[a-z0-9-]+$/.test(cfg.id) || cfg.siteUrl !== 'https://pjh-eric.github.io/' + cfg.id + '/') {
    throw new Error('siteUrl 必須是遊戲自己的 HTTPS 網址，並以 / 結尾');
  }
  if (cfg.lobbyUrl !== 'https://pjh-eric.github.io/game-lobby/') throw new Error('lobbyUrl 格式錯誤');
  if (cfg.title.length > 40 || cfg.description.length < 40 || cfg.description.length > 120) throw new Error('SEO 文案長度錯誤');
  if (!/^G-[A-Z0-9]+$/.test(gaId)) throw new Error('GA_MEASUREMENT_ID 格式錯誤');
  if (cfg.ogImage && !/^https:\/\//.test(cfg.ogImage)) throw new Error('ogImage 必須是 HTTPS 網址');
}

function inject(root, env = process.env) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'seo.config.json'), 'utf8'));
  const gaId = env.GA_MEASUREMENT_ID || 'G-PG79WZK8QY';
  validate(cfg, gaId);
  const indexPath = path.join(root, 'public', 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  if (html.split(MARK).length !== 2) throw new Error('index.html 必須有一個 ' + MARK);
  if (!/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) throw new Error('index.html 缺少 title');
  const descriptionTag = html.match(/<meta\b(?=[^>]*\bname=["']description["'])[^>]*>/i);
  const descriptionKey = descriptionTag && descriptionTag[0].match(/data-i18n-content="([^"]+)"/);
  // 保留界線，重複建置不會累積標籤。所有檢查完成才寫入產物。
  html = html.replace(/<!--SEO:HEAD-->[\s\S]*?<!--SEO:END-->/, MARK)
    .replace(/<meta\b(?=[^>]*\bname=["']description["'])[^>]*>\s*/gi, '')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, () => '<title>' + esc(cfg.title) + '</title>');
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'WebApplication',
    name: cfg.title.split('｜')[0], url: cfg.siteUrl, description: cfg.description,
    applicationCategory: 'GameApplication', operatingSystem: 'Any', inLanguage: 'zh-Hant',
    genre: cfg.genre, offers: { '@type': 'Offer', price: '0', priceCurrency: 'TWD' },
    isPartOf: { '@type': 'WebSite', url: cfg.lobbyUrl }
  };
  const head = [
    MARK,
    // 即使誤把部署產物在本機開啟，也不載入 GA 或傳送資料；不送邀請 query/hash。
    '<script>(function(){if(location.hostname!=="pjh-eric.github.io")return;' +
      'window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments)};' +
      'gtag("js",new Date());gtag("config",' + safeJson(gaId) + ',{game_id:' + safeJson(cfg.id) +
      ',page_location:' + safeJson(cfg.siteUrl) + '});' +
      'var s=document.createElement("script");s.async=true;s.src="https://www.googletagmanager.com/gtag/js?id=' + gaId + '";document.head.appendChild(s);})();</script>',
    cfg.googleSiteVerification && '<meta name="google-site-verification" content="' + esc(cfg.googleSiteVerification) + '">',
    '<meta name="description" data-i18n-content="' + esc(descriptionKey ? descriptionKey[1] : 'meta.desc') + '" content="' + esc(cfg.description) + '">',
    '<link rel="canonical" href="' + esc(cfg.siteUrl) + '">',
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="zh_TW">',
    '<meta property="og:title" content="' + esc(cfg.title) + '">',
    '<meta property="og:description" content="' + esc(cfg.description) + '">',
    '<meta property="og:url" content="' + esc(cfg.siteUrl) + '">',
    cfg.ogImage && '<meta property="og:image" content="' + esc(cfg.ogImage) + '">',
    '<meta name="twitter:card" content="' + (cfg.ogImage ? 'summary_large_image' : 'summary') + '">',
    '<meta name="twitter:title" content="' + esc(cfg.title) + '">',
    '<meta name="twitter:description" content="' + esc(cfg.description) + '">',
    cfg.ogImage && '<meta name="twitter:image" content="' + esc(cfg.ogImage) + '">',
    '<script type="application/ld+json">' + safeJson(jsonLd) + '</script>', END
  ].filter(Boolean).join('\n');
  html = html.replace(MARK, () => head);
  fs.writeFileSync(indexPath, html, 'utf8');
  fs.writeFileSync(path.join(root, 'public', 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    '  <url><loc>' + esc(cfg.siteUrl) + '</loc></url>\n</urlset>\n', 'utf8');
  return cfg;
}

module.exports = { inject, validate };
if (require.main === module) {
  try { console.log('✓ SEO 與 GA4 已注入：' + inject(path.join(__dirname, '..')).id); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
