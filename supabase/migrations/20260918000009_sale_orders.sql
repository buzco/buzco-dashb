-- Migration 009 — Sales become ORDERS.
--
-- Until now every sale was a standalone `sales` row, which cannot express the
-- two things the sales tab is actually used for:
--
--   * a multi-item sale (four tees to one buyer is ONE transaction, not four),
--   * a consignation (a batch left with a shop, unpaid until they settle).
--
-- So a `sale_orders` header is added and every `sales` row hangs off one. The
-- row stays the unit of record — one row per product+size line, which is what
-- the Notion tracker mirrors one page per garment from — but the money, the
-- buyer, the channel and the paid/pending state now live once on the order.
--
-- Consignation is the same shape with `kind = 'consignment'`: payment_status is
-- forced to 'pending' at creation and can only move to 'paid' through
-- settle_sale_order, so a consigned batch can never be logged as money in.
--
-- Idempotent throughout (create if not exists / create or replace / drop policy
-- if exists) because it may be applied through the Supabase SQL editor, which
-- keeps no schema_migrations bookkeeping.

-- ============================================================
-- Order header
-- ============================================================

-- Human reference (SL-0001 / CNS-0001). A shared sequence on purpose: the
-- prefix says what it is, and one counter means two orders can never collide.
create sequence if not exists sale_order_ref_seq;

create table if not exists sale_orders (
  id              uuid primary key default gen_random_uuid(),
  -- 'sale' | 'consignment'
  kind            text not null default 'sale',
  reference       text not null unique,
  channel         sale_channel not null default 'other',
  -- Wholesale/consignment buyer. Retailers double as the customer book.
  retailer_id     uuid references retailers(id),
  -- Walk-up buyer with no retailer record — just a name on the receipt.
  customer_name   text,
  -- The Notion tracker's "Where" option, verbatim (Feira / Online / Ladra …).
  where_sold      text,
  -- 'paid' | 'pending'
  payment_status  text not null default 'paid',
  payment_method  text,
  -- How the discount was ENTERED ('percent' | 'amount' | null), kept so the UI
  -- can show "10% off" rather than reverse-engineering it from the euros.
  discount_kind   text,
  discount_value  numeric(10,2) not null default 0,
  notes           text,
  shopify_order_id   text,
  shopify_order_name text,
  settled_at      timestamptz,
  created_at      timestamptz not null default now(),

  constraint sale_orders_kind_check check (kind in ('sale','consignment')),
  constraint sale_orders_payment_status_check check (payment_status in ('paid','pending')),
  constraint sale_orders_discount_kind_check
    check (discount_kind is null or discount_kind in ('percent','amount')),
  -- The rule the whole consignation flow rests on: a consignment counts as paid
  -- only once it has been settled, and settling is what stamps settled_at.
  constraint sale_orders_consignment_settled_check
    check (kind <> 'consignment' or payment_status = 'pending' or settled_at is not null)
);

create index if not exists sale_orders_kind_idx on sale_orders (kind, created_at desc);
create index if not exists sale_orders_retailer_idx on sale_orders (retailer_id);

alter table sales add column if not exists sale_order_id uuid references sale_orders(id) on delete cascade;
-- A giveaway is a real line (it leaves stock) that happens to be worth nothing.
-- Flagged rather than inferred from a zero price, because "free with purchase"
-- and "sold at a 100% discount" mean different things in the Notion tracker.
alter table sales add column if not exists is_freebie boolean not null default false;

-- Consigned stock has TWO states, not one, and they move independently: the
-- shop sells a piece off the rail (this column), and separately the shop pays
-- us for what it sold (sale_orders.payment_status). Weeks can pass between.
--
-- This mirrors what the Notion tracker already does by hand — its Status
-- multi-select carries "Por pagar" and "SOLD" together on 14 of the 46 pieces
-- currently at Cybercafé — so the app reads and writes the convention that is
-- already in use rather than inventing a second one.
alter table sales add column if not exists consignment_sold_at timestamptz;

create index if not exists sales_sale_order_idx on sales (sale_order_id);

-- ============================================================
-- Writing an order
-- ============================================================

-- One call writes the header, every line and every stock movement in a single
-- transaction. The alternative — insert the header, then loop inserts from the
-- server action — can half-record an order if the request dies mid-loop, which
-- on a phone at a market is not hypothetical.
--
-- p_lines is a jsonb array of:
--   { "variant_id": uuid, "quantity": int, "unit_price": numeric,
--     "discount_amount": numeric, "freebie": bool }
-- unit_price is the price per garment BEFORE the line's share of the order
-- discount; discount_amount is that share, already apportioned by the caller.
create or replace function log_sale_order(
  p_kind               text,
  p_channel            sale_channel,
  p_retailer_id        uuid,
  p_customer_name      text,
  p_where              text,
  p_payment_status     text,
  p_payment_method     text,
  p_discount_kind      text,
  p_discount_value     numeric,
  p_notes              text,
  p_location_id        uuid,
  p_lines              jsonb,
  p_shopify_order_id   text default null,
  p_shopify_order_name text default null,
  p_sold_at            timestamptz default now()
)
returns sale_orders
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_order  sale_orders;
  v_line   jsonb;
  v_sale   sales;
  v_qty    integer;
  v_price  numeric;
  v_status text;
  v_reason movement_reason;
