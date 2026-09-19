import { test } from "node:test";
import assert from "node:assert/strict";

import { apportionDiscount, channelFor, type PricedLine } from "./pricing.ts";

// Run with `npm test`. Node's own runner, no framework — these are pure
// functions and the project keeps its dependency list short on purpose.
//
// What's worth testing here is the arithmetic that quietly loses money: a
// discount that doesn't add back up, a freebie that soaks up someone else's
// discount, a typo'd 150% that turns into a refund.

const line = (unitPrice: number, quantity: number, freebie = false): PricedLine => ({
  unitPrice,
  quantity,
  freebie,
});

/** The invariant every split has to hold: the parts equal the whole. */
function sum(parts: number[]): number {
  return Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;
}

test("no discount leaves every line alone", () => {
  assert.deepEqual(apportionDiscount([line(35, 2), line(45, 1)], null, 0), [0, 0]);
  assert.deepEqual(apportionDiscount([line(35, 2)], "percent", 0), [0]);
});

test("a percentage splits in proportion to what each line is worth", () => {
  // €70 + €45 = €115; 10% = €11.50, split 7.00 / 4.50.
  assert.deepEqual(apportionDiscount([line(35, 2), line(45, 1)], "percent", 10), [7, 4.5]);
});

test("quantity counts toward a line's share", () => {
  assert.deepEqual(apportionDiscount([line(10, 3), line(10, 1)], "amount", 4), [3, 1]);
});

test("an uneven split still adds back up to the whole", () => {
  // €10 across three equal lines can't divide evenly; the last one absorbs it.
  const shares = apportionDiscount([line(10, 1), line(10, 1), line(10, 1)], "amount", 10);
  assert.deepEqual(shares, [3.33, 3.33, 3.34]);
  assert.equal(sum(shares), 10);
});

test("a percentage of an awkward subtotal still adds back up", () => {
  const shares = apportionDiscount(
    [line(33.33, 1), line(33.33, 1), line(33.34, 1)],
    "percent",
    33,
  );
  assert.equal(sum(shares), 33);
});

test("a discount bigger than the order is capped, never negative", () => {
  assert.deepEqual(apportionDiscount([line(20, 1)], "amount", 500), [20]);
  assert.deepEqual(apportionDiscount([line(20, 1)], "percent", 150), [20]);
});

test("nonsense discount values are ignored rather than applied", () => {
  assert.deepEqual(apportionDiscount([line(20, 1)], "amount", -5), [0]);
  assert.deepEqual(apportionDiscount([line(20, 1)], "amount", Number.NaN), [0]);
  assert.deepEqual(apportionDiscount([line(20, 1)], "percent", Number.POSITIVE_INFINITY), [0]);
});

test("freebies take no share of the discount", () => {
  assert.deepEqual(apportionDiscount([line(0, 2, true), line(50, 1)], "percent", 10), [0, 5]);
});

test("a freebie last in the order does not absorb the rounding remainder", () => {
  // The remainder has to land on a line someone is actually paying for.
  assert.deepEqual(apportionDiscount([line(50, 1), line(0, 1, true)], "amount", 7.5), [7.5, 0]);
});

test("an order of nothing but freebies discounts nothing", () => {
  assert.deepEqual(apportionDiscount([line(0, 1, true)], "percent", 50), [0]);
  assert.deepEqual(apportionDiscount([], "percent", 50), []);
});

test("a consignation is always wholesale, whatever else was picked", () => {
  assert.equal(
    channelFor({ kind: "consignment", retailerId: null, where: "Feira" }),
    "wholesale",
  );
});

test("a named customer makes it wholesale", () => {
  assert.equal(channelFor({ kind: "sale", retailerId: "r1", where: "Feira" }), "wholesale");
});

test("the Notion Where option routes a walk-up sale to a channel", () => {
  const at = (where: string | null) => channelFor({ kind: "sale", retailerId: null, where });
  assert.equal(at("Feira"), "market");
  assert.equal(at("Ladra"), "market");
  assert.equal(at("Physical"), "market");
  assert.equal(at("Online"), "shopify");
  // Options with no obvious home fall through rather than guessing.
  assert.equal(at("Cyber Loja"), "other");
  assert.equal(at(null), "other");
});
