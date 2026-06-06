import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY, IS_CONFIGURED } from './config'

// When unconfigured we still create a client with harmless placeholder values
// so imports don't throw; api.js guards real calls behind IS_CONFIGURED.
export const supabase = createClient(
  IS_CONFIGURED ? SUPABASE_URL : 'https://placeholder.supabase.co',
  IS_CONFIGURED ? SUPABASE_ANON_KEY : 'placeholder-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true } }
)
