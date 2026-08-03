/**
 * Same pattern as PaymentProvider: one interface, swappable implementations.
 * Order confirmation code calls send() and never knows or cares whether
 * it's SMTP, a transactional API, or just console.log in dev.
 */
class EmailProvider {
  /**
   * @param {{ to: string, subject: string, text: string, html?: string }} message
   */
  async send(message) {
    throw new Error('send() not implemented');
  }
}

module.exports = EmailProvider;
