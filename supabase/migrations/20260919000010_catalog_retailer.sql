-- Migration 010 — a line sheet can belong to a shop.
--
-- Wholesale prices are NEGOTIATED per boutique: Cybercafé pays €26 for a tee
-- that retails at €50, €36 for a longsleeve that retails at €75, €22 for the
-- older €40 tees. Those are not one percentage of RRP — 52%, 48%, 55% — so
-- there is no rule the app can apply, only a list someone agreed to.
--
-- Until now the sales wizard priced every line at RRP, which meant a
-- consignation to Cybercafé came out at roughly double what they owe, and the
-- prices had to be retyped line by line at the point of sale.
--
-- `catalogs` already models exactly the missing thing — a curated set of
-- variants with a wholesale price each — so this points one at a retailer
-- instead of adding a parallel price-list table. A sheet with no retailer is
-- still what it always was: a pitch sent to prospects.
--
-- Deliberately NOT unique per retailer: a shop can be sent an SS26 and an AW26
-- sheet. The wizard prices from the most recent one and names it on screen, so
-- which sheet won is visible rather than inferred.
--
-- Idempotent (add column if not exists / create index if not exists) because it
-- may be applied through the Supabase SQL editor, which keeps no
-- schema_migrations bookkeeping.

alter table catalogs
  add column if not exists retailer_id uuid references retailers(id) on delete set null;

create index if not exists catalogs_retailer_idx on catalogs (retailer_id, created_at desc);
