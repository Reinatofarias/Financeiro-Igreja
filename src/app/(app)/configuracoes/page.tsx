import type { Metadata } from "next";
import { requireContext, ROLE_LABEL, type Role } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeBR } from "@/lib/dates";
import { Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import Link from "next/link";
import { ApprovalForm, InviteForm, MemberForm, OrgForm, RevokeInviteForm } from "./forms";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const ctx = await requireContext();
  if (ctx.role !== "admin" && ctx.role !== "tesoureiro") return <EmptyState title="Acesso restrito" />;
  const supabase = await createClient();
  const [{ data: members }, { data: invites }, { data: periods }] = await Promise.all([
    supabase.from("memberships").select("id, user_id, role, is_active, created_at").eq("organization_id", ctx.org.id).order("created_at"),
    ctx.role === "admin"
      ? supabase.from("invitations").select("id, email, role, created_at, expires_at").eq("organization_id", ctx.org.id).is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from("accounting_periods").select("month, status, closed_at, reopened_at, reopen_reason").eq("organization_id", ctx.org.id).order("month", { ascending: false }),
  ]);
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, email");
  const person = (id: string) => profiles?.find((p) => p.id === id);

  return (
    <>
      <PageHeader title="Configurações" />
      {ctx.can.admin && <Card title="Dados da igreja"><OrgForm org={ctx.org} /></Card>}

      <Card title="Pessoas com acesso">
        <Table>
          <thead><tr><th>Pessoa</th><th>Perfil</th><th>Situação</th>{ctx.can.admin && <th>Alterar</th>}</tr></thead>
          <tbody>
            {(members ?? []).map((m) => (
              <tr key={m.id}>
                <td>{person(m.user_id)?.full_name ?? "—"}<div className="text-xs text-muted">{person(m.user_id)?.email}</div></td>
                <td>{ROLE_LABEL[m.role as Role]}</td>
                <td>{m.is_active ? <Badge tone="good">Ativo</Badge> : <Badge tone="bad">Revogado</Badge>}</td>
                {ctx.can.admin && <td><MemberForm id={m.id} role={m.role} active={m.is_active} self={m.user_id === ctx.userId} /></td>}
              </tr>
            ))}
          </tbody>
        </Table>
        {ctx.can.admin && (
          <div className="mt-4 space-y-3">
            <h3 className="text-sm font-semibold">Convidar pessoa</h3>
            <InviteForm />
            {(invites ?? []).length > 0 && (
              <Table>
                <thead><tr><th>Convite</th><th>Perfil</th><th>Expira</th><th /></tr></thead>
                <tbody>
                  {(invites ?? []).map((i) => (
                    <tr key={i.id}><td>{i.email}</td><td>{ROLE_LABEL[i.role as Role]}</td><td>{formatDateTimeBR(i.expires_at, ctx.org.timezone)}</td><td><RevokeInviteForm id={i.id} /></td></tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        )}
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-brand">O que cada perfil pode fazer</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            <li><strong>Administrador</strong>: tudo, inclusive convidar e mudar perfis (nunca o próprio).</li>
            <li><strong>Tesoureiro</strong>: lançar, estornar, cadastros, doadores, fechar e reabrir meses.</li>
            <li><strong>Operador financeiro</strong>: lançar receitas, despesas, transferências e operar o caixa.</li>
            <li><strong>Aprovador</strong>: conferir caixas fechados por outra pessoa e aprovar ou recusar despesas.</li>
            <li><strong>Conselho fiscal / auditor</strong>: leitura de tudo, inclusive doadores e auditoria.</li>
            <li><strong>Liderança</strong>: visão gerencial e relatórios, sem doadores identificados.</li>
          </ul>
        </details>
      </Card>

      {ctx.can.admin && (
        <Card title="Aprovação de despesas">
          <ApprovalForm threshold={ctx.org.approval_threshold_cents} />
        </Card>
      )}

      <Card title="Fechamento mensal">
        <p className="text-sm text-muted">
          A conferência e o fechamento de cada mês ficam em <Link href="/fechamento" className="text-brand underline">Fechamento</Link>.
          {(periods ?? []).length > 0 && ` Meses fechados: ${(periods ?? []).filter((p) => p.status === "fechado").length}.`}
        </p>
      </Card>
    </>
  );
}
