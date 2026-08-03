# LitByAura — Project Handoff

Read this instead of the codebase to get oriented. It's a COD-first skincare
e-commerce store: Node.js/Express + SQLite (better-sqlite3) backend, plain
HTML/CSS/JS frontend (no build step, no framework). Single-tenant, self-hosted.

Status as of this handoff: **fully working, smoke-tested end to end**
(server boot, seed, all major flows below verified via curl + a Playwright
screenshot pass). Not yet deployed anywhere; runs on `localhost:3000`.

### Most recent round

- **Fixed silent auto-save UX (hero slides + trust-bar messages).** Both
  previously saved on `onblur` with zero visual confirmation — genuinely
  confusing, since there was no way to tell "did that save, or did I just
  lose it by clicking away?" Both now have an explicit **Save** button and a
  confirmation toast ("Slide saved" / "Message saved"). Verified end-to-end
  for both: edited a field, clicked Save, confirmed the toast appeared AND
  the change actually persisted after a reload. Audited the rest of the
  admin panel for the same pattern (`grep -rn "onblur="`) — nothing else
  had it; order-status changes and the (removed) category system already
  had proper confirmations or explicit submit actions.
- **New: static site banner**, distinct from the trust-bar marquee. Single
  message, not scrolling, optionally a clickable link, admin toggles it on/
  off without losing the saved message/link. Backed by a `site_banner`
  table with exactly one row (`id=1`, enforced via `CHECK (id = 1)`) rather
  than a list — `GET /api/site-banner` returns `null` if it's off or was
  never configured, and the frontend (`renderSiteBanner()` in `main.js`)
  just hides the `#site-banner` element entirely in that case. Admin UI
  lives in Settings, above the trust-bar section, with its own Save button
  from the start (learned from the mistake above). **Homepage only** — the
  `<div id="site-banner">` container + `renderSiteBanner()` call live in
  `index.html` alone; every other customer-facing page originally had this
  too but it was deliberately removed per a follow-up request, so if
  "show it everywhere" is wanted later, the pattern to restore is: add the
  same div right after `<body>` and a `renderSiteBanner();` call after the
  `main.js` script tag (the static policy pages under `pages/` would also
  need `<script src="/js/main.js"></script>` re-added, since it's not
  loaded there for anything else). Verified via Playwright across 7 pages:
  present only on `/`, absent on shop/product/cart/checkout/account/contact.

 `GET /sitemap.xml` and `GET
  /robots.txt` are now live routes (`server/routes/sitemap.js`) generated
  fresh from the DB on every request — not static files — so the sitemap
  always reflects current active products/concerns/skin-types/brands with no
  manual regeneration step. Verified: valid XML (parsed with Python's
  ElementTree), correct `lastmod` per product, ampersands properly escaped
  in query-string URLs (e.g. `?view=concern&amp;slug=...`).
  **`product.html` is now server-rendered for its `<head>`**, not just a
  static file — `server/render-product-meta.js` reads the requested
  `?slug=`, looks up the real product, and injects title/description/
  `og:image`/price into `{{META_*}}` placeholder tokens in the HTML before
  sending it. This matters because link-preview bots (WhatsApp, Facebook,
  Twitter/X, Slack, iMessage) generally don't execute JavaScript when
  building a share-card preview — they only read the initial HTML response.
  Without this, every shared product link would show a generic "LitByAura"
  card instead of that product's actual photo/name/price. **This route MUST
  stay registered in `server/index.js` before `app.use(express.static(...))`**
  — if `express.static` runs first, it'll serve the raw file with unreplaced
  `{{...}}` tokens and this route never fires. Falls back to generic
  meta/placeholder image if the slug is missing or the product isn't
  found/inactive. Verified: real product data injected for a valid slug,
  clean generic fallback for a missing one, zero leftover `{{}}` tokens
  either way, and the page still fully functions in-browser afterward
  (gallery, add-to-cart, etc. all still worked in a Playwright check).
  Also added: `noindex, nofollow` on cart/checkout/account/confirmation/
  reset-password/admin (none of these should show up in search results),
  meta descriptions + OG/Twitter tags on the homepage and `shop.html` (the
  latter updates its description/OG tags per-view via JS, e.g. a "Shop by
  Concern → Acne & Breakouts" page gets its own description), and meta
  descriptions on all five static policy/contact pages.

### Earlier rounds (most recent first)

**Logo image slot.** The text-based "LitByAura" wordmark (`Lit<span>ByAura</span>`)
is replaced everywhere with `<img src="/images/logo.png" class="logo-img">`
— 13 main-site pages plus the admin sidebar mini-logo, all pointing at the
same single file. `public/images/logo.png` currently holds a generated
placeholder that visually matches the old text logo, so nothing looks
broken until the real logo is dropped in. **To use a real logo: just
overwrite `public/images/logo.png` with the same filename** — no HTML/CSS
changes needed. Sizing is handled by one CSS rule, `.logo-img { height:
0.8em; width: auto; }`, which resolves relative to whatever font-size the
`<img>` inherits from its container — that's why one rule correctly
produces a ~38px logo in the main 3rem header, ~24px on the 1.9rem mobile
header, and ~15px in the 1.2rem admin sidebar without any per-context
overrides. If a differently-shaped logo (e.g. very tall/square vs. wide)
looks off at some size, adjust that single `em` multiplier rather than
adding new rules per page. Verified via Playwright: image actually loads
(not a broken `<img>`), correct proportional size at desktop/mobile/admin,
and mobile still has zero horizontal overflow with it in place.

**How this interacts with the `.logo` font-size** (currently `7rem`, see
Design System section below): `.logo-img` is sized in `em` units (`height:
0.8em`), which resolve relative to the font-size of its container — so
bumping `.logo`'s font-size doesn't just resize invisible text, it also
scales the actual logo image proportionally. Confirmed no conflict: at
`7rem`, the logo image renders at ~90px tall on desktop; the mobile
override still caps `.logo` at `1.9rem` so the image stays a sane ~30px
there instead of blowing out the mobile header.

**Hero slideshow moved to the database + admin panel, uncapped.** Was
hardcoded to exactly 4 files (`hero-slide-1..4.jpg`) referenced directly in
`index.html`. Now backed by a `hero_slides` table (seeded from those same
4 files so upgrading doesn't start empty) with a public `GET
/api/hero-slides` and full admin CRUD + reorder at `/api/admin/hero-slides`
(same pattern as `announcements` below). New **"Hero Slides" admin tab**:
paste an image URL + optional caption, inline-edit either field, ↑/↓
reorder, Hide/Show toggle (soft, doesn't delete), delete. `index.html`'s
slideshow JS now builds slide `<div>`s from the fetched list instead of
expecting hardcoded markup - verified end-to-end (add/reorder/hide/delete
all correctly reflected on the public endpoint).

**Removed the duplicate "LitByAura" wordmark from the homepage footer** —
it repeated the header logo directly above the copyright line. Confirmed
via grep that no other page had this pattern (they only ever had the
plain copyright line), so this was homepage-only.

**Mobile responsiveness pass.** Audited every page at a 375px viewport
with Playwright (checking `document.documentElement.scrollWidth` vs
`clientWidth` for horizontal overflow) and fixed what it found:
- Header now wraps into two rows on narrow screens (logo + account/cart
  icons on row one, nav links centered on row two) instead of squeezing
  everything into one line — see the `@media (max-width: 640px)` block
  right after `.site-header`.
- Admin dashboard sidebar (`.admin-shell`) collapses from the fixed
  220px-sidebar grid into a horizontally-scrollable top bar below 860px —
  otherwise it was unusable on a phone.
- Admin tables (`.admin-card .admin-table`) get `min-width: 560px` inside
  an `overflow-x: auto` wrapper instead of squashing columns illegibly.
- Nav dropdowns (`.shop-nav-dropdown`) are now centered under their toggle
  (`left: 50%; transform: translateX(-50%)`) with `max-width: calc(100vw -
  32px)` instead of anchoring left, which could push them off the right
  edge of a narrow screen.
- **Root cause found and fixed**: the cart-count badge (the small "0"
  circle on the cart icon) was spilling ~12px past the viewport edge on
  every page at mobile width — its `right: -12px` offset assumed more
  breathing room than the mobile header actually had. Gave `.header-actions`
  a small `margin-right` on mobile so there's room for it.
- Also added `overflow-x: hidden` on `html`/`body` as a defensive
  safety net (standard practice) so any *future* stray element can't
  reintroduce a horizontal scrollbar site-wide the same way. Don't rely on
  this alone though — the audit script above is the real check; rerun it
  (`/tmp` scripts aren't saved, but the pattern is: Playwright at 375px
  viewport, compare `scrollWidth` to `clientWidth` on every page) after
  any layout change.
- Re-verified desktop (1280px) afterward — logo still 48px/3rem, hero
  slideshow still renders, nothing regressed.

### Recent fixes (earlier rounds)
- **Schema migration bug, now fixed**: a user hit `SqliteError: table orders
  has no column named customer_id` — they had a `litbyaura.db` created
  before customer accounts/order emails were added, and `CREATE TABLE IF NOT
  EXISTS` never alters an existing table. `server/db.js` now runs an
  `ensureColumn(table, column, definition)` migration step after the schema
  block (currently backfills `orders.customer_id` and `orders.email`) —
  it's idempotent and runs on every boot. **If you add more columns to an
  existing table in the future, add an `ensureColumn(...)` call for it too,
  or anyone with a pre-existing DB file will hit the same class of bug.**
  Verified by reconstructing the old pre-migration schema and confirming
  boot auto-repairs it and order creation/order history both work after.
- **Header/nav consistency**: `cart.html`, `checkout.html`, and
  `account.html` previously had different (and in cart/checkout's case,
  incomplete — missing nav links, no category bar) headers than the rest of
  the site, and the cart link had no text label anywhere (icon + count
  only). All pages now share the same header markup (Shop/Reviews/Contact +
  Account + "🛍️ Cart <count>") and the shopping-flow pages all render the
  category bar. `account.html` also gained a page `<h1>` that switches
  between "Log in or create an account" and "Hi, {name}" — it had no
  heading before, so there was no obvious page title while logged out.
- **Admin → storefront link**: admin nav sidebar now has a "↗ View store"
  link (opens `/` in a new tab, `target="_blank"`) above the tab list.
- **Confirm-password everywhere a password is set**: every form that sets a
  new password — admin first-run setup, admin change-password, admin/
  customer reset-password (`reset-password.html`), customer signup, customer
  change-password — now has a second "confirm" field. Validated client-side
  via `passwordsMatch(passwordInputId, confirmInputId)` in `public/js/main.js`
  before the API call fires (toasts "Passwords do not match" and aborts
  submission on mismatch; verified via Playwright that the API is NOT called
  on mismatch, and that fixing the confirm field and resubmitting succeeds).
- **Server-side price filtering**: `GET /api/products` now accepts
  `?minPrice=`/`?maxPrice=` (pesewas integers), combinable with the taxonomy
  filters below. Wired into `shop.html` via a shared `setupPriceFilter(onApply)`
  helper in `main.js` — customers enter a min/max in cedis, converted to
  pesewas before hitting the API.
- **Admin dashboard modernization**: Orders/Products tabs now open with a
  `.stat-grid` of summary cards (total orders, in-progress count, pending-COD
  count, revenue collected / active products, best sellers, low-stock,
  out-of-stock), and tables sit in a bordered `.admin-card` container instead
  of bare. Customer account profile/password tabs got the equivalent
  `.panel-card` treatment (a *different* CSS class from `.summary-card`,
  which is `position: sticky` for the checkout sidebar — don't merge these
  back into one class without dropping the sticky rule first).
- **Full taxonomy replacement — the old generic categories system is gone.**
  Replaced with a fixed, purpose-built structure:
  - **All** — every active product, 25/page, prev/next only (`GET
    /api/products/all?page=`), served from its own endpoint separate from
    the general one below so every other view stays a plain array.
  - **New Arrivals** — most recent 20 active products (`?newArrivals=1`).
  - **Shop by Concern** — 10 fixed values (Acne & Breakouts, Dark Spots &
    Hyperpigmentation, Anti-Aging, Dry Skin, Oily Skin, Sensitive Skin,
    Redness, Large Pores, Dull Skin, Uneven Skin Tone), multi-select
    checkboxes on the product form, stored in `concerns`/`product_concerns`.
  - **Shop by Skin Type** — 5 fixed values (Normal, Dry, Oily, Combination,
    Sensitive), same pattern, `skin_types`/`product_skin_types`.
  - **Brands** — free-text `products.brand` column, admin just types it; the
    nav lists whatever distinct brand strings are currently in use.
  - **Best Sellers** — `products.is_best_seller` boolean, admin toggles it
    per product.
  Concerns and skin types are a **fixed list with no admin CRUD** (unlike the
  old categories system) — seeded automatically in `server/db.js` on every
  boot (idempotent `INSERT OR IGNORE`), not via `npm run seed`. The old
  `categories`/`product_categories` tables and their admin CRUD routes are
  gone entirely (not just deprecated) — an old DB file still has those
  tables sitting unused on disk (harmless, nothing reads them anymore).
  Nav is a dropdown (click-to-toggle, not hover-only, so it works on
  touch) built by `renderShopNav()` in `main.js`; any dropdown item with
  zero matching active products is hidden automatically — verified with
  zero products seeded, all four taxonomy endpoints correctly return `[]`.
  `category.html` was deleted and replaced by `shop.html`, a single page
  driven by `?view=all|new-arrivals|concern|skin-type|brand|best-sellers`
  (+`&slug=`/`&name=` for the two taxonomy views and `&page=` for `all`).

## How to run it

```bash
npm install
cp .env.example .env
npm run seed      # seeds 9 default categories + 3 demo products; admin is NOT created here anymore
npm start          # or: npm run dev  (--watch)
```

Then open `/admin` — since no admin exists yet, a **first-run setup form**
appears instead of a login form. Fill it in once; that route (`POST
/api/admin/setup`) then 403s forever. (`ADMIN_EMAIL`/`ADMIN_PASSWORD` in
`.env` still work as an optional CLI alternative via `npm run seed`, kept for
scripted deploys, but the UI path is now the primary one.)

No `.env` is committed (removed before packaging). `.env.example` documents
every variable. Nothing is enabled by default except Cash on Delivery and the
console email provider (logs to stdout, sends nothing real).

## Directory map

```
server/
  index.js              Express entrypoint. Registers all routers. Captures
                         req.rawBody ONLY for /api/webhooks/* (needed for
                         HMAC signature verification — see below).
  db.js                 SQLite schema + connection (better-sqlite3, WAL mode).
                         ALL money columns are INTEGER pesewas (1 GHS = 100
                         pesewas). Converted to cedis only at the UI edge.
  config.js              Reads .env into one object incl. feature flags
                         (config.payments.paystack.enabled etc).
  seed.js                 Seeds admin (optional, only if ADMIN_EMAIL/PASSWORD
                         set) + 3 demo products. Concerns/skin types are
                         seeded automatically in db.js instead, not here.
  payments/
    PaymentProvider.js    Abstract base class: id, label, isEnabled(),
                          initiate(order), verify(order), handleWebhook(req).
    CodProvider.js        Always enabled, no credentials, no webhooks.
    PaystackProvider.js   Real HMAC-SHA512 webhook verification over raw
                          body. Gated by BOTH PAYSTACK_SECRET_KEY (works) AND
                          PAYSTACK_ENABLED=true (customer-visible). Currently
                          disabled by default — untested against a live
                          Paystack account, code is written but not exercised
                          end-to-end with real credentials.
    index.js               Registry: providers{}, getProvider(id),
                          listEnabledProviders(), isProviderUsable(id).
  email/
    EmailProvider.js       Abstract: send({to, subject, text, html}).
    ConsoleEmailProvider.js  Default. console.log's the email, doesn't send.
    SmtpEmailProvider.js     nodemailer wrapper, used when EMAIL_PROVIDER=smtp.
    index.js                Picks implementation from config.email.provider.
  middleware/auth.js
    requireAdmin      401s without a valid admin_token cookie.
    requireCustomer   401s without a valid customer_token cookie.
    optionalCustomer  Attaches req.customer if present, never blocks
                      (used on POST /api/orders so guest checkout still works).
  routes/
    products.js    Public: GET /api/products (concern/skinType/brand/
                   bestSeller/newArrivals/minPrice/maxPrice filters, all
                   combinable), GET /api/products/all (paginated "All" view,
                   different response shape - see API surface above), GET
                   /api/products/:slug, GET /api/concerns, GET /api/skin-types
                   (both: only entries with ≥1 active product by default,
                   ?all=1 for the full fixed list), GET /api/brands.
    orders.js      POST /api/orders (guest or logged-in via optionalCustomer),
                   GET /api/orders/:orderNumber, GET /api/payment-methods.
                   Exports: router, restoreStockIfNeeded(orderId),
                   sendOrderStatusEmail(order, status) — both imported by
                   admin.js and webhooks.js. Contains the stock-reservation
                   transaction and the STATUS_EMAIL_COPY map (confirmed/
                   shipped/delivered/completed/cancelled).
    admin.js       Everything under /api/admin. First-run setup
                   (GET setup-status, POST setup — only while admins table
                   is empty), login/logout, password-reset (emailed token)
                   AND change-password (requires current password, both min
                   6 chars), then requireAdmin-gated: products CRUD (handles
                   brand, isBestSeller, concernIds[], skinTypeIds[] and
                   images[] in one PUT/POST, replaces product_concerns +
                   product_skin_types + product_images rows on every save —
                   no categories CRUD anymore, concerns/skin types are fixed),
                   orders list/detail, order status update (fires
                   sendOrderStatusEmail when fulfillment_status changes;
                   fulfillment_status is free TEXT, no CHECK constraint, so
                   any string works — admin UI offers a preset list + "Other…" prompt).
    customers.js   Public + requireCustomer-gated: signup, login, logout,
                   me (GET/PUT — PUT updates saved shipping info), 
                   change-password, me/orders (order history/tracking).
    webhooks.js    POST /api/webhooks/:provider. Verifies signature via
                   provider.handleWebhook(req) before trusting anything;
                   on 'failed' calls restoreStockIfNeeded (idempotent, guarded
                   by orders.stock_restored flag).
    sitemap.js     GET /sitemap.xml and GET /robots.txt - both generated
                   fresh from the DB on every request (not static files),
                   so they always reflect current active products/taxonomy.
  render-product-meta.js  NOT in routes/ - imported directly by index.js and
                   registered as app.get('/product.html', ...) BEFORE
                   express.static (order matters, see comment in index.js).
                   Reads ?slug=, looks up the real product, injects title/
                   description/og:image/price into {{META_*}} tokens in
                   product.html before sending - so link-preview bots that
                   don't run JS (WhatsApp, Facebook, Slack, etc.) see the
                   real product instead of a generic card.
public/
  index.html            Homepage: hero, shop-nav dropdown, curated preview
                         grid (best sellers if any exist, else newest 8),
                         "View all products" → shop.html?view=all.
  shop.html              THE generic listing page — driven entirely by
                         ?view=all|new-arrivals|concern|skin-type|brand|best-sellers
                         (+&slug=/&name= for the taxonomy views, &page= for
                         "all"). Price filter always available; prev/next
                         pagination only rendered for view=all. Replaces the
                         old category.html (deleted).
  product.html           Image gallery (click thumbnail OR swipe on touch),
                         qty picker, Add to cart, Buy Now (?buyNow=id&qty=n
                         link straight to checkout.html), and taxonomy badges
                         (best-seller star, brand, concerns, skin types - each
                         badge links to the matching shop.html filtered view).
  cart.html               Reads/writes localStorage cart, qty +/-, remove.
  checkout.html + js/checkout.js
                         THE BUY-NOW BYPASS LIVES HERE: getCheckoutSource()
                         checks for ?buyNow= in the URL; if present, cart is
                         NEVER read and is NOT cleared after order. Otherwise
                         reads/clears the normal cart. Also: if logged in,
                         prefillFromAccount() fills name/phone/email/address/
                         city from GET /api/customers/me. Payment method list
                         comes from GET /api/payment-methods (server is the
                         real gate on what's offered, not just UI hiding).
  account.html + js/account.js
                         Combined login/signup (logged out) and profile/
                         order-history/change-password (logged in) screen,
                         tab-switching via data-auth-tab / data-account-tab.
  confirmation.html      /order/:orderNumber/confirm — order lookup + status pills.
  admin/index.html + js/admin.js
                         Three screens toggled by JS: #setup-screen (first
                         run only), #login-screen, #dashboard (3 tabs: orders,
                         products, settings/change-password — no categories
                         tab anymore). Product modal has a brand text input,
                         a best-seller checkbox, and two separate checkbox
                         groups (.concern-check / .skintype-check classes,
                         kept distinct so the submit handler doesn't mix them
                         up) built from GET /api/concerns?all=1 and GET
                         /api/skin-types?all=1 (full fixed lists, not the
                         "only in use" ones the public nav gets).
  js/main.js              SHARED utilities loaded on every page: formatMoney,
                         cart localStorage helpers, api() fetch wrapper, toast(),
                         setupPasswordToggles() (wires .password-field eye-icon
                         buttons — call this after injecting any new password
                         field into the DOM), setupPriceFilter(onApply),
                         passwordsMatch(id1, id2), and renderShopNav(activeView)
                         (fetches concerns/skin-types/brands/best-sellers in
                         parallel, injects the dropdown nav into a
                         #shop-nav element if present, hides any dropdown
                         with zero results, wires click-to-toggle + click-away-
                         to-close on the dropdowns).
  css/style.css          All design tokens + component styles, single file,
                         no preprocessor. See "Design system" below.
  pages/*.html            Static placeholder policy pages (privacy, returns,
                         shipping, terms, contact) — explicitly marked as
                         placeholders needing real legal review before launch.
  images/, favicon.*      Generated placeholder product image + favicon
                         (actual binary files, not just <link> tags).
```

## Database schema (server/db.js)

- `products` — id, slug (unique), name, description, price_pesewas,
  compare_at_pesewas (nullable), image_url (cover/fallback, kept in sync with
  first row of product_images), stock, brand (free text, admin-typed, default
  ''), is_best_seller (0/1, admin toggle), is_active (soft delete flag), created_at.
- `product_images` — id, product_id, url, sort_order. Ordered gallery "angles".
- `concerns` — id, slug (unique), name. **Fixed list, no admin CRUD** — the
  10 "Shop by Concern" values, seeded automatically on every boot.
- `skin_types` — id, slug (unique), name. Fixed list, the 5 "Shop by Skin
  Type" values, same seeding pattern.
- `product_concerns` / `product_skin_types` — (product_id, concern_id) /
  (product_id, skin_type_id) composite PKs, many-to-many, admin multi-select
  checkboxes on the product form write these.
- `customers` — id, name, email (unique), password_hash, phone, address, city
  (address/city = saved shipping info reused at checkout), created_at.
- `orders` — id, order_number (unique, format `LBA-<timestamp36>-<hex>`),
  customer_id (nullable FK — null means guest order), customer_name, phone,
  email (nullable, used for status notification emails), address, city,
  notes, subtotal_pesewas, payment_method, payment_status
  (pending/paid/failed/cancelled), fulfillment_status (free TEXT, no
  constraint — UI defaults to processing/confirmed/shipped/delivered/
  completed/cancelled but admin can type anything), provider_reference
  (external payment tx id), stock_restored (0/1 guard flag), created_at.
- `order_items` — snapshot rows: product_name and unit_price_pesewas are
  copied at order time so history stays correct even if the product changes
  or is later hidden.
- `admins` — id, email (unique), password_hash, created_at. No role/permission
  levels — every admin can do everything.
- `password_reset_tokens` / `customer_password_reset_tokens` — admin_id or
  customer_id, token_hash (sha256 of a random 32-byte token — raw token is
  never stored, only sent via the `EmailProvider`), expires_at (1hr), used
  (single-use guard). Two separate tables, one per account type.
- `announcements` — id, text, sort_order, is_active, created_at. Trust-bar
  marquee messages, fully admin-editable (add/edit/reorder/delete) at
  `/admin` → Settings, no code changes needed. Seeded with 4 defaults on
  first boot only (won't re-seed or overwrite admin edits).
- `hero_slides` — id, image_url, caption, sort_order, is_active, created_at.
  Homepage hero slideshow images, same admin-editable pattern as
  announcements, at `/admin` → Hero Slides. Seeded from the 4 originally
  hardcoded placeholder files on first boot only.

Note: the old `categories`/`product_categories` tables from an earlier round
are **no longer created** by the schema block, but if you're running against
a DB file from before this taxonomy rewrite, those tables still physically
exist on disk with old data — completely harmless, nothing in the app reads
them anymore, just dead weight. Not worth writing a migration to drop them.

Foreign keys reference tables that are defined later in the same CREATE
script (e.g. `orders.customer_id → customers`) — this works fine in SQLite
because FK existence isn't checked at CREATE TABLE time, only at DML time,
and by the time any INSERT happens all tables exist.

## Full API surface

```
Public:
  GET    /api/products                    ?concern=<slug>, ?skinType=<slug>, ?brand=<name>,
                                           ?bestSeller=1, ?newArrivals=1 (top 20), ?minPrice=/?maxPrice=
                                           (pesewas) — all combinable. No filters = every active
                                           product, unpaginated (used by cart/checkout to resolve IDs).
  GET    /api/products/all                ?page=<n> — the "All" nav view, 25/page, returns
                                           {products, page, perPage, total, totalPages, hasNext, hasPrev}
                                           (a different response SHAPE than the endpoint above — it's an
                                           object, not a bare array; don't reuse one parser for both)
  GET    /api/products/:slug              includes brand, isBestSeller, concerns[], skinTypes[], images[]
  GET    /api/concerns                    only concerns with ≥1 active product; ?all=1 → full fixed list (admin form)
  GET    /api/skin-types                  same pattern as concerns
  GET    /api/brands                      distinct brand strings in use by active products
  GET    /api/announcements                active trust-bar messages, ordered
  GET    /api/hero-slides                  active homepage slideshow images, ordered
  GET    /sitemap.xml                       generated fresh from DB, not a static file
  GET    /robots.txt                        also generated fresh (uses config.baseUrl)
  GET    /product.html                      NOT a static file - server-rendered, see
                                            render-product-meta.js above
  GET    /api/payment-methods              enabled providers only (COD always included)
  POST   /api/orders                       optionalCustomer — links customer_id if logged in
  GET    /api/orders/:orderNumber
  POST   /api/webhooks/:provider           signature-verified, provider-specific

Customer (cookie: customer_token, 30-day expiry):
  POST   /api/customers/signup
  POST   /api/customers/login
  POST   /api/customers/logout
  GET    /api/customers/me                 requireCustomer
  PUT    /api/customers/me                 requireCustomer — updates shipping info
  POST   /api/customers/change-password    requireCustomer — min 6 chars
  POST   /api/customers/password-reset/request   public, always 200 (doesn't leak account existence)
  POST   /api/customers/password-reset/confirm   public, needs valid unexpired unused token
  GET    /api/customers/me/orders          requireCustomer — order history/tracking

Admin (cookie: admin_token, 12h expiry):
  GET    /api/admin/setup-status           public — {hasAdmin: bool}
  POST   /api/admin/setup                  public but 403s if hasAdmin already true
  POST   /api/admin/login
  POST   /api/admin/logout
  POST   /api/admin/password-reset/request  public, always 200 (doesn't leak account existence)
  POST   /api/admin/password-reset/confirm  public, needs valid unexpired unused token
  --- everything below requires requireAdmin ---
  GET    /api/admin/me
  POST   /api/admin/change-password
  GET    /api/admin/products               includes images[], concernIds[], skinTypeIds[]
  POST   /api/admin/products                accepts brand, isBestSeller, concernIds[], skinTypeIds[], images[]
                                            (no slug field — server auto-generates one from name via
                                            slugify() + uniqueSlugFromName(), appending -2, -3... on collision)
  PUT    /api/admin/products/:id
  DELETE /api/admin/products/:id           soft delete (is_active = 0)
  GET    /api/admin/orders
  GET    /api/admin/orders/:id
  PUT    /api/admin/orders/:id/status      { paymentStatus?, fulfillmentStatus? }
                                            triggers status email + stock rollback
  GET    /api/admin/announcements
  POST   /api/admin/announcements          { text }
  PUT    /api/admin/announcements/:id      { text?, isActive? }
  DELETE /api/admin/announcements/:id
  POST   /api/admin/announcements/:id/move { direction: 'up'|'down' }
  GET    /api/admin/hero-slides
  POST   /api/admin/hero-slides            { imageUrl, caption? }
  PUT    /api/admin/hero-slides/:id        { imageUrl?, caption?, isActive? }
  DELETE /api/admin/hero-slides/:id
  POST   /api/admin/hero-slides/:id/move   { direction: 'up'|'down' }
```

## Key architectural decisions (the "why", so you don't undo them by accident)

1. **COD is the default payment method, not a fallback.** No processor
   dependency, always enabled, no config needed. Paystack is opt-in behind
   two independent switches (credential present AND explicitly enabled).
2. **Money is always an integer (pesewas)** everywhere in the DB and in
   API payloads. Only `formatMoney()` in the frontend divides by 100. Do
   not introduce decimal/float money anywhere.
3. **Buy Now is a true bypass**, not "add to cart then redirect." See
   `checkout.js` `getCheckoutSource()`. If you touch checkout, preserve this
   — a regression here was explicitly called out as a past bug.
4. **Stock is reserved at order-creation**, not at payment confirmation
   (COD has no separate confirmation step). Rollback (`restoreStockIfNeeded`)
   is idempotent via `orders.stock_restored`, safe to call from both the
   webhook handler and the admin status-update handler for the same order.
5. **Payment/email providers are behind interfaces** (`PaymentProvider`,
   `EmailProvider`). Adding a new payment method or email backend should
   only ever require one new file + one line in the relevant `index.js`
   registry — never touching checkout/order/admin code.
6. **Webhook signatures are verified over the raw request body**, captured
   via `express.json({ verify })` scoped to `/api/webhooks/*` only. Never
   trust `req.body` on a webhook route without this.
7. **No self-service admin escalation.** `POST /api/admin/setup` is the
   only admin-creation path and it hard-403s once any admin exists. There is
   no route anywhere that lets an authenticated (or unauthenticated) request
   grant admin to an account on a store that already has one.
8. **Soft delete only** for products (`is_active = 0`) — historical orders
   reference product_id and must keep rendering correctly.
9. **Passwords**: bcrypt (cost 12), minimum 6 characters, enforced both
   client-side (`minlength`) and server-side (authoritative check). Both
   admin and customer accounts have (a) a logged-in "change password"
   endpoint requiring the current password, and (b) their own emailed,
   single-use reset-link flow (1hr expiry, token hashed at rest, separate
   `password_reset_tokens` / `customer_password_reset_tokens` tables). Both
   reset-request handlers send through the shared `EmailProvider` — no more
   raw `console.log`ing of tokens. Both land on `public/reset-password.html`
   (`?type=admin|customer&token=...`). The admin "Forgot password?" entry
   point opens an in-page modal (`openForgotPasswordModal()` in
   `public/js/admin.js`) — it used to call the browser's `prompt()`, which
   was explicitly fixed; don't reintroduce `prompt()`/`alert()`/`confirm()`
   for user-facing flows like this (the one remaining `prompt()`, for typing
   a custom order fulfillment status in the admin orders tab, was left as-is
   since it wasn't part of this ask).
10. **localStorage is used for the cart** (`public/js/main.js`) — this is
    fine here because it's a real deployed site the user runs themselves,
    NOT a claude.ai artifact preview (where browser storage is unavailable).
    Don't "fix" this thinking it's a mistake.

## What's implemented vs. what's still a stub / untested

Implemented and smoke-tested (curl + Playwright screenshots):
taxonomy filtering (concern/skinType/brand/bestSeller/newArrivals, all
combinable with price range), "All" pagination (25/page verified with 27
seeded products → correctly 2 pages), product CRUD w/ images+brand+
bestSeller+concerns+skinTypes (full create→edit round-trip verified),
hide-when-empty nav behavior (verified with zero products seeded → all four
taxonomy endpoints return `[]`), order creation (guest +
logged-in), stock reservation + oversell rejection, payment-method gating,
admin first-run setup + login + change-password + reset flow, customer
signup/login/profile-update/change-password/order-history, order status
update + notification emails (console provider), buy-now bypass, image
gallery rendering.

Not yet exercised against real external services:
- **Paystack**: code path is complete (initiate/verify/webhook HMAC) but
  never called with real credentials — `PAYSTACK_ENABLED=false` by default.
  If enabling, test `initiate()`'s `authorization_url` redirect and the
  webhook round-trip against Paystack's test mode first.
- **SMTP email**: `SmtpEmailProvider` is written (nodemailer) but
  `EMAIL_PROVIDER=console` is the default; nothing has actually been sent
  through real SMTP. Verify with a real `SMTP_HOST`/`SMTP_USER` before relying
  on it for production order-status emails.
- **Hubtel**: mentioned in the original lessons doc and in `.env.example`/
  README as a future provider, but **no `HubtelProvider.js` exists yet** —
  only env var placeholders. Not started.

Known simplifications / things a next pass might want to address:
- Product images are **URL strings only** — there's no file upload endpoint;
  admin pastes image URLs (or `/images/placeholder.png`) into the product
  form. If real image upload is wanted, that's new work (multer or similar
  was deliberately removed as an unused dependency earlier).
- Admins have no role/permission tiers — any admin account can do anything.
- No automated test suite (Jest/etc.) — verification so far has been manual
  curl scripts + Playwright screenshots during the build session, not
  checked-in tests.
- No rate limiting / brute-force protection on login or signup endpoints.
- Category deletion doesn't warn if it's the last category a product has —
  product just ends up with fewer/zero categories, which is allowed.
- Policy pages (`public/pages/*.html`) are explicitly placeholder copy.

## Design system (public/css/style.css)

Brand: warm "aura glow" aesthetic, deep ink background, gold accent, blush
secondary, forest green reserved for success/trust states only.
```
--ink: #15110d        --gold: #d9a441       --blush: #e8b8a0
--ink-raised: #1d1712  --gold-bright: #f0c169  --forest: #3a4f3d / --forest-bright: #6b9e73
--cream: #f7f2e9       --cream-dim: #c9c0b0    --danger: #c0605a
Fonts: Fraunces (display/headings), Manrope (body), Space Grotesk (utility/labels/prices/eyebrows)
```
Signature element: a radial gold/blush "aura" glow (`.hero::before`,
`aura-pulse` keyframe) behind hero art, echoing the brand name. Logo is
`font-size: 7rem` in `.logo` — went 1.5rem → 3rem → **7rem**, each bump a
deliberate request (the last one made directly in the CSS file, not via
Claude). **Don't shrink this back down "for consistency" or "to fix
spacing" without checking first** — it's intentional, not a bug. Because of
this, `.site-header .wrap` uses `height: auto` with vertical padding rather
than a fixed pixel height, specifically so the header keeps accommodating
whatever size the logo ends up at without clipping it (verified: header
auto-grows to ~150px tall at 7rem with the logo fully visible, no overflow).
The mobile breakpoint (`@media max-width: 640px`) still caps it at `1.9rem`
regardless of the desktop value — don't remove that override, a 7rem
wordmark on a 375px phone screen would be wider than the viewport.

## Suggested next steps (not started, in rough priority order)

1. Real image upload (replace URL-paste with actual file upload + storage).
2. Enable + test Paystack against sandbox credentials end-to-end.
3. Wire up real SMTP and verify order-status emails actually deliver.
4. Build `HubtelProvider.js` if mobile money via Hubtel specifically is
   still wanted (Paystack already covers mobile money in Ghana, so confirm
   this is still needed before building it).
5. Replace placeholder policy pages and product imagery before any real launch.
6. Add automated tests covering the flows in "smoke-tested" above so
   regressions get caught without manual curl scripts.
7. Consider rate-limiting auth endpoints if this goes to production.
