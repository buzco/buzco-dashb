-- Migration 006 — wholesale catalogs.
--
-- A catalog is a curated set of variants with wholesale prices, used to pitch
-- retailers/buyers. catalog_items hold the per-variant wholesale price (set
-- manually or auto-derived from retail/cost in the app).

create table if not exists catalogs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists catalog_items (
  id              uuid primary key default gen_random_uuid(),
  catalog_id      uuid not null references catalogs(id) on delete cascade,
  variant_id      uuid not null references variants(id),
  wholesale_price numeric(10,2),
  unique (catalog_id, variant_id)
);
create index if not exists catalog_items_catalog_id_idx on catalog_items (catalog_id);

-- updated_at trigger (set_updated_at() defined in migration 002)
create or replace trigger set_updated_at before update on catalogs
  for each row execute function set_updated_at();

-- RLS: the single authenticated user has full access; anon stays locked out.
alter table catalogs enable row level security;
alter table catalog_items enable row level security;

drop policy if exists catalogs_authenticated_all on catalogs;
create policy catalogs_authenticated_all on catalogs
  for all to authenticated using (true) with check (true);

drop policy if exists catalog_items_authenticated_all on catalog_items;
create policy catalog_items_authenticated_all on catalog_items
  for all to authenticated using (true) with check (true);
