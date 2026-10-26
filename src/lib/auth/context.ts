import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "admin" | "tesoureiro" | "operador" | "aprovador" | "auditor" | "lideranca";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  tesoureiro: "Tesoureiro",
  operador: "Operador financeiro",
  aprovador: "Aprovador",
  auditor: "Conselho fiscal / auditor",
  lideranca: "Liderança",
};

export type Organization = {
  id: string;
  name: string;
  legal_name: string | null;
  document: string | null;
  timezone: string;
  logo_path: string | null;
  require_mfa: boolean;
  is_demo: boolean;
};

export type AppContext = {
  userId: string;
  email: string;
  name: string;
  role: Role;
  org: Organization;
  aal: "aal1" | "aal2";
  can: {
    operate: boolean; // lançar receitas, despesas, transferências, caixa
    manage: boolean; // cadastros, estornos, períodos
    admin: boolean; // membros e configurações
    verifyCash: boolean;
    seeDonors: boolean;
    seeAudit: boolean;
    seeStatements: boolean; // linhas do extrato trazem o nome de quem fez o Pix
  };
  /** Perfil privilegiado sem MFA quando a organização exige: escrita será recusada pelo banco. */
  needsMfa: boolean;
};

/** Claims do JWT, conferidas uma vez por requisição (layout, página e ações reaproveitam). */
export const getClaims = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
});

/** Sessão + vínculo de quem está usando. Lê o JWT e o banco a cada requisição (sem cache entre requisições). */
export const getContext = cache(async (): Promise<AppContext | null> => {
  const claims = await getClaims();
  if (!claims?.sub) return null;

  // Vínculo e perfil em paralelo: uma ida ao banco em vez de duas em sequência.
  const supabase = await createClient();
  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase
      .from("memberships")
      .select("role, organization:organizations(id, name, legal_name, document, timezone, logo_path, require_mfa, is_demo)")
      .eq("user_id", claims.sub)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", claims.sub).maybeSingle(),
  ]);

  if (!membership?.organization) return null;
  const org = membership.organization as unknown as Organization;
  const role = membership.role as Role;

  const aal = (claims.aal === "aal2" ? "aal2" : "aal1") as "aal1" | "aal2";
  const privileged = role === "admin" || role === "tesoureiro";
  const needsMfa = privileged && org.require_mfa && aal !== "aal2";
  const is = (...roles: Role[]) => roles.includes(role);

  return {
    userId: claims.sub,
    email: String(claims.email ?? ""),
    name: profile?.full_name || String(claims.email ?? ""),
    role,
    org,
    aal,
    needsMfa,
    can: {
      operate: is("admin", "tesoureiro", "operador") && !needsMfa,
      manage: is("admin", "tesoureiro") && !needsMfa,
      admin: is("admin") && !needsMfa,
      verifyCash: is("admin", "tesoureiro", "aprovador") && !needsMfa,
      seeDonors: is("admin", "tesoureiro", "auditor") && !needsMfa,
      seeAudit: is("admin", "tesoureiro", "auditor") && !needsMfa,
      seeStatements: is("admin", "tesoureiro", "operador", "auditor") && !needsMfa,
    },
  };
});

/** Exige login e vínculo; sem vínculo, vai para a criação da igreja / aceite de convite. */
export async function requireContext(): Promise<AppContext> {
  if (!(await getClaims())) redirect("/login");
  const ctx = await getContext();
  if (!ctx) redirect("/inicio");
  return ctx;
}
