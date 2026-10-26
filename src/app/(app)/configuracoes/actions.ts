"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { friendlyError, type ActionState } from "@/lib/errors";

const roles = ["admin", "tesoureiro", "operador", "aprovador", "auditor", "lideranca"] as const;

export async function inviteMember(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const parsed = z.object({ email: z.string().trim().toLowerCase().email("E-mail inválido."), role: z.enum(roles) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  // 1) O convite é registrado com a sessão da pessoa: o banco confere se ela é admin (com MFA).
  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_member", { p_org: ctx.org.id, p_email: parsed.data.email, p_role: parsed.data.role });
  if (error) return { ok: false, message: friendlyError(error) };

  // 2) Só depois da autorização confirmada, o e-mail é enviado com a chave de serviço (servidor).
  revalidatePath("/configuracoes");
  let sent: { error: unknown };
  try {
    const admin = createAdminClient();
    sent = await admin.auth.admin.inviteUserByEmail(parsed.data.email, { redirectTo: `${env.siteUrl()}/auth/confirm?next=/redefinir-senha` });
  } catch {
    return { ok: true, message: "Convite registrado, mas o envio de e-mail não está configurado no servidor. Peça para a pessoa criar o acesso pela tela de login." };
  }
  if (sent.error) {
    // Conta já existente: basta a pessoa entrar com o mesmo e-mail que o convite é aceito.
    return { ok: true, message: "Convite registrado. Esta pessoa já tem login: peça para entrar com o mesmo e-mail." };
  }
  return { ok: true, message: "Convite enviado por e-mail. Ele vale por 7 dias." };
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
  return { ok: true, message: "Mês reaberto. A justificativa ficou registrada na auditoria." };
}
