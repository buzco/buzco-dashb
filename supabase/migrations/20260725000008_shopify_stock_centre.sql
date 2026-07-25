-- Migration 008 — Shopify becomes the stock centre.
--
-- Until now a market sale deducted from the event's own crate location, which
-- required carrying stock in and out of every event. Selling now creates a real
-- Shopify order (lib/shopify/create-order.ts) and Shopify decrements its own
-- inventory, so our ledger should mirror that same pool rather than a crate.
--
-- log_market_sale therefore takes an explicit location: pass the 'shopify'
-- location to mirror Shopify's decrement, or omit it to keep the old crate
-- behaviour (still used by anyone who genuinely reserves stock per event).
--
-- Raffle income has no variant and no stock movement, so it is recorded as a
-- plain sales row instead of through this function.

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
  p_sold_at              timestamptz default now(),
  p_location_id          uuid default null
)
returns sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_location_id uuid;
  v_sale        sales;
begin
  if p_quantity <= 0 then
    raise exception 'p_quantity must be positive';
  end if;

  -- Default to the event's crate so existing callers are unaffected.
  select coalesce(p_location_id, location_id) into v_location_id
    from market_events where id = p_market_event_id;
  if v_location_id is null then
    raise exception 'market_event % not found', p_market_event_id;
  end if;

  if p_shopify_line_item_id is not null then
    select * into v_sale from sales where shopify_line_item_id = p_shopify_line_item_id;
    if v_sale.id is not null then
      return v_sale;
    end if;
  end if;

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

      if not exists (
        select 1 from inventory_movements
        where reference_type = 'sale' and reference_id = v_sale.id
      ) then
        insert into inventory_movements
          (variant_id, location_id, quantity_change, reason, reference_type, reference_id, occurred_at)
        values
          (p_variant_id, v_location_id, -p_quantity, 'sale_offline', 'sale', v_sale.id, p_sold_at);
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
    (p_variant_id, v_location_id, -p_quantity, 'sale_offline', 'sale', v_sale.id, p_sold_at);

  return v_sale;
end;
$$;

grant execute on function log_market_sale(uuid, uuid, integer, numeric, numeric, numeric, text, text, text, text, text, timestamptz, uuid) to authenticated;
grant execute on function log_market_sale(uuid, uuid, integer, numeric, numeric, numeric, text, text, text, text, text, timestamptz, uuid) to service_role;

-- Raffle ticket sales: money in, but no product and no stock movement. Kept in
-- `sales` (variant_id null, channel 'other') so raffle income shows up in the
-- Finance tab and the event's takings next to garment sales.
alter table sales add column if not exists raffle_bundle text;
create index if not exists sales_raffle_bundle_idx on sales (raffle_bundle)
  where raffle_bundle is not null;

-- The standalone POS/raffle links have no logged-in user, so their writes go
-- through the service role. It bypasses RLS, but grant execute explicitly for
-- the other market functions too so behaviour is not accidental.
grant execute on function create_market_event(text, text, timestamptz, timestamptz, text) to service_role;
grant execute on function void_market_sale(uuid) to service_role;
grant execute on function set_market_price(uuid, uuid, uuid, numeric) to service_role;
