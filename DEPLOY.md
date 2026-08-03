# Deploying LitByAura (GitHub → Render)

## ⚠️ Read this first: persistent storage

This app stores everything — products, orders, customers, admin account —
in a single SQLite file. Render's default web service filesystem is
**ephemeral**: it gets wiped on every deploy and on every restart. Without a
**persistent disk** attached, you will lose your entire database repeatedly,
often silently.

Persistent disks on Render require a **paid instance plan** (Starter or
above) — they are not available on the free tier. `render.yaml` in this repo
is already configured with a 1GB persistent disk mounted at `/var/data`, and
`DB_PATH` is set to `/var/data/litbyaura.db` so the database lives there
instead of the app directory. **If you deploy on the free tier without
adjusting this, understand that your data will not survive deploys.** For a
quick throwaway demo that's fine; for a real store, it isn't.

## 1. Push to GitHub

```bash
cd litbyaura
git init
git add .
git commit -m "Initial commit"
```

Create a new empty repository on GitHub (no README/license — you already
have files), then:

```bash
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Your `.gitignore` already excludes `node_modules/`, `.env`, and the SQLite
database files — none of that should ever be committed.

## 2. Deploy to Render

### Option A — Blueprint (recommended, uses render.yaml automatically)

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**.
2. Connect your GitHub account and select this repo.
3. Render reads `render.yaml` and proposes: a **Starter** web service named
   `litbyaura` with a 1GB persistent disk mounted at `/var/data`, and the
   env vars already listed (currency, COD-only defaults, etc.) — `JWT_SECRET`
   is auto-generated for you.
4. Click **Apply**. First deploy takes a few minutes (`npm install` + boot).

### Option B — Manual web service

1. **New** → **Web Service** → connect the repo.
2. Runtime: **Node**. Build command: `npm install`. Start command: `npm start`.
3. Plan: **Starter** or higher (needed for the disk in step 5).
4. Add environment variables (see `.env.example` for the full list) — at minimum:
   - `NODE_ENV=production`
   - `JWT_SECRET` — generate a long random string
   - `DB_PATH=/var/data/litbyaura.db`
   - `BASE_URL` — fill in after deploy once you know your `.onrender.com` URL
     (or your custom domain) — this is used in password-reset emails
5. Under the service's **Disks** tab, add a disk: name `litbyaura-data`,
   mount path `/var/data`, size 1GB.
6. Deploy.

## 3. After first deploy

1. Once live, go to `https://<your-app>.onrender.com/admin` — since no admin
   exists yet, you'll see the **Create admin account** setup form (not a
   login screen). Create your admin account here.
2. Update the `BASE_URL` env var to your actual live URL (needed so
   password-reset links point to the right place) and let Render redeploy.
3. Add your real products via **Admin → Products**. The demo seed data
   (`npm run seed`) is meant for local development — you generally do **not**
   want to run it against your production database, since it adds 3 fake
   demo products. If you deployed via Blueprint/manual steps above, it never
   ran automatically; your store starts empty and ready for real inventory.
4. Set up your hero slides (**Admin → Hero Slides**) and trust-bar messages
   (**Admin → Settings**) — both start with placeholder/default content.
5. If you want real payments, see the Paystack section in `.env.example` —
   `PAYSTACK_ENABLED=false` by default, COD works out of the box with no setup.
6. If you want real order-status emails, switch `EMAIL_PROVIDER=smtp` and
   fill in the `SMTP_*` vars — the default `console` provider just logs
   emails to Render's log viewer instead of sending them.

## Redeploying after code changes

Push to `main` (or your connected branch) and Render auto-deploys. Because
`DB_PATH` points at the persistent disk (not the app directory), your data
survives — the disk isn't wiped by a redeploy, only the app code is replaced.

## Custom domain

Render → your service → **Settings** → **Custom Domains**. Once added,
update `BASE_URL` to the custom domain and redeploy so emailed links use it.
