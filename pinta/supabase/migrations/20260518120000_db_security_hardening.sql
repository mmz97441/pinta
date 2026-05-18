-- Migration: db_security_hardening
-- Version: 20260518120000
-- Date: 2026-05-18
--
-- Closes 3 categories of advisor findings reported by the Supabase database
-- linter on project bqprktzehuhplpqjgjaz:
--
--  1. 7 views in public.* defined with SECURITY DEFINER — they bypass RLS by
--     running as the view creator. Switch to SECURITY INVOKER so the calling
--     user's policies apply (Postgres 15+).
--
--  2. share_links has an "always-true" RLS policy that grants ALL commands to
--     PUBLIC. Drop it. The remaining staff_all + service-role bypass cover the
--     legitimate access patterns.
--
--  3. Storage buckets `factures` and `photos-colis` are public AND have a broad
--     SELECT policy on storage.objects, which lets any client LIST every file
--     in the bucket via the API. Public buckets don't need that policy for
--     public URL access — the CDN serves them directly. Drop the listing
--     policies; keep INSERT/UPDATE for staff/owners.
--
-- All changes are reversible by re-running 005_vues_metier.sql +
-- create_share_links_table.sql + add_photo_prep_column_and_bucket.sql.


-- ════════════════════════════════════════════════════════════════════════════
-- 1. Switch the 7 SECURITY DEFINER views to SECURITY INVOKER (PG 15+ syntax)
-- ════════════════════════════════════════════════════════════════════════════

ALTER VIEW public.v_abonnements_alertes  SET (security_invoker = true);
ALTER VIEW public.v_ca_par_destination   SET (security_invoker = true);
ALTER VIEW public.v_colis                SET (security_invoker = true);
ALTER VIEW public.v_envois_logisticien   SET (security_invoker = true);
ALTER VIEW public.v_file_preparateur     SET (security_invoker = true);
ALTER VIEW public.v_kpi_directeur        SET (security_invoker = true);
ALTER VIEW public.v_top_clients          SET (security_invoker = true);


-- ════════════════════════════════════════════════════════════════════════════
-- 2. share_links — drop the always-true policy
-- ════════════════════════════════════════════════════════════════════════════
--
-- The Edge Function get-tracking uses the service role key, which bypasses RLS
-- entirely. So we don't need a "service" policy on the table. Removing it
-- means the only remaining policy is share_links_staff_all (USING is_staff()),
-- which correctly limits writes to authenticated staff.

DROP POLICY IF EXISTS share_links_service ON public.share_links;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. Storage — drop the broad SELECT policies that enable listing
-- ════════════════════════════════════════════════════════════════════════════
--
-- These policies grant SELECT on storage.objects for `bucket_id = X`, which
-- lets clients list every file. We drop them. Public URL access keeps working
-- because the bucket is marked public (served by the CDN, not via RLS).
--
-- INSERT (Factures upload, Auth upload photos-colis) and UPDATE (Factures
-- update) policies remain in place.

DROP POLICY IF EXISTS "Factures read"         ON storage.objects;
DROP POLICY IF EXISTS "Public read photos-colis" ON storage.objects;
