const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { requireAdmin } = require('../middleware/auth');
const { restoreStockIfNeeded, sendOrderStatusEmail } = require('./orders');
const emailProvider = require('../email');

const router = express.Router();
const MIN_PASSWORD_LENGTH = 6;

// ---- First-run setup ----
// There is still no route that lets an already-running store grant itself a
// NEW admin - this only ever works while the admins table is empty, which
// means it's equivalent to the old "npm run seed" bootstrap, just reachable
// from the UI instead of the CLI. Once one admin exists, this 404s forever.
router.get('/api/admin/setup-status', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as n FROM admins').get().n;
  res.json({ hasAdmin: count > 0 });
});

router.post('/api/admin/setup', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as n FROM admins').get().n;
  if (count > 0) return res.status(403).json({ error: 'An admin account already exists' });

  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  const hash = bcrypt.hashSync(password, 12);
  const info = db.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)').run(email.toLowerCase(), hash);
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(info.lastInsertRowid);
  issueAdminSession(res, admin);
  res.status(201).json({ email: admin.email });
});

function issueAdminSession(res, admin) {
  const token = jwt.sign({ role: 'admin', adminId: admin.id, email: admin.email }, config.jwtSecret, {
    expiresIn: '12h',
  });
  res.cookie('admin_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

// ---- Auth ----
router.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get((email || '').toLowerCase());
  if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  issueAdminSession(res, admin);
  res.json({ ok: true });
});

router.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ ok: true });
});

// ---- Password reset (forgot password, via emailed single-use token) ----
router.post('/api/admin/password-reset/request', (req, res) => {
  const { email } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  // Always respond the same way whether or not the email exists, to avoid
  // leaking which emails have admin accounts.
  if (admin) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    db.prepare(
      'INSERT INTO password_reset_tokens (admin_id, token_hash, expires_at) VALUES (?, ?, ?)'
    ).run(admin.id, tokenHash, expiresAt);

    const resetLink = `${config.baseUrl}/reset-password.html?type=admin&token=${rawToken}`;
    emailProvider
      .send({
        to: admin.email,
        subject: 'Reset your LitByAura admin password',
        text: `Click the link below to reset your admin password. This link expires in 1 hour and can only be used once.\n\n${resetLink}`,
      })
      .catch((e) => console.error('Admin password reset email failed:', e.message));
  }
  res.json({ ok: true, message: 'If that account exists, a reset link has been sent.' });
});

