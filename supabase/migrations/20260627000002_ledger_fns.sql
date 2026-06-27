-- Buzco — Gr8 Success | ERP + Inventory backbone
-- Postgres / Supabase — migration 002
--
-- Migration 001 is DDL-only: tables, enums, indexes, and the two
-- read-only current_stock views. Nothing in it keeps inventory_movements
-- consistent with purchase_order_lines / sales / consignment_lines —
-- that has to happen atomically, and the Supabase JS client has no
-- multi-statement transaction primitive over PostgREST. So every write
-- that touches the ledger is a plpgsql function (which transaction-wraps
-- naturally), called from the app via supabase.rpc(...), never built out
-- of several separate .insert()/.update() calls from the client.

-- ============================================================
-- Schema fixes
-- ============================================================

-- every other FK in 001 is `not null`; a sale with no variant can't be
-- reconciled against inventory or revenue-by-product reporting.
alter table sales alter column variant_id set not null;

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'suppliers','retailers','products','variants',
    'inventory_locations','purchase_orders','expenses','consignments'
  ]
  loop
    execute format('alter table %I add column if not exists updated_at timestamptz not null default now()', t);
    execute format(
      'create or replace trigger set_updated_at before update on %I for each row execute function set_updated_at()',
      t
    );
  end loop;
end;
$$;

-- ============================================================
-- Purchase orders: receiving a line
-- ============================================================
create or replace function receive_po_line(
  p_line_id     uuid,
  p_quantity    integer,
  p_location_id uuid
)
returns purchase_order_lines
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_line             purchase_order_lines;
  v_po_status        po_status;
  v_remaining_lines  integer;
begin
  if p_quantity <= 0 then
    raise exception 'p_quantity must be positive';
  end if;

  select * into v_line from purchase_order_lines where id = p_line_id for update;
  if v_line is null then
    raise exception 'purchase_order_line % not found', p_line_id;
  end if;

  select status into v_po_status from purchase_orders where id = v_line.purchase_order_id;
  if v_po_status = 'cancelled' then
    raise exception 'cannot receive against a cancelled purchase order';
  end if;

  if v_line.quantity_received + p_quantity > v_line.quantity_ordered then
    raise exception 'receiving % would exceed quantity_ordered (% already received of %)',
      p_quantity, v_line.quantity_received, v_line.quantity_ordered;
  end if;

  update purchase_order_lines
    set quantity_received = quantity_received + p_quantity
    where id = p_line_id
    returning * into v_line;

  insert into inventory_movements (variant_id, location_id, quantity_change, reason, reference_type, reference_id)
  values (v_line.variant_id, p_location_id, p_quantity, 'po_receipt', 'purchase_order', v_line.purchase_order_id);

  if v_line.unit_cost is not null then
    update variants set production_cost = v_line.unit_cost where id = v_line.variant_id;
  end if;

  select count(*) into v_remaining_lines
    from purchase_order_lines
    where purchase_order_id = v_line.purchase_order_id
      and quantity_received < quantity_ordered;

  update purchase_orders
    set status = case when v_remaining_lines = 0 then 'received' else 'partially_received' end,
        received_date = case when v_remaining_lines = 0 then coalesce(received_date, current_date) else received_date end
    where id = v_line.purchase_order_id;

  return v_line;
end;
$$;

grant execute on function receive_po_line(uuid, integer, uuid) to authenticated;

-- ============================================================
-- Manual sales logging (Shopify sales sync is a future migration —
-- this covers offline/market/wholesale/friends_family entry for now)
-- ============================================================
create or replace function log_sale(
  p_channel         sale_channel,
  p_variant_id      uuid,
  p_quantity        integer,
  p_location_id     uuid,
  p_gross_amount    numeric,
  p_discount_amount numeric default 0,
  p_shipping_amount numeric default 0,
  p_fees_amount     numeric default 0,
  p_customer_ref    text default null,
  p_notes           text default null
)
returns sales
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale   sales;
  v_reason movement_reason;
begin
  if p_quantity <= 0 then
    raise exception 'p_quantity must be positive';
  end if;

  insert into sales (
    channel, variant_id, quantity, gross_amount, discount_amount,
    shipping_amount, fees_amount, customer_ref, notes
  ) values (
    p_channel, p_variant_id, p_quantity, p_gross_amount, p_discount_amount,
    p_shipping_amount, p_fees_amount, p_customer_ref, p_notes
  ) returning * into v_sale;

  v_reason := case when p_channel = 'shopify' then 'sale_shopify'::movement_reason else 'sale_offline'::movement_reason end;

  insert into inventory_movements (variant_id, location_id, quantity_change, reason, reference_type, reference_id)
  values (p_variant_id, p_location_id, -p_quantity, v_reason, 'sale', v_sale.id);

  return v_sale;
end;
$$;

grant execute on function log_sale(sale_channel, uuid, integer, uuid, numeric, numeric, numeric, numeric, text, text) to authenticated;

