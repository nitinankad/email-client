import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Address, EmailRow, Env } from "./types";
import { checkPassword, issueToken, verifyToken } from "./auth";
import { handleInbound } from "./inbound";
import { sendViaResend } from "./resend";
import { resolveThreadId } from "./threading";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type", "Authorization"] }));

// ---- auth middleware (everything under /api except /api/login) ------------
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/login" || c.req.method === "OPTIONS") return next();
  const header = c.req.header("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!(await verifyToken(c.env.SESSION_SECRET, token))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
});

// ---- auth routes ----------------------------------------------------------
app.post("/api/login", async (c) => {
  const { password } = await c.req.json<{ password?: string }>();
  if (!password || !checkPassword(c.env.AUTH_PASSWORD, password)) {
    return c.json({ error: "invalid password" }, 401);
  }
  const token = await issueToken(c.env.SESSION_SECRET);
  return c.json({ token });
});

app.get("/api/me", (c) =>
  c.json({
    from: c.env.MAIL_FROM,
    name: c.env.MAIL_FROM_NAME,
    owned: (c.env.OWNED_ADDRESSES || "").split(",").map((s) => s.trim()).filter(Boolean),
    names: parseNames(c.env),
  }),
);

// ---- helpers --------------------------------------------------------------
function parseAddrs(json: string | null): Address[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as Address[];
  } catch {
    return [];
  }
}

// Selectable display names for the composer (combined with an address in the
// UI). Configured via SEND_NAMES, else just MAIL_FROM_NAME.
function parseNames(env: Env): string[] {
  const names = (env.SEND_NAMES || "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (names.length) return names;
  return env.MAIL_FROM_NAME ? [env.MAIL_FROM_NAME] : [];
}

function parseHeaders(json: string | null): { key: string; value: string }[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as { key: string; value: string }[];
  } catch {
    return [];
  }
}

function threadSummaryHaving(folder: string): string {
  switch (folder) {
    case "trash":
      return "HAVING trashed = 1";
    case "archived":
      return "HAVING trashed = 0 AND archived = 1";
    case "starred":
      return "HAVING trashed = 0 AND starred = 1";
    case "sent":
      return "HAVING trashed = 0 AND archived = 0 AND has_outbound = 1";
    case "all":
      return "HAVING trashed = 0";
    case "inbox":
    default:
      return "HAVING trashed = 0 AND archived = 0";
  }
}

// ---- thread list ----------------------------------------------------------
app.get("/api/threads", async (c) => {
  const folder = c.req.query("folder") || "inbox";
  const q = (c.req.query("q") || "").trim();
  const limit = Math.min(Number(c.req.query("limit")) || 50, 200);

  const aggregates = await c.env.DB.prepare(
    `SELECT thread_id,
            MAX(created_at) AS last_at,
            COUNT(*) AS msg_count,
            SUM(CASE WHEN is_read = 0 AND direction = 'inbound' THEN 1 ELSE 0 END) AS unread,
            MAX(is_starred) AS starred,
            MAX(is_archived) AS archived,
            MAX(is_trashed) AS trashed,
            MAX(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS has_outbound
       FROM emails
      GROUP BY thread_id
      ${threadSummaryHaving(folder)}
      ORDER BY last_at DESC
      LIMIT ?`,
  )
    .bind(limit)
    .all<{
      thread_id: string;
      last_at: number;
      msg_count: number;
      unread: number;
      starred: number;
      archived: number;
      trashed: number;
      has_outbound: number;
    }>();

  const rows = aggregates.results ?? [];
  if (rows.length === 0) return c.json({ threads: [] });

  // Fetch the latest message per thread for display fields.
  const ids = rows.map((r) => r.thread_id);
  const placeholders = ids.map(() => "?").join(",");
  const latest = await c.env.DB.prepare(
    `SELECT e.* FROM emails e
       JOIN (SELECT thread_id, MAX(created_at) AS mx FROM emails
               WHERE thread_id IN (${placeholders}) GROUP BY thread_id) m
         ON e.thread_id = m.thread_id AND e.created_at = m.mx`,
  )
    .bind(...ids)
    .all<EmailRow>();

  const latestByThread = new Map<string, EmailRow>();
  for (const e of latest.results ?? []) if (!latestByThread.has(e.thread_id)) latestByThread.set(e.thread_id, e);

  let threads = rows.map((r) => {
    const e = latestByThread.get(r.thread_id);
    return {
      threadId: r.thread_id,
      subject: e?.subject || "(no subject)",
      snippet: e?.snippet || "",
      from: { name: e?.from_name || undefined, address: e?.from_address || "" },
      to: parseAddrs(e?.to_addresses ?? null),
      lastAt: r.last_at,
      messageCount: r.msg_count,
      unread: r.unread,
      starred: !!r.starred,
      archived: !!r.archived,
      trashed: !!r.trashed,
      hasOutbound: !!r.has_outbound,
      direction: e?.direction ?? "inbound",
    };
  });

  if (q) {
    const needle = q.toLowerCase();
    threads = threads.filter(
      (t) =>
        t.subject.toLowerCase().includes(needle) ||
        t.snippet.toLowerCase().includes(needle) ||
        t.from.address.toLowerCase().includes(needle) ||
        (t.from.name || "").toLowerCase().includes(needle),
    );
  }

  return c.json({ threads });
});

