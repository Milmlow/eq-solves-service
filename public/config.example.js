// Runtime config template.
//
// On deploy, copy this file to /config.js and fill in real values, or edit
// the deployed /config.js directly (Netlify → Deploys → Browse published
// deploy → edit). This pattern lets you rotate keys without rebuilding.
//
// Values here override any baked-in VITE_* env vars.
//
// NOTE: config.js is git-ignored. Only this .example template is committed.
window.__EQ_CONFIG__ = {
  supabaseUrl: 'https://your-project-ref.supabase.co',
  supabaseAnonKey: 'your-anon-key-here',
}
