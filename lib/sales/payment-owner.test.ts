import { test } from "node:test";
import assert from "node:assert/strict";

import { ownerOf, groupPaymentOptions } from "./payment-owner.ts";

// The real option list off the tracker on 2026-09-20, after the duplicates
// were merged. Grouping it is the only thing that makes sixteen buttons
// readable, so what matters is that nothing lands under the wrong person —
// and that a method belonging to nobody doesn't get adopted by one.

const LIVE = [
  "Mbway Miguel",
  "Cash Miguel",
  "Cash André",
  "Revolut Andre",
  "Transferência André",
  "N/A",
  "Paypal Miguel",
  "Paypal Gr8Success",
  "Mbway André ",
  "Revolut Miguel",
  "Split cash + mbway",
  "Shopify",
  "Revolut",
  "MBWAY",
  "Cash Buzco",
];

test("an owner is found however the name is spelled", () => {
  // Both spellings are live on the tracker; they have to group together.
  assert.equal(ownerOf("Revolut Andre"), "André");
  assert.equal(ownerOf("Revolut André"), "André");
  assert.equal(ownerOf("Mbway André "), "André");
  assert.equal(ownerOf("Cash Miguel"), "Miguel");
});

test("a method belonging to nobody stays unowned", () => {
  for (const shared of ["Cash", "Revolut", "MBWAY", "Shopify", "N/A", "Split cash + mbway"]) {
    assert.equal(ownerOf(shared), null, shared);
  }
});

test("a name only counts as a whole word", () => {
  // Guards against a substring match adopting something it shouldn't.
  assert.equal(ownerOf("Andreia"), null);
  assert.equal(ownerOf("Miguelito"), null);
});

test("shared methods lead, then one group per person", () => {
  const groups = groupPaymentOptions(LIVE);
  assert.deepEqual(
    groups.map((g) => g.owner),
    [null, "André", "Miguel", "Buzco", "Gr8Success"],
  );
  assert.deepEqual(groups[0].options, ["N/A", "Split cash + mbway", "Shopify", "Revolut", "MBWAY"]);
  assert.deepEqual(groups[1].options, ["Cash André", "Revolut Andre", "Transferência André", "Mbway André "]);
});

test("every option survives the grouping exactly once", () => {
  // The menu IS this list; an option quietly dropped here is unpickable.
  const flattened = groupPaymentOptions(LIVE).flatMap((g) => g.options);
  assert.equal(flattened.length, LIVE.length);
  assert.deepEqual([...flattened].sort(), [...LIVE].sort());
});

test("an owner with no options gets no empty heading", () => {
  const groups = groupPaymentOptions(["Cash", "Cash André"]);
  assert.deepEqual(
    groups.map((g) => g.owner),
    [null, "André"],
  );
});
