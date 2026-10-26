"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { friendlyError, type ActionState } from "@/lib/errors";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe a senha."),
});

export async function signIn(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") return { ok: false, message: "Este e-mail ainda não foi confirmado. No Supabase, confirme o usuário em Authentication > Users." };
    if (error.code === "invalid_credentials") return { ok: false, message: "E-mail ou senha incorretos." };
    console.error("login falhou", error.status, error.code, error.message);
    return { ok: false, message: `Não foi possível entrar agora (${error.code ?? error.status ?? "erro desconhecido"}). Tente de novo em instantes.` };
  }
  redirect("/mfa");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(_: ActionState, form: FormData): Promise<ActionState> {
  const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  if (!email.success) return { ok: false, message: "Informe um e-mail válido." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${env.siteUrl()}/auth/confirm?next=/redefinir-senha` });
  // Mesma resposta exista ou não a conta, para não revelar quem tem cadastro.
  return { ok: true, message: "Se este e-mail estiver cadastrado, você vai receber um link para criar uma nova senha." };
}

const passwordSchema = z
  .object({ password: z.string().min(10, "Use pelo menos 10 caracteres."), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "As senhas não conferem.", path: ["confirm"] });

export async function updatePassword(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = passwordSchema.safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  // Também apaga a marca de senha provisória e renova o token para ela sair das claims.
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password, data: { must_change_password: null } });
  if (!error) await supabase.auth.refreshSession();
  if (error) return { ok: false, message: error.message.includes("different") ? "A nova senha precisa ser diferente da anterior." : "Não foi possível alterar a senha. Peça um novo link." };
  redirect("/mfa");
}

// ---------------------------------------------------------------- MFA (TOTP)
export type EnrollState = { factorId: string; qr: string; secret: string } | null;

export async function startMfaEnroll(): Promise<EnrollState> {
  const supabase = await createClient();
  // Remove tentativas não concluídas para não acumular fatores pendentes.
  const { data: list } = await supabase.auth.mfa.listFactors();
  for (const f of list?.all ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Autenticador ${Date.now()}` });
  if (error || !data) return null;
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyMfa(_: ActionState, form: FormData): Promise<ActionState> {
  const factorId = String(form.get("factorId") ?? "");
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  if (!factorId || code.length !== 6) return { ok: false, message: "Digite os 6 números do aplicativo autenticador." };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { ok: false, message: "Código inválido ou expirado. Tente o código atual do aplicativo." };
  redirect("/");
}

// ---------------------------------------------------------------- primeira organização
const orgSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da igreja.").max(160),
  document: z.string().trim().max(20).optional(),
  timezone: z.string().trim().min(3),
});

export async function createOrganization(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = orgSchema.safeParse({ name: form.get("name"), document: form.get("document") || undefined, timezone: form.get("timezone") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", {
    p_name: parsed.data.name,
    p_timezone: parsed.data.timezone,
    p_document: parsed.data.document ?? null,
  });
  if (error) return { ok: false, message: friendlyError(error) };
  redirect("/mfa");
}
