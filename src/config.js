// ─── Supabase configuration ─────────────────────────────────────────────────
//
// Paste the two values from your Supabase project here.
// Find them in: Supabase Dashboard → Project Settings → API
//   • Project URL          → SUPABASE_URL
//   • Project API keys → "anon" / "public" key → SUPABASE_ANON_KEY
//
// The anon (public) key is DESIGNED to be exposed in frontend code and is safe
// to commit to a public repo. Your data is protected by the database's
// Row Level Security policies, not by hiding this key.
//
// See SETUP.md for the full step-by-step.

export const SUPABASE_URL = 'https://nlemstfwyqupldldagyq.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_Cp3Mxp4BVemK0_-D30zx8Q_NEj6g_C1'

// Bucket used for entry images (created by the SQL in SETUP.md).
export const IMAGE_BUCKET = 'entry-images'

// True once real values have been pasted in (used to show a friendly setup
// message instead of a broken app).
export const IS_CONFIGURED =
  SUPABASE_URL.startsWith('http') && !SUPABASE_ANON_KEY.startsWith('YOUR_')
