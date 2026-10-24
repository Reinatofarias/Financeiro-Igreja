import type { Metadata } from "next";
import { requireContext, ROLE_LABEL, type Role } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { addMonths, formatDateBR, formatDateTimeBR, monthLabel, monthStart, todayIn } from "@/lib/dates";
import { Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { CloseMonthForm, InviteForm, MemberForm, OrgForm, ReopenMonthForm, RevokeInviteForm } from "./forms";

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
  const lastMonth = addMonths(monthStart(todayIn(ctx.org.timezone)), -1).slice(0, 7);

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
            <li><strong>Aprovador</strong>: conferir caixas fechados por outra pessoa; aprovações na Fase 4.</li>
            <li><strong>Conselho fiscal / auditor</strong>: leitura de tudo, inclusive doadores e auditoria.</li>
            <li><strong>Liderança</strong>: visão gerencial e relatórios, sem doadores identificados.</li>
          </ul>
        </details>
      </Card>

      <Card title="Fechamento mensal">
        <p className="mb-3 text-sm text-muted">Mês fechado não aceita lançamentos novos nem estornos com data nele. Reabrir exige justificativa, que fica na auditoria. A tela completa de fechamento (com conferência dos saldos bancários) chega na Fase 4.</p>
        {ctx.can.manage && <CloseMonthForm defaultMonth={lastMonth} />}
        {(periods ?? []).length > 0 && (
          <div className="mt-3">
            <Table>
              <thead><tr><th>Mês</th><th>Situação</th><th>Histórico</th>{ctx.can.manage && <th />}</tr></thead>
              <tbody>
                {(periods ?? []).map((p) => (
                  <tr key={p.month}>
                    <td>{monthLabel(p.month, true)}</td>
                    <td>{p.status === "fechado" ? <Badge tone="warn">Fechado</Badge> : <Badge tone="good">Aberto</Badge>}</td>
                    <td className="text-xs text-muted">Fechado em {formatDateTimeBR(p.closed_at, ctx.org.timezone)}{p.reopened_at && <> · reaberto em {formatDateBR(p.reopened_at.slice(0, 10))}: {p.reopen_reason}</>}</td>
                    {ctx.can.manage && <td>{p.status === "fechado" && <ReopenMonthForm month={p.month} />}</td>}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
