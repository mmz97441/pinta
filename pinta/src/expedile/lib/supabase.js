import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bqprktzehuhplpqjgjaz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxcHJrdHplaHVocGxwcWpnamF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MjUzODYsImV4cCI6MjA4NjIwMTM4Nn0.0uT4Ff-e_WV7IqaYgurvqP3-lHW-eaZIkg2PprrbBzk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
