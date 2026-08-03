const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');

const templatePath = path.join(__dirname, '..', 'public', 'product.html');

function htmlEscape(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Injects real product data into product.html's meta tags before sending it,
 * rather than leaving that to client-side JS. This matters because most
 * link-preview bots (WhatsApp, Facebook, Twitter/X, Slack, iMessage) do NOT
 * execute JavaScript when generating a share-card preview - they only read
 * the initial HTML response. Without this, sharing a product link would
 * always show a generic "LitByAura" card instead of that product's actual
 * photo, name, and price. Must be registered in server/index.js BEFORE
 * express.static, or the static file (with unreplaced {{...}} tokens) would
 * be served first and this would never run.
 */
function renderProductPage(req, res) {
  const slug = typeof req.query.slug === 'string' ? req.query.slug : '';
  const base = config.baseUrl.replace(/\/$/, '');

  let product = null;
  if (slug) {
    product = db.prepare('SELECT * FROM products WHERE slug = ? AND is_active = 1').get(slug);
  }

  let title, description, image, url, ogType, price;
  if (product) {
    title = `${product.name} — LitByAura`;
    description = product.description
      ? product.description.slice(0, 200)
      : `${product.name} — available now at LitByAura. Pay cash on delivery.`;
    const firstImage = db
      .prepare('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1')
      .get(product.id);
    const imagePath = firstImage ? firstImage.url : product.image_url;
    image = imagePath.startsWith('http') ? imagePath : `${base}${imagePath}`;
    url = `${base}/product.html?slug=${encodeURIComponent(product.slug)}`;
    ogType = 'product';
    price = (product.price_pesewas / 100).toFixed(2);
  } else {
    title = 'Product — LitByAura';
    description = 'Skincare delivered across Ghana. Pay cash on delivery.';
    image = `${base}/images/placeholder.png`;
    url = `${base}/product.html`;
    ogType = 'website';
    price = '';
  }

  let html;
  try {
    html = fs.readFileSync(templatePath, 'utf8');
  } catch (e) {
    console.error('Could not read product.html template:', e.message);
    return res.status(500).send('Server error');
  }

  html = html
    .replaceAll('{{META_TITLE}}', htmlEscape(title))
    .replaceAll('{{META_DESCRIPTION}}', htmlEscape(description))
    .replaceAll('{{META_URL}}', htmlEscape(url))
    .replaceAll('{{META_IMAGE}}', htmlEscape(image))
    .replaceAll('{{META_OG_TYPE}}', ogType)
    .replaceAll('{{META_PRICE}}', price)
    .replaceAll('{{META_CURRENCY}}', config.currency);

  res.send(html);
}

module.exports = { renderProductPage };
