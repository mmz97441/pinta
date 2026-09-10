-- Commit enum values before using them in the following migration.
ALTER TYPE canal_communication ADD VALUE IF NOT EXISTS 'telegram';
ALTER TYPE canal_communication ADD VALUE IF NOT EXISTS 'portal';
ALTER TYPE statut_colis ADD VALUE IF NOT EXISTS 'dedouanement';
ALTER TYPE statut_envoi ADD VALUE IF NOT EXISTS 'en_preparation';
ALTER TYPE statut_envoi ADD VALUE IF NOT EXISTS 'pret';
