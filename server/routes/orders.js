const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { getProvider, isProviderUsable } = require('../payments');
const emailProvider = require('../email');
const config = require('../config');
const { optionalCustomer } = require('../middleware/auth');

const router = express.Router();

// COD is always included even though it has no "enabled" flag - it's the
// guaranteed default, not one option among equals.
router.get('/api/payment-methods', (req, res) => {
  const { listEnabledProviders } = require('../payments');
  const methods = listEnabledProviders().map((p) => ({ id: p.id, label: p.label }));
  res.json(methods);
});

function generateOrderNumber() {
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `LBA-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

/**
 * Body shape:
 * {
 *   customerName, phone, email, address, city, notes,
 *   paymentMethod: 'cod' | 'paystack' | 'hubtel',
 *   items: [{ productId, quantity }]   <- built from cart OR from a single
 *                                         buy-now item on the client; this
 *                                         route doesn't care which, it just
 *                                         trusts exactly the items sent.
 * }
 * If a valid customer_token cookie is present, the order is linked to that
 * account (order history / tracking), but logging in is never required -
 * guest checkout with just name/phone/address always works.
 */
router.post('/api/orders', optionalCustomer, (req, res) => {
  const { customerName, phone, email = '', address, city, notes = '', paymentMethod, items } = req.body;

  if (!customerName || !phone || !address || !city) {
    return res.status(400).json({ error: 'Missing required customer details' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No items in order' });
  }
  // COD is always usable; any other method must actually be enabled server-side
  // - this is the real gate, not just the frontend hiding the option.
  if (paymentMethod !== 'cod' && !isProviderUsable(paymentMethod)) {
    return res.status(400).json({ error: 'Selected payment method is not available' });
  }

  try {
    const order = createOrderWithStockReservation({
      customerId: req.customer ? req.customer.customerId : null,
      customerName,
      phone,
      email,
      address,
      city,
      notes,
      paymentMethod,
      items,
    });

    const provider = getProvider(paymentMethod);
    initiatePaymentAndRespond(provider, order, res);
  } catch (err) {
    if (err.code === 'OUT_OF_STOCK') {
      return res.status(409).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not create order' });
  }
});

function createOrderWithStockReservation({ customerId, customerName, phone, email, address, city, notes, paymentMethod, items }) {
  // Stock is reserved at order-creation time, not on payment confirmation,
  // because COD has no separate "payment confirmed" step to hook into.
  // This whole block runs in one transaction so a stock check + decrement
  // race can't oversell.
  const tx = db.transaction(() => {
    const orderNumber = generateOrderNumber();
    let subtotal = 0;
    const lineItems = [];

    for (const { productId, quantity } of items) {
      if (!quantity || quantity < 1) continue;
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(productId);
      if (!product) {
        const e = new Error(`Product ${productId} not found`);
        e.code = 'OUT_OF_STOCK';
        throw e;
      }
      if (product.stock < quantity) {
        const e = new Error(`"${product.name}" only has ${product.stock} left in stock`);
        e.code = 'OUT_OF_STOCK';
        throw e;
      }
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(quantity, productId);
      subtotal += product.price_pesewas * quantity;
      lineItems.push({
        productId: product.id,
        name: product.name,
        unitPrice: product.price_pesewas,
        quantity,
      });
    }

    if (lineItems.length === 0) {
      const e = new Error('No valid items in order');
      e.code = 'OUT_OF_STOCK';
      throw e;
    }

    const info = db
      .prepare(`
        INSERT INTO orders
          (order_number, customer_id, customer_name, phone, email, address, city, notes, subtotal_pesewas, payment_method)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(orderNumber, customerId, customerName, phone, email, address, city, notes, subtotal, paymentMethod);

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price_pesewas, quantity)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const li of lineItems) {
      insertItem.run(info.lastInsertRowid, li.productId, li.name, li.unitPrice, li.quantity);
    }

    return db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
  });

  const order = tx();

  emailProvider
    .send({
      to: 'orders@litbyaura.com', // internal notification
      subject: `New order ${order.order_number}`,
      text: `New ${order.payment_method.toUpperCase()} order from ${order.customer_name} (${order.phone}), total ${(order.subtotal_pesewas / 100).toFixed(2)} ${config.currency}`,
    })
    .catch((e) => console.error('Order notification email failed:', e.message));

  if (order.email) {
    sendOrderStatusEmail(order, 'confirmed').catch((e) =>
      console.error('Order confirmation email failed:', e.message)
    );
  }

  return order;
}

/**
 * Sends a customer-facing update for a given lifecycle stage. Only fires
 * when the order has an email on file (guest orders placed with just a
 * phone number simply don't get these - nothing to send to).
 */
const STATUS_EMAIL_COPY = {
  confirmed: { subject: 'Order confirmed', text: (o) => `Hi ${o.customer_name.split(' ')[0]}, your order ${o.order_number} has been confirmed and is being prepared.` },
  shipped: { subject: 'Order shipped', text: (o) => `Hi ${o.customer_name.split(' ')[0]}, your order ${o.order_number} is on its way to ${o.address}, ${o.city}.` },
  delivered: { subject: 'Order delivered', text: (o) => `Hi ${o.customer_name.split(' ')[0]}, your order ${o.order_number} has been delivered. Enjoy!` },
  completed: { subject: 'Order completed', text: (o) => `Hi ${o.customer_name.split(' ')[0]}, your order ${o.order_number} is complete. Thanks for shopping with LitByAura.` },
  cancelled: { subject: 'Order cancelled', text: (o) => `Hi ${o.customer_name.split(' ')[0]}, your order ${o.order_number} has been cancelled.` },
};

async function sendOrderStatusEmail(order, status) {
  const copy = STATUS_EMAIL_COPY[status];
  if (!copy || !order.email) return;
  await emailProvider.send({
    to: order.email,
    subject: `${copy.subject} — ${order.order_number}`,
    text: copy.text(order),
  });
}

async function initiatePaymentAndRespond(provider, order, res) {
  const result = await provider.initiate(order);
  if (result.reference && result.reference !== order.order_number) {
    db.prepare('UPDATE orders SET provider_reference = ? WHERE id = ?').run(result.reference, order.id);
  }
  res.status(201).json({
    orderNumber: order.order_number,
    paymentMethod: provider.id,
    redirectUrl: result.redirectUrl || null,
    confirmationUrl: `/order/${order.order_number}/confirm`,
  });
}

router.get('/api/orders/:orderNumber', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(req.params.orderNumber);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json({ ...order, items });
});

/**
 * Rolls back stock for a failed/cancelled order. Guarded by stock_restored
 * so this is safe to call more than once (e.g. webhook AND a manual status
 * check both firing for the same failure) - it only ever restores stock once.
 */
function restoreStockIfNeeded(orderId) {
  const tx = db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order || order.stock_restored) return;
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    for (const item of items) {
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.quantity, item.product_id);
    }
    db.prepare('UPDATE orders SET stock_restored = 1 WHERE id = ?').run(orderId);
  });
  tx();
}

module.exports = { router, restoreStockIfNeeded, sendOrderStatusEmail };
