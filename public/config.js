// Empty runtime config — app falls back to VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// set in Netlify environment variables at build time.
//
// To override at runtime (rotate keys without rebuilding), set values here:
//   window.__EQ_CONFIG__ = { supabaseUrl: '...', supabaseAnonKey: '...' }
window.__EQ_CONFIG__ = {}
