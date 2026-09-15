export interface Env {
  DB: D1Database;
  // vars
  MAIL_FROM: string;
  MAIL_FROM_NAME: string;
  OWNED_ADDRESSES: string;
  // secrets
  AUTH_PASSWORD: string;
  SESSION_SECRET: string;
  RESEND_API_KEY: string;
}

export interface Address {
  name?: string;
  address: string;
}

export interface EmailRow {
  id: string;
  message_id: string | null;
  thread_id: string;
  in_reply_to: string | null;
  refs: string | null;
  direction: "inbound" | "outbound";
  from_name: string | null;
  from_address: string;
  to_addresses: string; // JSON
  cc_addresses: string | null; // JSON
  subject: string | null;
  snippet: string | null;
  text_body: string | null;
  html_body: string | null;
  headers: string | null; // JSON array of {key,value}
  is_read: number;
  is_starred: number;
  is_archived: number;
  is_trashed: number;
  created_at: number;
}
