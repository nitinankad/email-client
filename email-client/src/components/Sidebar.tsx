import type { Folder, Me } from "../types";
import {
  ArchiveIcon,
  InboxIcon,
  LayersIcon,
  PencilIcon,
  SentIcon,
  StarIcon,
  TrashIcon,
} from "../icons";

const FOLDERS: { key: Folder; label: string; Icon: typeof InboxIcon }[] = [
  { key: "inbox", label: "Inbox", Icon: InboxIcon },
  { key: "starred", label: "Starred", Icon: StarIcon },
  { key: "sent", label: "Sent", Icon: SentIcon },
  { key: "archived", label: "Archived", Icon: ArchiveIcon },
  { key: "all", label: "All Mail", Icon: LayersIcon },
  { key: "trash", label: "Trash", Icon: TrashIcon },
];

export default function Sidebar({
  folder,
  onFolder,
  onCompose,
  inboxUnread,
  me,
  onLogout,
}: {
  folder: Folder;
  onFolder: (f: Folder) => void;
  onCompose: () => void;
  inboxUnread: number;
  me: Me | null;
  onLogout: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="logo">✦</span>
        <span>Mailbox</span>
      </div>

      <button className="compose-btn" onClick={onCompose}>
        <PencilIcon style={{ width: 16, height: 16 }} />
        <span>Compose</span>
      </button>

      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {FOLDERS.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`nav-item ${folder === key ? "active" : ""}`}
            onClick={() => onFolder(key)}
          >
            <Icon />
            <span className="label">{label}</span>
            {key === "inbox" && inboxUnread > 0 && <span className="badge">{inboxUnread}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="account">
          <span className="avatar">{(me?.name || me?.from || "?").slice(0, 1).toUpperCase()}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "var(--text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>
              {me?.name || "Account"}
            </div>
            <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>{me?.from}</div>
          </div>
        </div>
        <button className="link-btn" onClick={onLogout} style={{ marginTop: 6, marginLeft: 8 }}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
