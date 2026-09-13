import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configurationError = !url || !key
  ? 'Configuration indisponible : renseignez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY, puis reconstruisez l’application.' : '';
// An unconfigured build must never silently connect to a production project.
export const supabase = createClient(url || 'http://127.0.0.1:54321', key || 'configuration-required');
