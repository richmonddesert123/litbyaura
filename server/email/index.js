const config = require('../config');
const ConsoleEmailProvider = require('./ConsoleEmailProvider');
const SmtpEmailProvider = require('./SmtpEmailProvider');

const provider =
  config.email.provider === 'smtp' ? new SmtpEmailProvider() : new ConsoleEmailProvider();

module.exports = provider;
