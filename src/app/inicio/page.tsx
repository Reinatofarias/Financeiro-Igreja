import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getContext } from "@/lib/auth/context";
import { AuthCard } from "@/components/auth-card";
import { CreateOrgForm } from "./create-org-form";
import { signOut } from "@/app/auth-actions";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Primeiro acesso" };

export default async function StartPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  // Convites pendentes para o e-mail confirmado são aceitos aqui (operação idempotente).
  await supabase.rpc("accept_my_invitations");
  if (await getContext()) redirect("/mfa");

  // O sistema é de uma igreja só: depois do primeiro cadastro, quem chega sem acesso espera o administrador liberar.
  if (await churchExists()) {
    return (
      <AuthCard
        title="Acesso ainda não liberado"
        subtitle={`Seu login (${data.claims.email ?? "este e-mail"}) ainda não tem acesso ao financeiro. Peça ao administrador para cadastrar você em Configurações > Pessoas com acesso, com este mesmo e-mail. Depois saia e entre de novo.`}
      >
        <form action={signOut} className="text-center">
          <button className="text-sm text-brand underline">Sair</button>
        </form>
      </AuthCard>
    );
  }

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

/** Quem não tem vínculo não enxerga nenhuma igreja pelo RLS, então a conferência usa a chave de serviço (só leitura de existência). */
async function churchExists() {
  try {
    const { count, error } = await createAdminClient().from("organizations").select("id", { count: "exact", head: true });
    return !error && (count ?? 0) > 0;
  } catch {
    return false;
  }
}
