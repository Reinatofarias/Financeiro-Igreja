import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Account = { id: string; name: string; kind: "banco" | "carteira_digital" | "caixa_fisico" | "outra"; provider: string; is_active: boolean };
export type Category = { id: string; name: string; kind: "receita" | "despesa"; parent_id: string | null; is_active: boolean; system_code: string | null; code: string | null };
export type Named = { id: string; name: string; is_active: boolean };
export type Fund = Named & { is_restricted: boolean; description: string | null };

export const ACCOUNT_KIND_LABEL: Record<Account["kind"], string> = {
  banco: "Conta bancária",
  carteira_digital: "Carteira digital",
  caixa_fisico: "Caixa físico",
  outra: "Outra",
};

export const PROVIDER_LABEL: Record<string, string> = {
  mercado_pago: "Mercado Pago",
  cora: "Cora",
  pagbank: "PagBank",
  manual: "Manual",
};

/** Cadastros usados nos formulários e filtros. O RLS limita tudo à organização de quem consulta. */
export async function loadLookups(orgId: string) {
  const supabase = await createClient();
  const [accounts, categories, funds, ministries, projects, costCenters, paymentMethods, contacts] = await Promise.all([
    supabase.from("financial_accounts").select("id, name, kind, provider, is_active").eq("organization_id", orgId).order("name"),
    supabase.from("categories").select("id, name, kind, parent_id, is_active, system_code, code").eq("organization_id", orgId).order("name"),
    supabase.from("funds").select("id, name, is_active, is_restricted, description").eq("organization_id", orgId).order("name"),
    supabase.from("ministries").select("id, name, is_active").eq("organization_id", orgId).order("name"),
    supabase.from("projects").select("id, name, is_active").eq("organization_id", orgId).order("name"),
    supabase.from("cost_centers").select("id, name, is_active").eq("organization_id", orgId).order("name"),
    supabase.from("payment_methods").select("id, name, is_active").eq("organization_id", orgId).order("name"),
    supabase.from("contacts").select("id, name, is_active").eq("organization_id", orgId).order("name"),
  ]);
  return {
    accounts: (accounts.data ?? []) as Account[],
    categories: (categories.data ?? []) as Category[],
    funds: (funds.data ?? []) as Fund[],
    ministries: (ministries.data ?? []) as Named[],
    projects: (projects.data ?? []) as Named[],
    costCenters: (costCenters.data ?? []) as Named[],
    paymentMethods: (paymentMethods.data ?? []) as Named[],
    contacts: (contacts.data ?? []) as Named[],
  };
}

export type Lookups = Awaited<ReturnType<typeof loadLookups>>;

/** Categorias em ordem hierárquica, com o nome do pai à frente ("Ocupação › Energia"). */
export function categoryOptions(categories: Category[], kind: "receita" | "despesa", onlyActive = true) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return categories
    .filter((c) => c.kind === kind && (!onlyActive || c.is_active))
    .map((c) => ({ id: c.id, label: c.parent_id ? `${byId.get(c.parent_id)?.name ?? ""} › ${c.name}` : c.name }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}
