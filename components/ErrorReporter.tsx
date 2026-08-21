"use client";

import { useEffect } from "react";

export default function ErrorReporter() {
  useEffect(() => {
    const handler = (msg: string) => {
      let box = document.getElementById("__errbox");
      if (!box) {
        box = document.createElement("div");
        box.id = "__errbox";
        box.style.cssText =
          "position:fixed;z-index:99999;left:8px;right:8px;bottom:8px;background:#7f1d1d;color:#fff;font:12px monospace;padding:10px;border-radius:8px;white-space:pre-wrap;max-height:50vh;overflow:auto";
        document.body.appendChild(box);
      }
      box.textContent += msg + "\n";
    };
    const onErr = (e: ErrorEvent) =>
      handler(`ERROR: ${e.message}\n@ ${e.filename}:${e.lineno}:${e.colno}`);
    const onRej = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      handler(
        `REJECT: ${(r && (r.stack || r.message)) || String(r)}`
      );
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);
  return null;
}