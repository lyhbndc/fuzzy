// Supabase connection, shared by index.html (waiver) and admin.html.
// Find these in Supabase → Project Settings → API.
// The anon/publishable key is safe to expose: Row Level Security (supabase/schema.sql)
// only lets the public insert waivers, never read them.
window.FUZZY_CONFIG = {
  SUPABASE_URL: '',       // e.g. 'https://abcd1234.supabase.co'
  SUPABASE_ANON_KEY: '',  // the anon / publishable key, NOT the service_role key
};
