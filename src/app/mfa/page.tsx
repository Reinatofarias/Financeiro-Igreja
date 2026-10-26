import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { AuthCard } from "@/components/auth-card";
import { MfaEnroll, MfaVerify } from "./mfa-forms";
import { signOut } from "@/app/auth-actions";

export const metadata: Metadata = { title: "Verificação em duas etapas" };

export default async function MfaPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  // Login criado pelo administrador com senha provisória: a pessoa cria a própria senha antes de tudo.
  if (data.claims.user_metadata?.must_change_password) redirect("/redefinir-senha");
  const ctx = await getContext();
  if (!ctx) redirect("/inicio");
  if (ctx.aal === "aal2") redirect("/");

  const privileged = ctx.role === "admin" || ctx.role === "tesoureiro";
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = (factors?.totp ?? []).find((f) => f.status === "verified");

  if (!verified && !(privileged && ctx.org.require_mfa)) redirect("/");

  return (
    <AuthCard
      title="Verificação em duas etapas"
      subtitle={
        verified
          ? "Digite o código de 6 números do seu aplicativo autenticador."
          : "Seu perfil movimenta dinheiro da igreja. Ative um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou similar) para continuar."
      }
    >
      {verified ? <MfaVerify factorId={verified.id} /> : <MfaEnroll />}
      <form action={signOut} className="mt-4 text-center">
        <button className="text-sm text-muted underline">Sair</button>
      </form>
    </AuthCard>
  );
}