// ---- thread detail --------------------------------------------------------
app.get("/api/threads/:id", async (c) => {
  const id = c.req.param("id");
  const emails = await c.env.DB.prepare(
    "SELECT * FROM emails WHERE thread_id = ? ORDER BY created_at ASC",
  )
    .bind(id)
    .all<EmailRow>();

  const rows = emails.results ?? [];
  if (rows.length === 0) return c.json({ error: "not found" }, 404);

  const emailIds = rows.map((r) => r.id);
  const placeholders = emailIds.map(() => "?").join(",");
  const atts = await c.env.DB.prepare(
    `SELECT id, email_id, filename, mime_type, size FROM attachments WHERE email_id IN (${placeholders})`,
  )
    .bind(...emailIds)
    .all<{ id: string; email_id: string; filename: string; mime_type: string; size: number }>();

  const attByEmail = new Map<string, { id: string; filename: string; mimeType: string; size: number }[]>();
  for (const a of atts.results ?? []) {
    const list = attByEmail.get(a.email_id) ?? [];
    list.push({ id: a.id, filename: a.filename, mimeType: a.mime_type, size: a.size });
    attByEmail.set(a.email_id, list);
  }

  const messages = rows.map((r) => ({
    id: r.id,
    messageId: r.message_id,
    direction: r.direction,
    from: { name: r.from_name || undefined, address: r.from_address },
    to: parseAddrs(r.to_addresses),
    cc: parseAddrs(r.cc_addresses),
    subject: r.subject,
    text: r.text_body,
    html: r.html_body,
    headers: parseHeaders(r.headers),
    isRead: !!r.is_read,
    isStarred: !!r.is_starred,
    createdAt: r.created_at,
    attachments: attByEmail.get(r.id) ?? [],
  }));

  return c.json({
    threadId: id,
    subject: rows[rows.length - 1].subject || "(no subject)",
    archived: rows.some((r) => !!r.is_archived),
    trashed: rows.some((r) => !!r.is_trashed),
    messages,
  });
});

// ---- flags (per email) ----------------------------------------------------
const FLAG_COLUMNS: Record<string, string> = {
  isRead: "is_read",
  isStarred: "is_starred",
  isArchived: "is_archived",
  isTrashed: "is_trashed",
};

async function applyFlags(c: any, where: "id" | "thread_id", key: string) {
  const body = (await c.req.json()) as Record<string, boolean>;
  const sets: string[] = [];
  const vals: (number | string)[] = [];
  for (const [k, col] of Object.entries(FLAG_COLUMNS)) {
    if (k in body) {
      sets.push(`${col} = ?`);
      vals.push(body[k] ? 1 : 0);
    }
  }
  if (sets.length === 0) return c.json({ error: "no flags" }, 400);
  vals.push(key);
  await c.env.DB.prepare(`UPDATE emails SET ${sets.join(", ")} WHERE ${where} = ?`)
    .bind(...vals)
    .run();
  return c.json({ ok: true });
}

app.post("/api/emails/:id/flags", (c) => applyFlags(c, "id", c.req.param("id")));
app.post("/api/threads/:id/flags", (c) => applyFlags(c, "thread_id", c.req.param("id")));

// ---- attachment download --------------------------------------------------
app.get("/api/attachments/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT filename, mime_type, content, r2_key FROM attachments WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ filename: string; mime_type: string; content: string | null; r2_key: string | null }>();
  if (!row) return c.json({ error: "not found" }, 404);

  const disposition = `attachment; filename="${(row.filename || "attachment").replace(/"/g, "")}"`;

  // Preferred path: bytes live in R2.
  if (row.r2_key) {
    const obj = await c.env.ATTACHMENTS.get(row.r2_key);
    if (!obj) return c.json({ error: "not found in storage" }, 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || row.mime_type || "application/octet-stream",
        "Content-Disposition": disposition,
        "Content-Length": String(obj.size),
      },
    });
  }

  // Legacy path: small attachments stored inline as base64 in D1.
  if (row.content) {
    const bin = atob(row.content);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, {
      headers: {
        "Content-Type": row.mime_type || "application/octet-stream",
        "Content-Disposition": disposition,
      },
    });
  }

  return c.json({ error: "attachment has no stored content" }, 404);
});

