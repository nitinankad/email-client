import type { Address, Env } from "./types";

interface SendArgs {
  fromAddress: string;
  fromName?: string;
  to: Address[];
  cc?: Address[];
  subject: string;
  html?: string;
  text?: string;
  inReplyTo?: string | null;
  references?: string | null;
}

function fmt(a: Address): string {
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

export interface SendResult {
  id: string; // Resend message id
  messageId: string; // RFC Message-ID we can thread on
}

export async function sendViaResend(env: Env, args: SendArgs): Promise<SendResult> {
  const from = args.fromName
    ? `${args.fromName} <${args.fromAddress}>`
    : args.fromAddress;

  const headers: Record<string, string> = {};
  if (args.inReplyTo) headers["In-Reply-To"] = args.inReplyTo;
  if (args.references) headers["References"] = args.references;

  const body: Record<string, unknown> = {
    from,
    to: args.to.map(fmt),
    subject: args.subject,
  };
  if (args.cc?.length) body.cc = args.cc.map(fmt);
  if (args.html) body.html = args.html;
  if (args.text) body.text = args.text;
  if (Object.keys(headers).length) body.headers = headers;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend send failed (${res.status}): ${detail}`);
  }

  const json = (await res.json()) as { id: string };
  // Resend generates its own Message-ID; we mint one we control for threading.
  const domain = args.fromAddress.split("@")[1] ?? "resend.local";
  const messageId = `<${json.id}@${domain}>`;
  return { id: json.id, messageId };
}