begin
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then
    raise exception 'an order needs at least one line';
  end if;
  if p_location_id is null then
    raise exception 'p_location_id is required — stock has to leave somewhere';
  end if;

  -- A consignment is unpaid by construction; ignore anything the caller passed.
  v_status := case when p_kind = 'consignment' then 'pending'
                   else coalesce(p_payment_status, 'paid') end;
  v_reason := (case when p_kind = 'consignment' then 'consignment_out'
                    else 'sale_offline' end)::movement_reason;

  insert into sale_orders (
    kind, reference, channel, retailer_id, customer_name, where_sold,
    payment_status, payment_method, discount_kind, discount_value, notes,
    shopify_order_id, shopify_order_name, created_at
  ) values (
    p_kind,
    (case when p_kind = 'consignment' then 'CNS-' else 'SL-' end)
      || lpad(nextval('sale_order_ref_seq')::text, 4, '0'),
    p_channel, p_retailer_id, p_customer_name, p_where,
    v_status, p_payment_method, p_discount_kind, coalesce(p_discount_value, 0), p_notes,
    p_shopify_order_id, p_shopify_order_name, p_sold_at
  ) returning * into v_order;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty   := coalesce((v_line ->> 'quantity')::integer, 0);
    v_price := coalesce((v_line ->> 'unit_price')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'line quantity must be positive';
    end if;

    insert into sales (
      channel, variant_id, quantity, gross_amount, discount_amount,
      customer_ref, notes, payment_method, sale_order_id, is_freebie,
      shopify_order_id, sold_at
    ) values (
      p_channel,
      (v_line ->> 'variant_id')::uuid,
      v_qty,
      round(v_price * v_qty, 2),
      round(coalesce((v_line ->> 'discount_amount')::numeric, 0), 2),
      coalesce(p_customer_name, v_order.reference),
      p_notes,
      p_payment_method,
      v_order.id,
      coalesce((v_line ->> 'freebie')::boolean, false),
      p_shopify_order_id,
      p_sold_at
    ) returning * into v_sale;

    insert into inventory_movements
      (variant_id, location_id, quantity_change, reason, reference_type, reference_id, occurred_at)
    values
      (v_sale.variant_id, p_location_id, -v_qty, v_reason, 'sale', v_sale.id, p_sold_at);
  end loop;

  return v_order;
end;
$fn$;

-- ============================================================
-- Settling a consignation
-- ============================================================

-- The shop paid for what it kept. Flips the order to paid and stamps the real
-- payment method onto every line, which is what the Notion mirror reads to move
-- those pages from "Por pagar" to "Pago".
create or replace function settle_sale_order(
  p_order_id       uuid,
  p_payment_method text,
  p_settled_at     timestamptz default now()
)
returns sale_orders
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_order sale_orders;
begin
  select * into v_order from sale_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'sale order % not found', p_order_id;
  end if;
  if v_order.payment_status = 'paid' then
    return v_order;  -- settling twice is a no-op, not an error
  end if;

  update sale_orders set
    payment_status = 'paid',
    payment_method = coalesce(p_payment_method, payment_method),
    settled_at     = p_settled_at
  where id = p_order_id
  returning * into v_order;

  -- Freebies stay freebies: they were never owed, so they keep no method.
  update sales set payment_method = coalesce(p_payment_method, payment_method)
  where sale_order_id = p_order_id and is_freebie = false;

  return v_order;
end;
$fn$;

-- The shop sold a piece off the rail. Not the same as being paid for it, so
-- this deliberately does not touch payment_status — settle_sale_order is still
-- what turns money into money.
create or replace function set_consignment_line_sold(
  p_sale_id uuid,
  p_sold    boolean,
  p_sold_at timestamptz default now()
)
returns sales
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_sale sales;
begin
  update sales
     set consignment_sold_at = case when p_sold then coalesce(consignment_sold_at, p_sold_at) end
   where id = p_sale_id
  returning * into v_sale;

  if v_sale.id is null then
    raise exception 'sale line % not found', p_sale_id;
  end if;
  return v_sale;
end;
$fn$;

-- Consigned stock coming back unsold: the line is reversed and the units land
-- in `p_to_location_id`. The sale row is deleted rather than zeroed, because it
-- was never revenue and a zero-value row would still count as a garment sold in
-- every report.
create or replace function return_sale_order_line(
  p_sale_id        uuid,
  p_to_location_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_sale sales;
begin
  select * into v_sale from sales where id = p_sale_id;
  if v_sale.id is null then
    raise exception 'sale line % not found', p_sale_id;
  end if;
  if p_to_location_id is null then
    raise exception 'p_to_location_id is required — the units have to land somewhere';
  end if;

  insert into inventory_movements
    (variant_id, location_id, quantity_change, reason, reference_type, reference_id, occurred_at)
  values
    (v_sale.variant_id, p_to_location_id, v_sale.quantity, 'consignment_return', 'sale', v_sale.id, now());

  delete from sales where id = p_sale_id;
end;
$fn$;

-- ============================================================
-- RLS — same blanket single-user policy as every other table
-- ============================================================

alter table sale_orders enable row level security;
drop policy if exists sale_orders_authenticated_all on sale_orders;
create policy sale_orders_authenticated_all on sale_orders
  for all to authenticated using (true) with check (true);

grant usage on sequence sale_order_ref_seq to authenticated, service_role;

grant execute on function log_sale_order(
  text, sale_channel, uuid, text, text, text, text, text, numeric, text, uuid, jsonb, text, text, timestamptz
) to authenticated, service_role;
grant execute on function settle_sale_order(uuid, text, timestamptz) to authenticated, service_role;
grant execute on function return_sale_order_line(uuid, uuid) to authenticated, service_role;
grant execute on function set_consignment_line_sold(uuid, boolean, timestamptz) to authenticated, service_role;