// ---- send / reply ---------------------------------------------------------
app.post("/api/send", async (c) => {
  const body = await c.req.json<{
    from?: string;
    fromName?: string;
    to: Address[];
    cc?: Address[];
    subject: string;
    text?: string;
    html?: string;
    replyToEmailId?: string;
    attachments?: { filename: string; contentType?: string; content: string }[];
  }>();

  if (!body.to?.length || !body.subject) return c.json({ error: "to and subject required" }, 400);

  const attachments = (body.attachments ?? []).filter((a) => a.content && a.filename);

  // Choose the sender address: must be one this mailbox owns. Falls back to MAIL_FROM.
  const owned = (c.env.OWNED_ADDRESSES || "").split(",").map((s) => s.trim()).filter(Boolean);
  const fromAddress =
    body.from && owned.some((o) => o.toLowerCase() === body.from!.toLowerCase())
      ? body.from
      : c.env.MAIL_FROM;

  // Resolve the display name: must be one of the configured names. Falls back
  // to the first configured name (or none).
  const names = parseNames(c.env);
  const fromName = body.fromName && names.includes(body.fromName) ? body.fromName : names[0] || undefined;

  let inReplyTo: string | null = null;
  let references: string | null = null;
  let threadId: string | null = null;

  if (body.replyToEmailId) {
    const orig = await c.env.DB.prepare(
      "SELECT message_id, refs, thread_id FROM emails WHERE id = ?",
    )
      .bind(body.replyToEmailId)
      .first<{ message_id: string | null; refs: string | null; thread_id: string }>();
    if (orig) {
      inReplyTo = orig.message_id;
      references = [orig.refs, orig.message_id].filter(Boolean).join(" ") || null;
      threadId = orig.thread_id;
    }
  }

  const result = await sendViaResend(c.env, {
    fromAddress,
    fromName,
    to: body.to,
    cc: body.cc,
    subject: body.subject,
    text: body.text,
    html: body.html,
    inReplyTo,
    references,
    attachments,
  });

  if (!threadId) {
    threadId = await resolveThreadId({ inReplyTo, references, subject: body.subject }, async (mid) => {
      const row = await c.env.DB.prepare("SELECT thread_id FROM emails WHERE message_id = ? LIMIT 1")
        .bind(mid)
        .first<{ thread_id: string }>();
      return row?.thread_id ?? null;
    });
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const snippet = (body.text || (body.html ? body.html.replace(/<[^>]+>/g, " ") : "") || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  // Synthesize the headers we set, so "view raw headers" works for sent mail too.
  const sentHeaders: { key: string; value: string }[] = [
    { key: "Message-ID", value: result.messageId },
    { key: "Date", value: new Date(now).toUTCString() },
    { key: "From", value: fromName ? `${fromName} <${fromAddress}>` : fromAddress },
    { key: "To", value: body.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ") },
    ...(body.cc?.length ? [{ key: "Cc", value: body.cc.map((a) => a.address).join(", ") }] : []),
    { key: "Subject", value: body.subject },
    ...(inReplyTo ? [{ key: "In-Reply-To", value: inReplyTo }] : []),
    ...(references ? [{ key: "References", value: references }] : []),
  ];

  await c.env.DB.prepare(
    `INSERT INTO emails
      (id, message_id, thread_id, in_reply_to, refs, direction,
       from_name, from_address, to_addresses, cc_addresses,
       subject, snippet, text_body, html_body, headers,
       is_read, is_starred, is_archived, is_trashed, created_at)
     VALUES (?,?,?,?,?, 'outbound', ?,?,?,?, ?,?,?,?,?, 1,0,0,0, ?)`,
  )
    .bind(
      id,
      result.messageId,
      threadId,
      inReplyTo,
      references,
      fromName || null,
      fromAddress,
      JSON.stringify(body.to),
      body.cc?.length ? JSON.stringify(body.cc) : null,
      body.subject,
      snippet,
      body.text || null,
      body.html || null,
      JSON.stringify(sentHeaders),
      now,
    )
    .run();

  // Persist sent attachments (R2 bytes + D1 metadata) so they show in the thread.
  for (const att of attachments) {
    let bytes: Uint8Array;
    try {
      const bin = atob(att.content);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      continue; // skip malformed base64
    }
    const attId = crypto.randomUUID();
    const r2Key = `attachments/${id}/${attId}`;
    try {
      await c.env.ATTACHMENTS.put(r2Key, bytes, {
        httpMetadata: { contentType: att.contentType || "application/octet-stream" },
      });
    } catch (err) {
      console.error(`R2 put failed for ${r2Key}:`, err);
      continue;
    }
    await c.env.DB.prepare(
      `INSERT INTO attachments (id, email_id, filename, mime_type, size, content, r2_key)
       VALUES (?,?,?,?,?,NULL,?)`,
    )
      .bind(attId, id, att.filename, att.contentType || "application/octet-stream", bytes.byteLength, r2Key)
      .run();
  }

  return c.json({ ok: true, id, threadId, resendId: result.id });
});

app.get("/", (c) => c.text("email-client API"));

export default {
  fetch: app.fetch,
  // Cloudflare Email Routing entrypoint.
  async email(message: any, env: Env, ctx: any): Promise<void> {
    ctx.waitUntil(handleInbound(message, env));
  },
};
