import { useMemo, useState } from "react";
import { api, ApiError } from "../api";
import type { Address, Me } from "../types";
import { CloseIcon, SendIcon } from "../icons";
import { displayName, formatFull } from "../util";
import type { ComposeIntent } from "./ThreadView";

function parseAddresses(input: string): Address[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => {
      const m = token.match(/^(.*)<(.+)>$/);
      if (m) return { name: m[1].trim() || undefined, address: m[2].trim() };
      return { address: token };
    });
}

function addrToInput(list: Address[]): string {
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textToHtml(s: string): string {
  return escapeHtml(s).replace(/\r?\n/g, "<br>");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Plain-text of the original message, for the text/plain part and the preview.
function originalText(m: ComposeIntent["message"]): string {
  return m.text || (m.html ? stripHtml(m.html) : "");
}

// Build the text/plain and text/html bodies. The HTML wraps the original in a
// `gmail_quote` blockquote, which Gmail/Apple Mail/Outlook collapse behind a
// "show trimmed content" toggle.
function buildBodies(intent: ComposeIntent | null, newText: string): { text: string; html: string } {
  const newHtml = `<div dir="ltr">${textToHtml(newText)}</div>`;
  if (!intent) return { text: newText, html: newHtml };

  const m = intent.message;
  const orig = originalText(m);
  const origHtml = m.html || `<div dir="ltr">${textToHtml(orig)}</div>`;
  const who = `${displayName(m.from)} <${m.from.address}>`;

  if (intent.mode === "forward") {
    const hdrText =
      `---------- Forwarded message ----------\n` +
      `From: ${who}\nDate: ${formatFull(m.createdAt)}\n` +
      `Subject: ${intent.subject}\nTo: ${m.to.map((a) => a.address).join(", ")}\n`;
    const hdrHtml =
      `<div dir="ltr" class="gmail_attr">---------- Forwarded message ----------<br>` +
      `From: ${escapeHtml(who)}<br>Date: ${escapeHtml(formatFull(m.createdAt))}<br>` +
      `Subject: ${escapeHtml(intent.subject)}<br>To: ${escapeHtml(m.to.map((a) => a.address).join(", "))}<br></div>`;
    return {
      text: `${newText}\n\n${hdrText}\n${orig}`,
      html: `${newHtml}<br><div class="gmail_quote">${hdrHtml}<br>${origHtml}</div>`,
    };
  }

  const attribution = `On ${formatFull(m.createdAt)}, ${who} wrote:`;
  const quotedText = orig
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return {
    text: `${newText}\n\n${attribution}\n${quotedText}`,
    html:
      `${newHtml}<br>` +
      `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${escapeHtml(attribution)}</div>` +
      `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">` +
      `${origHtml}</blockquote></div>`,
  };
}

export default function Composer({
  me,
  intent,
  onClose,
  onSent,
}: {
  me: Me | null;
  intent: ComposeIntent | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const fromOptions = useMemo(() => {
    const set = new Set<string>();
    if (me?.from) set.add(me.from);
    for (const o of me?.owned ?? []) set.add(o);
    return [...set];
  }, [me]);

  const initial = useMemo(() => {
    if (!intent) return { to: "", cc: "", subject: "", replyId: undefined as string | undefined };
    const m = intent.message;
    const subjBase = intent.subject.replace(/^(re|fwd?):\s*/i, "");
    if (intent.mode === "forward") {
      return { to: "", cc: "", subject: `Fwd: ${subjBase}`, replyId: undefined };
    }
    const to = addrToInput([m.from]);
    const cc = intent.mode === "replyAll" ? addrToInput(m.to.concat(m.cc)) : "";
    return { to, cc, subject: `Re: ${subjBase}`, replyId: m.id };
  }, [intent]);

  const [from, setFrom] = useState(intent?.message.to[0]?.address && fromOptions.includes(intent.message.to[0].address) ? intent.message.to[0].address : me?.from || fromOptions[0] || "");
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [showCc, setShowCc] = useState(!!initial.cc);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState("");
  const [showQuote, setShowQuote] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");

  async function send() {
    const toList = parseAddresses(to);
    if (toList.length === 0) {
      setMsg("Add at least one recipient.");
      return;
    }
    setSending(true);
    setMsg("");
    try {
      const { text, html } = buildBodies(intent, body);
      await api.send({
        from,
        to: toList,
        cc: showCc ? parseAddresses(cc) : undefined,
        subject: subject || "(no subject)",
        text,
        html,
        replyToEmailId: initial.replyId,
      });
      onSent();
      onClose();
    } catch (err) {
      setMsg(err instanceof ApiError ? `Failed: ${err.message}` : "Failed to send.");
      setSending(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="composer">
        <div className="composer-head">
          <span>
            {intent?.mode === "forward" ? "Forward" : intent ? "Reply" : "New message"}
          </span>
          <button className="close" onClick={onClose}>
            <CloseIcon style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div className="composer-row">
          <label>From</label>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {fromOptions.map((o) => (
              <option key={o} value={o}>
                {me?.name && o === me.from ? `${me.name} <${o}>` : o}
              </option>
            ))}
          </select>
        </div>

        <div className="composer-row">
          <label>To</label>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" autoFocus={!intent || intent.mode === "forward"} />
          {!showCc && (
            <button className="link-btn" onClick={() => setShowCc(true)}>
              Cc
            </button>
          )}
        </div>

        {showCc && (
          <div className="composer-row">
            <label>Cc</label>
            <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc@example.com" />
          </div>
        )}

        <div className="composer-row">
          <label>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
        </div>

        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message…" autoFocus={!!intent && intent.mode !== "forward"} />

        {intent && (
          <div className="quote-preview">
            <button className="link-btn" onClick={() => setShowQuote((s) => !s)}>
              {showQuote ? "Hide" : "Show"} {intent.mode === "forward" ? "forwarded" : "quoted"} text
            </button>
            {showQuote && <pre className="quote-body">{originalText(intent.message)}</pre>}
          </div>
        )}

        <div className="composer-foot">
          <button className="send" onClick={send} disabled={sending}>
            <SendIcon style={{ width: 16, height: 16 }} />
            {sending ? "Sending…" : "Send"}
          </button>
          <span className={`foot-msg ${msg.startsWith("Failed") ? "error" : ""}`}>{msg}</span>
        </div>
      </div>
    </div>
  );
}
