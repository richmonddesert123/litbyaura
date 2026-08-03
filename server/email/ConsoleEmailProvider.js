const EmailProvider = require('./EmailProvider');

class ConsoleEmailProvider extends EmailProvider {
  async send({ to, subject, text }) {
    console.log(`\n--- EMAIL (console provider, not actually sent) ---`);
    console.log(`To: ${to}\nSubject: ${subject}\n\n${text}`);
    console.log(`--- end email ---\n`);
    return { id: 'console-' + Date.now() };
  }
}

module.exports = ConsoleEmailProvider;
