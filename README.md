# email-client

A single-user email client for a custom domain, built on
**Cloudflare Email Routing + Workers + D1** for inbound/storage and
**Resend** for outbound.

- **Inbound** — Cloudflare Email Routing pipes incoming mail to a Worker's
  `email()` handler, which parses the MIME with `postal-mime` and stores it in D1.
- **Storage/API** — the same Worker exposes a small JSON API (Hono) over the D1
  database: list/read threads, star/archive/trash, send.
- **Outbound** — replies are sent through the Resend API. You can pick **which
  of your addresses to send as** on every message.
- **Frontend** — a React + Vite SPA (dark theme) that talks to the Worker API,
  deployable to Cloudflare Pages.

```
workers/        Cloudflare Worker: email() handler + JSON API + D1
email-client/   React + Vite single-page app (the UI)
```

---

## Prerequisites

- Node 20+
- A Cloudflare account with your domain added, and **Email Routing** enabled for it
- A [Resend](https://resend.com) account with the same domain **verified**
- `npx wrangler login` (authenticates the CLI with Cloudflare)

---

## 1. Set up the Worker (API + inbound + database)

```bash
cd workers
npm install

# Create your config from the template (the real wrangler.toml is gitignored)
cp wrangler.toml.example wrangler.toml

# Create the D1 database, then paste the returned database_id into wrangler.toml
npx wrangler d1 create email_client

# Create the R2 bucket that holds attachment bytes
npx wrangler r2 bucket create email-attachments

# Create the tables (local + remote)
npm run db:init:local
npm run db:init:remote
```

Now edit **`workers/wrangler.toml`**:

- `[[d1_databases]]` → `database_id` — paste the id printed by `d1 create`.
  **Leave `binding = "DB"` unchanged** — the Worker reads the database as
  `env.DB`, so renaming the binding breaks every query.
- `[vars]` → `MAIL_FROM` — the default address you send from (must be on a
  Resend-verified domain)
- `[vars]` → `MAIL_FROM_NAME` — your display name
- `[vars]` → `OWNED_ADDRESSES` — comma-separated list of every address you may
  send *as* (the security allowlist for outbound)
- `[vars]` → `SEND_NAMES` *(optional)* — selectable display names, comma-separated
  (e.g. `Nitin, Nitin from Kinvo, Kinvo`). The composer lets you pick a name and
  an address independently. Falls back to `MAIL_FROM_NAME` if unset.

Set the three secrets (stored encrypted by Cloudflare, never in the repo):

```bash
npx wrangler secret put AUTH_PASSWORD    # password you'll use to log in
npx wrangler secret put SESSION_SECRET   # any long random string
npx wrangler secret put RESEND_API_KEY   # from resend.com → API Keys
```

---

## 2. Run locally

**Terminal A — the Worker API:**

```bash
cd workers
cp .dev.vars.example .dev.vars      # then fill in the three secrets
npm run dev                          # serves the API at http://localhost:8787
```

`.dev.vars` supplies the secrets for local dev (the production ones set via
`wrangler secret put` are not used locally). Local `wrangler dev` uses a local
SQLite copy of D1, seeded by `npm run db:init:local`.

**Terminal B — the frontend:**

```bash
cd email-client
npm install
cp .env.example .env.local           # VITE_API_URL defaults to localhost:8787
npm run dev                          # opens http://localhost:5173
```

Open the printed URL, sign in with your `AUTH_PASSWORD`, and you're in.

### Testing inbound email locally

Real Email Routing only delivers to the **deployed** Worker, but wrangler's
local runtime exposes an endpoint that invokes the `email()` handler directly —
so you can exercise the full parse-and-store pipeline without deploying.

With `npm run dev` running, POST a raw RFC-822 message to
`/cdn-cgi/handler/email` (a sample lives in `test/sample.eml`):

```bash
# from the workers/ directory, in a second terminal
npm run test:inbound
# or manually:
curl -X POST \
  'http://localhost:8787/cdn-cgi/handler/email?from=ada@example.com&to=you@yourdomain.com' \
  -H 'Content-Type: message/rfc822' \
  --data-binary @test/sample.eml
```

You should get `Worker successfully processed email`. Confirm it stored:

```bash
npx wrangler d1 execute email_client --local \
  --command "SELECT from_address, subject, snippet FROM emails"
```

Then refresh the SPA and it appears in the Inbox. Edit `test/sample.eml` (or
change the `?from=`/`?to=` query params) to simulate different senders, threads
(reuse a `Message-ID` in the `In-Reply-To` header), or attachments.

---

### Importing a raw email manually

Mail normally appears only when Cloudflare Email Routing delivers it to the
Worker. To import a one-off `.eml` (RFC-822) file that never went through the
Worker, POST it to the auth-protected `/api/import` endpoint:

```bash
# get a session token
TOKEN=$(curl -s -X POST https://<your-worker-url>/api/login \
  -H 'Content-Type: application/json' -d '{"password":"YOUR_AUTH_PASSWORD"}' | jq -r .token)

# import the raw message
curl -X POST https://<your-worker-url>/api/import \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: message/rfc822' \
  --data-binary @message.eml
```

It parses and stores exactly like inbound mail (threading, attachments, headers)
and then shows up in the client. Note: the `.eml` must be the **original**
message — an export that a downstream provider re-encrypted (e.g. a ProtonMail
PGP-wrapped copy) will import with an unreadable encrypted body.

## 3. Deploy

**Worker:**

```bash
cd workers
npm run deploy          # note the printed *.workers.dev URL
```

**Already deployed from an earlier version?** Run pending migrations against the
remote (and local) database so new columns exist:

```bash
cd workers
# each migration, against remote and local
npx wrangler d1 execute email_client --remote --file=./migrations/0001_add_headers.sql
npx wrangler d1 execute email_client --local  --file=./migrations/0001_add_headers.sql
npx wrangler d1 execute email_client --remote --file=./migrations/0002_add_r2_key.sql
npx wrangler d1 execute email_client --local  --file=./migrations/0002_add_r2_key.sql
```

(The `0002` migration also needs the R2 bucket to exist —
`npx wrangler r2 bucket create email-attachments` — and the `[[r2_buckets]]`
binding in `wrangler.toml`.)

Then wire up inbound delivery in the Cloudflare dashboard:
**Email → Email Routing → Routes**. Add a rule (a specific address or the
catch-all) with the action **"Send to a Worker"** and pick `email-client-api`.
New mail now lands in D1 automatically.

**Frontend (Cloudflare Pages):**

```bash
cd email-client
# point the SPA at your deployed worker
echo 'VITE_API_URL="https://email-client-api.<your-subdomain>.workers.dev"' > .env.production
npm run build           # outputs to dist/
npx wrangler pages deploy dist --project-name email-client
```

Or connect the repo in the Pages dashboard with build command `npm run build`,
output dir `dist`, and set the `VITE_API_URL` environment variable there.

---

## Useful scripts

| Location        | Command                    | Does                                  |
| --------------- | -------------------------- | ------------------------------------- |
| `workers/`      | `npm run dev`              | Run the API locally (`:8787`)         |
| `workers/`      | `npm run deploy`           | Deploy the Worker                     |
| `workers/`      | `npm run typecheck`        | Type-check the Worker                 |
| `workers/`      | `npm run db:init:local`    | Create tables in local D1             |
| `workers/`      | `npm run db:init:remote`   | Create tables in remote D1            |
| `workers/`      | `npm run test:inbound`     | POST `test/sample.eml` to local `email()` |
| `email-client/` | `npm run dev`              | Run the SPA locally (`:5173`)         |
| `email-client/` | `npm run build`            | Type-check + production build         |
| `email-client/` | `npm run lint`             | Lint with oxlint                      |

---

## Notes

- **Auth** is single-user: one password issues a signed, 30-day session token
  kept in `localStorage`. No user table.
- **Threading** groups messages by `In-Reply-To`/`References`, falling back to a
  normalized subject.
- **HTML email** is rendered inside a sandboxed `<iframe>` (scripts disabled), so
  hostile markup in a message can't touch the app.
- **Forwarding** — set `FORWARD_TO` in `wrangler.toml` (comma-separated) to also
  forward every inbound message to your personal address(es), on top of storing
  it. Each destination must be added and **verified** under Cloudflare
  **Email Routing → Destination addresses** first, or `message.forward()` fails.
  This is how you keep receiving mail in your normal inbox after pointing the
  routing rule at the Worker (the Worker rule replaces the old forwarding rule).
- **Raw headers** are stored per message and viewable via the `</>` toggle in
  each message's header row.
- **Replies are sent as multipart text + HTML**, with the original wrapped in a
  `gmail_quote` blockquote so Gmail/Apple Mail/Outlook collapse the quoted
  thread behind a "show trimmed content" toggle.
- **Attachments** are stored in an **R2 bucket** (bytes) with metadata in D1, so
  there's no practical size cap. The download endpoint serves from R2, falling
  back to any legacy base64-in-D1 attachments from older versions.
