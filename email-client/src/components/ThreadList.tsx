import { useState } from "react";
import type { Folder, ThreadSummary } from "../types";
import { MailIcon, SearchIcon, StarFillIcon } from "../icons";
import { displayName, formatTime } from "../util";

export default function ThreadList({
  folder,
  threads,
  loading,
  selectedId,
  onSelect,
  onSearch,
}: {
  folder: Folder;
  threads: ThreadSummary[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (t: ThreadSummary) => void;
  onSearch: (q: string) => void;
}) {
  const [q, setQ] = useState("");

  return (
    <div className="list-pane">
      <div className="list-header">
        <div className="list-title">{folder === "all" ? "All Mail" : folder}</div>
        <div className="search">
          <SearchIcon />
          <input
            value={q}
            placeholder="Search mail"
            onChange={(e) => {
              setQ(e.target.value);
              onSearch(e.target.value);
            }}
          />
        </div>
      </div>

      <div className="thread-list">
        {loading ? (
          <div className="empty">
            <div className="spinner" />
          </div>
        ) : threads.length === 0 ? (
          <div className="empty">
            <MailIcon className="big-icon" />
            <div>No conversations here</div>
          </div>
        ) : (
          threads.map((t) => {
            const who =
              folder === "sent"
                ? "To: " + t.to.map((a) => displayName(a)).join(", ")
                : displayName(t.from);
            return (
              <button
                key={t.threadId}
                className={`thread-row ${t.unread > 0 ? "unread" : ""} ${selectedId === t.threadId ? "selected" : ""}`}
                onClick={() => onSelect(t)}
              >
                <div className="row-top">
                  <span className="who">{who}</span>
                  <span className="time">{formatTime(t.lastAt)}</span>
                </div>
                <div className="subject">{t.subject}</div>
                <div className="snippet">{t.snippet}</div>
                <div className="meta">
                  {t.unread > 0 && <span className="unread-dot" />}
                  {t.messageCount > 1 && <span className="count-pill">{t.messageCount}</span>}
                  {t.starred && <StarFillIcon className="star-mini" />}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
