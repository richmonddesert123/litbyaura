const express = require('express');
const db = require('../db');
const config = require('../config');

const router = express.Router();

function xmlEscape(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function urlEntry(loc, { lastmod, changefreq, priority } = {}) {
  return `  <url>
    <loc>${xmlEscape(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>${changefreq || 'weekly'}</changefreq>
    <priority>${priority ?? '0.5'}</priority>
  </url>`;
}

/**
 * Generated fresh on every request (not cached to a file) so it's never
 * stale relative to what's actually in the products/taxonomy tables. For a
 * store this size, querying the DB per sitemap request is cheap - if the
 * catalog ever grows into the thousands of products, this would be worth
 * caching for a few minutes instead of regenerating on every hit.
 */
router.get('/sitemap.xml', (req, res) => {
  const base = config.baseUrl.replace(/\/$/, '');
  const entries = [];

  entries.push(urlEntry(`${base}/`, { changefreq: 'daily', priority: '1.0' }));
  entries.push(urlEntry(`${base}/shop.html?view=all`, { changefreq: 'daily', priority: '0.9' }));
  entries.push(urlEntry(`${base}/shop.html?view=new-arrivals`, { changefreq: 'daily', priority: '0.8' }));

  const bestSellerCount = db.prepare('SELECT COUNT(*) as n FROM products WHERE is_active = 1 AND is_best_seller = 1').get().n;
  if (bestSellerCount > 0) {
    entries.push(urlEntry(`${base}/shop.html?view=best-sellers`, { changefreq: 'daily', priority: '0.8' }));
  }

  // Only concerns/skin types/brands actually in use get a real, linkable
  // page - matches what the nav itself shows (see renderShopNav in main.js).
  const concerns = db.prepare(`
    SELECT DISTINCT c.slug FROM concerns c
    JOIN product_concerns pc ON pc.concern_id = c.id
    JOIN products p ON p.id = pc.product_id WHERE p.is_active = 1
  `).all();
  concerns.forEach((c) => entries.push(urlEntry(`${base}/shop.html?view=concern&slug=${encodeURIComponent(c.slug)}`, { changefreq: 'weekly', priority: '0.6' })));

  const skinTypes = db.prepare(`
    SELECT DISTINCT s.slug FROM skin_types s
    JOIN product_skin_types ps ON ps.skin_type_id = s.id
    JOIN products p ON p.id = ps.product_id WHERE p.is_active = 1
  `).all();
  skinTypes.forEach((s) => entries.push(urlEntry(`${base}/shop.html?view=skin-type&slug=${encodeURIComponent(s.slug)}`, { changefreq: 'weekly', priority: '0.6' })));

  const brands = db.prepare(`SELECT DISTINCT brand FROM products WHERE is_active = 1 AND brand != ''`).all();
  brands.forEach((b) => entries.push(urlEntry(`${base}/shop.html?view=brand&name=${encodeURIComponent(b.brand)}`, { changefreq: 'weekly', priority: '0.6' })));

  const products = db.prepare(`SELECT slug, created_at FROM products WHERE is_active = 1`).all();
  products.forEach((p) => {
    entries.push(urlEntry(`${base}/product.html?slug=${encodeURIComponent(p.slug)}`, {
      lastmod: p.created_at.slice(0, 10), // 'YYYY-MM-DD HH:MM:SS' -> 'YYYY-MM-DD', valid W3C date
      changefreq: 'weekly',
      priority: '0.8',
    }));
  });

  ['contact', 'privacy', 'returns', 'shipping', 'terms'].forEach((page) => {
    entries.push(urlEntry(`${base}/pages/${page}.html`, { changefreq: 'monthly', priority: '0.3' }));
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`;

  res.type('application/xml').send(xml);
});

router.get('/robots.txt', (req, res) => {
  const base = config.baseUrl.replace(/\/$/, '');
  res.type('text/plain').send(
    `User-agent: *\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`
  );
});

module.exports = router;
