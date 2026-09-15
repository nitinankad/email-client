import { useEffect, useRef, useState } from "react";
import type { Message } from "../types";

// Renders email HTML inside a sandboxed iframe so remote/hostile markup can
// never touch the app. Scripts are disabled (no allow-scripts); links open in
// a new tab via an injected <base>.
export default function EmailBody({ message }: { message: Message }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const html = message.html;

  const srcDoc = html
    ? `<!doctype html><html><head><meta charset="utf-8">
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
       </style></head><body>${html}</body></html>`
    : null;

  useEffect(() => {
    if (!srcDoc) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => {
      try {
        const doc = iframe.contentWindow?.document;
        if (doc) setHeight(Math.min(doc.body.scrollHeight + 8, 4000));
      } catch {
        /* cross-origin: leave default */
      }
    };
    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, [srcDoc]);

  if (!html) {
    return <div className="msg-text">{message.text || "(no content)"}</div>;
  }

  return (
    <iframe
      ref={iframeRef}
      title="email-content"
      sandbox="allow-same-origin allow-popups"
      srcDoc={srcDoc!}
      style={{ height, background: "transparent" }}
    />
  );
}
