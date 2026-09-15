import { useEffect, useState } from "react";
import { api } from "../api";
import type { Message, ThreadDetail } from "../types";
import {
  ArchiveIcon,
  BackIcon,
  CodeIcon,
  ForwardIcon,
  MailIcon,
  PaperclipIcon,
  ReplyAllIcon,
  ReplyIcon,
  StarFillIcon,
  StarIcon,
  TrashIcon,
} from "../icons";
import { addressList, displayName, formatBytes, formatFull, initials } from "../util";
import EmailBody from "./EmailBody";

export type ComposeIntent = {
  mode: "reply" | "replyAll" | "forward";
  message: Message;
  subject: string;
};

export default function ThreadView({
  threadId,
  onBack,
  onCompose,
  onMutated,
}: {
  threadId: string | null;
  onBack: () => void;
  onCompose: (intent: ComposeIntent) => void;
  onMutated: () => void;
}) {
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [starred, setStarred] = useState(false);

  useEffect(() => {
    if (!threadId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .thread(threadId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setStarred(d.messages.some((m) => m.isStarred));
        // mark unread inbound messages read
        const unread = d.messages.some((m) => m.direction === "inbound" && !m.isRead);
        if (unread) {
          api.setThreadFlags(threadId, { isRead: true }).then(onMutated).catch(() => {});
        }
      })
      .catch(() => setDetail(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  async function toggleStar() {
    if (!threadId) return;
    const next = !starred;
    setStarred(next);
    await api.setThreadFlags(threadId, { isStarred: next });
    onMutated();
  }

  async function archive() {
    if (!threadId) return;
    await api.setThreadFlags(threadId, { isArchived: true });
    onMutated();
    onBack();
  }

  async function trash() {
    if (!threadId) return;
    await api.setThreadFlags(threadId, { isTrashed: true });
    onMutated();
    onBack();
  }

  if (!threadId) {
    return (
      <div className="read-pane">
        <div className="empty">
          <MailIcon className="big-icon" />
          <div>Select a conversation to read</div>
        </div>
      </div>
    );
  }

  if (loading || !detail) {
    return (
      <div className="read-pane">
        <div className="empty">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="read-pane">
      <div className="read-header">
        <button className="icon-btn back-btn" onClick={onBack} title="Back">
          <BackIcon />
        </button>
        <div className="read-subject">{detail.subject}</div>
        <div className="toolbar">
          <button className={`icon-btn ${starred ? "on" : ""}`} onClick={toggleStar} title="Star">
            {starred ? <StarFillIcon /> : <StarIcon />}
          </button>
          <button className="icon-btn" onClick={archive} title="Archive">
            <ArchiveIcon />
          </button>
          <button className="icon-btn" onClick={trash} title="Trash">
            <TrashIcon />
          </button>
        </div>
      </div>

      <div className="messages">
        {detail.messages.map((m) => (
          <MessageCard key={m.id} m={m} subject={detail.subject} onCompose={onCompose} />
        ))}
      </div>
    </div>
  );
}

function MessageCard({
  m,
  subject,
  onCompose,
}: {
  m: Message;
  subject: string;
  onCompose: (intent: ComposeIntent) => void;
}) {
  const [open, setOpen] = useState(true);
  const [showHeaders, setShowHeaders] = useState(false);
  const act = (mode: ComposeIntent["mode"]) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onCompose({ mode, message: m, subject });
  };
  return (
    <div className={`message ${m.direction === "outbound" ? "outbound" : ""}`}>
      <div className="msg-head" onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer" }}>
        <span className="avatar">{initials(m.from)}</span>
        <div className="msg-who">
          <div className="name">
            {displayName(m.from)}
            {m.direction === "outbound" && <span className="tag" style={{ marginLeft: 8 }}>Sent</span>}
          </div>
          <div className="addr">{m.from.address}</div>
          {m.to.length > 0 && <div className="to">to {addressList(m.to)}</div>}
        </div>
        <div className="msg-head-right">
          <div className="msg-date">{formatFull(m.createdAt)}</div>
          <div className="msg-actions-row" onClick={(e) => e.stopPropagation()}>
            <button
              className={`icon-btn sm ghost ${showHeaders ? "on-accent" : ""}`}
              onClick={() => setShowHeaders((s) => !s)}
              title="View raw headers"
            >
              <CodeIcon />
            </button>
            <div className="msg-actions">
              <button className="icon-btn sm" onClick={act("reply")} title="Reply">
                <ReplyIcon />
              </button>
              <button className="icon-btn sm" onClick={act("replyAll")} title="Reply all">
                <ReplyAllIcon />
              </button>
              <button className="icon-btn sm" onClick={act("forward")} title="Forward">
                <ForwardIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
      {showHeaders && (
        <pre className="raw-headers">
          {m.headers.length
            ? m.headers.map((h) => `${h.key}: ${h.value}`).join("\n")
            : "No headers available for this message."}
        </pre>
      )}
      {open && (
        <>
          <div className="msg-body">
            <EmailBody message={m} />
          </div>
          {m.attachments.length > 0 && (
            <div className="attachments">
              {m.attachments.map((a) => (
                <button
                  key={a.id}
                  className="attach-chip"
                  onClick={() => api.openAttachment(a.id, a.filename).catch(() => {})}
                  title={`Download ${a.filename}`}
                >
                  <PaperclipIcon className="icon" style={{ width: 14, height: 14 }} />
                  <span>{a.filename}</span>
                  <span className="size">{formatBytes(a.size)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
