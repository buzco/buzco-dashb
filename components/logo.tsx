"use client";

import { useState } from "react";
import Image from "next/image";

// The animated Buzco wordmark (public/buzco-logo.gif — 1081x608, transparent).
// Callers pass a 16:9 box to match. The plain-text fallback stays as a safety
// net: it's a ~1MB GIF, and a nav with no brand at all is worse than a wordmark.

export function Logo({
  width,
  height,
  className = "",
}: {
  width: number;
  height: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className={`block font-bold tracking-tight text-ink ${className}`}
        style={{ fontSize: Math.round(height * 0.42) }}
      >
        BUZCO
      </span>
    );
  }

  return (
    <Image
      src="/buzco-logo.gif"
      alt="Buzco"
      width={width}
      height={height}
      priority
      unoptimized
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
