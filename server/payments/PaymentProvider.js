/**
 * Every payment method (COD, Paystack, Hubtel, whatever comes next)
 * implements this exact interface. Checkout and the order controller only
 * ever talk to this interface, never to a specific provider - adding a new
 * payment method should mean "add one new file", not "touch checkout".
 */
class PaymentProvider {
  /** Machine-readable id, e.g. 'cod' | 'paystack' | 'hubtel' */
  get id() {
    throw new Error('id getter not implemented');
  }

  /** Human label shown in checkout UI */
  get label() {
    throw new Error('label getter not implemented');
  }

  /** Whether this should currently be offered to customers. */
  isEnabled() {
    throw new Error('isEnabled() not implemented');
  }

  /**
   * Start a payment for an order that already exists in the DB.
   * @param {object} order - the order row
   * @returns {Promise<{ status: 'awaiting_action'|'paid', redirectUrl?: string, reference?: string }>}
   */
  async initiate(order) {
    throw new Error('initiate() not implemented');
  }

  /**
   * Actively check payment status with the provider (polling fallback,
   * used if a webhook never arrives).
   * @param {object} order
   * @returns {Promise<'pending'|'paid'|'failed'>}
   */
  async verify(order) {
    throw new Error('verify() not implemented');
  }

  /**
   * Handle an inbound webhook. MUST verify the signature before trusting
   * anything in the payload - see PaystackProvider for the reference
   * implementation (HMAC over the raw request body).
   * @param {import('express').Request} req
   * @returns {Promise<{ orderReference: string, status: 'paid'|'failed' }|null>}
   */
  async handleWebhook(req) {
    throw new Error('handleWebhook() not implemented');
  }
}

module.exports = PaymentProvider;
