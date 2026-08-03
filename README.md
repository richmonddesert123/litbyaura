# LitByAura

COD-first skincare storefront: Node.js/Express + SQLite backend, plain HTML/CSS/JS frontend, no build step.

**Deploying?** See [`DEPLOY.md`](./DEPLOY.md) for the GitHub → Render walkthrough (persistent disk setup, custom domain, env vars).
**Picking this project back up after a while, or handing it to someone else?** See [`HANDOFF.md`](./HANDOFF.md) — a much deeper reference covering every table, endpoint, and "don't undo this by accident" decision.

## Quick start

```bash
npm install
cp .env.example .env
node server/seed.js   # optional: seeds 3 demo products for local testing
npm start
```

Visit http://localhost:3000 for the store, http://localhost:3000/admin for the dashboard.
The first time you open `/admin`, you'll see a **Create admin account** form
instead of a login form — that only appears while zero admin accounts exist,
and disables itself forever the moment the first one is created.

Categories/taxonomy (concerns, skin types), default trust-bar messages, and
hero slideshow placeholders all seed themselves automatically on first boot —
`node server/seed.js` is only needed for the 3 fake demo *products*, and you
generally shouldn't run it against a real production database.

## What's here

- **Storefront**: browse **All** products (paginated, 25/page), **New
  Arrivals**, **Best Sellers**, or **Shop by Concern** / **Shop by Skin
  Type** / **Brands** via dropdown nav — each hides itself automatically if
  nothing currently matches it. Price range filter. Multi-image product
  galleries (click a thumbnail or swipe on mobile). Cart, guest or logged-in
  checkout, Buy Now bypass, order confirmation + tracking.
- **Customer accounts**: sign up / log in, saved shipping info that pre-fills
  future checkouts, order history, self-service password change, and a full
  "forgot password" emailed-link reset flow (min. 6 chars, confirm-password
  on every form that sets one).
- **Admin dashboard**: first-run self-setup (no CLI/env-var step needed),
  Orders (status lifecycle + customer notification emails), Products
  (multi-image, brand, best-seller flag, concern/skin-type tagging — slug is
  auto-generated from the name, never typed manually), Hero Slides (uncapped
  homepage slideshow, add/reorder/hide/delete), and Settings (trust-bar
  marquee messages + a separate static site banner, both editable without
  touching code).
- **SEO**: `/sitemap.xml` and `/robots.txt` are live routes generated fresh
  from the database (not static files), and product pages are
  server-rendered with real Open Graph/Twitter meta tags so sharing a
  product link on WhatsApp/Facebook/etc. shows the actual photo and price.
- **Mobile-responsive** throughout, audited page-by-page for horizontal
  overflow.

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
  while the `admins` table is empty. Once one admin exists, that route 403s permanently.
- **Passwords**: admin and customer passwords both require a minimum of 6
  characters, are bcrypt-hashed, and each account type has its own
  self-service "change password" flow plus a separate emailed single-use
  reset-link flow, each with its own token table.
- **Taxonomy**: "Shop by Concern" (10 fixed values) and "Shop by Skin Type"
  (5 fixed values) are a *fixed* list — no admin CRUD, seeded automatically
  in `server/db.js`, multi-select per product. "Brands" is free-text typed
  per product. "Best Sellers" is a boolean toggle. None of this is the old
  generic categories system — that's been fully removed.
- **Product images**: `product_images` holds an ordered list of URLs per
  product; the first one doubles as `products.image_url`, the cover image
  used anywhere a gallery isn't shown (cards, emails, social share previews).
- **Soft delete**: deleting a product sets `is_active = 0` rather than
  removing the row, so past orders referencing it still display correctly.
- **DB_PATH**: configurable via env var so it can point at a mounted
  persistent disk in production instead of the app directory (which is
  ephemeral on most hosts) — see `DEPLOY.md`.

## Structure

```
server/
  index.js                entrypoint; also registers the server-rendered
                           /product.html route BEFORE express.static
  db.js                    SQLite schema (money as integer pesewas);
                           auto-seeds taxonomy/announcements/hero-slides on boot
  config.js                env vars + feature flags
  seed.js                  optional: 3 demo products for local dev only
  render-product-meta.js   injects real product data into product.html's
                           meta tags server-side (for social share previews)
  payments/                PaymentProvider interface + implementations
  email/                   EmailProvider interface + implementations
  routes/                  products, orders, admin, customers, webhooks, sitemap
  middleware/auth.js       requireAdmin, requireCustomer, optionalCustomer
public/
  index.html, shop.html, product.html, cart.html, checkout.html,
  confirmation.html, account.html, reset-password.html
  admin/index.html         admin dashboard (setup, login, Orders, Products,
                           Hero Slides, Settings)
  css/style.css            design tokens + components, mobile breakpoints
  js/                      main.js (shared utils incl. renderShopNav,
                           renderSiteBanner, setupPriceFilter), checkout.js,
                           admin.js, account.js
  images/, favicon.ico, favicon.svg
render.yaml                Render Blueprint (web service + persistent disk)
DEPLOY.md                  GitHub → Render deployment guide
HANDOFF.md                 deep technical reference + full change history
```

## Before going live

- Set `PAYSTACK_SECRET_KEY`/`PAYSTACK_PUBLIC_KEY` and flip `PAYSTACK_ENABLED=true`
  once you have a confirmed Paystack merchant account, and register the
  webhook URL `https://yourdomain.com/api/webhooks/paystack` in the Paystack dashboard.
- Switch `EMAIL_PROVIDER=smtp` and fill in the `SMTP_*` vars so order-status
  and password-reset emails actually send instead of just logging to the console.
- Replace the placeholder policy pages in `public/pages/` with real, reviewed copy.
- Add real product photography via the admin Products form (multiple angles supported).
- Set `BASE_URL` to your real domain — used in password-reset links and the sitemap.
- Submit `https://yourdomain.com/sitemap.xml` to Google Search Console.
- Make sure `DB_PATH` points at a persistent disk if deploying somewhere with
  an ephemeral filesystem (see `DEPLOY.md`) — otherwise your database gets
  wiped on every deploy/restart.
