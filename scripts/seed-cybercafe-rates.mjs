// Seeds Cybercafé's agreed wholesale prices as a line sheet, and points the
// sheet at them so the sales wizard prices their orders from it.
//
// The three rates are what was actually negotiated, not a formula: €22 on a
// €40 tee, €26 on a €50 tee, €36 on a €75 longsleeve — 55%, 52%, 48% of RRP.
// That is exactly why they have to be stored rather than computed.
//
// Needs migration 20260919000010_catalog_retailer.sql applied first, and reads
// the service-role key from .env.local. Safe to run twice: the sheet is found
// by name and the prices are upserted.
//
//   node scripts/seed-cybercafe-rates.mjs
//   node scripts/seed-cybercafe-rates.mjs --dry-run

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const RETAILER = "Cybercafé";
const SHEET = "Cybercafé — house rates";

// Product name -> agreed price per piece, every size the same.
const RATES = new Map([
  // The €40-RRP tees: one band, confirmed 2026-09-20.
  ["Spirit Animal Tee", 22],
  ["Normalize Chilling Tee", 22],
  ["Minerals Tee", 22],
  ["Respectful Tee", 22],
  ["Wise Hand Tee", 22],
  ["Heaven's Gate Tee", 22],
  ["Superior Enti-tee", 26],
  ["Curiosi-tee", 26],
  ["Cosmic Divini-tee", 26],
  ["Primal Identi-tee", 26],
  ["Butterfly Waffle Longsleeve — Beige", 36],
  ["Butterfly Waffle Longsleeve — Black", 36],
  ["Butterfly Waffle Longsleeve — Purple", 36],
]);

const dryRun = process.argv.includes("--dry-run");

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

const { data: retailer } = await db
  .from("retailers")
  .select("id, name")
  .eq("name", RETAILER)
  .maybeSingle();
if (!retailer) die(`No retailer named ${RETAILER}.`);

const { data: products } = await db.from("products").select("id, name");
const wanted = products.filter((p) => RATES.has(p.name));
const missing = [...RATES.keys()].filter((n) => !products.some((p) => p.name === n));
if (missing.length) die(`Products not found: ${missing.join(", ")}`);

const { data: variants } = await db
  .from("variants")
  .select("id, product_id, sku, retail_price")
  .in("product_id", wanted.map((p) => p.id));

const priceByProduct = new Map(wanted.map((p) => [p.id, RATES.get(p.name)]));
const rows = variants.map((v) => ({
  variant_id: v.id,
  wholesale_price: priceByProduct.get(v.product_id),
}));

console.log(`${rows.length} variants across ${wanted.length} products:`);
for (const p of wanted) {
  const n = variants.filter((v) => v.product_id === p.id).length;
  console.log(`  €${RATES.get(p.name)}  ${p.name}  (${n} sizes)`);
}
if (dryRun) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

// Find-or-create by name, so a second run edits the sheet instead of cloning it.
let { data: sheet } = await db
  .from("catalogs")
  .select("id")
  .eq("name", SHEET)
  .maybeSingle();
if (!sheet) {
  const { data, error } = await db
    .from("catalogs")
    .insert({
      name: SHEET,
      notes: "Agreed wholesale rates — what the sales wizard prices their orders at.",
      retailer_id: retailer.id,
    })
    .select("id")
    .single();
  if (error) die(`Could not create the sheet: ${error.message}`);
  sheet = data;
} else {
  const { error } = await db
    .from("catalogs")
    .update({ retailer_id: retailer.id })
    .eq("id", sheet.id);
  if (error) die(`Could not attach the sheet to ${RETAILER}: ${error.message}`);
}

const { error } = await db
  .from("catalog_items")
  .upsert(
    rows.map((r) => ({ catalog_id: sheet.id, ...r })),
    { onConflict: "catalog_id,variant_id" },
  );
if (error) die(`Could not write the prices: ${error.message}`);

console.log(`\nDone — "${SHEET}" is attached to ${retailer.name}.`);
