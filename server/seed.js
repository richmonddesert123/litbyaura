const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('./config');

// Concerns and skin types are seeded automatically in server/db.js (fixed
// taxonomy, not admin-editable) - nothing to do for them here.

function seedAdmin() {
  if (!config.admin.email || !config.admin.password) {
    console.log('ADMIN_EMAIL / ADMIN_PASSWORD not set - skipping admin creation.');
    console.log('Set them in .env and re-run `npm run seed` to create the first admin.');
    return;
  }
  const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(config.admin.email);
  if (existing) {
    console.log(`Admin ${config.admin.email} already exists - skipping.`);
    return;
  }
  const hash = bcrypt.hashSync(config.admin.password, 12);
  db.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)').run(
    config.admin.email,
    hash
  );
  console.log(`Created admin: ${config.admin.email}`);
  console.log('Remove ADMIN_PASSWORD from .env now that the account exists.');
}

function seedProducts() {
  const count = db.prepare('SELECT COUNT(*) as n FROM products').get().n;
  if (count > 0) {
    console.log('Products already exist - skipping product seed.');
    return;
  }
  const insert = db.prepare(`
    INSERT INTO products (slug, name, description, price_pesewas, compare_at_pesewas, image_url, stock, brand, is_best_seller)
    VALUES (@slug, @name, @description, @price, @compareAt, @image, @stock, @brand, @bestSeller)
  `);
  const products = [
    {
      slug: 'aura-glow-serum',
      name: 'Aura Glow Vitamin C Serum',
      description: 'Brightening vitamin C serum for an even, radiant complexion. Suitable for all skin types.',
      price: 24900, // GH₵249.00
      compareAt: 39900,
      image: '/images/placeholder.png',
      stock: 40,
      brand: 'LitByAura',
      bestSeller: 1,
      concerns: ['Dull Skin', 'Uneven Skin Tone', 'Dark Spots & Hyperpigmentation'],
      skinTypes: ['Normal', 'Dry', 'Combination'],
    },
    {
      slug: 'aura-collagen-mask',
      name: 'Aura Collagen Repair Mask',
      description: 'Hydrating collagen sheet mask set for firmer, plumper-looking skin.',
      price: 19900,
      compareAt: 29900,
      image: '/images/placeholder.png',
      stock: 60,
      brand: 'LitByAura',
      bestSeller: 1,
      concerns: ['Anti-Aging', 'Dry Skin'],
      skinTypes: ['Dry', 'Normal', 'Sensitive'],
    },
    {
      slug: 'aura-clay-cleanser',
      name: 'Aura Purifying Clay Cleanser',
      description: 'Deep-pore clay cleanser that clears buildup without stripping the skin.',
      price: 15900,
      compareAt: null,
      image: '/images/placeholder.png',
      stock: 75,
      brand: 'Glow Lab',
      bestSeller: 0,
      concerns: ['Acne & Breakouts', 'Large Pores', 'Oily Skin'],
      skinTypes: ['Oily', 'Combination'],
    },
  ];
  const insertMany = db.transaction((rows) => rows.forEach((r) => insert.run({
    slug: r.slug, name: r.name, description: r.description, price: r.price,
    compareAt: r.compareAt, image: r.image, stock: r.stock, brand: r.brand, bestSeller: r.bestSeller,
  })));
  insertMany(products);
  console.log(`Seeded ${products.length} products.`);

  // Assign concerns/skin types + a second image "angle" each, so the
  // storefront's new nav (Shop by Concern / Shop by Skin Type / Brands /
  // Best Sellers) isn't empty on first run.
  const concernIdByName = (name) => db.prepare('SELECT id FROM concerns WHERE name = ?').get(name)?.id;
  const skinTypeIdByName = (name) => db.prepare('SELECT id FROM skin_types WHERE name = ?').get(name)?.id;
  const linkConcern = db.prepare('INSERT OR IGNORE INTO product_concerns (product_id, concern_id) VALUES (?, ?)');
  const linkSkinType = db.prepare('INSERT OR IGNORE INTO product_skin_types (product_id, skin_type_id) VALUES (?, ?)');
  const insertImage = db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)');

  products.forEach((r) => {
    const product = db.prepare('SELECT id FROM products WHERE slug = ?').get(r.slug);
    if (!product) return;
    r.concerns.forEach((name) => {
      const id = concernIdByName(name);
      if (id) linkConcern.run(product.id, id);
    });
    r.skinTypes.forEach((name) => {
      const id = skinTypeIdByName(name);
      if (id) linkSkinType.run(product.id, id);
    });
    insertImage.run(product.id, '/images/placeholder.png', 0);
    insertImage.run(product.id, '/images/placeholder.png', 1);
  });
}

seedAdmin();
seedProducts();
