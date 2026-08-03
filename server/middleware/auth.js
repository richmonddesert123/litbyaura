const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * There is deliberately NO route anywhere in this app that lets a request
 * grant itself admin. The only way an admin account is ever created is
 * `npm run seed`, which reads ADMIN_EMAIL/ADMIN_PASSWORD from the
 * environment - i.e. requires deploy-time access, not an API call.
 */
function requireAdmin(req, res, next) {
  const token = req.cookies?.admin_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.role !== 'admin') throw new Error('not admin');
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

/** Requires a logged-in customer; 401s otherwise. */
function requireCustomer(req, res, next) {
  const token = req.cookies?.customer_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.role !== 'customer') throw new Error('not customer');
    req.customer = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

/** Attaches req.customer if a valid session cookie is present, but never blocks the request (guest checkout stays supported). */
function optionalCustomer(req, res, next) {
  const token = req.cookies?.customer_token;
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      if (payload.role === 'customer') req.customer = payload;
    } catch {
      // ignore invalid/expired token - just treat as guest
    }
  }
  next();
}

module.exports = { requireAdmin, requireCustomer, optionalCustomer };
