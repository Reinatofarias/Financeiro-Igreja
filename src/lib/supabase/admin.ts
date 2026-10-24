import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Cliente com a chave service_role. Ignora o RLS, então só deve ser usado depois de
 * conferir explicitamente, com o cliente da pessoa, que ela tem permissão para a ação.
 * Uso atual: enviar e-mail de convite (auth.admin.inviteUserByEmail).
 */
export function createAdminClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
