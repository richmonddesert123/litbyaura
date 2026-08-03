require('dotenv').config();

/**
 * Central config. Every payment/email integration reads its "is this
 * visible to customers" answer from here, never by checking whether an
 * API key happens to be set. Credentials and enablement are deliberately
 * separate switches (see README "Payments" section / lessons learned).
 */
module.exports = {
  port: process.env.PORT || 3000,
  env: process.env.NODE_ENV || 'development',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  currency: process.env.CURRENCY || 'GHS',
  currencySymbol: process.env.CURRENCY_SYMBOL || 'GH₵',

  admin: {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || '',
  },

  payments: {
    paystack: {
      secretKey: process.env.PAYSTACK_SECRET_KEY || '',
      publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
      enabled: process.env.PAYSTACK_ENABLED === 'true',
    },
    hubtel: {
      clientId: process.env.HUBTEL_CLIENT_ID || '',
      clientSecret: process.env.HUBTEL_CLIENT_SECRET || '',
      enabled: process.env.HUBTEL_ENABLED === 'true',
    },
  },

  email: {
    provider: process.env.EMAIL_PROVIDER || 'console',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: Number(process.env.SMTP_PORT || 587),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
    from: process.env.EMAIL_FROM || 'LitByAura <orders@litbyaura.com>',
  },
};
