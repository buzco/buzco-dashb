-- Default warehouse location so the first PO has somewhere to receive stock into.
insert into inventory_locations (name, type)
select 'Main Warehouse', 'warehouse'::location_type
where not exists (select 1 from inventory_locations where type = 'warehouse');
