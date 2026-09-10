-- Synthetic fixtures: apply after application migrations and BEFORE legacy migration 00012.
INSERT INTO clients(id,nom,cp,email,type,points) VALUES
 ('80000000-0000-4000-8000-000000000001','Legacy fixture','97400','buyer+legacy@example.test','particulier',7),
 ('80000000-0000-4000-8000-000000000002','Other fixture','97400','other@example.test','particulier',0);
INSERT INTO colis(id,client_id,ref,statut,devis_brouillon,devis_transport,devis_total,fin_l,fin_w,fin_h,fin_p,payplug_payment_id,paiement_montant,paiement_date) VALUES
 ('90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','EXP-LEGACY','devis_envoye',false,30,37.98,10,10,10,2,'pay_legacyPending',NULL,NULL),
 ('90000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','EXP-PAID','paye',false,30,37.98,10,10,10,2,'pay_legacyPaid',37.98,'2026-01-01T00:00:00Z'),
 ('90000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000002','EXP-CHANGED','devis_envoye',false,30,37.98,10,10,10,2,'pay_legacyChanged',NULL,NULL),
 ('90000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000002','EXP-DESTINATION','devis_envoye',false,30,37.98,10,10,10,2,'pay_legacyDestination',NULL,NULL),
 ('90000000-0000-4000-8000-000000000006','80000000-0000-4000-8000-000000000002','EXP-DRAFT','devis_envoye',false,30,37.98,10,10,10,2,'pay_legacyDraft',NULL,NULL);
INSERT INTO colis(id,client_id,ref,statut,devis_brouillon,devis_transport,devis_total,quote_version,devis_snapshot,payplug_payment_id) VALUES
 ('90000000-0000-4000-8000-000000000005','80000000-0000-4000-8000-000000000001','EXP-MODERN','devis_envoye',false,30,37.98,2,'{}','pay_modernLink');
INSERT INTO paiements(colis_id,client_id,montant,methode,statut,confirme_le) VALUES
 ('90000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001',37.98,'historical','confirme','2026-01-01T00:00:00Z');
-- Simulate documents that predate the new invalidation triggers, as in the real dump.
SET LOCAL session_replication_role='replica';
INSERT INTO factures(id,colis_id,vendeur,montant,fichier_url,valide) VALUES
 ('40000000-0000-4000-8000-000000000099','90000000-0000-4000-8000-000000000002','Historical document',37.98,'90000000-0000-4000-8000-000000000002/history.pdf',true);
INSERT INTO lignes(id,colis_id,facture_id,description,qte,prix_unitaire) VALUES
 ('30000000-0000-4000-8000-000000000099','90000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000099','Historical article',1,37.98);
SET LOCAL session_replication_role='origin';
