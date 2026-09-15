import { useRef } from "react";
import type { Folder, Me } from "../types";
import {
  ArchiveIcon,
  InboxIcon,
  LayersIcon,
  PencilIcon,
  SentIcon,
  StarIcon,
  TrashIcon,
  UploadIcon,
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
  onImport,
  importStatus,
  inboxUnread,
  me,
  onLogout,
}: {
  folder: Folder;
  onFolder: (f: Folder) => void;
  onCompose: () => void;
  onImport: (files: FileList) => void;
  importStatus: string;
  inboxUnread: number;
  me: Me | null;
  onLogout: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

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

      <button className="import-btn" onClick={() => fileRef.current?.click()} title="Import .eml files">
        <UploadIcon style={{ width: 15, height: 15 }} />
        <span>{importStatus || "Import .eml"}</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".eml,message/rfc822"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onImport(e.target.files);
          e.target.value = "";
        }}
      />

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
