# Deck Expert Estimator

Internal field-estimator + AI visualizer for **Chicago Deck Expert**, with
Housecall Pro (HCP) sync. Built on the same proven stack as the Concrete Shield
Coatings app (Node 22 + Express + SQLite), extended for a multi-structure,
multi-service business.

## What it does

- **Home** → two actions: **New Estimate** and **Visualizer**.
- **New Estimate** → pick a structure: **Deck · Porch · Fence · Pergola · Gazebo**.
  Deck has the full workflow today; the others are stubbed "coming soon" and will
  reuse the same pattern.
- **Deck estimate** → customer info, service (stain/seal), opacity (clear →
  solid), wood type, prep level, measurements (surface sq ft, railing lf, stairs),
  extra line items, discount → live total → save → **Send to Housecall Pro**.
- **Visualizer** → snap/upload a deck photo, pick a stain/seal finish, get a
  photorealistic AI preview (OpenAI `gpt-image-1`).

## Stack

- Node 22, Express 5 (ESM), `better-sqlite3`, `multer`, `sharp`, `openai`.
- Single shared-password login (`express-session`). No per-user accounts.
- SQLite file DB in `data/` (gitignored). Photos in `uploads/` (gitignored).

## Pricing

All prices live in **`pricing.js`** — edit the numbers there, no other changes
needed. The current values are **placeholders**. The deck model is:

```
surface  = rate(service, opacity, wood) * sqft * prepMultiplier
railing  = railing_lf_rate[service] * railing_lf
stairs   = stairs_each * steps
+ extra line items - discount
```

Each saved estimate freezes its price breakdown (`pricing_snapshot`) so editing
rates later doesn't change historical estimates.

## Configuration

Copy `.env.example` → `.env`:

| Var | Required | Purpose |
|-----|----------|---------|
| `APP_PASSWORD` | ✅ | Shared login password |
| `SESSION_SECRET` | ✅ | Cookie signing (`openssl rand -hex 32`) |
| `OPENAI_API_KEY` | optional | Enables the Visualizer |
| `HCP_API_KEY` | optional | Enables Housecall Pro sync (HCP **MAX** plan) |
| `HCP_API_BASE` | optional | Defaults to `https://api.housecallpro.com/v1` |
| `HCP_AUTH_SCHEME` | optional | `Token` (default) or `Bearer` |
| `PORT` | optional | Defaults to `3000` |

The app runs fine without `OPENAI_API_KEY`/`HCP_API_KEY` — those features just
show as disabled.

## Run locally

```bash
npm install
cp .env.example .env   # set APP_PASSWORD and SESSION_SECRET
npm start              # http://127.0.0.1:3000
```

## Deploy (existing VPS, new subdomain)

Mirrors the CSC app. App binds to `127.0.0.1:3000`; nginx terminates TLS for
`estimator.chicagodeckexpert.com` and proxies to it.

1. Clone to `/var/www/deck-expert-estimator`, `npm install --omit=dev`, create `.env`.
2. `cp deploy/estimator-app.service /etc/systemd/system/` → edit paths → `systemctl enable --now estimator-app`.
3. `cp deploy/nginx-estimator.conf /etc/nginx/sites-available/` → symlink → `certbot --nginx -d estimator.chicagodeckexpert.com` → `nginx -t && systemctl reload nginx`.

> Resource footprint is light (small Node process + SQLite; AI is offloaded to
> OpenAI). It coexists comfortably with other small apps on the same box.

## Housecall Pro notes

`hcp.js` contains all HCP logic: it upserts the customer (search-then-create to
avoid duplicates), then creates an estimate with line items. HCP's exact estimate
payload can vary by account — verify the first real push and adjust `hcp.js` if
HCP returns a validation error.

## Roadmap

- [ ] Fill in real deck pricing in `pricing.js`.
- [ ] Add real stain reference photos to `public/swatches/`.
- [ ] Adapt the deck workflow to Porch / Fence / Pergola / Gazebo.
- [ ] Verify the HCP estimate payload against the live account.
