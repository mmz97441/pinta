import { supabase } from '../lib/supabase';

export async function markVisibleMessagesRead(colis) {
  const ids = (colis.messages || []).filter((message) => message.type === 'client' && !message.lu).map((message) => message.id);
  if (!ids.length) return [];
  const { error } = await supabase.from('messages').update({ lu: true }).eq('colis_id', colis.id).in('id', ids);
  if (error) throw error;
  return ids;
}

export async function setConversationState(colis, state) {
  const { data, error } = await supabase.rpc('set_conversation_state', {
    p_colis_id: colis.id, p_state: state, p_expected_version: colis.conversationVersion ?? 0,
  });
  if (error) throw error;
  return data;
}

export async function assignColisWork(colis, values) {
  const { data, error } = await supabase.rpc('assign_colis_work', {
    p_colis_id: colis.id,
    p_responsible_staff_id: Object.hasOwn(values, 'responsibleStaffId') ? values.responsibleStaffId : colis.responsibleStaffId ?? null,
    p_next_action: Object.hasOwn(values, 'nextAction') ? values.nextAction : colis.nextAction ?? null,
    p_next_action_at: Object.hasOwn(values, 'nextActionAt') ? values.nextActionAt : colis.nextActionAt ?? null,
    p_expected_updated_at: colis.updatedAt,
    p_action_changed: Object.hasOwn(values, 'nextAction') || Object.hasOwn(values, 'nextActionAt'),
  });
  if (error) throw error;
  return data;
}
