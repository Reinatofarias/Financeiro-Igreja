import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, Notice, PageHeader, Table } from "@/components/ui";
import { DonorForm } from "./donor-form";

export const metadata: Metadata = { title: "Doadores" };

function mask(doc: string | null) {
  if (!doc) return "—";
  const d = doc.replace(/\D/g, "");
  return d.length <= 4 ? "••••" : `•••.•••.${d.slice(-5, -2)}-${d.slice(-2)}`;
}

export default async function DonorsPage() {
  const ctx = await requireContext();
  if (!ctx.can.seeDonors) return <EmptyState title="Acesso restrito">{ctx.needsMfa ? "Ative a verificação em duas etapas para ver doadores identificados." : "Somente administrador, tesoureiro e auditor veem doadores identificados."}</EmptyState>;
  const supabase = await createClient();
  const { data } = await supabase.from("donors").select("id, name, document, consent_at, is_active").eq("organization_id", ctx.org.id).order("name");
  return (
    <>
      <PageHeader title="Doadores identificados" description="Cadastro opcional e restrito. Contribuições anônimas não precisam de doador." />
      <Notice tone="info">
        Dados de contribuição religiosa são sensíveis (LGPD). Cadastre só quem pediu recibo ou autorizou, registre o consentimento e evite guardar mais do que o necessário. Esses dados nunca aparecem na prestação de contas pública.
      </Notice>
      {ctx.can.manage && (
        <Card title="Novo doador"><DonorForm /></Card>
      )}
      <Table>
        <thead><tr><th>Nome</th><th>CPF</th><th>Consentimento</th></tr></thead>
        <tbody>
          {(data ?? []).map((d) => (
            <tr key={d.id}><td>{d.name}</td><td className="num">{mask(d.document)}</td><td>{d.consent_at ? "Registrado" : "Não registrado"}</td></tr>
          ))}
          {(data ?? []).length === 0 && <tr><td colSpan={3} className="text-muted">Nenhum doador cadastrado.</td></tr>}
        </tbody>
      </Table>
    </>
  );
}
