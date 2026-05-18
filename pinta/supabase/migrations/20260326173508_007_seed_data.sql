-- Migration: 007_seed_data
-- Version: 20260326173508
-- Pulled from Supabase project bqprktzehuhplpqjgjaz on 2026-05-18


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 7 : Données de référence                                 ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ══════════ DESTINATIONS DOM-TOM ══════════
INSERT INTO destinations (code, nom, flag, tva, has_om, taxe_conso) VALUES
  ('974', 'La Réunion',   '🇷🇪', 8.5,  TRUE,  0),
  ('976', 'Mayotte',      '🇾🇹', 10,   FALSE, 5),
  ('971', 'Guadeloupe',   '🇬🇵', 8.5,  TRUE,  0),
  ('972', 'Martinique',   '🇲🇶', 8.5,  TRUE,  0);

-- ══════════ CATÉGORIES PRODUITS ══════════
INSERT INTO categories (label, custom, position) VALUES
  ('Électronique',     FALSE, 1),
  ('Vêtements',        FALSE, 2),
  ('Cosmétique',       FALSE, 3),
  ('Accessoires',      FALSE, 4),
  ('Maison / Déco',    FALSE, 5),
  ('Jouets / Loisirs', FALSE, 6),
  ('Auto / Moto',      FALSE, 7);

-- ══════════ TAUX OM/OMR PAR CATÉGORIE × DESTINATION ══════════
-- Électronique
INSERT INTO taux_categories (categorie_id, destination_code, om, omr)
SELECT id, '974', 9.5, 2.5 FROM categories WHERE label = 'Électronique'
UNION ALL SELECT id, '976', 5, 0 FROM categories WHERE label = 'Électronique'
UNION ALL SELECT id, '971', 8, 2 FROM categories WHERE label = 'Électronique'
UNION ALL SELECT id, '972', 8, 2 FROM categories WHERE label = 'Électronique';

-- Vêtements
INSERT INTO taux_categories (categorie_id, destination_code, om, omr)
SELECT id, '974', 0, 0 FROM categories WHERE label = 'Vêtements'
UNION ALL SELECT id, '976', 5, 0 FROM categories WHERE label = 'Vêtements'
UNION ALL SELECT id, '971', 0, 0 FROM categories WHERE label = 'Vêtements'
UNION ALL SELECT id, '972', 0, 0 FROM categories WHERE label = 'Vêtements';

-- Cosmétique
INSERT INTO taux_categories (categorie_id, destination_code, om, omr)
SELECT id, '974', 6.5, 2.5 FROM categories WHERE label = 'Cosmétique'
UNION ALL SELECT id, '976', 10, 0 FROM categories WHERE label = 'Cosmétique'
UNION ALL SELECT id, '971', 6.5, 2.5 FROM categories WHERE label = 'Cosmétique'
UNION ALL SELECT id, '972', 6.5, 2.5 FROM categories WHERE label = 'Cosmétique';

-- Accessoires
INSERT INTO taux_categories (categorie_id, destination_code, om, omr)
SELECT id, '974', 6.5, 2.5 FROM categories WHERE label = 'Accessoires'
UNION ALL SELECT id, '976', 5, 0 FROM categories WHERE label = 'Accessoires'
UNION ALL SELECT id, '971', 6, 2 FROM categories WHERE label = 'Accessoires'
UNION ALL SELECT id, '972', 6, 2 FROM categories WHERE label = 'Accessoires';

-- Maison / Déco
INSERT INTO taux_categories (categorie_id, destination_code, om, omr)
SELECT id, '974', 12.5, 2.5 FROM categories WHERE label = 'Maison / Déco'
UNION ALL SELECT id, '976', 10, 0 FROM categories WHERE label = 'Maison / Déco'
UNION ALL SELECT id, '971', 12, 2.5 FROM categories WHERE label = 'Maison / Déco'
UNION ALL SELECT id, '972', 12, 2.5 FROM categories WHERE label = 'Maison / Déco';

-- Jouets / Loisirs
INSERT INTO taux_categories (categorie_id, destination_code, om, omr)
SELECT id, '974', 15, 2.5 FROM categories WHERE label = 'Jouets / Loisirs'
UNION ALL SELECT id, '976', 10, 0 FROM categories WHERE label = 'Jouets / Loisirs'
UNION ALL SELECT id, '971', 14, 2.5 FROM categories WHERE label = 'Jouets / Loisirs'
UNION ALL SELECT id, '972', 14, 2.5 FROM categories WHERE label = 'Jouets / Loisirs';

-- Auto / Moto
INSERT INTO taux_categories (categorie_id, destination_code, om, omr)
SELECT id, '974', 7, 2.5 FROM categories WHERE label = 'Auto / Moto'
UNION ALL SELECT id, '976', 5, 0 FROM categories WHERE label = 'Auto / Moto'
UNION ALL SELECT id, '971', 7, 2 FROM categories WHERE label = 'Auto / Moto'
UNION ALL SELECT id, '972', 7, 2 FROM categories WHERE label = 'Auto / Moto';

-- ══════════ TARIFS TRANSPORT ══════════
INSERT INTO tarifs (destination_code, base, par_kg) VALUES
  ('974', 25, 5),
  ('976', 35, 15),
  ('971', 30, 8),
  ('972', 30, 8);
