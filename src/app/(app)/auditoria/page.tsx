import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeBR } from "@/lib/dates";
import { EmptyState, PageHeader, Table, buttonStyles } from "@/components/ui";

export const metadata: Metadata = { title: "Auditoria" };

const TABLE_LABEL: Record<string, string> = {
  journal_entries: "Lançamento", financial_accounts: "Conta", categories: "Categoria", funds: "Fundo", ministries: "Ministério",
  projects: "Projeto", cost_centers: "Centro de custo", contacts: "Fornecedor", donors: "Doador", payment_methods: "Forma de pagamento",
  memberships: "Acesso", invitations: "Convite", organizations: "Igreja", units: "Unidade", cash_sessions: "Caixa",
  accounting_periods: "Período", attachments: "Comprovante",
};
const ACTION_LABEL: Record<string, string> = { insert: "criou", update: "alterou", delete: "removeu" };
const PAGE = 100;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can.seeAudit) return <EmptyState title="Acesso restrito">{ctx.needsMfa ? "Ative a verificação em duas etapas para ver a auditoria." : null}</EmptyState>;
  const page = Math.max(1, Number((await searchParams).pagina) || 1);
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("audit_log")
    .select("id, occurred_at, actor_id, action, table_name, record_id, reason, new_data, old_data", { count: "exact" })
    .eq("organization_id", ctx.org.id)
    .order("occurred_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, email");
  const who = (id: string | null) => profiles?.find((p) => p.id === id)?.full_name ?? (id ? "Pessoa removida" : "Sistema");
  const describe = (r: { table_name: string; new_data: Record<string, unknown> | null; old_data: Record<string, unknown> | null }) => {
    const d = r.new_data ?? r.old_data ?? {};
    const changed = r.new_data && r.old_data ? Object.keys(r.new_data).filter((k) => JSON.stringify(r.new_data![k]) !== JSON.stringify(r.old_data![k])) : [];
    const label = (d.description ?? d.name ?? d.email ?? "") as string;
    return `${label}${changed.length ? ` (campos: ${changed.join(", ")})` : ""}`;
  };
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));

  return (
    <>
      <PageHeader title="Auditoria" description="Registro permanente de quem criou ou alterou cada informação. Ninguém edita ou apaga este histórico." />
      <Table>
        <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhe</th><th>Motivo</th></tr></thead>
        <tbody>
          {(data ?? []).map((r) => (
            <tr key={r.id}>
              <td className="num">{formatDateTimeBR(r.occurred_at, ctx.org.timezone)}</td>
              <td>{who(r.actor_id)}</td>
              <td>{ACTION_LABEL[r.action] ?? r.action} {TABLE_LABEL[r.table_name] ?? r.table_name}</td>
              <td className="max-w-md truncate">{describe(r)}</td>
              <td>{r.reason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {pages > 1 && (
        <div className="flex gap-2">
          {page > 1 && <a className={buttonStyles.secondary} href={`/auditoria?pagina=${page - 1}`}>Anterior</a>}
          {page < pages && <a className={buttonStyles.secondary} href={`/auditoria?pagina=${page + 1}`}>Próxima</a>}
        </div>
      )}
    </>
  );
}