router.post('/api/admin/password-reset/confirm', (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Invalid token, or password shorter than ${MIN_PASSWORD_LENGTH} characters` });
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ?').get(tokenHash);

  if (!row || row.used || new Date(row.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Reset link is invalid or has expired' });
  }

  const tx = db.transaction(() => {
    const hash = bcrypt.hashSync(newPassword, 12);
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, row.admin_id);
    db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(row.id); // single-use
  });
  tx();

  res.json({ ok: true });
});

// ---- Everything below requires an authenticated admin ----
router.use('/api/admin', requireAdmin);

router.get('/api/admin/me', (req, res) => res.json({ email: req.admin.email }));

// Change password while logged in (distinct from the emailed-token reset flow above).
router.post('/api/admin/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.adminId);
  if (!admin || !bcrypt.compareSync(currentPassword || '', admin.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, admin.id);
  res.json({ ok: true });
});

// ---- Products ----
// Includes every field the store owner actually edits day to day: name,
// description, price, compare-at, stock, active, brand, best-seller flag,
// concerns + skin types (fixed multi-select taxonomy), and multiple image
// "angles". There is no admin CRUD for concerns/skin types themselves -
// those are a fixed list seeded in server/db.js; only their per-product
// assignment is editable here.
router.get('/api/admin/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  const imagesStmt = db.prepare('SELECT id, url FROM product_images WHERE product_id = ? ORDER BY sort_order');
  const concernsStmt = db.prepare('SELECT concern_id FROM product_concerns WHERE product_id = ?');
  const skinTypesStmt = db.prepare('SELECT skin_type_id FROM product_skin_types WHERE product_id = ?');
  res.json(
    products.map((p) => ({
      ...p,
      images: imagesStmt.all(p.id),
      concernIds: concernsStmt.all(p.id).map((c) => c.concern_id),
      skinTypeIds: skinTypesStmt.all(p.id).map((s) => s.skin_type_id),
    }))
  );
});

function saveProductTaxonomyAndImages(productId, { concernIds, skinTypeIds, images }) {
  const tx = db.transaction(() => {
    if (Array.isArray(concernIds)) {
      db.prepare('DELETE FROM product_concerns WHERE product_id = ?').run(productId);
      const link = db.prepare('INSERT OR IGNORE INTO product_concerns (product_id, concern_id) VALUES (?, ?)');
      concernIds.forEach((id) => link.run(productId, id));
    }
    if (Array.isArray(skinTypeIds)) {
      db.prepare('DELETE FROM product_skin_types WHERE product_id = ?').run(productId);
      const link = db.prepare('INSERT OR IGNORE INTO product_skin_types (product_id, skin_type_id) VALUES (?, ?)');
      skinTypeIds.forEach((id) => link.run(productId, id));
    }
    if (Array.isArray(images)) {
      db.prepare('DELETE FROM product_images WHERE product_id = ?').run(productId);
      const insertImg = db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)');
      images.filter((url) => url && url.trim()).forEach((url, i) => insertImg.run(productId, url.trim(), i));
      // Keep the classic single image_url in sync as the cover/fallback image.
      if (images[0]) db.prepare('UPDATE products SET image_url = ? WHERE id = ?').run(images[0], productId);
    }
  });
  tx();
}

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Appends -2, -3, etc. until the slug is unique - the admin never has to think about this. */
function uniqueSlugFromName(name) {
  const base = slugify(name) || 'product';
  let candidate = base;
  let n = 2;
  while (db.prepare('SELECT id FROM products WHERE slug = ?').get(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

router.post('/api/admin/products', (req, res) => {
  const { name, description, pricePesewas, compareAtPesewas, stock, brand, isBestSeller, concernIds, skinTypeIds, images } = req.body;
  if (!name || !pricePesewas) {
    return res.status(400).json({ error: 'name and pricePesewas are required' });
  }
  try {
    const slug = uniqueSlugFromName(name);
    const firstImage = Array.isArray(images) && images[0] ? images[0] : '/images/placeholder.png';
    const info = db
      .prepare(`
        INSERT INTO products (slug, name, description, price_pesewas, compare_at_pesewas, image_url, stock, brand, is_best_seller)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(slug, name, description || '', pricePesewas, compareAtPesewas || null, firstImage, stock || 0, brand || '', isBestSeller ? 1 : 0);
    saveProductTaxonomyAndImages(info.lastInsertRowid, { concernIds, skinTypeIds, images: images && images.length ? images : [firstImage] });
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(product);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/api/admin/products/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const { name, description, pricePesewas, compareAtPesewas, stock, isActive, brand, isBestSeller, concernIds, skinTypeIds, images } = req.body;
  db.prepare(`
    UPDATE products SET
      name = ?, description = ?, price_pesewas = ?, compare_at_pesewas = ?,
      stock = ?, is_active = ?, brand = ?, is_best_seller = ?
    WHERE id = ?
  `).run(
    name ?? existing.name,
    description ?? existing.description,
    pricePesewas ?? existing.price_pesewas,
    compareAtPesewas ?? existing.compare_at_pesewas,
    stock ?? existing.stock,
    isActive === undefined ? existing.is_active : (isActive ? 1 : 0),
    brand ?? existing.brand,
    isBestSeller === undefined ? existing.is_best_seller : (isBestSeller ? 1 : 0),
    req.params.id
  );
  if (concernIds !== undefined || skinTypeIds !== undefined || images !== undefined) {
    saveProductTaxonomyAndImages(req.params.id, { concernIds, skinTypeIds, images });
  }
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

// Soft delete only - past orders reference this product_id and must keep
// displaying correctly, so the row is never actually removed.
router.delete('/api/admin/products/:id', (req, res) => {
  const result = db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true });
});

// ---- Orders ----
router.get('/api/admin/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  res.json(orders);
});

router.get('/api/admin/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json({ ...order, items });
});

// Fulfillment status is free text (see db.js) so the admin can use any
// label, but the UI offers this common set including "confirmed" and
// "completed" alongside the original processing/shipped/delivered/cancelled.
router.put('/api/admin/orders/:id/status', (req, res) => {
  const { paymentStatus, fulfillmentStatus } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  db.prepare('UPDATE orders SET payment_status = COALESCE(?, payment_status), fulfillment_status = COALESCE(?, fulfillment_status) WHERE id = ?')
    .run(paymentStatus || null, fulfillmentStatus || null, req.params.id);

  if (paymentStatus === 'cancelled' || fulfillmentStatus === 'cancelled') {
    restoreStockIfNeeded(order.id); // guarded, safe even if already restored
  }

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  // Notify the customer by email when the fulfillment status changes to one
  // of the milestones they'd care about - only fires if an email is on file.
  if (fulfillmentStatus && fulfillmentStatus !== order.fulfillment_status) {
    sendOrderStatusEmail(updated, fulfillmentStatus).catch((e) => console.error('Status email failed:', e.message));
  }

  res.json(updated);
});

