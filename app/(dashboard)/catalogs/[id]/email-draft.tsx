"use client";

import { useMemo, useState } from "react";

type Retailer = { id: string; name: string; email: string | null };
type Line = { label: string; wholesale: number | null; retail: number | null };

const eur = (n: number) => "€" + n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function EmailDraft({
  catalogName,
  notes,
  lines,
  retailers,
}: {
  catalogName: string;
  notes: string | null;
  lines: Line[];
  retailers: Retailer[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const subject = `Buzco — Gr8 Success · Wholesale: ${catalogName}`;

  const body = useMemo(() => {
    const itemLines = lines
      .map((l) => {
        const w = l.wholesale != null ? `${eur(l.wholesale)} wholesale` : "price on request";
        const rrp = l.retail != null ? ` (RRP ${eur(l.retail)})` : "";
        return `• ${l.label} — ${w}${rrp}`;
      })
      .join("\n");
    return [
      "Hi there,",
      "",
      `Thanks for your interest in Buzco — Gr8 Success. Here's our "${catalogName}" wholesale selection:`,
      "",
      itemLines,
      "",
      notes ? notes + "\n" : "",
      "Let me know which pieces and quantities you'd like and I'll put an order together.",
      "",
      "Best,",
      "Buzco — Gr8 Success",
      "gr8success.xyz · @buzco.rar",
    ]
      .filter((s) => s !== "")
      .join("\n");
  }, [catalogName, notes, lines]);

  const toEmails = retailers
    .filter((r) => selected.includes(r.id) && r.email)
    .map((r) => r.email as string);

  const mailto = `mailto:?bcc=${encodeURIComponent(toEmails.join(","))}&subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;

  async function copy() {
    await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="label-caps text-ink/60">Recipients</p>
        {!retailers.length ? (
          <p className="text-sm text-ink/50">No retailers yet — add them under Retailers.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {retailers.map((r) => {
              const on = selected.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() =>
                    setSelected((s) => (on ? s.filter((x) => x !== r.id) : [...s, r.id]))
                  }
                  disabled={!r.email}
                  title={r.email ?? "no email on file"}
                  className={`label-caps rounded-full border px-3 py-1 ${
                    on ? "border-ink bg-ink/10 text-ink" : "border-line text-ink/60"
                  } disabled:opacity-40`}
                >
                  {r.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <textarea
        readOnly
        value={`Subject: ${subject}\n\n${body}`}
        rows={14}
        className="w-full rounded-md border border-line bg-surface p-3 font-mono text-xs text-bone outline-none"
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={copy}
          className="label-caps rounded-md bg-pink px-4 py-2 text-black hover:opacity-90"
        >
          {copied ? "Copied ✓" : "Copy email"}
        </button>
        <a
          href={mailto}
          className="label-caps rounded-md border border-ink/50 px-4 py-2 text-ink hover:border-ink hover:bg-ink/10"
        >
          Open in mail{toEmails.length ? ` (${toEmails.length})` : ""}
        </a>
      </div>
      <p className="text-xs text-ink/40">
        Opens your mail app with recipients BCC&apos;d. Bulk sending via an email service is a future add-on.
      </p>
    </div>
  );
}
