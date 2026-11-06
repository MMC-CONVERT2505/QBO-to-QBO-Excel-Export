# QBO Accounting Data Export & Regional Template Mapping Tool

Connects to a SOURCE QuickBooks Online company (OAuth, read-only), lets you
pick a DESTINATION region, and exports the source data into that region's
Excel template. Nothing is ever written back to QuickBooks — there is no
destination QBO connection at all.

```
Source QBO --(OAuth, read-only)--> Fetch --> Normalize --> Map (region config)
    --> Validate --> Fill destination .xlsx template --> Download (.zip)
```

## Project layout

```
server/      Node.js + Express API (ESM)
  src/config/       region + entity + dependency-graph configuration
  src/controllers/  route handlers
  src/services/     OAuth, QBO client, normalize, mapping engine, excel, jobs
  src/mappings/     <REGION>/<entity>.json - field mapping configs (30 files)
  src/middleware/   auth guard, central error handler
  templates/        <REGION>/<Entity>.xlsx - destination templates (30 files)
  scripts/          regenerate mappings/templates from code

frontend/    React + Vite + Tailwind SPA
  src/pages/        Landing, Dashboard, Connect, ExportFlow
  src/components/   Sidebar, Stepper, Toasts, shared UI primitives
  src/context/      connection state + toast notifications
  src/api/          axios client (cookie-based session auth)
```

## Running it

**Backend**
```
cd server
npm install
npm start          # http://localhost:7004
```

**Frontend**
```
cd frontend
npm install
npm run dev         # http://localhost:5173
```

Open `http://localhost:5173`, click "Connect QuickBooks", authorize against
your sandbox company, then Dashboard → Export.

## Environment variables (server/.env)

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 7004) |
| `FRONTEND_URL` | Frontend origin, for CORS + post-auth redirect |
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` | From your Intuit app |
| `QBO_REDIRECT_URI` | Must exactly match the Intuit app's redirect URI |
| `QBO_ENVIRONMENT` | `sandbox` or `production` |
| `SESSION_SECRET` | Express session signing secret |

⚠️ The `.env` shipped here has your original sandbox credentials still in
it (carried over from the uploaded project) — see the Security section below.

## Regenerating mappings/templates

The 30 mapping configs and 30 placeholder templates are generated, not
hand-written, so they're always structurally consistent:

```
cd server
npm run generate:mappings    # writes src/mappings/<REGION>/<entity>.json
npm run generate:templates   # writes templates/<REGION>/<Entity>.xlsx (reads the mapping headers)
```

## ⚠️ Templates are placeholders — read this

No real destination Excel templates were provided, so
`scripts/generateTemplates.js` generated **standard, reasonable-default**
templates (one sheet per entity, headers matching each region's mapping
config). They are NOT your client's real destination templates.

**Once you have the real templates:**
1. Drop the real `.xlsx` files into `templates/<REGION>/<Entity>.xlsx`
   (same filenames: `Account.xlsx`, `Customer.xlsx`, `Vendor.xlsx`,
   `Item.xlsx`, `Invoice.xlsx`, `Bill.xlsx`).
2. Edit `src/mappings/<REGION>/<entity>.json` so each column's `header`
   matches the real template's header text exactly (the export engine
   matches columns by header text against the template's actual row 1,
   so order doesn't matter — spelling does).
3. Nothing else changes. No code, no restart-required config.

## Security

- Your original `.env` already contains a live `QBO_CLIENT_SECRET` — since
  this is a sandbox app, low urgency, but **rotate it in the Intuit
  developer dashboard** before this ever touches a shared repo, and
  double check `.env` is actually git-ignored (`.gitignore` is in place).
- Access/refresh tokens live only in the server-side session (never sent
  to the frontend); tokens and secrets are redacted from all logs.
- Access tokens auto-refresh ~2 minutes before expiry; a failed refresh
  cleanly reports "please reconnect" rather than a raw QBO error.

## Known limitations (read before demoing)

- **Templates are placeholders** (see above) — this is the biggest one.
- **Export jobs are in-memory**: they live in a `Map` inside the running
  Node process. Restarting the server drops any in-flight/completed job
  (the source data itself is untouched — just re-run the export). Fine
  for one instance; swap for Redis/a DB table if this needs to scale
  horizontally or survive restarts.
- **Reference resolution** for Invoice/Bill lines (customer, item, account)
  uses the *name* QBO already returns inside each reference object, rather
  than a separate ID → record lookup pass. This is simpler and correct for
  the common case, but if two source records share a display name, the
  export can't distinguish them by name alone.
- **OAuth flow itself could not be end-to-end tested here** — it needs a
  real browser round-trip to Intuit's login screen. The token exchange,
  refresh, revoke, and everything downstream of a valid session (fetch →
  normalize → map → validate → Excel → zip → download) **was tested** with
  synthetic QBO-shaped data and confirmed correct end to end (see the
  verified example below).
- Six entities are wired end-to-end (Account, Customer, Vendor, Item,
  Invoice, Bill) — Tax Code/Rate, Payments, Credit/Vendor Memos, Deposits,
  Purchases, Sales Receipts, Refunds are not yet implemented. Adding one
  follows the exact same recipe as the six that exist: an entry in
  `config/entities.js`, a normalizer in `normalize.service.js`, and a
  mapping JSON per region.

## What was verified end-to-end (with synthetic data)

normalize → map → validate → fill real .xlsx template → zip, producing a
correctly-labeled export per region — e.g. for Canada: `Income Account` →
`Income Account` header, `GST/HST Registered` / `GST/HST Code` columns
(vs. `Sales Tax` for a US export), currency defaulted to CAD, and an
Invoice line's `Customer`/`Item` correctly resolved to their QBO display
names rather than raw IDs. A record with a missing required field (empty
Account Name) was correctly flagged `invalid` and excluded from the
generated Excel while everything else was written.

## API endpoints

```
GET  /api/auth/login            start OAuth
GET  /api/auth/callback         OAuth callback
GET  /api/auth/status           { connected, realmId }
POST /api/auth/logout           revoke + clear session

GET  /api/qbo/company-info      + detected source region
GET  /api/qbo/accounts|customers|vendors|items|invoices|bills

GET  /api/regions               all regions + which modules each supports
GET  /api/templates/:region     modules with a real template on disk

POST /api/mapping/preview       { region, modules } -> validation report
POST /api/export                { region, modules } -> { jobId } (202, async)
GET  /api/export/:jobId/status  poll while processing
GET  /api/export/:jobId/download  .zip of generated .xlsx files
```
