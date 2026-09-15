-- Adds the raw-headers column to an existing database (fresh installs get it
-- from schema.sql). Safe to run once per environment.
--
--   npx wrangler d1 execute email_client --local  --file=./migrations/0001_add_headers.sql
--   npx wrangler d1 execute email_client --remote --file=./migrations/0001_add_headers.sql

ALTER TABLE emails ADD COLUMN headers TEXT;
