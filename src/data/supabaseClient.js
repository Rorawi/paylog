import { createClient } from '@supabase/supabase-js';

let client;
let anonymousSignIn;

export function getSupabaseClient() {
  if (client) return client;

  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();
  if (!url || !key) {
    throw new Error('Supabase is not configured. Copy .env.example to .env.local and add your project URL and publishable key.');
  }

  client = createClient(url, key, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}

export async function getSupabaseUserId() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`Could not read the Paylog session: ${error.message}`);
  if (data.session?.user?.id) return data.session.user.id;

  if (!anonymousSignIn) {
    anonymousSignIn = supabase.auth.signInAnonymously().then(({ data: signedIn, error: signInError }) => {
      if (signInError) {
        if (/anonymous sign-ins are disabled/i.test(signInError.message || '')) {
          throw new Error('Anonymous sign-ins are disabled for this Supabase project. In your Supabase Dashboard, open Authentication → Sign In / Providers and turn on “Allow anonymous sign-ins”, then tap Try again. This is a project setting, not an .env value.');
        }
        throw new Error(`Could not start a private Paylog session: ${signInError.message}`);
      }
      if (!signedIn.user?.id) throw new Error('Supabase did not return a Paylog user session.');
      return signedIn.user.id;
    }).finally(() => { anonymousSignIn = null; });
  }

  return anonymousSignIn;
}
