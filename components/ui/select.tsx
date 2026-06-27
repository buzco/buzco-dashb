import { type SelectHTMLAttributes } from "react";

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full border border-line bg-white px-3 py-2 text-ink outline-none focus:border-ink ${className}`}
      {...props}
    />
  );
}
