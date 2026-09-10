-- Start automatic reminder eligibility at deployment, not at warehouse receipt.
-- Preserve an explicit existing value, including an invalid value: the worker
-- then fails closed until configuration is corrected instead of resetting it.
UPDATE app_settings
 SET value=jsonb_set(value,'{relancesActivesDepuis}',to_jsonb(now()),true),updated_at=now()
 WHERE key='business' AND NOT (value ? 'relancesActivesDepuis');