// ---- Announcements (trust-bar marquee) ----
// The whole point of this being admin-editable: the site owner can change
// these messages any time in production without touching code or
// redeploying. Order matters (sort_order), so there's a simple move-up/
// move-down instead of a full drag-and-drop reorder UI.
router.get('/api/admin/announcements', (req, res) => {
  res.json(db.prepare('SELECT * FROM announcements ORDER BY sort_order').all());
});

router.post('/api/admin/announcements', (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Message text is required' });
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM announcements').get().m;
  const info = db.prepare('INSERT INTO announcements (text, sort_order) VALUES (?, ?)').run(text.trim(), (maxOrder ?? -1) + 1);
  res.status(201).json(db.prepare('SELECT * FROM announcements WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/api/admin/announcements/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Message not found' });
  const { text, isActive } = req.body;
  db.prepare('UPDATE announcements SET text = ?, is_active = ? WHERE id = ?').run(
    text !== undefined ? text.trim() : existing.text,
    isActive === undefined ? existing.is_active : (isActive ? 1 : 0),
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id));
});

router.delete('/api/admin/announcements/:id', (req, res) => {
  const result = db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Message not found' });
  res.json({ ok: true });
});

router.post('/api/admin/announcements/:id/move', (req, res) => {
  const { direction } = req.body; // 'up' | 'down'
  const all = db.prepare('SELECT * FROM announcements ORDER BY sort_order').all();
  const idx = all.findIndex((a) => a.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Message not found' });
  const swapWith = direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= all.length) return res.json(all); // already at the edge, no-op

  const tx = db.transaction(() => {
    const a = all[idx];
    const b = all[swapWith];
    db.prepare('UPDATE announcements SET sort_order = ? WHERE id = ?').run(b.sort_order, a.id);
    db.prepare('UPDATE announcements SET sort_order = ? WHERE id = ?').run(a.sort_order, b.id);
  });
  tx();
  res.json(db.prepare('SELECT * FROM announcements ORDER BY sort_order').all());
});

// ---- Hero slideshow (homepage) ----
// Same admin-editable pattern as announcements: any number of slides (not
// capped), each an image URL (no file upload infra, same as product
// images), reorderable, toggleable without deleting.
router.get('/api/admin/hero-slides', (req, res) => {
  res.json(db.prepare('SELECT * FROM hero_slides ORDER BY sort_order').all());
});

router.post('/api/admin/hero-slides', (req, res) => {
  const { imageUrl, caption } = req.body;
  if (!imageUrl || !imageUrl.trim()) return res.status(400).json({ error: 'Image URL is required' });
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM hero_slides').get().m;
  const info = db
    .prepare('INSERT INTO hero_slides (image_url, caption, sort_order) VALUES (?, ?, ?)')
    .run(imageUrl.trim(), (caption || '').trim(), (maxOrder ?? -1) + 1);
  res.status(201).json(db.prepare('SELECT * FROM hero_slides WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/api/admin/hero-slides/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM hero_slides WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Slide not found' });
  const { imageUrl, caption, isActive } = req.body;
  db.prepare('UPDATE hero_slides SET image_url = ?, caption = ?, is_active = ? WHERE id = ?').run(
    imageUrl !== undefined && imageUrl.trim() ? imageUrl.trim() : existing.image_url,
    caption !== undefined ? caption.trim() : existing.caption,
    isActive === undefined ? existing.is_active : (isActive ? 1 : 0),
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM hero_slides WHERE id = ?').get(req.params.id));
});

router.delete('/api/admin/hero-slides/:id', (req, res) => {
  const result = db.prepare('DELETE FROM hero_slides WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Slide not found' });
  res.json({ ok: true });
});

router.post('/api/admin/hero-slides/:id/move', (req, res) => {
  const { direction } = req.body;
  const all = db.prepare('SELECT * FROM hero_slides ORDER BY sort_order').all();
  const idx = all.findIndex((s) => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Slide not found' });
  const swapWith = direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= all.length) return res.json(all);

  const tx = db.transaction(() => {
    const a = all[idx];
    const b = all[swapWith];
    db.prepare('UPDATE hero_slides SET sort_order = ? WHERE id = ?').run(b.sort_order, a.id);
    db.prepare('UPDATE hero_slides SET sort_order = ? WHERE id = ?').run(a.sort_order, b.id);
  });
  tx();
  res.json(db.prepare('SELECT * FROM hero_slides ORDER BY sort_order').all());
});

module.exports = router;
