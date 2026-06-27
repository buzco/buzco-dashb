import { type TdHTMLAttributes, type ThHTMLAttributes } from "react";

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <table className="w-full border-collapse text-left text-sm">{children}</table>
  );
}

export function Th({ className = "", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`label-caps border-b border-line px-3 py-2 text-ink/50 ${className}`}
      {...props}
    />
  );
}

export function Td({ className = "", ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={`border-b border-line px-3 py-2 text-ink ${className}`}
      {...props}
    />
  );
}
