-- Migration 005 — image URLs on products and variants.
--
-- Needed for product thumbnails in the merged catalog view and for showing
-- imagery in edit screens. Populated by the Shopify sync (featuredImage) and
-- by the dashboard image-upload pipeline (Supabase Storage public URLs).
-- Purely additive, nullable.

alter table products add column if not exists image_url text;
alter table variants add column if not exists image_url text;
