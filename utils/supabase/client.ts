import { createClient } from '@supabase/supabase-js';

export function createClerkSupabaseClient(session: any) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        // This injects the Clerk token into every Supabase request
        fetch: async (url, options = {}) => {
          // 1. Get the special 'supabase' token we just configured
          const clerkToken = await session?.getToken({ template: 'supabase' });

          // 2. Insert it into the headers
          const headers = new Headers(options?.headers);
          headers.set('Authorization', `Bearer ${clerkToken}`);

          return fetch(url, {
            ...options,
            headers,
          });
        },
      },
    }
  );
}