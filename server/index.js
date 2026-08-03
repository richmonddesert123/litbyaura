const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./config');

const productRoutes = require('./routes/products');
const { router: orderRoutes } = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const customerRoutes = require('./routes/customers');
const webhookRoutes = require('./routes/webhooks');

const app = express();

app.use(cookieParser());

// Capture the raw request body BEFORE JSON parsing discards it, so webhook
// handlers can compute an HMAC signature over the exact bytes the provider
// sent. Doing this only for /api/webhooks keeps the rest of the app on the
// normal fast-path JSON parser.
app.use(
  express.json({
    verify: (req, res, buf) => {
      if (req.originalUrl.startsWith('/api/webhooks')) {
        req.rawBody = buf;
      }
    },
  })
);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(productRoutes);
app.use(orderRoutes);
app.use(adminRoutes);
app.use(customerRoutes);
app.use(webhookRoutes);

// Client-side routes that just need to serve the SPA-ish pages
app.get('/order/:orderNumber/confirm', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'confirmation.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
});

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html')));

app.listen(config.port, () => {
  console.log(`LitByAura running at ${config.baseUrl} (env: ${config.env})`);
});
