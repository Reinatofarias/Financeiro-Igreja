import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getContext } from "@/lib/auth/context";
import { AuthCard } from "@/components/auth-card";
import { CreateOrgForm } from "./create-org-form";
import { signOut } from "@/app/auth-actions";

export const metadata: Metadata = { title: "Primeiro acesso" };

export default async function StartPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  // Convites pendentes para o e-mail confirmado são aceitos aqui (operação idempotente).
  await supabase.rpc("accept_my_invitations");
  if (await getContext()) redirect("/mfa");

  return (
    <AuthCard
      title="Cadastrar a igreja"
      subtitle="Você ainda não participa de nenhuma organização. Se recebeu um convite, confira se entrou com o mesmo e-mail. Para começar do zero, cadastre a igreja: você será o administrador."
    >
      <CreateOrgForm />
      <form action={signOut} className="mt-4 text-center">
        <button className="text-sm text-muted underline">Sair</button>
      </form>
    </AuthCard>
  );
}
