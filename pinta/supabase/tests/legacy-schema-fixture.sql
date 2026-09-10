-- Synthetic schema-only divergences observed in the pre-release production
-- inventory. Contains no exported customer/staff/template data.
CREATE TYPE type_abonnement AS ENUM ('freemium','premium','vip');
ALTER TABLE clients ADD COLUMN abonnement type_abonnement NOT NULL DEFAULT 'freemium';
ALTER TABLE clients ADD COLUMN abonnement_debut date, ADD COLUMN abonnement_fin date;
ALTER TABLE colis ADD COLUMN tags_preparation text[] DEFAULT '{}';
CREATE TABLE staff_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),auth_id uuid UNIQUE REFERENCES auth.users(id),
 nom text NOT NULL,prenom text,email text UNIQUE NOT NULL,
 role text NOT NULL DEFAULT 'preparateur' CHECK(role IN ('directeur','vice_directeur','logisticien','preparateur')),
 actif boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),must_change_password boolean DEFAULT true
);
CREATE TABLE staff_permissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),staff_id uuid UNIQUE NOT NULL REFERENCES staff_users(id),
 perm_colis_mesurer boolean DEFAULT false,restrict_destination text,restrict_type_client text,restrict_lecture_seule boolean DEFAULT false
);
CREATE TABLE audit_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),colis_id uuid REFERENCES colis(id),user_nom text,
 action text NOT NULL,detail text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE colis_locks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),colis_id uuid UNIQUE NOT NULL REFERENCES colis(id),
 staff_id uuid NOT NULL,staff_nom text NOT NULL,locked_at timestamptz NOT NULL DEFAULT now()
);
CREATE POLICY audit_staff_crud ON audit_actions USING(is_staff());
CREATE POLICY locks_staff_all ON colis_locks USING(is_staff());
CREATE TABLE message_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cle text NOT NULL,canal text NOT NULL,
 label text NOT NULL,objet text,corps text NOT NULL,abonnement text,actif boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1,modifie_par uuid REFERENCES profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE message_templates_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),template_id uuid NOT NULL REFERENCES message_templates(id),
 version integer NOT NULL,corps text NOT NULL,objet text,modifie_par uuid REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE POLICY anon_read_templates ON message_templates FOR SELECT TO anon USING(true);
CREATE POLICY anon_read_templates_v ON message_templates_versions FOR SELECT TO anon USING(true);
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('90000000-0000-4000-8000-000000000001','legacy@example.test','{"nom":"Synthetic historical staff"}');
INSERT INTO staff_users(id,auth_id,nom,email,role) VALUES('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','Synthetic','legacy@example.test','logisticien');
INSERT INTO staff_permissions(id,staff_id,perm_colis_mesurer) VALUES('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000002',true);
INSERT INTO audit_actions(action,detail) VALUES('Synthetic historical entry','Preserve exact history');
INSERT INTO message_templates(id,cle,canal,label,corps) VALUES('90000000-0000-4000-8000-000000000004','legacy_sample','email','Synthetic','Synthetic historical body');
INSERT INTO message_templates_versions(template_id,version,corps) VALUES('90000000-0000-4000-8000-000000000004',1,'Synthetic historical body');
