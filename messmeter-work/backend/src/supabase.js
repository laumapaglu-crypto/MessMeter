import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const supabaseForUser = (accessToken) =>
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` }
      },
      auth: { autoRefreshToken: false, persistSession: false }
    }
  );
