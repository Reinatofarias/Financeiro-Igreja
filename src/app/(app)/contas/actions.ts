"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { parseBRLToCents } from "@/lib/money";
import { isIsoDate } from "@/lib/dates";
import { friendlyError, type ActionState } from "@/lib/errors";

const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome da conta.").max(80),
  kind: z.enum(["banco", "carteira_digital", "caixa_fisico", "outra"]),
  provider: z.enum(["mercado_pago", "cora", "pagbank", "manual"]),
  opening_date: z.string().refine(isIsoDate, "Data de abertura inválida."),
  opening: z.string(),
  institution: z.string().trim().max(80).optional(),
  account_hint: z.string().trim().max(30).optional(),
});

export async function createAccount(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const opening = parseBRLToCents(parsed.data.opening || "0");
  if (opening === null || opening < 0) return { ok: false, message: "Saldo inicial inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_financial_account", {
    p_org: ctx.org.id,
    p_name: parsed.data.name,
    p_kind: parsed.data.kind,
    p_provider: parsed.data.provider,
    p_opening_date: parsed.data.opening_date,
    p_opening_cents: opening,
    p_institution: parsed.data.institution || null,
    p_account_hint: parsed.data.account_hint || null,
    p_color: null,
  });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: `Conta "${parsed.data.name}" cadastrada.` };
}

export async function setOpeningBalance(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const parsed = z.object({ account_id: z.string().uuid(), opening: z.string(), opening_date: z.string().refine(isIsoDate, "Data inválida.") }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const cents = parseBRLToCents(parsed.data.opening || "0");
  if (cents === null || cents < 0) return { ok: false, message: "Saldo inicial inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_opening_balance", { p_account: parsed.data.account_id, p_amount_cents: cents, p_date: parsed.data.opening_date });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: "Saldo inicial atualizado. O anterior foi estornado e continua no histórico." };
}

export async function toggleAccount(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const id = z.string().uuid().safeParse(form.get("account_id"));
  if (!id.success) return { ok: false, message: "Conta inválida." };
  const supabase = await createClient();
  const active = form.get("active") === "true";
  const { error } = await supabase.from("financial_accounts").update({ is_active: active }).eq("id", id.data);
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: active ? "Conta reativada." : "Conta desativada. O histórico continua disponível." };
}

export async function saveIntegration(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const account = z.string().uuid().safeParse(form.get("account_id"));
  const slot = z.coerce.number().int().min(1).max(4).safeParse(form.get("slot"));
  if (!account.success) return { ok: false, message: "Conta inválida." };
  if (!slot.success) return { ok: false, message: "Escolha o número do token." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_integration", {
    p_org: ctx.org.id, p_account: account.data, p_slot: slot.data, p_enabled: form.get("enabled") === "on",
  });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath(`/contas/${account.data}`);
  revalidatePath("/conciliacao");
  return { ok: true, message: "Integração salva." };
}
