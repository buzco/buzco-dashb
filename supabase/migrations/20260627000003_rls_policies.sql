-- Migration 003 — Row Level Security policies.
--
-- The backbone schema creates tables but ships no RLS policies. Supabase enables
-- RLS on public tables by default, so without policies the `authenticated` role
-- (the logged-in app user) is locked out exactly like the anonymous public role:
-- reads return zero rows and writes are rejected. This migration grants the
-- single trusted `authenticated` user full access to every app table, while the
-- public `anon` role stays blocked (it never gets a policy).
--
-- Model: single-user internal tool. There is no per-row ownership to enforce, so
-- each policy is a blanket `using (true) with check (true)` scoped to the
-- `authenticated` role. `service_role` bypasses RLS entirely and is unaffected.

do $$
declare
  t text;
  app_tables text[] := array[
    'suppliers',
    'retailers',
    'products',
    'variants',
    'inventory_locations',
    'inventory_movements',
    'purchase_orders',
    'purchase_order_lines',
    'expenses',
    'sales',
    'consignments',
    'consignment_lines'
  ];
begin
  foreach t in array app_tables loop
    -- Idempotent: enabling RLS when already enabled is a no-op.
    execute format('alter table public.%I enable row level security;', t);

    -- Drop-then-create so the migration can be re-run cleanly during development.
    execute format('drop policy if exists %I on public.%I;', t || '_authenticated_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true);',
      t || '_authenticated_all',
      t
    );
  end loop;
end;
$$;
