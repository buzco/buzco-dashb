-- Migration 004 — fix receive_po_line enum cast.
--
-- In 002, receive_po_line set purchase_orders.status from a CASE expression
-- whose branches were bare string literals. A CASE resolves its branches to a
-- common type of `text`, and there is no implicit assignment cast from text to
-- the po_status enum, so the UPDATE failed at runtime with:
--   column "status" is of type po_status but expression is of type text
-- (Bare literals in INSERT ... VALUES coerce directly to the target enum, which
-- is why the movement insert in the same function was fine — only the CASE bit.)
--
-- Fix: cast each branch explicitly to po_status. This is a create-or-replace of
-- the whole function body, otherwise identical to 002.

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
    set status = case when v_remaining_lines = 0 then 'received'::po_status else 'partially_received'::po_status end,
        received_date = case when v_remaining_lines = 0 then coalesce(received_date, current_date) else received_date end
    where id = v_line.purchase_order_id;

  return v_line;
end;
$$;

grant execute on function receive_po_line(uuid, integer, uuid) to authenticated;
