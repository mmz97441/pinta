"""Initial consignee of the commercial invoice for La Réunion (decided with the user on 2026-10-08).

The user gave the consignee printed at the top of the commercial invoice of departures to La Réunion:
« Expedîle, 5 Chemin Grand Canal, Immeuble Thales, 97490 Sainte-Clotilde », and asked that it stays editable.
It is written once into app_settings.business.factureCommerciale.destinataires['974'] (the field the screen
Paramètres › Facture commerciale edits), only when that consignee is not set yet. Every other key of the business
object is kept. The change is audited like a save from the screen (action admin_setting_saved, before and after).
No schema change, no migration: the business object already accepts this key.

Operations, each run separately by the lead:
  preflight  read-only: the current factureCommerciale value and whether the Réunion consignee is already set.
  apply      one transaction: lock the row, write the consignee if absent, audit, commit; refuses if the row is missing.
  verify     read-only: the stored consignee equals the decided one and the other business keys are unchanged.
Credentials stay in memory (management.py); nothing runs at import.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from management import request

FOLDER = Path(__file__).resolve().parents[3] / '.deployment-backups/2026-10-08-invoice-identity'
CONSIGNEE = {
    'nom': 'Expedîle', 'adresse': '5 Chemin Grand Canal', 'complement': 'Immeuble Thales', 'codePostal': '97490',
    'ville': 'Sainte-Clotilde', 'pays': 'La Réunion (France)', 'telephone': '', 'email': '', 'siret': '', 'eori': '', 'tva': '',
}
LITERAL = json.dumps(CONSIGNEE, ensure_ascii=False).replace("'", "''")

READ_SQL = "SELECT value FROM public.app_settings WHERE key='business'"

APPLY_SQL = r"""DO $$
DECLARE previous jsonb; next jsonb;
BEGIN
 SELECT value INTO previous FROM public.app_settings WHERE key='business' FOR UPDATE;
 IF previous IS NULL THEN RAISE EXCEPTION 'app_settings.business is missing'; END IF;
 IF previous #> '{factureCommerciale,destinataires,974}' IS NOT NULL THEN RAISE NOTICE 'already set: nothing written'; RETURN; END IF;
 next := jsonb_set(previous, '{factureCommerciale}',
   coalesce(previous->'factureCommerciale','{}'::jsonb)
   || jsonb_build_object('destinataires', coalesce(previous #> '{factureCommerciale,destinataires}','{}'::jsonb) || jsonb_build_object('974', '""" + LITERAL + r"""'::jsonb)));
 UPDATE public.app_settings SET value=next, updated_at=now(), updated_by=NULL WHERE key='business';
 INSERT INTO public.audit_actions(user_id,user_nom,action,detail,before_data,after_data)
 VALUES(NULL,'Mise en service (destinataire La Réunion décidé le 8 octobre 2026)','admin_setting_saved','business',previous,next);
END $$;"""


def query(sql, readonly=True):
    return request('/database/query', 'POST', {'query': sql, 'read_only': readonly})


def current():
    rows = query(READ_SQL)
    if not rows:
        raise SystemExit('app_settings.business is missing')
    value = rows[0]['value']
    return json.loads(value) if isinstance(value, str) else value


def save(name, value):
    FOLDER.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = FOLDER / name
    path.write_text(json.dumps(value, ensure_ascii=False, indent=1), encoding='utf-8')
    path.chmod(0o600)
    return str(path)


def preflight():
    value = current()
    reunion = ((value.get('factureCommerciale') or {}).get('destinataires') or {}).get('974')
    backup = save('before.json', {'at': datetime.now(timezone.utc).isoformat(), 'business': value})
    print(json.dumps({'private_backup': backup, 'business_keys': sorted(value), 'factureCommerciale': value.get('factureCommerciale'),
                      'reunion_consignee_set': reunion is not None}, ensure_ascii=False, indent=1))


def apply():
    before = current()
    query(APPLY_SQL, readonly=False)
    after = current()
    save('after.json', {'at': datetime.now(timezone.utc).isoformat(), 'business': after})
    print(json.dumps({'applied': True, 'reunion_consignee': after['factureCommerciale']['destinataires']['974'],
                      'other_keys_unchanged': {k: v for k, v in before.items() if k != 'factureCommerciale'} == {k: v for k, v in after.items() if k != 'factureCommerciale'}},
                     ensure_ascii=False, indent=1))


def verify():
    value = current()
    stored = ((value.get('factureCommerciale') or {}).get('destinataires') or {}).get('974')
    assert stored is not None, 'the Réunion consignee is not set'
    print(json.dumps({'reunion_consignee': stored, 'as_decided': stored == CONSIGNEE or {k: stored.get(k, '') for k in CONSIGNEE} == CONSIGNEE,
                      'edited_since': stored != CONSIGNEE}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'apply', 'verify'])
    {'preflight': preflight, 'apply': apply, 'verify': verify}[parser.parse_args().operation]()
