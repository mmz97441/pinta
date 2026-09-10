-- Reconcile schema changes formerly applied outside the tracked migrations.
-- Inspected against the production schema-only backup on 2026-09-10.
-- No business row, document, role, permission or historic template is deleted.
-- Safe both before the September release and on a fresh migration replay.

DO $$
BEGIN
 IF to_regclass('public.audit_actions') IS NOT NULL THEN
  ALTER TABLE public.audit_actions ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id);
  -- The old ALL policy allowed arbitrary audit deletion/modification.
  DROP POLICY IF EXISTS audit_staff_crud ON public.audit_actions;
 END IF;
 IF to_regclass('public.colis_locks') IS NOT NULL THEN
  -- Production already has UNIQUE(colis_id), with a separate id primary key.
  -- Retain both and existing transient locks. The new RPC uses auth.uid().
  CREATE UNIQUE INDEX IF NOT EXISTS colis_locks_colis_unique ON public.colis_locks(colis_id);
  DROP POLICY IF EXISTS locks_staff_all ON public.colis_locks;
 END IF;
END;
$$;

-- The old template catalogue supports subscription variants, duplicate keys,
-- email subjects and version history. It cannot be silently repurposed as the
-- new single-template-per-key/channel contract. Preserve the complete catalogue
-- under explicit legacy names. The September migration creates the operational
-- table; reviewed texts can subsequently be copied through the settings editor.
DO $$
DECLARE p record;
BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='message_templates' AND column_name='cle')
   AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='message_templates' AND column_name='key') THEN
  IF to_regclass('public.message_templates_legacy') IS NOT NULL THEN
   RAISE EXCEPTION 'Template reconciliation: legacy archive already exists; manual schema review required';
  END IF;
  ALTER TABLE public.message_templates RENAME TO message_templates_legacy;
  -- Renaming the constraint also frees its backing index name for the new table.
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.message_templates_legacy'::regclass AND conname='message_templates_pkey') THEN
   ALTER TABLE public.message_templates_legacy RENAME CONSTRAINT message_templates_pkey TO message_templates_legacy_pkey;
  END IF;
  COMMENT ON TABLE public.message_templates_legacy IS 'Preserved pre-September 2026 template catalogue; review before copying into operational message_templates.';
 END IF;
 IF to_regclass('public.message_templates_legacy') IS NOT NULL THEN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='message_templates_legacy' LOOP
   EXECUTE format('DROP POLICY %I ON public.message_templates_legacy',p.policyname);
  END LOOP;
  ALTER TABLE public.message_templates_legacy ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.message_templates_legacy FROM anon,authenticated;
  GRANT SELECT ON public.message_templates_legacy TO authenticated;
  CREATE POLICY legacy_templates_direction_read ON public.message_templates_legacy FOR SELECT TO authenticated USING(public.is_direction());
 END IF;
 -- Existing versions retain their FK to the renamed catalogue. Keep their name
 -- and all history, but remove the former anonymous/public read access.
 IF to_regclass('public.message_templates_versions') IS NOT NULL THEN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='message_templates_versions' LOOP
   EXECUTE format('DROP POLICY %I ON public.message_templates_versions',p.policyname);
  END LOOP;
  ALTER TABLE public.message_templates_versions ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.message_templates_versions FROM anon,authenticated;
  GRANT SELECT ON public.message_templates_versions TO authenticated;
  CREATE POLICY legacy_template_versions_direction_read ON public.message_templates_versions FOR SELECT TO authenticated USING(public.is_direction());
 END IF;
END;
$$;

-- Preserve historical TEXT staff roles, TEXT[] preparation tags and subscription
-- enum columns: their JSON API representations match the current application.
-- The September profile synchronization casts staff role explicitly to the
-- canonical enum; no table/type rewrite or permission reconstruction is needed.
