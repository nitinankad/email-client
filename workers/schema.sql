-- D1 schema for the email client.
-- Apply locally:  npx wrangler d1 execute email_client --local  --file=./schema.sql
-- Apply remote:   npx wrangler d1 execute email_client --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS emails (
  id           TEXT PRIMARY KEY,          -- uuid
  message_id   TEXT,                      -- RFC Message-ID header
  thread_id    TEXT NOT NULL,             -- computed conversation id
  in_reply_to  TEXT,                      -- Message-ID this replies to
  refs         TEXT,                      -- References header (space separated)
  direction    TEXT NOT NULL,             -- 'inbound' | 'outbound'
  from_name    TEXT,
  from_address TEXT NOT NULL,
  to_addresses TEXT NOT NULL,             -- JSON array of {name,address}
  cc_addresses TEXT,                      -- JSON array of {name,address}
  subject      TEXT,
  snippet      TEXT,                      -- short plaintext preview
  text_body    TEXT,
  html_body    TEXT,
  is_read      INTEGER NOT NULL DEFAULT 0,
  is_starred   INTEGER NOT NULL DEFAULT 0,
  is_archived  INTEGER NOT NULL DEFAULT 0,
  is_trashed   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL           -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_emails_thread     ON emails (thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_created    ON emails (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_direction  ON emails (direction);
CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails (message_id);

CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,           -- uuid
  email_id    TEXT NOT NULL,
  filename    TEXT,
  mime_type   TEXT,
  size        INTEGER NOT NULL DEFAULT 0,
  content     TEXT,                       -- base64 (small attachments only)
  FOREIGN KEY (email_id) REFERENCES emails (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_email ON attachments (email_id);
