-- Buzco — Gr8 Success | ERP + Inventory backbone
-- Postgres / Supabase — migration 001
-- Principle: THIS database is the source of truth for stock & money.
-- Shopify is one synced channel, not the master record.

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ============================================================
-- Enums
-- ============================================================
create type location_type   as enum ('warehouse','shopify','market','consignment','friends_family');
create type po_status        as enum ('draft','ordered','partially_received','received','cancelled');
create type movement_reason  as enum (
  'po_receipt','sale_shopify','sale_offline','consignment_out',
  'consignment_sold','consignment_return','adjustment','transfer'
);
create type sale_channel     as enum ('shopify','market','friends_family','wholesale','other');
create type expense_source   as enum ('purchase_order','subscription','shipping','ads','manual','other');

-- ============================================================
-- Partners
-- ============================================================
create table suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_email text,
  notes         text,
  created_at    timestamptz not null default now()
);

create table retailers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_email text,
  kind          text,                 -- boutique / wholesaler / buyer
  location      text,
  status        text default 'prospect',
  notes         text,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- Catalog: products -> variants (SKUs)
-- ============================================================
create table products (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,          -- "Superior Entity Tee"
  description        text,
  tags               text[],                 -- nature / science / spirituality
  shopify_product_id text,                   -- null until pushed as a draft
  status             text not null default 'draft', -- draft / active / archived
  created_at         timestamptz not null default now()
);

create table variants (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references products(id) on delete cascade,
  size               text,                   -- XS / S / M / L / XL
  color              text,
  sku                text unique not null,   -- auto-generated per size on PO creation
  barcode            text,
  retail_price       numeric(10,2),          -- default selling price
  production_cost    numeric(10,2),          -- latest known unit cost
  shopify_variant_id text,
  created_at         timestamptz not null default now(),
  unique (product_id, size, color)
);
create index on variants (product_id);

-- ============================================================
-- Inventory: locations + an append-only movement ledger
-- (a ledger, not a single "quantity" column, so stock is always
--  auditable and accurate across every channel)
-- ============================================================
create table inventory_locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        location_type not null,
  retailer_id uuid references retailers(id),   -- set when type = consignment
  created_at  timestamptz not null default now()
);

create table inventory_movements (
  id              uuid primary key default gen_random_uuid(),
  variant_id      uuid not null references variants(id),
  location_id     uuid not null references inventory_locations(id),
  quantity_change integer not null,            -- +received, -sold/out
  reason          movement_reason not null,
  reference_type  text,                        -- 'purchase_order' | 'sale' | 'consignment'
  reference_id    uuid,                        -- soft link to the source row
  occurred_at     timestamptz not null default now(),
  notes           text
);
create index on inventory_movements (variant_id);
create index on inventory_movements (location_id);
create index on inventory_movements (reference_type, reference_id);

-- Live stock per variant per location
create view current_stock as
select variant_id, location_id, sum(quantity_change)::int as quantity
from inventory_movements
group by variant_id, location_id;

-- Live total stock per variant across all locations
create view current_stock_by_variant as
select variant_id, sum(quantity_change)::int as total_quantity
from inventory_movements
group by variant_id;

-- ============================================================
-- Inbound: purchase orders  (your ERP receiving loop)
-- ============================================================
create table purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid references suppliers(id),
  status        po_status not null default 'draft',
  reference     text,                  -- your own PO name/number
  currency      text default 'EUR',
  total_bill    numeric(12,2),         -- full invoice -> becomes an expense on receipt
  order_date    date,
  received_date date,
  notes         text,
  created_at    timestamptz not null default now()
);

create table purchase_order_lines (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  variant_id        uuid not null references variants(id),
  quantity_ordered  integer not null,
  quantity_received integer not null default 0,
  unit_cost         numeric(10,2)      -- feeds variant.production_cost on receipt
);
create index on purchase_order_lines (purchase_order_id);

-- ============================================================
-- Money out / in
-- ============================================================
create table expenses (
  id                uuid primary key default gen_random_uuid(),
  category          text not null,     -- production / software / shipping / ads / fees ...
  description       text,
  amount            numeric(12,2) not null,
  currency          text default 'EUR',
  incurred_at       date not null default current_date,
  recurring_interval text,             -- null | 'monthly' | 'yearly'
  source            expense_source not null default 'manual',
  source_id         uuid,              -- e.g. the purchase_order it came from
  created_at        timestamptz not null default now()
);

create table sales (
  id              uuid primary key default gen_random_uuid(),
  channel         sale_channel not null,
  variant_id      uuid references variants(id),
  quantity        integer not null default 1,
  gross_amount    numeric(12,2) not null,
  discount_amount numeric(12,2) not null default 0,
  shipping_amount numeric(12,2) not null default 0,
  fees_amount     numeric(12,2) not null default 0,   -- payment processing
  net_amount      numeric(12,2) generated always as
                    (gross_amount - discount_amount - fees_amount) stored,
  shopify_order_id text,
  customer_ref    text,
  sold_at         timestamptz not null default now(),
  notes           text
);
create index on sales (variant_id);
create index on sales (channel);

-- ============================================================
-- Consignment: stock that physically lives with a retailer
-- ============================================================
create table consignments (
  id          uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references retailers(id),
  status      text not null default 'active', -- active / settled / returned
  sent_date   date default current_date,
  notes       text,
  created_at  timestamptz not null default now()
);

create table consignment_lines (
  id                uuid primary key default gen_random_uuid(),
  consignment_id    uuid not null references consignments(id) on delete cascade,
  variant_id        uuid not null references variants(id),
  quantity_sent     integer not null,
  quantity_sold     integer not null default 0,
  quantity_returned integer not null default 0,
  wholesale_price   numeric(10,2)
);
create index on consignment_lines (consignment_id);
