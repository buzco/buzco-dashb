"use client";

import { useActionState } from "react";
import { signIn } from "@/lib/actions/auth";

export default function LoginPage() {
  const [error, formAction, isPending] = useActionState(signIn, undefined);

  return (
    <form
      action={formAction}
      className="w-full max-w-sm space-y-6 border border-line bg-white p-8"
    >
      <div className="space-y-1">
        <p className="label-caps text-ink/60">Buzco</p>
        <h1 className="text-2xl font-semibold text-ink">Ops login</h1>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="email" className="label-caps block text-ink/60">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full border border-line px-3 py-2 text-ink outline-none focus:border-ink"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="label-caps block text-ink/60">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full border border-line px-3 py-2 text-ink outline-none focus:border-ink"
          />
        </div>
      </div>

      {error && <p className="text-sm text-status-cancelled">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="label-caps w-full bg-ink py-2 text-paper disabled:opacity-50"
      >
        {isPending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
