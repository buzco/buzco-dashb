import { test } from "node:test";
import assert from "node:assert/strict";

import { applyView, matches, type ColumnLike, type FilterRule } from "./table-view.ts";

// Run with `npm test`. What's worth testing here is the filtering that hides
// rows WITHOUT saying so: a €0 fee mistaken for an empty one, a half-typed
// rule blanking the table, an accented payment method that won't match itself.

type Row = {
  id: string;
  item: string;
  channel: string;
  payment: string | null;
  fees: number;
  net: number;
  date: string;
};

const COLUMNS: ColumnLike<Row>[] = [
  { key: "item", type: "text", value: (r) => r.item },
  { key: "channel", type: "select", value: (r) => r.channel },
  { key: "payment", type: "select", value: (r) => r.payment },
  { key: "fees", type: "number", value: (r) => r.fees },
  { key: "net", type: "number", value: (r) => r.net },
  { key: "date", type: "date", value: (r) => r.date },
];

const ROWS: Row[] = [
  { id: "a", item: "Curiosi-tee", channel: "shopify", payment: null, fees: 0, net: 50, date: "2026-08-13" },
  { id: "b", item: "Spirit Animal Tee", channel: "market", payment: "Mbway André", fees: 1.5, net: 40, date: "2026-07-25" },
  { id: "c", item: "WYGS Tee", channel: "market", payment: "Cash", fees: 0, net: 25, date: "2026-07-25" },
];

const rule = (column: string, operator: string, value = ""): FilterRule => ({
  id: "r",
  column,
  operator: operator as FilterRule["operator"],
  value,
});

const ids = (rows: Row[]) => rows.map((r) => r.id);

test("a rule with nothing typed in it yet hides nothing", () => {
  // Otherwise the table blanks the instant you press "Add a filter".
  assert.deepEqual(ids(applyView(ROWS, COLUMNS, { filters: [rule("item", "contains")] })), [
    "a",
    "b",
    "c",
  ]);
});

test("a recorded zero is not an empty value", () => {
  // €0.00 of fees is a real answer; "is empty" must not swallow those rows.
  assert.deepEqual(ids(applyView(ROWS, COLUMNS, { filters: [rule("fees", "is_empty")] })), []);
  assert.deepEqual(ids(applyView(ROWS, COLUMNS, { filters: [rule("fees", "is_not_empty")] })), [
    "a",
    "b",
    "c",
  ]);
});

test("a genuinely absent value is empty", () => {
  assert.deepEqual(ids(applyView(ROWS, COLUMNS, { filters: [rule("payment", "is_empty")] })), ["a"]);
});

test("text matching ignores case and accents", () => {
  // The Notion option lists are typed by hand — "Mbway Andre" has to find it.
  assert.equal(matches("Mbway André", rule("payment", "contains", "mbway andre"), "text"), true);
  assert.equal(matches("Mbway André", rule("payment", "is", "MBWAY ANDRE"), "text"), true);
});

test("number comparisons work on the numeric value, not the string", () => {
  assert.deepEqual(ids(applyView(ROWS, COLUMNS, { filters: [rule("net", "gte", "40")] })), ["a", "b"]);
  assert.deepEqual(ids(applyView(ROWS, COLUMNS, { filters: [rule("net", "lt", "40")] })), ["c"]);
});

test("dates compare by calendar day", () => {
  assert.deepEqual(ids(applyView(ROWS, COLUMNS, { filters: [rule("date", "after", "2026-07-25")] })), [
    "a",
  ]);
  assert.deepEqual(
    ids(applyView(ROWS, COLUMNS, { filters: [rule("date", "on_or_after", "2026-07-25")] })),
    ["a", "b", "c"],
  );
});

test("rules stack with AND", () => {
  const filtered = applyView(ROWS, COLUMNS, {
    filters: [rule("channel", "is", "market"), { ...rule("net", "gt", "30"), id: "r2" }],
  });
  assert.deepEqual(ids(filtered), ["b"]);
});

test("the search box looks through whatever the caller offers", () => {
  const found = applyView(ROWS, COLUMNS, {
    query: "wygs",
    search: (r) => `${r.item} ${r.channel}`,
  });
  assert.deepEqual(ids(found), ["c"]);
});

test("a second sort only breaks ties in the first", () => {
  const sorted = applyView(ROWS, COLUMNS, {
    sorts: [
      { column: "date", descending: true },
      { column: "net", descending: true },
    ],
  });
  // 13 Aug first, then the two 25 Jul rows ordered by net.
  assert.deepEqual(ids(sorted), ["a", "b", "c"]);
});

test("reversing a sort does not float the blanks to the top", () => {
  const ascending = applyView(ROWS, COLUMNS, { sorts: [{ column: "payment", descending: false }] });
  const descending = applyView(ROWS, COLUMNS, { sorts: [{ column: "payment", descending: true }] });
  // The row with no payment method sinks either way.
  assert.equal(ascending.at(-1)!.id, "a");
  assert.equal(descending.at(-1)!.id, "a");
});

test("a filter on a column that no longer exists is ignored, not fatal", () => {
  assert.deepEqual(ids(applyView(ROWS, COLUMNS, { filters: [rule("gone", "is", "x")] })), [
    "a",
    "b",
    "c",
  ]);
});
