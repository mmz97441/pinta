"""Publish the reviewed customs schema and reference, using the existing CLI login.

No notification, customer update, quote recalculation or deletion is performed.
Backups stay private; the exact SQL rehearsed is the exact SQL committed.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from management import request

ROOT = Path(__file__).resolve().parents[3]
FOLDER = ROOT / '.deployment-backups/2026-09-17-customs'
FILES = [ROOT / 'pinta/supabase/migrations' / name for name in [
    '20260917000004_customs_quote.sql', '20260917000005_customs_reunion_2026.sql',
]]
DATASET = ROOT / 'pinta/data/customs/reunion-2026.json'
FUNCTIONS = ['save_quote', 'save_invoice_review', 'confirm_departure',
             'save_quote_customs', 'search_customs_tariffs', 'quote_customs_lines']
STAGING = 'public._pinta_customs_seed_20260917'
CHUNK_SIZE = 100000
SOURCE_ID = 'reunion-2026-dcp2026-0296'


def query(sql, readonly=True):
    return request('/database/query', 'POST', {'query': sql, 'read_only': readonly})


def save(name, value):
    FOLDER.mkdir(mode=0o700, parents=True, exist_ok=True)
    FOLDER.chmod(0o700)
    path = FOLDER / name
    path.write_text(json.dumps(value, indent=2))
    path.chmod(0o600)


def hashes():
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [*FILES, DATASET]}


def check_hashes(name):
    if json.loads((FOLDER / name).read_text())['hashes'] != hashes():
        raise RuntimeError('The release changed: repeat preflight and rehearsal.')


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def seed_parts():
    sql = FILES[1].read_text()
    return sql, [sql[i:i + CHUNK_SIZE] for i in range(0, len(sql), CHUNK_SIZE)]


def stage():
    """Upload only a private, non-executable staging copy, below the API size cap."""
    check_hashes('before.json')
    sql, chunks = seed_parts()
    seed_hash = hashes()[FILES[1].name]
    query("CREATE TABLE IF NOT EXISTS " + STAGING + " (source_hash text NOT NULL,part_no integer NOT NULL CHECK(part_no>=0),payload text NOT NULL,PRIMARY KEY(source_hash,part_no));"
          " ALTER TABLE " + STAGING + " OWNER TO postgres; ALTER TABLE " + STAGING + " ENABLE ROW LEVEL SECURITY; REVOKE ALL ON " + STAGING + " FROM PUBLIC,anon,authenticated,service_role;", False)
    for part, chunk in enumerate(chunks):
        query("INSERT INTO " + STAGING + " (source_hash,part_no,payload) VALUES (" + literal(seed_hash) + ',' + str(part) + ',' + literal(chunk) + ") ON CONFLICT(source_hash,part_no) DO UPDATE SET payload=EXCLUDED.payload;", False)
    result = query("SELECT count(*) parts,min(part_no) first,max(part_no) last,md5(string_agg(payload,'' ORDER BY part_no)) checksum,octet_length(string_agg(payload,'' ORDER BY part_no)) bytes FROM " + STAGING + " WHERE source_hash=" + literal(seed_hash))[0]
    assert result == {'parts': len(chunks), 'first': 0, 'last': len(chunks) - 1,
                      'checksum': hashlib.md5(sql.encode()).hexdigest(), 'bytes': len(sql.encode())}
    save('staged.json', {'hashes': hashes(), 'parts': len(chunks), 'bytes': len(sql.encode()), 'success': True})
    print(json.dumps({'staged_private_parts': len(chunks), 'bytes': len(sql.encode()), 'verified': True}))


def preflight():
    if (FOLDER / 'applied.json').exists():
        raise RuntimeError('Already published. Use verify.')
    names = ','.join("'" + n + "'" for n in FUNCTIONS)
    result = query("""SELECT
      (SELECT jsonb_agg(x) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 8) x) migrations,
      (SELECT jsonb_agg(x) FROM (SELECT p.proname,pg_get_userbyid(p.proowner) owner,pg_get_functiondef(p.oid) definition,p.proacl acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (""" + names + """)) x) functions,
      (SELECT jsonb_object_agg(t,c) FROM (SELECT 'colis' t,count(*) c FROM colis UNION ALL SELECT 'factures',count(*) FROM factures UNION ALL SELECT 'clients',count(*) FROM clients UNION ALL SELECT 'lignes',count(*) FROM lignes UNION ALL SELECT 'quote_versions',count(*) FROM quote_versions) x) counts,
      to_regclass('public.customs_tariffs')::text catalogue_exists
    """)
    if result[0]['catalogue_exists']:
        raise RuntimeError('Catalogue already exists. Inspect before attempting publication.')
    save('before.json', {'at': datetime.now(timezone.utc).isoformat(), 'hashes': hashes(), 'database': result})
    print(json.dumps({'backup': 'private before.json', 'counts': result[0]['counts'], 'hashes': hashes()}))


def reference_check_sql():
    expected = len(json.loads(DATASET.read_text())['records'])
    return """DO $verify$ BEGIN
      IF (SELECT count(*) FROM customs_tariffs WHERE source_id=""" + literal(SOURCE_ID) + """) <> """ + str(expected) + """ THEN RAISE EXCEPTION 'Incomplete customs catalogue'; END IF;
      IF EXISTS(SELECT 1 FROM customs_tariffs WHERE destination_code<>'974') THEN RAISE EXCEPTION 'Unexpected customs destination'; END IF;
    END $verify$;"""


def rehearse():
    check_hashes('before.json'); check_hashes('staged.json')
    query(transaction_sql(commit=False), False)
    save('rehearsed.json', {'hashes': hashes(), 'rolled_back': True})
    print('Customs schema and full reference rehearsed, verified and rolled back.')


def transaction_sql(commit):
    statements = ["BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='35s';"]
    p = FILES[0]
    version, name = p.stem.split('_', 1)
    sql = p.read_text()
    statements.extend([sql, "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (" + literal(version) + ',' + literal(name) + ',ARRAY[' + literal(sql) + ']);'])
    seed, chunks = seed_parts()
    version, name = FILES[1].stem.split('_', 1)
    seed_hash = hashes()[FILES[1].name]
    statements.append("LOCK TABLE " + STAGING + " IN SHARE MODE;")
    statements.append("""DO $seed_import$ DECLARE seed text; part_count integer; first_part integer; last_part integer; BEGIN
      SELECT string_agg(payload,'' ORDER BY part_no),count(*),min(part_no),max(part_no) INTO seed,part_count,first_part,last_part FROM """ + STAGING + " WHERE source_hash=" + literal(seed_hash) + ";\n"
      + "IF part_count<>" + str(len(chunks)) + " OR first_part<>0 OR last_part<>" + str(len(chunks) - 1)
      + " OR seed IS NULL OR md5(seed)<>" + literal(hashlib.md5(seed.encode()).hexdigest()) + " OR octet_length(seed)<>" + str(len(seed.encode()))
      + " THEN RAISE EXCEPTION 'Staged seed is incomplete or differs from reviewed source'; END IF;\n"
      + "EXECUTE seed; INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (" + literal(version) + ',' + literal(name) + ",ARRAY[seed]); END $seed_import$;")
    statements.extend([reference_check_sql(), "NOTIFY pgrst,'reload schema';", 'COMMIT;' if commit else 'ROLLBACK;'])
    return '\n'.join(statements)


def apply():
    check_hashes('before.json'); check_hashes('staged.json'); check_hashes('rehearsed.json')
    for p in FILES:
        version = p.stem.split('_', 1)[0]
        if query("SELECT version FROM supabase_migrations.schema_migrations WHERE version='" + version + "'"):
            raise RuntimeError('Migration already registered: ' + version)
    query(transaction_sql(commit=True), False)
    save('applied.json', {'at': datetime.now(timezone.utc).isoformat(), 'hashes': hashes(), 'success': True})
    print('Customs schema and reference committed atomically; schema reload requested.')


def verify():
    check_hashes('applied.json'); check_hashes('rehearsed.json')
    row = query("""SELECT
      (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20260917000004','20260917000005')) registered,
      (SELECT jsonb_agg(jsonb_build_object('source',source_id,'destination',destination_code,'count',n)) FROM (SELECT source_id,destination_code,count(*) n FROM customs_tariffs GROUP BY source_id,destination_code) x) sources,
      (SELECT jsonb_agg(jsonb_build_object('name',p.proname,'security_definer',p.prosecdef,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('search_customs_tariffs','save_quote_customs')) commands,
      (SELECT count(*) FROM customs_tariffs WHERE om IS NULL OR omr IS NULL) incomplete_rates,
      (SELECT count(*) FROM lignes WHERE custom_duty IS NOT NULL) classifications
    """)[0]
    expected = len(json.loads(DATASET.read_text())['records'])
    assert row['registered'] == 2
    assert len(row['commands']) == 2
    assert all(c['security_definer'] and not c['anon_execute'] and c['authenticated_execute'] for c in row['commands'])
    assert any(s['source'] == SOURCE_ID and s['destination'] == '974' and s['count'] == expected for s in row['sources'])
    save('verified.json', {'at': datetime.now(timezone.utc).isoformat(), 'hashes': hashes(), 'database': row})
    print(json.dumps(row))


def cleanup():
    check_hashes('verified.json')
    # This dedicated table contains only the release's previously verified SQL chunks.
    query('DROP TABLE IF EXISTS ' + STAGING, False)
    print('Private customs release staging removed.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'stage', 'rehearse', 'apply', 'verify', 'cleanup'])
    globals()[parser.parse_args().operation]()
