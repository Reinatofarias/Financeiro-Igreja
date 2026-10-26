import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { parseFilters, filtersToQuery } from "@/lib/finance/filters";
import { loadLookups, ACCOUNT_KIND_LABEL, PROVIDER_LABEL } from "@/lib/finance/lookups";
import { loadFinancialReport } from "@/lib/finance/reports";
import { todayIn, formatDateBR, periodLabel } from "@/lib/dates";
import { ButtonLink, Card, EmptyState, Money, PageHeader, Stat, Table } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { CategoryBars, MonthlyChart, MonthlyTable } from "@/components/charts";

export const metadata: Metadata = { title: "Visão geral" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const filters = parseFilters(await searchParams, ctx.org.timezone);
  const supabase = await createClient();
  const [lookups, report, { data: billsSummary }] = await Promise.all([
    loadLookups(ctx.org.id),
    loadFinancialReport(ctx.org.id, filters, todayIn(ctx.org.timezone)),
    supabase.rpc("bills_summary", { p_org: ctx.org.id }).single(),
  ]);
  const bills = billsSummary as {
    overdue_pay_cents: number; overdue_pay_count: number; week_pay_cents: number; week_pay_count: number;
    overdue_receive_cents: number; week_receive_cents: number; pending_approval_count: number;
  } | null;
  const q = filtersToQuery(filters);
  const hasAccounts = lookups.accounts.length > 0;

  return (
    <>
      <PageHeader
        title="Visão geral"
        description={`${periodLabel(filters.start, filters.end)} · regime de ${filters.basis === "caixa" ? "caixa" : "competência"} · saldos em ${formatDateBR(report.asOf)}`}
        actions={
          <>
            {ctx.can.operate && <ButtonLink href="/lancamentos/novo?tipo=receita">Nova receita</ButtonLink>}
            {ctx.can.operate && <ButtonLink href="/lancamentos/novo?tipo=despesa" variant="secondary">Nova despesa</ButtonLink>}
            <ButtonLink href={`/relatorios/mensal?${q}`} variant="secondary">Relatório para impressão</ButtonLink>
          </>
        }
      />
      {!hasAccounts ? (
        <EmptyState
          title="Comece cadastrando as contas da igreja"
          action={ctx.can.manage ? <ButtonLink href="/contas">Cadastrar contas</ButtonLink> : undefined}
        >
          Cadastre Mercado Pago, Cora, PagBank e o caixa físico com o saldo inicial de cada um. Depois disso os lançamentos aparecem aqui.
        </EmptyState>
      ) : (
        <>
          <FilterBar filters={filters} lookups={lookups} action="/" />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat featured label="Saldo consolidado" value={<Money cents={report.summary.total_cents} />} help="Soma dos saldos de todas as contas, incluindo valores em trânsito." href="/contas" />
            <Stat label="Recursos livres" value={<Money cents={report.summary.free_cents} />} help="Saldo consolidado menos os fundos vinculados." />
            <Stat label="Recursos vinculados" value={<Money cents={report.summary.restricted_cents} />} help="Saldos positivos dos fundos com destino definido." />
            <Stat label="Em trânsito" value={<Money cents={report.summary.in_transit_cents} />} help="Transferências enviadas e ainda não confirmadas no destino." />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Receitas do período" tone="income" value={<Money cents={report.totals.income_cents} />} help="Valor bruto, líquido de estornos. Sem transferências nem saldo inicial." href={`/lancamentos?${q}&tipo=receita`} />
            <Stat label="Despesas do período" tone="expense" value={<Money cents={report.totals.expense_cents} />} help="Despesas e tarifas, líquidas de estornos. Sem transferências." href={`/lancamentos?${q}&tipo=despesa`} />
            <Stat
              label="Resultado do período"
              tone={report.totals.result_cents >= 0 ? "income" : "expense"}
              value={<Money cents={report.totals.result_cents} />}
              help="Receitas menos despesas do período."
              href={`/lancamentos?${q}`}
            />
            <Stat label="Lançamentos no período" value={<span className="num">{report.totals.entries_count}</span>} help="Com receita ou despesa, incluindo estornos." />
          </div>

          {bills && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Contas vencidas"
                tone={bills.overdue_pay_count > 0 ? "expense" : undefined}
                value={<Money cents={bills.overdue_pay_cents} />}
                help={bills.overdue_pay_count > 0 ? `${bills.overdue_pay_count} conta(s) a pagar já venceram.` : "Nenhuma conta a pagar vencida."}
                href="/contas-a-pagar"
              />
              <Stat label="A pagar em 7 dias" value={<Money cents={bills.week_pay_cents} />} help={`${bills.week_pay_count} conta(s) vencendo nesta semana.`} href="/contas-a-pagar" />
              <Stat label="A receber em 7 dias" tone="income" value={<Money cents={bills.week_receive_cents} />} help="Contas a receber com vencimento nesta semana." href="/contas-a-pagar?tipo=receber" />
              <Stat
                label="Aguardando aprovação"
                value={<span className="num">{bills.pending_approval_count}</span>}
                help={ctx.can.approve && bills.pending_approval_count > 0 ? "Toque para aprovar ou recusar." : "Despesas que precisam do ok antes de pagar."}
                href="/contas-a-pagar"
              />
            </div>
          )}

          <Card title="Evolução mensal" actions={<span className="text-xs text-muted">Valores realizados</span>}>
            <MonthlyChart rows={report.monthly} />
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-brand">Ver tabela com os valores</summary>
              <div className="mt-2"><MonthlyTable rows={report.monthly} /></div>
            </details>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Receitas por categoria"><CategoryBars rows={report.incomeByCategory} kind="receita" /></Card>
            <Card title="Despesas por categoria"><CategoryBars rows={report.expenseByCategory} kind="despesa" /></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Saldo por conta">
              <Table>
                <thead><tr><th>Conta</th><th>Tipo</th><th className="text-right">Saldo</th></tr></thead>
                <tbody>
                  {report.balances.map((b) => (
                    <tr key={b.account_id} className={b.is_active ? "" : "text-muted"}>
                      <td><Link className="text-brand underline" href={`/contas/${b.account_id}`}>{b.name}</Link></td>
                      <td>{ACCOUNT_KIND_LABEL[b.kind as keyof typeof ACCOUNT_KIND_LABEL]} · {PROVIDER_LABEL[b.provider]}</td>
                      <td className="text-right"><Money cents={b.balance_cents} /></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="mt-2 text-xs text-muted">Saldos calculados pelo sistema (saldo inicial + lançamentos conciliados).</p>
            </Card>
            <Card title="Fundos">
              <Table>
                <thead><tr><th>Fundo</th><th>Tipo</th><th className="text-right">Saldo</th></tr></thead>
                <tbody>
                  {report.funds.map((f) => (
                    <tr key={f.fund_id}>
                      <td><Link className="text-brand underline" href={`/lancamentos?${filtersToQuery({ ...filters, fund: f.fund_id })}`}>{f.name}</Link></td>
                      <td>{f.is_restricted ? "Vinculado" : "Livre"}</td>
                      <td className="text-right"><Money cents={f.balance_cents} colored /></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>

        </>
      )}
    </>
  );
}