-- ============================================================
-- Consignment lifecycle
--
-- Assumption: each retailer with an active consignment gets one
-- inventory_locations row (type='consignment', retailer_id=<them>) —
-- created lazily on first send if it doesn't exist yet. Stock physically
-- sitting with a retailer is modeled as a real location, per 001's intent
-- ("stock that physically lives with a retailer"), so send/return are
-- two-sided movements (out of the source location, into/out of the
-- retailer's consignment location) rather than a single-sided adjustment.
-- ============================================================
create or replace function consignment_send(
  p_consignment_id   uuid,
  p_variant_id       uuid,
  p_quantity         integer,
  p_wholesale_price  numeric,
  p_from_location_id uuid
)
returns consignment_lines
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_retailer_id             uuid;
  v_retailer_name           text;
  v_consignment_location_id uuid;
  v_line                    consignment_lines;
begin
  if p_quantity <= 0 then
    raise exception 'p_quantity must be positive';
  end if;

  select retailer_id into v_retailer_id from consignments where id = p_consignment_id;
  if v_retailer_id is null then
    raise exception 'consignment % not found', p_consignment_id;
  end if;

  select id into v_consignment_location_id
    from inventory_locations
    where type = 'consignment' and retailer_id = v_retailer_id
    limit 1;

  if v_consignment_location_id is null then
    select name into v_retailer_name from retailers where id = v_retailer_id;
    insert into inventory_locations (name, type, retailer_id)
    values (coalesce(v_retailer_name, 'Retailer') || ' (consignment)', 'consignment', v_retailer_id)
    returning id into v_consignment_location_id;
  end if;

  insert into consignment_lines (consignment_id, variant_id, quantity_sent, wholesale_price)
  values (p_consignment_id, p_variant_id, p_quantity, p_wholesale_price)
  returning * into v_line;

  insert into inventory_movements (variant_id, location_id, quantity_change, reason, reference_type, reference_id)
  values
    (p_variant_id, p_from_location_id,     -p_quantity, 'consignment_out', 'consignment', v_line.id),
    (p_variant_id, v_consignment_location_id, p_quantity, 'consignment_out', 'consignment', v_line.id);

  return v_line;
end;
$$;

grant execute on function consignment_send(uuid, uuid, integer, numeric, uuid) to authenticated;

create or replace function consignment_mark_sold(
  p_line_id  uuid,
  p_quantity integer
)
returns consignment_lines
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_line                    consignment_lines;
  v_retailer_id             uuid;
  v_retailer_name           text;
  v_consignment_location_id uuid;
begin
  if p_quantity <= 0 then
    raise exception 'p_quantity must be positive';
  end if;

  select cl.* into v_line from consignment_lines cl where cl.id = p_line_id for update;
  if v_line is null then
    raise exception 'consignment_line % not found', p_line_id;
  end if;

  if v_line.quantity_sold + v_line.quantity_returned + p_quantity > v_line.quantity_sent then
    raise exception 'marking % sold would exceed quantity_sent (% sold, % returned of %)',
      p_quantity, v_line.quantity_sold, v_line.quantity_returned, v_line.quantity_sent;
  end if;

  select c.retailer_id into v_retailer_id from consignments c where c.id = v_line.consignment_id;
  select name into v_retailer_name from retailers where id = v_retailer_id;
  select id into v_consignment_location_id
    from inventory_locations
    where type = 'consignment' and retailer_id = v_retailer_id
    limit 1;

  if v_consignment_location_id is null then
    raise exception 'no consignment location found for retailer %', v_retailer_id;
  end if;

  update consignment_lines
    set quantity_sold = quantity_sold + p_quantity
    where id = p_line_id
    returning * into v_line;

  insert into inventory_movements (variant_id, location_id, quantity_change, reason, reference_type, reference_id)
  values (v_line.variant_id, v_consignment_location_id, -p_quantity, 'consignment_sold', 'consignment', v_line.id);

  -- a consignment sale is still a sale — log it so revenue-by-channel
  -- reporting doesn't have to special-case consignments.
  insert into sales (channel, variant_id, quantity, gross_amount, customer_ref, notes)
  values (
    'wholesale', v_line.variant_id, p_quantity,
    coalesce(v_line.wholesale_price, 0) * p_quantity,
    v_retailer_name,
    'consignment_line:' || v_line.id
  );

  return v_line;
end;
$$;

grant execute on function consignment_mark_sold(uuid, integer) to authenticated;

create or replace function consignment_return(
  p_line_id        uuid,
  p_quantity       integer,
  p_to_location_id uuid
)
returns consignment_lines
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_line                    consignment_lines;
  v_retailer_id             uuid;
  v_consignment_location_id uuid;
begin
  if p_quantity <= 0 then
    raise exception 'p_quantity must be positive';
  end if;

  select cl.* into v_line from consignment_lines cl where cl.id = p_line_id for update;
  if v_line is null then
    raise exception 'consignment_line % not found', p_line_id;
  end if;

  if v_line.quantity_sold + v_line.quantity_returned + p_quantity > v_line.quantity_sent then
    raise exception 'returning % would exceed quantity_sent (% sold, % returned of %)',
      p_quantity, v_line.quantity_sold, v_line.quantity_returned, v_line.quantity_sent;
  end if;

  select c.retailer_id into v_retailer_id from consignments c where c.id = v_line.consignment_id;
  select id into v_consignment_location_id
    from inventory_locations
    where type = 'consignment' and retailer_id = v_retailer_id
    limit 1;

  if v_consignment_location_id is null then
    raise exception 'no consignment location found for retailer %', v_retailer_id;
  end if;

  update consignment_lines
    set quantity_returned = quantity_returned + p_quantity
    where id = p_line_id
    returning * into v_line;

  insert into inventory_movements (variant_id, location_id, quantity_change, reason, reference_type, reference_id)
  values
    (v_line.variant_id, v_consignment_location_id, -p_quantity, 'consignment_return', 'consignment', v_line.id),
    (v_line.variant_id, p_to_location_id,            p_quantity, 'consignment_return', 'consignment', v_line.id);

  return v_line;
end;
$$;

grant execute on function consignment_return(uuid, integer, uuid) to authenticated;
