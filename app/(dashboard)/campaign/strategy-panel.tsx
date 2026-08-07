"use client";

import { useMemo } from "react";
import { buildStrategy, type Advice } from "./strategy";
import type { CampaignInputs, Simulation, UnitEconomics } from "./funnel";

const TONE: Record<Advice["tone"], { border: string; text: string; tag: string }> = {
  critical: { border: "border-status-cancelled", text: "text-status-cancelled", tag: "Fix first" },
  warning: { border: "border-status-ordered/60", text: "text-status-ordered", tag: "Watch" },
  good: { border: "border-status-received", text: "text-status-received", tag: "Working" },
  neutral: { border: "border-line", text: "text-ink/60", tag: "How to run it" },
};

export function StrategyPanel({
  sim,
  inputs,
  econ,
}: {
  sim: Simulation;
  inputs: CampaignInputs;
  econ: UnitEconomics;
}) {
  const advice = useMemo(() => buildStrategy(sim, inputs, econ), [sim, inputs, econ]);
  if (!advice.length) return null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="label-caps text-ink/60">Recommended strategy</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink/50">
          Generated from the numbers above — your margin, your stock, your budget. It changes as you
          change them, so it&apos;s worth re-reading after every edit.
        </p>
      </div>

      <div className="space-y-3">
        {advice.map((a, i) => {
          const tone = TONE[a.tone];
          return (
            <div key={i} className={`rounded-lg border ${tone.border} bg-surface/70 p-4`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className={`label-caps ${tone.text}`}>{tone.tag}</span>
                <h3 className="font-bold text-bone">{a.title}</h3>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink/70">{a.body}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
