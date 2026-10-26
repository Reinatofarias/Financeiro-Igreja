"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyError, type ActionState } from "@/lib/errors";
import { parseBRLToCents } from "@/lib/money";

const roles = ["admin", "tesoureiro", "operador", "aprovador", "auditor", "lideranca"] as const;

export type NewMemberState = (NonNullable<ActionState> & { email?: string; password?: string }) | null;

/** Senha provisória legível (sem 0/O, 1/l), mostrada uma única vez para o administrador repassar. */
function temporaryPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

export async function createMember(_: NewMemberState, form: FormData): Promise<NewMemberState> {
  const ctx = await requireContext();
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Informe o nome.").max(120),
      email: z.string().trim().toLowerCase().email("E-mail inválido."),
      role: z.enum(roles),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { name, email, role } = parsed.data;

  // 1) O acesso é registrado com a sessão da pessoa: o banco confere se ela é admin (com MFA).
  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_member", { p_org: ctx.org.id, p_email: email, p_role: role });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/configuracoes");

  // 2) Só depois da autorização confirmada, o login é criado com a chave de serviço (servidor), já confirmado.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, message: "Acesso registrado, mas falta a chave de serviço do Supabase na Vercel para criar o login." };
  }
  const password = temporaryPassword();
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, must_change_password: true },
  });
  if (createError) {
    if (createError.code === "email_exists" || /already/i.test(createError.message)) {
      return { ok: true, message: "Esta pessoa já tem login. O acesso foi liberado: peça para ela entrar com o mesmo e-mail e a senha que já usa." };
    }
    console.error("criar login falhou", createError.status, createError.code);
    return { ok: false, message: "O acesso foi registrado, mas não foi possível criar o login agora. Tente de novo em instantes." };
  }
  return { ok: true, message: "Pessoa cadastrada.", email, password };
}

export async function revokeInvite(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { ok: false, message: "Convite inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation: id.data });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/configuracoes");
  return { ok: true, message: "Convite revogado." };
}

export async function updateMember(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const parsed = z.object({ id: z.string().uuid(), role: z.enum(roles), active: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Dados inválidos." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_member", { p_membership: parsed.data.id, p_role: parsed.data.role, p_active: parsed.data.active === "true" });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/configuracoes");
  return { ok: true, message: "Acesso atualizado." };
}

export async function updateOrganization(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(160),
      legal_name: z.string().trim().max(200).optional(),
      document: z.string().trim().max(20).optional(),
      timezone: z.string().trim().min(3),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Confira os dados." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      name: parsed.data.name,
      legal_name: parsed.data.legal_name || null,
      document: parsed.data.document?.replace(/\D/g, "") || null,
      timezone: parsed.data.timezone,
      require_mfa: form.get("require_mfa") === "on",
    })
    .eq("id", ctx.org.id)
    .select("id")
    .single();
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: "Dados da igreja atualizados." };
}

export async function closeMonth(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const month = String(form.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, message: "Escolha o mês." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_period", { p_org: ctx.org.id, p_month: `${month}-01` });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/configuracoes");
  revalidatePath("/fechamento");
  return { ok: true, message: "Mês fechado. Lançamentos nesse mês ficam bloqueados." };
}

export async function reopenMonth(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const month = String(form.get("month") ?? "");
  const reason = String(form.get("reason") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_period", { p_org: ctx.org.id, p_month: month, p_reason: reason });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/configuracoes");
  revalidatePath("/fechamento");
  return { ok: true, message: "Mês reaberto. A justificativa ficou registrada na auditoria." };
}

export async function updateApproval(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const mode = String(form.get("mode") ?? "");
  let threshold: number | null = null;
  if (mode === "todas") threshold = 0;
  else if (mode === "valor") {
    const cents = parseBRLToCents(String(form.get("amount") ?? ""));
    if (cents === null || cents <= 0) return { ok: false, message: "Informe o valor a partir do qual a despesa precisa de aprovação." };
    threshold = cents;
  } else if (mode !== "nenhuma") return { ok: false, message: "Escolha uma opção." };
  const supabase = await createClient();
  const { error } = await supabase.from("organizations").update({ approval_threshold_cents: threshold }).eq("id", ctx.org.id).select("id").single();
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: "Regra de aprovação salva. Vale para as contas cadastradas daqui em diante." };
}
