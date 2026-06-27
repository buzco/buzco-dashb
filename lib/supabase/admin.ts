import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

// Service-role client: bypasses RLS entirely. There are no RLS policies
// yet (single-tenant tool, auth-gated at the app layer), so prefer the
// regular server client for almost everything — reserve this for the rare
// case a server action needs to act outside the logged-in user's session.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
