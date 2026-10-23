'use strict';

const fs = require('fs');
const path = require('path');
const MARK = '<!--SEO:HEAD-->';
const END = '<!--SEO:END-->';
const GAMEPLAY_MARK = '<!--SEO:GAMEPLAY-->';
const GAMEPLAY_END = '<!--SEO:GAMEPLAY:END-->';
const GAMEPLAY_LOCALES = {
  'zh-Hant': { mode: '玩法模式', controls: '操作方式', separator: '、' },
  'zh-Hans': { mode: '玩法模式', controls: '操作方式', separator: '、' },
  en: { mode: 'Game modes', controls: 'How to play', separator: ', ' }
};
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

function validateGameplay(gameplay) {
  for (const locale of Object.keys(GAMEPLAY_LOCALES)) {
    const entry = gameplay && gameplay[locale];
    const hasTextFields = entry && ['name', 'summary', 'controls']
      .every(key => typeof entry[key] === 'string' && entry[key].trim());
    const hasValidModes = entry && Array.isArray(entry.modes) && entry.modes.length &&
      entry.modes.every(mode => typeof mode === 'string' && mode.trim());
    if (!hasTextFields || !hasValidModes) {
      throw new Error('seo.gameplay.json 缺少完整語系或玩法欄位：' + locale);
    }
  }
}

function renderGameplay(gameplay) {
  validateGameplay(gameplay);
  const sections = Object.entries(GAMEPLAY_LOCALES).map(([locale, labels]) => {
    const entry = gameplay[locale];
    const punctuation = locale === 'en' ? ': ' : '：';
    return [
      '<section lang="' + locale + '">',
      '<h2>' + esc(entry.name) + '</h2>',
      '<p>' + esc(entry.summary) + '</p>',
      '<p><strong>' + labels.mode + punctuation + '</strong>' + entry.modes.map(esc).join(labels.separator) + '</p>',
      '<p><strong>' + labels.controls + punctuation + '</strong>' + esc(entry.controls) + '</p>',
      '</section>'
    ].join('\n');
  });
  return [GAMEPLAY_MARK, '<noscript><div class="seo-gameplay">' + sections.join('\n') + '</div></noscript>', GAMEPLAY_END].join('\n');
}

function inject(root, env = process.env) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'seo.config.json'), 'utf8'));
  const gameplay = JSON.parse(fs.readFileSync(path.join(root, 'seo.gameplay.json'), 'utf8'));
  const gaId = env.GA_MEASUREMENT_ID || 'G-PG79WZK8QY';
  validate(cfg, gaId);
  validateGameplay(gameplay);
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
    image: cfg.ogImage || undefined, thumbnailUrl: cfg.iconUrl || undefined,
    isPartOf: { '@type': 'WebSite', url: cfg.lobbyUrl }
  };
  const head = [
    MARK,
    // 共用 analytics.js 負責正式環境限制、URL 清理與單次初始化。
    '<script>window.GAME_ANALYTICS_CONFIG=' + safeJson({
      measurement_id: gaId, game_id: cfg.id, page_location: cfg.siteUrl
    }) + ';</script>',
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
    cfg.ogImage && '<meta property="og:image:type" content="image/png">',
    cfg.ogImage && '<meta property="og:image:width" content="1200">',
    cfg.ogImage && '<meta property="og:image:height" content="630">',
    cfg.ogImage && '<meta property="og:image:alt" content="' + esc(cfg.ogImageAlt || cfg.title) + '">',
    '<meta name="twitter:card" content="' + (cfg.ogImage ? 'summary_large_image' : 'summary') + '">',
    '<meta name="twitter:title" content="' + esc(cfg.title) + '">',
    '<meta name="twitter:description" content="' + esc(cfg.description) + '">',
    cfg.ogImage && '<meta name="twitter:image" content="' + esc(cfg.ogImage) + '">',
    cfg.ogImage && '<meta name="twitter:image:alt" content="' + esc(cfg.ogImageAlt || cfg.title) + '">',
    '<script type="application/ld+json">' + safeJson(jsonLd) + '</script>', END
  ].filter(Boolean).join('\n');
  html = html.replace(MARK, () => head);
  html = html.replace(/\r?\n?<!--SEO:GAMEPLAY-->[\s\S]*?<!--SEO:GAMEPLAY:END-->\r?\n?/g, '\n');
  if (!/<\/body>/i.test(html)) throw new Error('index.html 缺少 </body>');
  html = html.replace(/(?:\r?\n)*<\/body>/i, '\n' + renderGameplay(gameplay) + '\n</body>');
  fs.writeFileSync(indexPath, html, 'utf8');
  fs.writeFileSync(path.join(root, 'public', 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    '  <url><loc>' + esc(cfg.siteUrl) + '</loc></url>\n</urlset>\n', 'utf8');
  fs.writeFileSync(path.join(root, 'public', 'robots.txt'),
    'User-agent: *\nAllow: /\n\nSitemap: ' + esc(cfg.siteUrl) + 'sitemap.xml\n', 'utf8');
  return cfg;
}

module.exports = { inject, renderGameplay, validate, validateGameplay };
if (require.main === module) {
  try { console.log('✓ SEO 與 GA4 已注入：' + inject(path.join(__dirname, '..')).id); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
