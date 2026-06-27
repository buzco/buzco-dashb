import { type SelectHTMLAttributes } from "react";

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-md border border-line bg-surface px-3 py-2 text-bone outline-none focus:border-ink ${className}`}
      {...props}
    />
  );
}
