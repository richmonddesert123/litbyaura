const PaymentProvider = require('./PaymentProvider');

/**
 * Cash on Delivery: no processor, no credentials, no risk of getting
 * rejected/frozen by a payment processor. This is the DEFAULT payment
 * method, not a fallback - the store must be able to take real orders on
 * day one even if no card/mobile-money processor relationship exists yet.
 */
class CodProvider extends PaymentProvider {
  get id() { return 'cod'; }
  get label() { return 'Cash on Delivery'; }

  isEnabled() {
    return true; // always available, never gated behind a flag
  }

  async initiate(order) {
    // Nothing to redirect to - the order is simply placed and paid_status
    // stays 'pending' until the courier collects payment on delivery.
    return { status: 'awaiting_action', reference: order.order_number };
  }

  async verify(order) {
    // COD has no external system to poll - payment is confirmed manually
    // by staff (fulfillment flow), not by this method.
    return order.payment_status;
  }

  async handleWebhook() {
    return null; // COD has no webhooks
  }
}

module.exports = CodProvider;
