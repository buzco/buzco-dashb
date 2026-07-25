-- Migration 007 — physical markets & pop-up events.
--
-- A market event is a real-world selling day (fair, pop-up, street market).
-- Each event owns ONE inventory_locations row of type 'market', so the stock
-- you physically carry in the crate is a real location in the ledger:
--   load-in  = transfer warehouse -> market location
--   sale     = single-sided out of the market location
--   load-out = transfer market location -> warehouse (what came home)
-- That means "how much of X am I carrying" is just current_stock at the
-- event's location, and it stays auditable like every other movement.
--
-- Prices: an event can discount independently of variants.retail_price
-- (market_prices). Resolution order is variant override -> product default ->
-- variants.retail_price. These are OUR record only; they are never pushed to
-- Shopify, so the live storefront is untouched.

create table if not exists market_events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  venue       text,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  status      text not null default 'planning',  -- planning / live / closed
  location_id uuid not null references inventory_locations(id),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists market_events_status_idx on market_events (status);

create table if not exists market_prices (
  id              uuid primary key default gen_random_uuid(),
  market_event_id uuid not null references market_events(id) on delete cascade,
  product_id      uuid not null references products(id) on delete cascade,
  -- null = the event's default price for every variant of this product
  variant_id      uuid references variants(id) on delete cascade,
  price           numeric(10,2) not null check (price >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- Partial uniques: one product-level default and one override per variant.
-- NOTE: these are PARTIAL, so `insert ... on conflict (cols)` cannot infer them
-- without repeating the predicate. Writes therefore go through
-- set_market_price() below rather than a client-side upsert.
create unique index if not exists market_prices_product_default_key
  on market_prices (market_event_id, product_id) where variant_id is null;
create unique index if not exists market_prices_variant_key
  on market_prices (market_event_id, variant_id) where variant_id is not null;

-- Sales gain a market link + the Notion mirror bookkeeping.
alter table sales add column if not exists market_event_id uuid references market_events(id);
alter table sales add column if not exists shopify_line_item_id text;
-- How it was paid ("Cash", "Card (POS)", "Mbway André", "Unpaid") — mirrored to
-- the Notion tracker's "Método pagamento" column.
alter table sales add column if not exists payment_method text;
alter table sales add column if not exists notion_page_id text;
alter table sales add column if not exists notion_synced_at timestamptz;
alter table sales add column if not exists notion_error text;
create index if not exists sales_market_event_id_idx on sales (market_event_id);
-- Exact idempotency for imported POS lines (one sale per Shopify line item).
create unique index if not exists sales_shopify_line_item_key
  on sales (shopify_line_item_id) where shopify_line_item_id is not null;

create or replace trigger set_updated_at before update on market_events
  for each row execute function set_updated_at();
create or replace trigger set_updated_at before update on market_prices
  for each row execute function set_updated_at();

-- ============================================================
-- Create an event together with its inventory location, so the app never has
-- to do a two-step write that could leave an event without a location.
-- ============================================================
create or replace function create_market_event(
  p_name      text,
  p_venue     text default null,
  p_starts_at timestamptz default now(),
  p_ends_at   timestamptz default null,
  p_notes     text default null
)
returns market_events
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_location_id uuid;
  v_event       market_events;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'p_name is required';
  end if;

  insert into inventory_locations (name, type)
  values (trim(p_name) || ' (market)', 'market')
  returning id into v_location_id;

  insert into market_events (name, venue, starts_at, ends_at, notes, location_id)
  values (trim(p_name), p_venue, p_starts_at, p_ends_at, p_notes, v_location_id)
  returning * into v_event;

  return v_event;
end;
$$;

grant execute on function create_market_event(text, text, timestamptz, timestamptz, text) to authenticated;

-- ============================================================
-- Load stock into the crate (warehouse -> market) and back out again.
-- Both are two-sided transfers so total stock is conserved.
-- ============================================================
create or replace function market_load_in(
  p_market_event_id  uuid,
  p_variant_id       uuid,
  p_quantity         integer,
  p_from_location_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_market_location_id uuid;
  v_available          integer;
begin
  if p_quantity <= 0 then
    raise exception 'p_quantity must be positive';
  end if;

  select location_id into v_market_location_id
    from market_events where id = p_market_event_id;
  if v_market_location_id is null then
    raise exception 'market_event % not found', p_market_event_id;
  end if;
  if v_market_location_id = p_from_location_id then
    raise exception 'cannot load in from the event''s own location';
  end if;

  -- Unlike consignment_send, guard the source: loading a crate you don't have
  -- stock for is always a data-entry mistake, not a real movement.
  select coalesce(sum(quantity_change), 0) into v_available
    from inventory_movements
    where variant_id = p_variant_id and location_id = p_from_location_id;
  if v_available < p_quantity then
    raise exception 'only % available at source location (asked for %)', v_available, p_quantity;
  end if;

  insert into inventory_movements
    (variant_id, location_id, quantity_change, reason, reference_type, reference_id)
  values
    (p_variant_id, p_from_location_id,   -p_quantity, 'transfer', 'market_event', p_market_event_id),
    (p_variant_id, v_market_location_id,  p_quantity, 'transfer', 'market_event', p_market_event_id);
end;
$$;

grant execute on function market_load_in(uuid, uuid, integer, uuid) to authenticated;

create or replace function market_load_out(
  p_market_event_id uuid,
  p_variant_id      uuid,
  p_quantity        integer,
  p_to_location_id  uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_market_location_id uuid;
  v_available          integer;
begin
  if p_quantity <= 0 then
    raise exception 'p_quantity must be positive';
  end if;

  select location_id into v_market_location_id
    from market_events where id = p_market_event_id;
  if v_market_location_id is null then
    raise exception 'market_event % not found', p_market_event_id;
  end if;

  select coalesce(sum(quantity_change), 0) into v_available
    from inventory_movements
    where variant_id = p_variant_id and location_id = v_market_location_id;
  if v_available < p_quantity then
    raise exception 'only % left at the market (asked for %)', v_available, p_quantity;
  end if;

  insert into inventory_movements
    (variant_id, location_id, quantity_change, reason, reference_type, reference_id)
  values
    (p_variant_id, v_market_location_id, -p_quantity, 'transfer', 'market_event', p_market_event_id),
    (p_variant_id, p_to_location_id,      p_quantity, 'transfer', 'market_event', p_market_event_id);
end;
$$;

grant execute on function market_load_out(uuid, uuid, integer, uuid) to authenticated;

-- ============================================================
-- Event pricing. Set (or clear) one price: variant-level when p_variant_id is
-- given, otherwise the product-level default for the event.
-- Hand-rolled upsert because the uniques above are partial.
-- ============================================================
create or replace function set_market_price(
  p_market_event_id uuid,
  p_product_id      uuid,
  p_variant_id      uuid default null,
  p_price           numeric default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Null price clears the override, falling back to the next rule up.
  if p_price is null then
    if p_variant_id is null then
      delete from market_prices
        where market_event_id = p_market_event_id
          and product_id = p_product_id
          and variant_id is null;
    else
      delete from market_prices
        where market_event_id = p_market_event_id
          and variant_id = p_variant_id;
    end if;
    return;
  end if;

  if p_variant_id is null then
    update market_prices set price = p_price
      where market_event_id = p_market_event_id
        and product_id = p_product_id
        and variant_id is null;
  else
    update market_prices set price = p_price
      where market_event_id = p_market_event_id
        and variant_id = p_variant_id;
  end if;

  if not found then
    insert into market_prices (market_event_id, product_id, variant_id, price)
    values (p_market_event_id, p_product_id, p_variant_id, p_price);
  end if;
end;
$$;

grant execute on function set_market_price(uuid, uuid, uuid, numeric) to authenticated;

-- Price every product currently in the crate at a percentage off its retail
-- price. Sizes of one garment share a price, so this works at product level and
-- takes the highest retail among the loaded variants. Returns rows written.
create or replace function bulk_discount_market(
  p_market_event_id uuid,
  p_percent         numeric
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_market_location_id uuid;
  v_count              integer := 0;
  r                    record;
begin
  if p_percent is null or p_percent <= 0 or p_percent > 100 then
    raise exception 'p_percent must be between 1 and 100';
  end if;

  select location_id into v_market_location_id
    from market_events where id = p_market_event_id;
  if v_market_location_id is null then
    raise exception 'market_event % not found', p_market_event_id;
  end if;

  for r in
    select v.product_id, max(v.retail_price) as retail
      from current_stock cs
      join variants v on v.id = cs.variant_id
     where cs.location_id = v_market_location_id
       and cs.quantity > 0
       and v.retail_price is not null
     group by v.product_id
  loop
    perform set_market_price(
      p_market_event_id,
      r.product_id,
      null,
      round(r.retail * (1 - p_percent / 100.0), 2)
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function bulk_discount_market(uuid, numeric) to authenticated;

-- ============================================================
-- Sell at the market. Like log_sale, but the location is implied by the event
-- and the sale is tagged with it. Used both by the manual "sell" button and by
-- the Shopify POS importer, so every market sale takes one code path.
--
-- Idempotent for POS lines: if p_shopify_line_item_id already exists the
-- existing sale is returned untouched. A sale previously imported by the
-- generic Shopify order importer (revenue only, no inventory movement) is
-- ADOPTED — re-tagged to this event and given its missing movement — instead
-- of being duplicated.
-- ============================================================
create or replace function log_market_sale(
  p_market_event_id      uuid,
  p_variant_id           uuid,
  p_quantity             integer,
  p_gross_amount         numeric,
  p_discount_amount      numeric default 0,
  p_fees_amount          numeric default 0,
  p_customer_ref         text default null,
  p_notes                text default null,
  p_payment_method       text default null,
  p_shopify_order_id     text default null,
  p_shopify_line_item_id text default null,
  p_sold_at              timestamptz default now()
)
returns sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_market_location_id uuid;
  v_sale               sales;
begin
  if p_quantity <= 0 then
    raise exception 'p_quantity must be positive';
  end if;

  select location_id into v_market_location_id
    from market_events where id = p_market_event_id;
  if v_market_location_id is null then
    raise exception 'market_event % not found', p_market_event_id;
  end if;

  -- Already imported this exact POS line: nothing to do.
  if p_shopify_line_item_id is not null then
    select * into v_sale from sales where shopify_line_item_id = p_shopify_line_item_id;
    if v_sale.id is not null then
      return v_sale;
    end if;
  end if;

  -- Adopt a revenue-only row the generic order importer already created.
  if p_shopify_order_id is not null then
    select * into v_sale
      from sales
      where shopify_order_id = p_shopify_order_id
        and variant_id = p_variant_id
        and market_event_id is null
      limit 1;

    if v_sale.id is not null then
      update sales set
        channel              = 'market',
        market_event_id      = p_market_event_id,
        shopify_line_item_id = coalesce(p_shopify_line_item_id, shopify_line_item_id),
        quantity             = p_quantity,
        gross_amount         = p_gross_amount,
        discount_amount      = p_discount_amount,
        fees_amount          = p_fees_amount,
        customer_ref         = coalesce(p_customer_ref, customer_ref),
        notes                = coalesce(p_notes, notes),
        payment_method       = coalesce(p_payment_method, payment_method)
      where id = v_sale.id
      returning * into v_sale;

      -- Give it the inventory movement it never had.
      if not exists (
        select 1 from inventory_movements
        where reference_type = 'sale' and reference_id = v_sale.id
      ) then
        insert into inventory_movements
          (variant_id, location_id, quantity_change, reason, reference_type, reference_id, occurred_at)
        values
          (p_variant_id, v_market_location_id, -p_quantity, 'sale_offline', 'sale', v_sale.id, p_sold_at);
      end if;

      return v_sale;
    end if;
  end if;

  insert into sales (
    channel, variant_id, market_event_id, quantity, gross_amount, discount_amount,
    fees_amount, customer_ref, notes, payment_method,
    shopify_order_id, shopify_line_item_id, sold_at
  ) values (
    'market', p_variant_id, p_market_event_id, p_quantity, p_gross_amount, p_discount_amount,
    p_fees_amount, p_customer_ref, p_notes, p_payment_method,
    p_shopify_order_id, p_shopify_line_item_id, p_sold_at
  ) returning * into v_sale;

  insert into inventory_movements
    (variant_id, location_id, quantity_change, reason, reference_type, reference_id, occurred_at)
  values
    (p_variant_id, v_market_location_id, -p_quantity, 'sale_offline', 'sale', v_sale.id, p_sold_at);

  return v_sale;
end;
$$;

grant execute on function log_market_sale(uuid, uuid, integer, numeric, numeric, numeric, text, text, text, text, text, timestamptz) to authenticated;

-- Tombstones for voided Shopify POS lines. Without this, voiding an imported
-- sale then pulling again would silently re-import it, because the pull's
-- idempotency key (the sale row) has just been deleted.
create table if not exists market_voided_lines (
  shopify_line_item_id text primary key,
  market_event_id      uuid references market_events(id) on delete cascade,
  voided_at            timestamptz not null default now()
);

-- ============================================================
-- Undo a market sale (mis-scan, refund on the spot): removes the sale and its
-- movement, putting the unit back in the crate.
-- ============================================================
create or replace function void_market_sale(p_sale_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_line_id  text;
  v_event_id uuid;
begin
  select shopify_line_item_id, market_event_id
    into v_line_id, v_event_id
    from sales where id = p_sale_id;

  delete from inventory_movements where reference_type = 'sale' and reference_id = p_sale_id;
  delete from sales where id = p_sale_id;

  if v_line_id is not null then
    insert into market_voided_lines (shopify_line_item_id, market_event_id)
    values (v_line_id, v_event_id)
    on conflict (shopify_line_item_id) do nothing;
  end if;
end;
$$;

grant execute on function void_market_sale(uuid) to authenticated;

-- RLS: single trusted authenticated user, same blanket policy as every other table.
alter table market_events enable row level security;
alter table market_prices enable row level security;
alter table market_voided_lines enable row level security;

drop policy if exists market_events_authenticated_all on market_events;
create policy market_events_authenticated_all on market_events
  for all to authenticated using (true) with check (true);

drop policy if exists market_prices_authenticated_all on market_prices;
create policy market_prices_authenticated_all on market_prices
  for all to authenticated using (true) with check (true);

drop policy if exists market_voided_lines_authenticated_all on market_voided_lines;
create policy market_voided_lines_authenticated_all on market_voided_lines
  for all to authenticated using (true) with check (true);
