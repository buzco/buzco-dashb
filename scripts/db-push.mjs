// Pushes pending migrations to the live Supabase project.
//
// Exists because the plain CLI paths don't work here:
//   * `supabase login` / `link` reject the newer `sbp_v0_…` PAT format,
//   * the direct host `db.<ref>.supabase.co` is IPv6-only and won't resolve,
// so everything goes through the IPv4 session pooler in eu-west-1 instead.
//
// The password is read from .env.local (gitignored) and URL-encoded here, so a
// `!` or `#` in it can't break the connection string and it never lands in
// shell history or in a terminal transcript.
//
//   node scripts/db-push.mjs --dry-run   # list what would be pushed
//   node scripts/db-push.mjs             # push it
//
// Note that migrations applied by hand through the Supabase SQL editor leave no
// schema_migrations bookkeeping, so they show up as pending and get re-applied.
// That is why every migration in this repo is written to be idempotent — check
// a --dry-run list before pushing and make sure the re-runs really are no-ops.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PROJECT_REF = "wrdvivypstwnrrazguuf";
const POOLER = "aws-0-eu-west-1.pooler.supabase.com:5432";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);

const password = env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error(
    "SUPABASE_DB_PASSWORD is empty in .env.local.\n" +
      "Paste the Postgres password there (raw — no quotes, no URL-encoding).",
  );
  process.exit(1);
}

const dbUrl =
  `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(password)}@${POOLER}/postgres`;

// The Docker warning the CLI prints here is harmless — it only means it can't
// cache the catalog locally.
const result = spawnSync(
  "npx",
  ["supabase", "db", "push", "--db-url", dbUrl, ...process.argv.slice(2)],
  { stdio: "inherit", shell: true, cwd: root },
);
process.exit(result.status ?? 1);
