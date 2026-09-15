export interface Address {
  name?: string;
  address: string;
}

export interface ThreadSummary {
  threadId: string;
  subject: string;
  snippet: string;
  from: Address;
  to: Address[];
  lastAt: number;
  messageCount: number;
  unread: number;
  starred: boolean;
  archived: boolean;
  trashed: boolean;
  hasOutbound: boolean;
  direction: "inbound" | "outbound";
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface Message {
  id: string;
  messageId: string | null;
  direction: "inbound" | "outbound";
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string | null;
  text: string | null;
  html: string | null;
  headers: { key: string; value: string }[];
  isRead: boolean;
  isStarred: boolean;
  createdAt: number;
  attachments: Attachment[];
}

export interface ThreadDetail {
  threadId: string;
  subject: string;
  archived: boolean;
  trashed: boolean;
  messages: Message[];
}

export interface Me {
  from: string;
  name: string;
  owned: string[];
}

export type Folder = "inbox" | "starred" | "sent" | "archived" | "trash" | "all";
