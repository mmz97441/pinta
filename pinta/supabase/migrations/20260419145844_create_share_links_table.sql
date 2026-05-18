-- Migration: create_share_links_table
-- Version: 20260419145844
-- Pulled from Supabase project bqprktzehuhplpqjgjaz on 2026-05-18


-- Table des liens de partage client (suivi public par token)
CREATE TABLE IF NOT EXISTS share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  revoked_at TIMESTAMPTZ,
  access_count INT NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);
CREATE INDEX IF NOT EXISTS idx_share_links_client_id ON share_links(client_id);

ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;

-- Staff peut tout gérer
DO $$ BEGIN
  CREATE POLICY "share_links_staff_all" ON share_links FOR ALL USING (is_staff());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role (Edge Function) bypass
DO $$ BEGIN
  CREATE POLICY "share_links_service" ON share_links FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
