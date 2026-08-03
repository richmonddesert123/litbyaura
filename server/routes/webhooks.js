const express = require('express');
const db = require('../db');
const { getProvider } = require('../payments');
const { restoreStockIfNeeded } = require('./orders');

const router = express.Router();

// IMPORTANT: this route relies on req.rawBody being captured by the
// express.json({ verify }) hook in server/index.js BEFORE JSON parsing
// discards the original bytes. Signature verification is computed over
// those raw bytes, not over the re-serialized req.body.
router.post('/api/webhooks/:provider', async (req, res) => {
  let provider;
  try {
    provider = getProvider(req.params.provider);
  } catch {
    return res.status(404).end();
  }

  const result = await provider.handleWebhook(req);
  if (!result) {
    // Either not a recognized event, or - critically - signature
    // verification failed. Either way: do NOT act on the payload.
    return res.status(400).json({ error: 'Invalid or unverifiable webhook' });
  }

  const order = db.prepare('SELECT * FROM orders WHERE order_number = ? OR provider_reference = ?')
    .get(result.orderReference, result.orderReference);
  if (!order) return res.status(404).end();

  if (result.status === 'paid') {
    db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run('paid', order.id);
  } else if (result.status === 'failed') {
    db.prepare('UPDATE orders SET payment_status = ?, fulfillment_status = ? WHERE id = ?')
      .run('failed', 'cancelled', order.id);
    restoreStockIfNeeded(order.id); // guarded internally against double-restore
  }

  res.status(200).json({ received: true });
});

module.exports = router;
