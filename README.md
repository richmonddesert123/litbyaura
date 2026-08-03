# LitByAura

COD-first skincare storefront: Node.js/Express + SQLite backend, plain HTML/CSS/JS frontend.

## Quick start

```bash
npm install
cp .env.example .env
npm run seed        # seeds default categories + demo products (no admin needed yet)
npm start
```

Visit http://localhost:3000 for the store, http://localhost:3000/admin for the dashboard.
The first time you open `/admin`, you'll see a **Create admin account** form
instead of a login form — that only appears while zero admin accounts exist,
and disables itself forever the moment the first one is created.

## What's here

- **Storefront**: category-organized catalog, multi-image product galleries
  (click a thumbnail or swipe on mobile), cart, guest or logged-in checkout,
  Buy Now bypass, order confirmation + tracking.
- **Customer accounts**: sign up / log in, saved shipping info that pre-fills
  future checkouts, order history, self-service password change (min. 6
  chars), password-visibility toggle on every password field.
- **Admin dashboard**: first-run self-setup, order management with a full
  status lifecycle (processing → confirmed → shipped → delivered → completed,
  or any custom label), product CRUD with multiple images and category
  tagging, category CRUD (create/delete, including the seeded defaults),
  self-service password change, emailed password reset.
- **Order status emails**: whenever an order is confirmed or its fulfillment
  status changes to shipped/delivered/completed/cancelled, the customer gets
  an email — if one is on file (guest checkouts can optionally supply an
  email at checkout even without creating an account).

## Architecture notes

- **Payments** (`server/payments/`): `PaymentProvider` interface with `CodProvider`
  (always on, zero processor risk) and `PaystackProvider` (gated behind both a
  credential AND a separate `PAYSTACK_ENABLED` flag, enforced client- and
  server-side). Add a new method by adding one file to this folder and
  registering it in `payments/index.js` — checkout and order code never change.
- **Email** (`server/email/`): same interface pattern, swap `EMAIL_PROVIDER=console|smtp`.
- **Webhooks** (`server/routes/webhooks.js`): Paystack signature is verified via
  HMAC over the *raw* request body, captured in `server/index.js` before
  Express's JSON parser discards it. Never trust an unverified payload.
- **Stock**: reserved at order-creation time (not payment confirmation), since
  COD has no separate confirmation step. Rollback on payment failure is
  guarded by `orders.stock_restored` so it's safe even if a webhook and a
  manual status check both fire for the same failure.
- **Buy Now** (`public/js/checkout.js`): `?buyNow=<id>&qty=<n>` is a true bypass —
  the cart in localStorage is never read in that mode, so items already in
  the cart never leak into a buy-now order.
- **Money**: every price/amount column is an integer in pesewas (smallest
  currency unit), converted to cedis only at the UI boundary (`formatMoney`).
- **Admin bootstrap**: no signup route exists that lets a request grant
  *itself* admin on a running store — `POST /api/admin/setup` only works
  while the `admins` table is empty, so it's the UI equivalent of the old
  CLI-only seed, not an open promotion path. Once one admin exists, that
  route 403s permanently.
- **Passwords**: admin and customer passwords both require a minimum of 6
  characters, are bcrypt-hashed, and each account type has its own
  self-service "change password" flow (requires the current password) plus
  a separate emailed single-use reset-token flow (admin only, 1-hour expiry).
- **Categories**: many-to-many via `product_categories`; the 9 defaults
  (Home, New Arrivals, Skincare, Shop by Concern, Shop by Skin Type, Brands,
  Best Sellers, Bundles, Sale) are seeded once but are ordinary rows the
  admin can delete like any other category.
- **Product images**: `product_images` holds an ordered list of URLs per
  product; the first one doubles as `products.image_url`, the classic
  single cover image used anywhere a gallery isn't shown (cards, emails).
- **Soft delete**: deleting a product sets `is_active = 0` rather than
  removing the row, so past orders referencing it still display correctly.

## Structure

```
server/
  index.js          entrypoint, raw-body capture for webhooks
  db.js             SQLite schema (money as integer pesewas)
  config.js         env vars + feature flags
  seed.js           seeds categories + demo products (admin now optional here)
  payments/         PaymentProvider interface + implementations
  email/            EmailProvider interface + implementations
  routes/           products, orders, admin, customers, webhooks
  middleware/auth.js  requireAdmin, requireCustomer, optionalCustomer
public/
  index.html, category.html, product.html, cart.html, checkout.html,
  confirmation.html, account.html
  admin/index.html  admin dashboard (setup, login, orders, products, categories, settings)
  css/style.css     design tokens + components
  js/               main.js (cart/money/password-toggle/category-bar utils),
                     checkout.js, admin.js, account.js
  images/, favicon.ico, favicon.svg
```

## Before going live

- Set `PAYSTACK_SECRET_KEY`/`PAYSTACK_PUBLIC_KEY` and flip `PAYSTACK_ENABLED=true`
  once you have a confirmed Paystack merchant account, and register the
  webhook URL `https://yourdomain.com/api/webhooks/paystack` in the Paystack dashboard.
- Switch `EMAIL_PROVIDER=smtp` and fill in the `SMTP_*` vars so order-status
  emails actually send instead of just logging to the console.
- Replace the placeholder policy pages in `public/pages/` with real, reviewed copy.
- Replace `public/images/placeholder.png` and the seeded product image URLs
  with real product photography (multiple angles, via the admin product form).
- Put this behind HTTPS (the admin/customer cookies are marked `secure`
  automatically when `NODE_ENV=production`).

