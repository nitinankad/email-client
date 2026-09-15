import type { Address, Folder, Me, ThreadDetail, ThreadSummary } from "./types";

// Base URL of the Worker API. Set VITE_API_URL in .env for production;
// defaults to the local wrangler dev server.
const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8787";

const TOKEN_KEY = "ec_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401) {
    setToken(null);
    throw new ApiError(401, "unauthorized");
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // Attachments are behind auth, so a plain link can't reach them. Fetch with
  // the bearer token, then hand the browser a blob to download/open.
  async openAttachment(id: string, filename: string) {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${API_URL}/api/attachments/${id}`, { headers });
    if (res.status === 401) {
      setToken(null);
      throw new ApiError(401, "unauthorized");
    }
    if (!res.ok) throw new ApiError(res.status, "could not download attachment");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "attachment";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },

  async login(password: string): Promise<string> {
    const { token } = await request<{ token: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    setToken(token);
    return token;
  },

  me: () => request<Me>("/api/me"),

  threads: (folder: Folder, q = "") =>
    request<{ threads: ThreadSummary[] }>(
      `/api/threads?folder=${encodeURIComponent(folder)}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    ).then((r) => r.threads),

  thread: (id: string) => request<ThreadDetail>(`/api/threads/${encodeURIComponent(id)}`),

  setEmailFlags: (id: string, flags: Record<string, boolean>) =>
    request(`/api/emails/${encodeURIComponent(id)}/flags`, { method: "POST", body: JSON.stringify(flags) }),

  setThreadFlags: (id: string, flags: Record<string, boolean>) =>
    request(`/api/threads/${encodeURIComponent(id)}/flags`, { method: "POST", body: JSON.stringify(flags) }),

  send: (payload: {
    from?: string;
    to: Address[];
    cc?: Address[];
    subject: string;
    text?: string;
    html?: string;
    replyToEmailId?: string;
  }) => request<{ ok: true; threadId: string }>("/api/send", { method: "POST", body: JSON.stringify(payload) }),
};
