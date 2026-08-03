const express = require('express');
const db = require('../db');

const router = express.Router();

const ALL_PAGE_SIZE = 25;
const NEW_ARRIVALS_LIMIT = 20;

function attachTaxonomy(product) {
  const images = db.prepare('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order').all(product.id).map((r) => r.url);
  const concerns = db
    .prepare(`SELECT c.id, c.slug, c.name FROM concerns c JOIN product_concerns pc ON pc.concern_id = c.id WHERE pc.product_id = ?`)
    .all(product.id);
  const skinTypes = db
    .prepare(`SELECT s.id, s.slug, s.name FROM skin_types s JOIN product_skin_types ps ON ps.skin_type_id = s.id WHERE ps.product_id = ?`)
    .all(product.id);
  return {
    ...product,
    images: images.length ? images : [product.image_url],
    concerns,
    skinTypes,
    isBestSeller: !!product.is_best_seller,
  };
}

/**
 * Public product listing, used by every nav view EXCEPT "All" (which has
 * its own paginated endpoint below since it needs 25/page + prev/next).
 * Every filter is optional and combinable:
 *   ?concern=<slug>        Shop by Concern
 *   ?skinType=<slug>       Shop by Skin Type
 *   ?brand=<name>          Brands (exact match)
 *   ?bestSeller=1          Best Sellers
 *   ?newArrivals=1         most recent 20 (New Arrivals) - ignores other filters
 *   ?minPrice=/?maxPrice=  price range (pesewas), combinable with any of the above
 * No filters at all -> every active product (used by cart/checkout to
 * resolve product IDs, and as a raw list elsewhere) - NOT paginated.
 */
router.get('/api/products', (req, res) => {
  const { concern, skinType, brand } = req.query;
  const bestSeller = req.query.bestSeller === '1' || req.query.bestSeller === 'true';
  const newArrivals = req.query.newArrivals === '1' || req.query.newArrivals === 'true';
  const minPrice = req.query.minPrice !== undefined ? parseInt(req.query.minPrice, 10) : null;
  const maxPrice = req.query.maxPrice !== undefined ? parseInt(req.query.maxPrice, 10) : null;

  const conditions = ['p.is_active = 1'];
  const params = [];
  let baseQuery = 'SELECT DISTINCT p.* FROM products p';

  if (concern) {
    baseQuery += ' JOIN product_concerns pcn ON pcn.product_id = p.id JOIN concerns cn ON cn.id = pcn.concern_id';
    conditions.push('cn.slug = ?');
    params.push(concern);
  }
  if (skinType) {
    baseQuery += ' JOIN product_skin_types pst ON pst.product_id = p.id JOIN skin_types st ON st.id = pst.skin_type_id';
    conditions.push('st.slug = ?');
    params.push(skinType);
  }
  if (brand) {
    conditions.push('p.brand = ?');
    params.push(brand);
  }
  if (bestSeller) {
    conditions.push('p.is_best_seller = 1');
  }
  if (Number.isFinite(minPrice)) {
    conditions.push('p.price_pesewas >= ?');
    params.push(minPrice);
  }
  if (Number.isFinite(maxPrice)) {
    conditions.push('p.price_pesewas <= ?');
    params.push(maxPrice);
  }

  let sql = `${baseQuery} WHERE ${conditions.join(' AND ')} ORDER BY p.created_at DESC`;
  if (newArrivals) sql += ` LIMIT ${NEW_ARRIVALS_LIMIT}`;

  const products = db.prepare(sql).all(...params);
  res.json(products.map(attachTaxonomy));
});

// "All" gets its own endpoint: 25/page, prev/next only (no numbered pages
// per spec), separate from the general endpoint above so every other view
// stays a plain unpaginated array.
router.get('/api/products/all', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * ALL_PAGE_SIZE;

  const total = db.prepare('SELECT COUNT(*) as n FROM products WHERE is_active = 1').get().n;
  const totalPages = Math.max(1, Math.ceil(total / ALL_PAGE_SIZE));
  const products = db
    .prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(ALL_PAGE_SIZE, offset);

  res.json({
    products: products.map(attachTaxonomy),
    page,
    perPage: ALL_PAGE_SIZE,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  });
});

router.get('/api/products/:slug', (req, res) => {
  const product = db
    .prepare('SELECT * FROM products WHERE slug = ? AND is_active = 1')
    .get(req.params.slug);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(attachTaxonomy(product));
});

// By default, only returns concerns/skin types with at least one active
// product tagged - so the public nav dropdown can hide entries nobody's
// shopping by yet. Admin's product form needs the FULL fixed list (to
// assign a concern to a product for the first time), so it passes ?all=1.
router.get('/api/concerns', (req, res) => {
  if (req.query.all === '1') {
    return res.json(db.prepare('SELECT * FROM concerns ORDER BY id').all());
  }
  const rows = db
    .prepare(`
      SELECT DISTINCT c.* FROM concerns c
      JOIN product_concerns pc ON pc.concern_id = c.id
      JOIN products p ON p.id = pc.product_id
      WHERE p.is_active = 1
      ORDER BY c.id
    `)
    .all();
  res.json(rows);
});

router.get('/api/skin-types', (req, res) => {
  if (req.query.all === '1') {
    return res.json(db.prepare('SELECT * FROM skin_types ORDER BY id').all());
  }
  const rows = db
    .prepare(`
      SELECT DISTINCT s.* FROM skin_types s
      JOIN product_skin_types ps ON ps.skin_type_id = s.id
      JOIN products p ON p.id = ps.product_id
      WHERE p.is_active = 1
      ORDER BY s.id
    `)
    .all();
  res.json(rows);
});

// Only brands actually in use by an active product - so the nav can hide
// itself (or individual entries) when nothing is tagged with them yet.
router.get('/api/brands', (req, res) => {
  const rows = db
    .prepare(`SELECT DISTINCT brand FROM products WHERE is_active = 1 AND brand != '' ORDER BY brand COLLATE NOCASE`)
    .all();
  res.json(rows.map((r) => r.brand));
});

// Trust-bar marquee messages, admin-editable via /api/admin/announcements -
// no code changes needed to update these in production.
router.get('/api/announcements', (req, res) => {
  res.json(db.prepare('SELECT id, text FROM announcements WHERE is_active = 1 ORDER BY sort_order').all());
});

// Homepage hero slideshow images, admin-editable via /api/admin/hero-slides.
router.get('/api/hero-slides', (req, res) => {
  res.json(db.prepare('SELECT id, image_url, caption FROM hero_slides WHERE is_active = 1 ORDER BY sort_order').all());
});

// Static site banner (single message, not the scrolling marquee) - returns
// null if turned off or never configured, so the frontend can just hide it.
router.get('/api/site-banner', (req, res) => {
  const banner = db.prepare('SELECT message, link_url, is_active FROM site_banner WHERE id = 1').get();
  if (!banner || !banner.is_active || !banner.message) return res.json(null);
  res.json({ message: banner.message, linkUrl: banner.link_url });
});

module.exports = router;
