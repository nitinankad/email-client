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

function quote(intent: ComposeIntent): string {
  const m = intent.message;
  const body = m.text || (m.html ? m.html.replace(/<[^>]+>/g, "") : "");
  const header = `\n\nOn ${formatFull(m.createdAt)}, ${displayName(m.from)} <${m.from.address}> wrote:\n`;
  const quoted = body
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return header + quoted;
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
    if (!intent) return { to: "", cc: "", subject: "", body: "", replyId: undefined as string | undefined };
    const m = intent.message;
    const subjBase = intent.subject.replace(/^(re|fwd?):\s*/i, "");
    if (intent.mode === "forward") {
      return {
        to: "",
        cc: "",
        subject: `Fwd: ${subjBase}`,
        body: `\n\n---------- Forwarded message ----------\nFrom: ${displayName(m.from)} <${m.from.address}>\nSubject: ${intent.subject}\n\n${m.text || (m.html ? m.html.replace(/<[^>]+>/g, "") : "")}`,
        replyId: undefined,
      };
    }
    const to = addrToInput([m.from]);
    const cc = intent.mode === "replyAll" ? addrToInput(m.to.concat(m.cc)) : "";
    return { to, cc, subject: `Re: ${subjBase}`, body: quote(intent), replyId: m.id };
  }, [intent]);

  const [from, setFrom] = useState(intent?.message.to[0]?.address && fromOptions.includes(intent.message.to[0].address) ? intent.message.to[0].address : me?.from || fromOptions[0] || "");
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [showCc, setShowCc] = useState(!!initial.cc);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
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
      await api.send({
        from,
        to: toList,
        cc: showCc ? parseAddresses(cc) : undefined,
        subject: subject || "(no subject)",
        text: body,
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

        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message…" />

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
