# Valantis Collab Tracker

Internal tool for the influencer team. It tracks every collab shipment we send, each influencer's discount-code sales and commission, whether they've posted content, and WhatsApp reminders.

---

## How it works

```
Team's browser ──(login cookie)──► Vercel (this app)
                                     ├── /public/index.html   the tracker screen
                                     ├── /api/login, /api/me   shared-password login
                                     ├── /api/shopify          read-only Shopify data ──► Shopify Admin API
                                     └── /api/data, /api/save  team's edits ──► Supabase (Postgres)
```

- **Shopify** is the source of truth for orders, addresses, delivery status and code sales. The app reads it live and never stores addresses or phone numbers.
- **Supabase** stores only what the team types: discount code, commission %, content status, post link, delivery dates Shopify doesn't know, reminders sent, reminder settings. It also keeps an `edits` log of who changed what.
- **Collab orders** are orders with "collab" in the customer or ship-to name, or tagged `collab` / `influencer-collab`. Paying customers who used a code like `collab35` are excluded.
- **Live updates:** each open screen checks for teammates' edits every 15 seconds and re-reads recent Shopify orders every 10 minutes.
- **Auto-deploy:** every push to the `main` branch on GitHub goes live on Vercel within a minute.

### Security
- Everything is behind one team password. Each person also types their name, which is stored on every edit.
- Login cookies are signed and expire after 30 days. Changing `TEAM_PASSWORD` logs everyone out.
- 10 wrong passwords from one network in 15 minutes locks that network out for 15 minutes.
- The browser can't send its own Shopify queries. The server only runs three fixed, read-only requests.
- The Supabase tables have Row Level Security on and no public access. Only the server's secret key can read or write them.
- All Shopify and Supabase keys live in Vercel environment variables and never reach the browser.

---

## One-time setup (about 20 minutes)

### 1. Shopify app (Dev Dashboard)
Shopify no longer allows new "Develop apps" custom apps in the admin, so this uses a Dev Dashboard app.

1. Go to **https://dev.shopify.com/dashboard** and log in with the store owner account. Click **Create app** and name it `Valantis Collab Tracker`.
2. Open **Versions → Create version**:
   - **App URL:** leave the default (this app isn't embedded in Shopify admin).
   - **Scopes:** `read_orders`, `read_all_orders`, `read_customers`, `read_reports`.
   - Click **Release**.
3. **Protected customer data:** in the app's settings, request access to **Name, Address and Phone** (Level 2). Give the reason "Internal tool to track influencer seeding shipments for our own store". Shopify requires this for addresses, and for sales by discount code (`read_reports`).
4. **Install app** on the Valantis store.
5. **Settings → Credentials:** copy the **Client ID** and **Client secret**. Treat the secret like a password.

If Shopify asks you to apply for `read_all_orders`, apply. Until it's granted, the Lifetime view only reaches back 60 days.

### 2. Supabase (database)
1. Go to **https://supabase.com**, create a free account, then **New project**. Name it `valantis-collab-tracker`, pick region **Mumbai (ap-south-1)**, and set a strong database password (save it in your password manager).
2. Open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
3. Open **Project Settings → API keys**. Copy the **Project URL** and the **secret** key (`service_role`, or `sb_secret_…` on newer projects). Never use the secret key in a browser.

### 3. Vercel (free Hobby plan)
1. Log in to **https://vercel.com** (Hobby plan is fine — this app uses 6 small functions and very little traffic).
2. **Add New → Project →** import this GitHub repo. Framework preset: **Other**. Leave build settings empty.
3. **Environment Variables** — add these (see `.env.example`):

   | Name | Value |
   |---|---|
   | `TEAM_PASSWORD` | A long password for the team, for example 4 random words |
   | `SESSION_SECRET` | 64 random characters (https://generate-secret.vercel.app/64) |
   | `SHOPIFY_SHOP_DOMAIN` | `i01c17-bu.myshopify.com` |
   | `SHOPIFY_CLIENT_ID` | from step 1 |
   | `SHOPIFY_CLIENT_SECRET` | from step 1 |
   | `SUPABASE_URL` | from step 2 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 2 |

4. **Settings → Functions → Function Region:** pick **Mumbai (bom1)** so the app sits next to your Supabase database. (Optional, but makes it faster.)
5. Click **Deploy**. Open the URL, log in with your name and the team password, and press **Lifetime** once to load all past collabs.
6. Share the URL and password with the influencer team on WhatsApp. Don't post them anywhere public.

---

## Day-to-day

- **Free-plan notes:** Supabase pauses a free project after 7 days with no activity. Opening the tracker counts as activity, so daily use keeps it awake. If it ever pauses, click **Restore** in Supabase. Vercel Hobby limits (bandwidth, function time) are far above what this app uses.

- **Someone leaves the team:** change `TEAM_PASSWORD` in Vercel (Settings → Environment Variables), then **Redeploy**. Everyone is logged out, and you share the new password with the people who should still have access.
- **See who changed what:** open Supabase **Table Editor → `edits`**.
- **Shopify says a permission is missing:** the banner names it. Add the scope in a new app version in the Dev Dashboard and approve it in the Shopify admin.

## For developers

- No framework. `public/index.html` is the whole screen (plain JS), and `api/*.js` are Vercel Node functions. Shared code lives in `api/_lib/` (the leading underscore stops Vercel exposing it).
- `npm test` runs the API tests against a fake Shopify and an in-memory database (`tests/`).
- To run locally with real keys, put the variables in `.env.local` (never commit it), then run `node --env-file=.env.local scripts/dev-server.js` and open http://localhost:3000. Login cookies are `Secure`, so use a browser that treats localhost as secure (Chrome and Firefox do).
- Shopify Admin API version: `2026-07` by default. Override it with `SHOPIFY_API_VERSION`, and bump it about once a year, since Shopify retires old versions.

| File | What it does |
|---|---|
| `api/login.js` · `logout.js` · `me.js` | Shared-password login with lockout |
| `api/shopify.js` + `_lib/shopify.js` | Token via client-credentials grant; `scan`, `details` and `sales` operations |
| `api/data.js` | Saved rows (all, or changed since a time) |
| `api/save.js` + `_lib/fields.js` | Validated saves and the edit log |
| `supabase/schema.sql` | Tables, indexes, Row Level Security |
| `public/index.html` | The tracker screen |
