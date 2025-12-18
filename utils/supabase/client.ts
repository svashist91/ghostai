import { createClient } from '@supabase/supabase-js';

// This uses the "Public" keys we put in .env.local
export const createBrowserClient = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );