const nodemailer = require('nodemailer');
const EmailProvider = require('./EmailProvider');
const config = require('../config');

class SmtpEmailProvider extends EmailProvider {
  constructor() {
    super();
    this.transport = nodemailer.createTransport({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.port === 465,
      auth: config.email.smtp.user
        ? { user: config.email.smtp.user, pass: config.email.smtp.pass }
        : undefined,
    });
  }

  async send({ to, subject, text, html }) {
    return this.transport.sendMail({
      from: config.email.from,
      to,
      subject,
      text,
      html,
    });
  }
}

module.exports = SmtpEmailProvider;
