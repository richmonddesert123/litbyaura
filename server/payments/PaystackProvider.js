const crypto = require('crypto');
const PaymentProvider = require('./PaymentProvider');
const config = require('../config');

const PAYSTACK_API = 'https://api.paystack.co';

/**
 * Paystack (card / mobile money via Paystack). Gated behind TWO independent
 * switches:
 *   - PAYSTACK_SECRET_KEY set -> the integration *works* (for our own testing)
 *   - PAYSTACK_ENABLED=true   -> customers can actually *see and pick* it
 * A request to /checkout that tries to force this provider while
 * PAYSTACK_ENABLED is false is rejected server-side too - see routes/orders.js.
 * The UI hiding the option is not the real gate; the backend check is.
 */
class PaystackProvider extends PaymentProvider {
  get id() { return 'paystack'; }
  get label() { return 'Card / Mobile Money (Paystack)'; }

  isEnabled() {
    return config.payments.paystack.enabled && !!config.payments.paystack.secretKey;
  }

  async initiate(order) {
    const secretKey = config.payments.paystack.secretKey;
    const res = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: `${order.phone.replace(/\D/g, '')}@litbyaura-guest.com`, // Paystack requires an email
        amount: order.subtotal_pesewas, // Paystack also calls this "the smallest currency unit" - matches our schema
        reference: order.order_number,
        currency: config.currency,
        callback_url: `${config.baseUrl}/order/${order.order_number}/confirm`,
      }),
    });
    const data = await res.json();
    if (!data.status) {
      throw new Error(`Paystack initialize failed: ${data.message || 'unknown error'}`);
    }
    return {
      status: 'awaiting_action',
      redirectUrl: data.data.authorization_url,
      reference: data.data.reference,
    };
  }

  async verify(order) {
    const secretKey = config.payments.paystack.secretKey;
    const res = await fetch(
      `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(order.provider_reference || order.order_number)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    const data = await res.json();
    if (!data.status) return 'pending';
    const txStatus = data.data.status; // 'success' | 'failed' | 'abandoned'
    if (txStatus === 'success') return 'paid';
    if (txStatus === 'failed') return 'failed';
    return 'pending';
  }

  /**
   * Verifies the HMAC-SHA512 signature Paystack sends in the
   * x-paystack-signature header, computed over the RAW request body.
   * This requires the raw bytes to have been captured before Express's
   * JSON body parser discards them - see server/index.js
   * (express.json({ verify: ... })).
   */
  async handleWebhook(req) {
    const secretKey = config.payments.paystack.secretKey;
    const signature = req.headers['x-paystack-signature'];
    if (!signature || !req.rawBody) return null;

    const expected = crypto
      .createHmac('sha512', secretKey)
      .update(req.rawBody)
      .digest('hex');

    // timing-safe compare
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null; // signature invalid - do NOT trust this payload
    }

    const event = req.body;
    if (event.event !== 'charge.success' && event.event !== 'charge.failed') return null;

    return {
      orderReference: event.data.reference,
      status: event.event === 'charge.success' ? 'paid' : 'failed',
    };
  }
}

module.exports = PaystackProvider;
