import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Message } from "../types";

// --- quoted-thread detection ------------------------------------------------
// The reply lives at the top; the quoted history is a trailing block. We split
// it out so the reading view can collapse it behind a "•••" toggle, the way
// Gmail/Apple Mail do. Detection is heuristic but covers the common clients.

interface Split {
  main: string;
  quoted: string | null;
}

// Selectors that mark the start of quoted history in HTML mail.
const QUOTE_SELECTORS = [
  ".gmail_quote_container",
  ".gmail_quote",
  "blockquote.gmail_quote",
  "blockquote[type='cite']",
  ".moz-cite-prefix",
  "#divRplyFwdMsg",
  "#appendonsend",
  ".yahoo_quoted",
  "#yiv-quoted",
];

function splitHtmlQuote(html: string): Split {
  if (typeof DOMParser === "undefined") return { main: html, quoted: null };
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return { main: html, quoted: null };
  }
  const body = doc.body;

  let anchor: Element | null = null;
  for (const sel of QUOTE_SELECTORS) {
    const el = body.querySelector(sel);
    if (el) {
      anchor = el;
      break;
    }
  }
  if (!anchor) anchor = body.querySelector("blockquote");
  if (!anchor || !anchor.parentNode) return { main: html, quoted: null };

  // Move the anchor and everything after it (at its own level) into a holder.
  const holder = doc.createElement("div");
  let node: Node | null = anchor;
  while (node) {
    const next: Node | null = node.nextSibling;
    holder.appendChild(node); // moves node out of the original tree
    node = next;
  }

  const quoted = holder.innerHTML.trim();
  const main = body.innerHTML.trim();
  // Don't collapse if there's no visible reply above the quote.
  if (!main || !quoted) return { main: html, quoted: null };
  return { main, quoted };
}

function splitTextQuote(text: string): Split {
  const lines = text.split(/\r?\n/);
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*On\b.+\bwrote:\s*$/.test(lines[i]) || /^\s*-{2,}\s*Forwarded message/i.test(lines[i])) {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*>/.test(lines[i])) {
        idx = i;
        break;
      }
    }
  }
  if (idx <= 0) return { main: text, quoted: null };
  const main = lines.slice(0, idx).join("\n").replace(/\s+$/, "");
  const quoted = lines.slice(idx).join("\n").trim();
  if (!main.trim() || !quoted) return { main: text, quoted: null };
  return { main, quoted };
}

function wrapDoc(inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta name="color-scheme" content="dark"><base target="_blank">
    <style>
      :root{color-scheme:dark;}
      html,body{margin:0;padding:2px 0;color:#e6e6ea;background:#0a0a0b;
        font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
        word-break:break-word;overflow-wrap:break-word;}
      img{max-width:100%;height:auto;}
      a{color:#6d8bff;}
      p,div,span,td,th,li,h1,h2,h3,h4,strong,b,em{color:inherit;}
      table{max-width:100%;}
      blockquote{margin:0 0 0 8px;padding-left:12px;border-left:3px solid #2c2c33;color:#a1a1aa;}
    </style></head><body>${inner}</body></html>`;
}

export default function EmailBody({ message }: { message: Message }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(60);
  const [expanded, setExpanded] = useState(false);

  const isHtml = !!message.html;
  const split = useMemo<Split>(
    () => (isHtml ? splitHtmlQuote(message.html!) : splitTextQuote(message.text || "")),
    [isHtml, message.html, message.text],
  );

  const srcDoc = useMemo(() => {
    if (!isHtml) return null;
    return wrapDoc(expanded && split.quoted ? split.main + split.quoted : split.main);
  }, [isHtml, expanded, split]);

  const measure = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentWindow?.document;
      if (!doc) return;
      const h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
      if (h > 0) setHeight(Math.min(h + 8, 4000));
    } catch {
      /* cross-origin: leave default */
    }
  }, []);

  // Fires reliably on every srcDoc load (React attaches before load), then keeps
  // the height in sync as images/fonts reflow the content. We measure several
  // times because scrollHeight can under-report before fonts/layout settle.
  const handleLoad = useCallback(() => {
    measure();
    requestAnimationFrame(measure);
    for (const t of [50, 150, 400, 1000]) setTimeout(measure, t);
    try {
      const doc = iframeRef.current?.contentWindow?.document;
      if (!doc) return;
      observerRef.current?.disconnect();
      const ro = new ResizeObserver(() => measure());
      ro.observe(doc.documentElement);
      ro.observe(doc.body);
      observerRef.current = ro;
    } catch {
      /* ignore */
    }
  }, [measure]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const toggle = split.quoted ? (
    <button
      className={`quote-toggle ${expanded ? "expanded" : ""}`}
      onClick={() => setExpanded((e) => !e)}
      title={expanded ? "Hide quoted text" : "Show trimmed content"}
    >
      <span />
      <span />
      <span />
    </button>
  ) : null;

  if (!isHtml) {
    return (
      <div>
        <div className="msg-text">{split.main || message.text || "(no content)"}</div>
        {toggle}
        {expanded && split.quoted && <div className="msg-text quoted-text">{split.quoted}</div>}
      </div>
    );
  }

  return (
    <div>
      <iframe
        ref={iframeRef}
        title="email-content"
        sandbox="allow-same-origin allow-popups"
        srcDoc={srcDoc!}
        onLoad={handleLoad}
        style={{ height, background: "transparent" }}
      />
      {toggle}
    </div>
  );
}
