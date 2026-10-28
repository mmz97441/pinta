// Reads of the reception screens that lib/supabaseData.js does not offer one by one. Reads only: every write goes
// through lib/supabaseData.js (insertColis, appendReceptionCartons, uploadDocument, updateColis), AppContext
// (addNewClient) and lib/receptionValidation.js (validateReception, addReceptionPhoto).
import { supabase } from '../../lib/supabase';
import { mapClient } from '../../lib/supabaseData';

/** One client as the server has it now (its Telegram link or e-mail decide the channel of the notice), or null. */
export async function fetchClientRecord(clientId) {
  const { data, error } = await supabase.from('clients').select('*').eq('id', clientId).maybeSingle();
  if (error) throw error;
  return data ? mapClient(data) : null;
}

/** Replaces one client in the list of AppContext (setClients) by its current record. */
export async function refreshClientRecord(clientId, setClients) {
  const fresh = await fetchClientRecord(clientId);
  if (fresh) setClients(previous => previous.some(item => item.id === fresh.id) ? previous.map(item => item.id === fresh.id ? { ...item, ...fresh } : item) : [...previous, fresh]);
  return fresh;
}
