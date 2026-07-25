"use client";

import { useState } from "react";

// Copying beats reading a 32-character token off a screen into WhatsApp.
// Falls back to selecting nothing loudly: if the clipboard API is unavailable
// (older browser, or an insecure origin) the URL is still printed above.

export function CopyLinkButton({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="label-caps mt-2 w-full rounded-md border border-ink/50 px-3 py-2 text-ink transition-colors hover:border-ink hover:bg-ink/10"
    >
      {state === "copied" ? "Copied ✓" : state === "failed" ? "Copy failed — select it above" : "Copy link"}
    </button>
  );
}
