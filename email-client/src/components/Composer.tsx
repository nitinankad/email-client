import { useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api";
import type { Address, Me } from "../types";
import { CloseIcon, PaperclipIcon, SendIcon } from "../icons";
import { displayName, formatBytes, formatFull } from "../util";
import type { ComposeIntent } from "./ThreadView";

// Total attachment size cap (base64 inflates ~33%, and the request goes through
// the Worker). Kept well under Resend's ~40 MB limit.
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

interface Attachment {
  filename: string;
  contentType: string;
  size: number;
  content: string; // base64 (no data: prefix)
}

function readFile(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const base64 = result.slice(result.indexOf(",") + 1);
      resolve({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        content: base64,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

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
  const names: string[] = useMemo(() => me?.names?.length ? me.names : me?.name ? [me.name] : [], [me]);
  const addresses: string[] = useMemo(() => me?.owned?.length ? me.owned : me?.from ? [me.from] : [], [me]);

  // Default address: the one the original was sent to (reply), else the first.
  const defaultAddrIdx = useMemo(() => {
    const target = intent?.message.to[0]?.address?.toLowerCase();
    if (target) {
      const i = addresses.findIndex((a) => a.toLowerCase() === target);
      if (i >= 0) return i;
    }
    return 0;
  }, [addresses, intent]);

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

  const [nameIdx, setNameIdx] = useState(0);
  const [addrIdx, setAddrIdx] = useState(defaultAddrIdx);
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [showCc, setShowCc] = useState(!!initial.cc);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState("");
  const [showQuote, setShowQuote] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function addFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setMsg("");
    const incoming = await Promise.all(Array.from(fileList).map(readFile));
    setAttachments((prev) => {
      const next = [...prev, ...incoming];
      const total = next.reduce((n, a) => n + a.size, 0);
      if (total > MAX_TOTAL_BYTES) {
        setMsg(`Attachments exceed ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB total.`);
        return prev;
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

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
        from: addresses[addrIdx],
        fromName: names[nameIdx],
        to: toList,
        cc: showCc ? parseAddresses(cc) : undefined,
        subject: subject || "(no subject)",
        text,
        html,
        replyToEmailId: initial.replyId,
        attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content })),
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

        {names.length > 1 && (
          <div className="composer-row">
            <label>Name</label>
            <select value={nameIdx} onChange={(e) => setNameIdx(Number(e.target.value))}>
              {names.map((n, i) => (
                <option key={`${n}|${i}`} value={i}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="composer-row">
          <label>From</label>
          <select value={addrIdx} onChange={(e) => setAddrIdx(Number(e.target.value))}>
            {addresses.map((a, i) => (
              <option key={`${a}|${i}`} value={i}>
                {names[nameIdx] ? `${names[nameIdx]} <${a}>` : a}
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

        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((a, i) => (
              <span key={i} className="attach-chip static">
                <PaperclipIcon className="icon" style={{ width: 14, height: 14 }} />
                <span className="name">{a.filename}</span>
                <span className="size">{formatBytes(a.size)}</span>
                <button className="chip-remove" onClick={() => removeAttachment(i)} title="Remove">
                  <CloseIcon style={{ width: 13, height: 13 }} />
                </button>
              </span>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />

        <div className="composer-foot">
          <button className="send" onClick={send} disabled={sending}>
            <SendIcon style={{ width: 16, height: 16 }} />
            {sending ? "Sending…" : "Send"}
          </button>
          <button className="attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach files">
            <PaperclipIcon style={{ width: 17, height: 17 }} />
          </button>
          <span className={`foot-msg ${msg.startsWith("Failed") || msg.includes("exceed") ? "error" : ""}`}>{msg}</span>
        </div>
      </div>
    </div>
  );
}
