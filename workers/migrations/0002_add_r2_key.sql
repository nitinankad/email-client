-- Adds the R2 object-key column so large attachments can live in R2 instead of
-- inline in D1. Existing inline attachments (content column) keep working.
--
--   npx wrangler d1 execute email_client --remote --file=./migrations/0002_add_r2_key.sql
--   npx wrangler d1 execute email_client --local  --file=./migrations/0002_add_r2_key.sql

ALTER TABLE attachments ADD COLUMN r2_key TEXT;
