import PostalMime from "postal-mime";
import type { Address, Env } from "./types";
import { resolveThreadId } from "./threading";

// Cloudflare Email Routing message shape (subset we use).
interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
}

function toAddresses(list: { name?: string; address?: string }[] | undefined): Address[] {
  if (!list) return [];
  return list
    .filter((a) => a.address)
    .map((a) => ({ name: a.name || undefined, address: a.address as string }));
}

function makeSnippet(text: string | null, html: string | null): string {
  const src = text || (html ? html.replace(/<[^>]+>/g, " ") : "");
  return src.replace(/\s+/g, " ").trim().slice(0, 180);
}

const MAX_ATTACHMENT_BYTES = 700_000; // keep D1 rows sane; larger ones stored as metadata only

/** Parse a raw inbound message and persist it (plus attachments) to D1. */
export async function handleInbound(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const parsed = await PostalMime.parse(message.raw);

  const id = crypto.randomUUID();
  const messageId = parsed.messageId || `<${id}@inbound.local>`;
  const inReplyTo = parsed.inReplyTo || null;
  const references = parsed.references || null;

  const threadId = await resolveThreadId(
    { inReplyTo, references, subject: parsed.subject },
    async (mid) => {
      const row = await env.DB.prepare(
        "SELECT thread_id FROM emails WHERE message_id = ? LIMIT 1",
      )
        .bind(mid)
        .first<{ thread_id: string }>();
      return row?.thread_id ?? null;
    },
  );

  const from: Address =
    parsed.from && "address" in parsed.from && parsed.from.address
      ? { name: parsed.from.name || undefined, address: parsed.from.address }
      : { address: message.from };
  const to = toAddresses(parsed.to);
  const cc = toAddresses(parsed.cc);
  const text = parsed.text ?? null;
  const html = parsed.html ?? null;
  const createdAt = parsed.date ? Date.parse(parsed.date) || Date.now() : Date.now();
  // Raw headers, in received order, as [{key, value}].
  const headers = JSON.stringify(
    (parsed.headers ?? []).map((h) => ({ key: h.key, value: h.value })),
  );

  await env.DB.prepare(
    `INSERT INTO emails
      (id, message_id, thread_id, in_reply_to, refs, direction,
       from_name, from_address, to_addresses, cc_addresses,
       subject, snippet, text_body, html_body, headers,
       is_read, is_starred, is_archived, is_trashed, created_at)
     VALUES (?,?,?,?,?, 'inbound', ?,?,?,?, ?,?,?,?,?, 0,0,0,0, ?)`,
  )
    .bind(
      id,
      messageId,
      threadId,
      inReplyTo,
      references,
      from.name || null,
      from.address || message.from,
      JSON.stringify(to.length ? to : [{ address: message.to }]),
      cc.length ? JSON.stringify(cc) : null,
      parsed.subject || null,
      makeSnippet(text, html),
      text,
      html,
      headers,
      createdAt,
    )
    .run();

  for (const att of parsed.attachments ?? []) {
    const bytes =
      att.content instanceof ArrayBuffer
        ? new Uint8Array(att.content)
        : typeof att.content === "string"
          ? new TextEncoder().encode(att.content)
          : new Uint8Array();
    const size = bytes.byteLength;
    let b64: string | null = null;
    if (size > 0 && size <= MAX_ATTACHMENT_BYTES) {
      let bin = "";
      for (const byte of bytes) bin += String.fromCharCode(byte);
      b64 = btoa(bin);
    }
    await env.DB.prepare(
      `INSERT INTO attachments (id, email_id, filename, mime_type, size, content)
       VALUES (?,?,?,?,?,?)`,
    )
      .bind(crypto.randomUUID(), id, att.filename || "attachment", att.mimeType || "application/octet-stream", size, b64)
      .run();
  }
}
