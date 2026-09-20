// Merges the duplicate "Método pagamento " options on the Notion sales tracker
// and drops the ones nothing uses.
//
// Order matters, because deleting a select option in Notion STRIPS IT FROM
// EVERY PAGE that carried it. So:
//
//   1. move the pages off the doomed option onto the survivor,
//   2. only then delete the option, now that nothing points at it.
//
// Renaming the survivors is a third step that CANNOT be done from here — see
// the note by RENAMES below.
//
//   node scripts/notion-merge-payment-options.mjs --dry-run
//   node scripts/notion-merge-payment-options.mjs
//
// Verified against the live tracker on 2026-09-20: 298 pages, 22 options.

import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");

// Pages on the left move to the right, then the left option is deleted.
const MERGES = [
  { from: "Revolut André", into: "Revolut Andre" },
  { from: "Paypalmiguel😋", into: "Paypal Miguel" },
];

// Nothing points at these — confirmed by counting pages before deleting.
const DELETE_IF_UNUSED = [
  "Mbway André", // the clean spelling, unused; the 46 pages are on the spaced one
  "Transf Bancária",
  "Cash",
  "Cash Trying2",
];

// Renaming a select option is NOT possible through the API. PATCHing the
// database with an option's id and a new name returns 200 and changes nothing
// — verified against the live tracker on 2026-09-20. The two survivors are
// still spelled "Mbway André " (trailing space) and "Revolut Andre" (no
// accent); fixing those is a rename in the Notion UI, which carries the pages
// with it. Deliberately not attempted here rather than reported as done.

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);

const HEADERS = {
  Authorization: `Bearer ${env.NOTION_TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};
const DB = env.NOTION_SALES_DB_ID;

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

async function notion(path, init = {}) {
  const r = await fetch(`https://api.notion.com/v1${path}`, { headers: HEADERS, ...init });
  const body = await r.json();
  if (!r.ok) die(`${init.method ?? "GET"} ${path} → ${r.status}: ${body.message ?? ""}`);
  return body;
}

/**
 * Write a select option list, refusing to drop anything by accident.
 *
 * Notion takes the array as the COMPLETE set: every option missing from it is
 * deleted, and deleting one clears that value from every page carrying it. A
 * partial list is therefore a silent mass edit — sending a single option to
 * this database once blanked the payment method on 265 of 298 pages. So the
 * only options this will remove are the ones named out loud.
 */
async function writeOptions(property, current, next, intentionallyRemoved) {
  const before = new Set(current.map((o) => o.name));
  const after = new Set(next.map((o) => o.name));
  const removed = [...before].filter((n) => !after.has(n));
  const unexpected = removed.filter((n) => !intentionallyRemoved.includes(n));
  if (unexpected.length) {
    die(
      `Refusing to write: this would also delete ${unexpected.map((n) => JSON.stringify(n)).join(", ")}` +
        ` — and with it the value on every page using them.`,
    );
  }
  return notion(`/databases/${DB}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { [property]: { select: { options: next } } } }),
  });
}

const db = await notion(`/databases/${DB}`);
const PROP = Object.keys(db.properties).find((n) =>
  n.trim().toLowerCase().startsWith("método pagamento") ||
  n.trim().toLowerCase().startsWith("metodo pagamento"),
);
if (!PROP) die("No payment-method property on that database.");

const options = db.properties[PROP].select.options;
const byName = new Map(options.map((o) => [o.name, o]));

// Every page, with the option it currently carries.
const pages = [];
let cursor;
do {
  const page = await notion(`/databases/${DB}/query`, {
    method: "POST",
    body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
  });
  for (const p of page.results) {
    pages.push({ id: p.id, value: p.properties[PROP]?.select?.name ?? null });
  }
  cursor = page.has_more ? page.next_cursor : undefined;
} while (cursor);

const countOf = (name) => pages.filter((p) => p.value === name).length;

console.log(`${pages.length} pages · ${options.length} options · property ${JSON.stringify(PROP)}\n`);

// --- 1. moves ---------------------------------------------------------------
const moves = [];
for (const merge of MERGES) {
  if (!byName.has(merge.from)) {
    console.log(`skip  ${JSON.stringify(merge.from)} — no such option`);
    continue;
  }
  if (!byName.has(merge.into)) die(`Target option ${JSON.stringify(merge.into)} does not exist.`);
  const affected = pages.filter((p) => p.value === merge.from);
  console.log(`move  ${affected.length} page(s)  ${JSON.stringify(merge.from)} → ${JSON.stringify(merge.into)}`);
  moves.push(...affected.map((p) => ({ id: p.id, to: merge.into })));
}

// --- 2. deletions -----------------------------------------------------------
// Anything merged above is empty now, so it joins the delete list.
const toDelete = [...DELETE_IF_UNUSED, ...MERGES.map((m) => m.from)].filter((name) => {
  if (!byName.has(name)) return false;
  const used = countOf(name) - moves.filter((m) => pages.find((p) => p.id === m.id)?.value === name).length;
  if (used > 0) {
    // Refusing rather than deleting is the whole point: a delete here would
    // silently blank the property on those pages.
    console.log(`KEEP  ${JSON.stringify(name)} — still on ${used} page(s), not deleting`);
    return false;
  }
  console.log(`drop  ${JSON.stringify(name)}`);
  return true;
});

// --- 3. spellings we cannot fix from here -----------------------------------
for (const survivor of ["Mbway André ", "Revolut Andre"]) {
  if (byName.has(survivor)) {
    console.log(`note  ${JSON.stringify(survivor)} keeps its spelling — rename it in the Notion UI`);
  }
}

if (dryRun) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

console.log("");
for (const move of moves) {
  await notion(`/pages/${move.id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { [PROP]: { select: { name: move.to } } } }),
  });
  console.log(`moved page ${move.id} → ${move.to}`);
}

if (toDelete.length) {
  const kept = options
    .filter((o) => !toDelete.includes(o.name))
    .map((o) => ({ id: o.id, name: o.name }));
  await writeOptions(PROP, options, kept, toDelete);
  console.log(`deleted ${toDelete.length} option(s)`);
}

const final = await notion(`/databases/${DB}`);
console.log(`\nDone — ${final.properties[PROP].select.options.length} options remain.`);
