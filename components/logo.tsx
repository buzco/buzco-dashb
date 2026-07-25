"use client";

import { useState } from "react";
import Image from "next/image";

// public/buzco-logo.gif isn't in the repo, so every page currently renders a
// broken-image icon in the nav. Rather than drop the logo (it comes back the
// moment the file is added) fall back to a wordmark if it fails to load.

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
