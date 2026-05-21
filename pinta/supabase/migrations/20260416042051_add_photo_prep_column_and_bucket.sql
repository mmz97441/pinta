-- Migration: add_photo_prep_column_and_bucket
-- Version: 20260416042051
-- Pulled from Supabase project bqprktzehuhplpqjgjaz on 2026-05-18

-- Add photo_prep column to store preparation photo URL
ALTER TABLE colis ADD COLUMN IF NOT EXISTS photo_prep TEXT;

-- Create storage bucket for colis photos (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('photos-colis', 'photos-colis', true)
ON CONFLICT (id) DO NOTHING;
