// Conversation threading. We prefer RFC references (In-Reply-To / References)
// and fall back to a normalized subject so replies group together.

function normalizeSubject(subject: string | null | undefined): string {
  if (!subject) return "(no subject)";
  return subject
    .replace(/^(\s*(re|fwd?|aw|sv)\s*:\s*)+/i, "") // strip Re:/Fwd: prefixes
    .trim()
    .toLowerCase();
}

async function sha1(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Resolve the thread id for a message.
 * @param lookupByMessageId  finds an existing email row's thread_id by Message-ID
 */
export async function resolveThreadId(
  opts: {
    inReplyTo?: string | null;
    references?: string | null;
    subject?: string | null;
  },
  lookupByMessageId: (messageId: string) => Promise<string | null>,
): Promise<string> {
  const refs: string[] = [];
  if (opts.inReplyTo) refs.push(opts.inReplyTo.trim());
  if (opts.references) {
    for (const r of opts.references.split(/\s+/)) if (r.trim()) refs.push(r.trim());
  }
  // If any referenced message already exists, reuse its thread.
  for (const ref of refs) {
    const existing = await lookupByMessageId(ref);
    if (existing) return existing;
  }
  // Otherwise derive a stable id from the normalized subject.
  return "t_" + (await sha1(normalizeSubject(opts.subject))).slice(0, 24);
}
