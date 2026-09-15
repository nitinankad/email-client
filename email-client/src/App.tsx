import { useCallback, useEffect, useState } from "react";
import { api, ApiError, getToken, setToken } from "./api";
import type { Folder, Me, ThreadSummary } from "./types";
import Login from "./components/Login";
import Sidebar from "./components/Sidebar";
import ThreadList from "./components/ThreadList";
import ThreadView, { type ComposeIntent } from "./components/ThreadView";
import Composer from "./components/Composer";

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [me, setMe] = useState<Me | null>(null);

  const [folder, setFolder] = useState<Folder>("inbox");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [inboxUnread, setInboxUnread] = useState(0);

  const [composerOpen, setComposerOpen] = useState(false);
  const [intent, setIntent] = useState<ComposeIntent | null>(null);
  const [importStatus, setImportStatus] = useState("");

  const loadThreads = useCallback(
    async (f: Folder, q: string) => {
      setLoading(true);
      try {
        const list = await api.threads(f, q);
        setThreads(list);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setAuthed(false);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const refreshUnread = useCallback(async () => {
    try {
      const list = await api.threads("inbox");
      setInboxUnread(list.reduce((n, t) => n + (t.unread > 0 ? 1 : 0), 0));
    } catch {
      /* ignore */
    }
  }, []);

  // initial load after auth
  useEffect(() => {
    if (!authed) return;
    api
      .me()
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setAuthed(false);
      });
    refreshUnread();
  }, [authed, refreshUnread]);

  // load list when folder / query changes
  useEffect(() => {
    if (!authed) return;
    loadThreads(folder, query);
  }, [authed, folder, query, loadThreads]);

  const refreshAll = useCallback(() => {
    loadThreads(folder, query);
    refreshUnread();
  }, [folder, query, loadThreads, refreshUnread]);

  function logout() {
    setToken(null);
    setAuthed(false);
    setMe(null);
    setThreads([]);
    setSelected(null);
  }

  function openCompose(next: ComposeIntent | null) {
    setIntent(next);
    setComposerOpen(true);
  }

  async function handleImport(files: FileList) {
    setImportStatus("Importing…");
    let ok = 0;
    let fail = 0;
    for (const file of Array.from(files)) {
      try {
        const raw = await file.text();
        await api.importEml(raw);
        ok++;
      } catch {
        fail++;
      }
    }
    refreshAll();
    setImportStatus(`Imported ${ok}${fail ? `, ${fail} failed` : ""}`);
    setTimeout(() => setImportStatus(""), 4000);
  }

  if (!authed) {
    return <Login onLogin={() => setAuthed(true)} />;
  }

  return (
    <div className={`app ${selected ? "reading" : ""}`}>
      <Sidebar
        folder={folder}
        onFolder={(f) => {
          setFolder(f);
          setSelected(null);
          setQuery("");
        }}
        onCompose={() => openCompose(null)}
        onImport={handleImport}
        importStatus={importStatus}
        inboxUnread={inboxUnread}
        me={me}
        onLogout={logout}
      />

      <ThreadList
        folder={folder}
        threads={threads}
        loading={loading}
        selectedId={selected}
        onSelect={(t) => setSelected(t.threadId)}
        onSearch={setQuery}
      />

      <ThreadView
        threadId={selected}
        onBack={() => setSelected(null)}
        onCompose={openCompose}
        onMutated={refreshAll}
      />

      {composerOpen && (
        <Composer
          me={me}
          intent={intent}
          onClose={() => setComposerOpen(false)}
          onSent={refreshAll}
        />
      )}
    </div>
  );
}
