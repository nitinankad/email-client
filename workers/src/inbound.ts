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
  forward(rcptTo: string, headers?: Headers): Promise<void>;
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

function toBytes(content: unknown): Uint8Array {
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (typeof content === "string") return new TextEncoder().encode(content);
  return new Uint8Array();
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Inline images referenced by `cid:` (pasted screenshots, signatures) don't
// resolve in the sandboxed viewer, so embed them as data: URIs in the stored
// HTML. Capped so we don't blow past D1's per-value size limit.
const MAX_INLINE_BYTES = 900_000;
function inlineCidImages(
  html: string,
  attachments: { content: unknown; mimeType?: string; contentId?: string }[],
): string {
  let out = html;
  for (const att of attachments) {
    if (!att.contentId || !(att.mimeType || "").startsWith("image/")) continue;
    const bytes = toBytes(att.content);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_INLINE_BYTES) continue;
    const cid = att.contentId.replace(/^<|>$/g, "");
    const dataUri = `data:${att.mimeType};base64,${base64(bytes)}`;
    out = out.split(`cid:${cid}`).join(dataUri);
  }
  return out;
}

/** Parse a raw inbound message and persist it (plus attachments) to D1. */
export async function handleInbound(message: ForwardableEmailMessage, env: Env): Promise<void> {
  // Forward a copy to any configured personal destinations. Do this first, and
  // isolate failures, so a bad/unverified address or a storage error never
  // prevents the other from happening. Each destination must be verified in
  // Cloudflare Email Routing, or forward() rejects.
  const forwardTo = (env.FORWARD_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const dest of forwardTo) {
    try {
      await message.forward(dest);
    } catch (err) {
      console.error(`forward to ${dest} failed:`, err);
    }
  }

  await storeRawEmail(env, message.raw, { fallbackFrom: message.from, fallbackTo: message.to });
}

/**
 * Parse a raw RFC-822 message (string, bytes, or stream) and persist it to D1.
 * Shared by the Email Routing handler and the manual import endpoint.
 * Returns the new email id and its thread id.
 */
export async function storeRawEmail(
  env: Env,
  raw: string | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
  fallback: { fallbackFrom?: string; fallbackTo?: string } = {},
): Promise<{ id: string; threadId: string }> {
  const parsed = await PostalMime.parse(raw as ArrayBuffer);

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
      : { address: fallback.fallbackFrom || "unknown@unknown" };
  const to = toAddresses(parsed.to);
  const cc = toAddresses(parsed.cc);
  const text = parsed.text ?? null;
  const rawHtml = parsed.html ?? null;
  const html = rawHtml ? inlineCidImages(rawHtml, parsed.attachments ?? []) : null;
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
      from.address,
      JSON.stringify(to.length ? to : [{ address: fallback.fallbackTo || "unknown@unknown" }]),
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
    const bytes = toBytes(att.content);
    const size = bytes.byteLength;
    const mimeType = att.mimeType || "application/octet-stream";

    // Skip a separate chip for inline images we already embedded into the HTML.
    const wasInlined =
      !!rawHtml && !!att.contentId && mimeType.startsWith("image/") && size > 0 && size <= MAX_INLINE_BYTES;
    if (wasInlined) continue;

    const attId = crypto.randomUUID();

    // Store the bytes in R2 (no size cap); D1 keeps only metadata + the key.
    let r2Key: string | null = null;
    if (size > 0) {
      r2Key = `attachments/${id}/${attId}`;
      try {
        await env.ATTACHMENTS.put(r2Key, bytes, {
          httpMetadata: { contentType: mimeType },
        });
      } catch (err) {
        console.error(`R2 put failed for ${r2Key}:`, err);
        r2Key = null;
      }
    }

    await env.DB.prepare(
      `INSERT INTO attachments (id, email_id, filename, mime_type, size, content, r2_key)
       VALUES (?,?,?,?,?,NULL,?)`,
    )
      .bind(attId, id, att.filename || "attachment", mimeType, size, r2Key)
      .run();
  }

  return { id, threadId };
}
