const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { requireCustomer } = require('../middleware/auth');
const emailProvider = require('../email');

const router = express.Router();

const MIN_PASSWORD_LENGTH = 6;

function setCustomerCookie(res, customer) {
  const token = jwt.sign(
    { role: 'customer', customerId: customer.id, email: customer.email, name: customer.name },
    config.jwtSecret,
    { expiresIn: '30d' }
  );
  res.cookie('customer_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function publicCustomer(c) {
  return { id: c.id, name: c.name, email: c.email, phone: c.phone, address: c.address, city: c.city };
}

router.post('/api/customers/signup', (req, res) => {
  const { name, email, password, phone = '', address = '', city = '' } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  const existing = db.prepare('SELECT id FROM customers WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const hash = bcrypt.hashSync(password, 12);
  const info = db
    .prepare('INSERT INTO customers (name, email, password_hash, phone, address, city) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, email.toLowerCase(), hash, phone, address, city);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
  setCustomerCookie(res, customer);
  res.status(201).json(publicCustomer(customer));
});

router.post('/api/customers/login', (req, res) => {
  const { email, password } = req.body;
  const customer = db.prepare('SELECT * FROM customers WHERE email = ?').get((email || '').toLowerCase());
  if (!customer || !bcrypt.compareSync(password || '', customer.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  setCustomerCookie(res, customer);
  res.json(publicCustomer(customer));
});

router.post('/api/customers/logout', (req, res) => {
  res.clearCookie('customer_token');
  res.json({ ok: true });
});

router.get('/api/customers/me', requireCustomer, (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.customer.customerId);
  if (!customer) return res.status(404).json({ error: 'Account not found' });
  res.json(publicCustomer(customer));
});

// Update saved shipping info (name/phone/address/city), reused to pre-fill future checkouts.
router.put('/api/customers/me', requireCustomer, (req, res) => {
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.customer.customerId);
  if (!existing) return res.status(404).json({ error: 'Account not found' });
  const { name, phone, address, city } = req.body;
  db.prepare('UPDATE customers SET name = ?, phone = ?, address = ?, city = ? WHERE id = ?').run(
    name ?? existing.name,
    phone ?? existing.phone,
    address ?? existing.address,
    city ?? existing.city,
    existing.id
  );
  res.json(publicCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(existing.id)));
});

router.post('/api/customers/change-password', requireCustomer, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.customer.customerId);
  if (!customer || !bcrypt.compareSync(currentPassword || '', customer.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE customers SET password_hash = ? WHERE id = ?').run(hash, customer.id);
  res.json({ ok: true });
});

// ---- Forgot password (emailed single-use link) — separate from the
// logged-in change-password above, for customers who can't log in at all. ----
router.post('/api/customers/password-reset/request', (req, res) => {
  const { email } = req.body;
  const customer = db.prepare('SELECT * FROM customers WHERE email = ?').get((email || '').toLowerCase());
  // Always respond the same way whether or not the email exists, to avoid
  // leaking which emails have accounts.
  if (customer) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    db.prepare(
      'INSERT INTO customer_password_reset_tokens (customer_id, token_hash, expires_at) VALUES (?, ?, ?)'
    ).run(customer.id, tokenHash, expiresAt);

    const resetLink = `${config.baseUrl}/reset-password.html?type=customer&token=${rawToken}`;
    emailProvider
      .send({
        to: customer.email,
        subject: 'Reset your LitByAura password',
        text: `Click the link below to reset your password. This link expires in 1 hour and can only be used once.\n\n${resetLink}`,
      })
      .catch((e) => console.error('Customer password reset email failed:', e.message));
  }
  res.json({ ok: true, message: 'If that account exists, a reset link has been sent.' });
});

router.post('/api/customers/password-reset/confirm', (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Invalid token, or password shorter than ${MIN_PASSWORD_LENGTH} characters` });
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare('SELECT * FROM customer_password_reset_tokens WHERE token_hash = ?').get(tokenHash);

  if (!row || row.used || new Date(row.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Reset link is invalid or has expired' });
  }

  const tx = db.transaction(() => {
    const hash = bcrypt.hashSync(newPassword, 12);
    db.prepare('UPDATE customers SET password_hash = ? WHERE id = ?').run(hash, row.customer_id);
    db.prepare('UPDATE customer_password_reset_tokens SET used = 1 WHERE id = ?').run(row.id); // single-use
  });
  tx();

  res.json({ ok: true });
});

// Order history for the logged-in customer - covers "ability to track orders".
router.get('/api/customers/me/orders', requireCustomer, (req, res) => {
  const orders = db
    .prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC')
    .all(req.customer.customerId);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  res.json(orders.map((o) => ({ ...o, items: items.all(o.id) })));
});

module.exports = router;
