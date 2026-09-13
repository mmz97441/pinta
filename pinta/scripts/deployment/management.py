"""Scoped deployment operations using the existing Supabase CLI login in memory.

Never print, export or persist the account credential or existing provider secrets.
Only the Expedile project is addressable by this helper.
"""
import argparse
import base64
import json
import re
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

PROJECT = 'bqprktzehuhplpqjgjaz'
API = 'https://api.supabase.com/v1/projects/' + PROJECT
BACKUP = Path(__file__).resolve().parents[3] / '.deployment-backups/2026-09-10'


def credential():
    for account in ['supabase', 'access-token']:
        result = subprocess.run(
            ['security', 'find-generic-password', '-s', 'Supabase CLI', '-a', account, '-w'],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            value = result.stdout.strip()
            if value.startswith('go-keyring-base64:'):
                value = base64.b64decode(value.split(':', 1)[1], validate=True).decode()
            elif value.startswith('go-keyring-encoded:'):
                value = bytes.fromhex(value.split(':', 1)[1]).decode()
            if re.fullmatch(r'sbp_(oauth_)?[a-f0-9]{40}', value):
                return value
    raise RuntimeError('Supabase CLI login unavailable in the credential store')


def request(path, method='GET', body=None):
    if path not in ['/config/auth', '/secrets', '/database/query', '/api-keys?reveal=true']:
        raise ValueError('Unsupported deployment endpoint')
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        'Authorization': 'Bearer ' + credential(), 'Content-Type': 'application/json',
        'User-Agent': 'SupabaseCLI/2.98.2', 'Accept': 'application/json',
    })
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        # Provider error bodies can include credentials or SQL data. Do not log them.
        raise RuntimeError(f'Management API request failed: HTTP {error.code}') from None


def auth_status():
    config = request('/config/auth')
    return {
        'site_url': config.get('site_url'),
        'uri_allow_list': config.get('uri_allow_list'),
        'disable_signup': config.get('disable_signup'),
        'mailer_autoconfirm': config.get('mailer_autoconfirm'),
        'smtp_configured': bool(config.get('smtp_host') and config.get('smtp_user') and config.get('smtp_pass')),
        'smtp_host': config.get('smtp_host'),
        'smtp_port': config.get('smtp_port'),
        'smtp_sender_name': config.get('smtp_sender_name'),
        'smtp_sender_configured': bool(config.get('smtp_admin_email')),
    }


def configure_auth():
    config = request('/config/auth')
    fields = ['site_url', 'uri_allow_list', 'disable_signup', 'password_min_length']
    BACKUP.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = BACKUP / 'auth-changed-settings-before.json'
    if not backup.exists():
        backup.write_text(json.dumps({key: config.get(key) for key in fields}, indent=2))
        backup.chmod(0o600)
    redirects = [url.strip() for url in (config.get('uri_allow_list') or '').split(',') if url.strip()]
    for url in ['https://expedile.app/password', 'https://expedile.app/']:
        if url not in redirects:
            redirects.append(url)
    request('/config/auth', 'PATCH', {
        'site_url': 'https://expedile.app', 'uri_allow_list': ','.join(redirects),
        'disable_signup': True, 'password_min_length': max(12, config.get('password_min_length') or 6),
    })
    return auth_status()


def service_key():
    keys = request('/api-keys?reveal=true')
    for item in keys:
        if item.get('name') == 'service_role' and item.get('api_key'):
            return item['api_key']
    raise RuntimeError('Existing service role key unavailable')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['auth-status', 'configure-auth'])
    args = parser.parse_args()
    print(json.dumps(configure_auth() if args.operation == 'configure-auth' else auth_status(), indent=2))
