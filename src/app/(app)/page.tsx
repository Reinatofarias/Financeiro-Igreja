import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { parseFilters, filtersToQuery } from "@/lib/finance/filters";
import { loadLookups, ACCOUNT_KIND_LABEL, PROVIDER_LABEL } from "@/lib/finance/lookups";
import { loadFinancialReport } from "@/lib/finance/reports";
import { todayIn, formatDateBR, periodLabel } from "@/lib/dates";
import { ButtonLink, Card, EmptyState, Money, PageHeader, Table } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { CategoryBars, MonthlyChart, MonthlyTable } from "@/components/charts";

export const metadata: Metadata = { title: "Visão geral" };

function Kpi({ label, cents, help, tone, href }: { label: string; cents: number; help: string; tone?: "income" | "expense" | "signed"; href?: string }) {
  const color = tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : tone === "signed" ? (cents >= 0 ? "text-income" : "text-expense") : "";
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${color}`}>
        <Money cents={cents} />
      </p>
      <p className="mt-1 text-xs text-muted">{help}</p>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-lg border border-line bg-surface p-4 hover:border-brand">{body}</Link>
  ) : (
    <div className="rounded-lg border border-line bg-surface p-4">{body}</div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const filters = parseFilters(await searchParams, ctx.org.timezone);
  const [lookups, report] = await Promise.all([loadLookups(ctx.org.id), loadFinancialReport(ctx.org.id, filters, todayIn(ctx.org.timezone))]);
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
            <Kpi label="Saldo consolidado" cents={report.summary.total_cents} help="Soma dos saldos calculados de todas as contas, incluindo valores em trânsito." href="/contas" />
            <Kpi label="Recursos livres" cents={report.summary.free_cents} help="Saldo consolidado menos os fundos vinculados." />
            <Kpi label="Recursos vinculados" cents={report.summary.restricted_cents} help="Soma dos saldos positivos dos fundos com destino definido." />
            <Kpi label="Em trânsito" cents={report.summary.in_transit_cents} help="Transferências enviadas e ainda não confirmadas na conta de destino." />
            <Kpi label="Receitas do período" cents={report.totals.income_cents} tone="income" help="Receitas pelo valor bruto, líquidas de estornos. Não inclui transferências nem saldo inicial." href={`/lancamentos?${q}&tipo=receita`} />
            <Kpi label="Despesas do período" cents={report.totals.expense_cents} tone="expense" help="Despesas e tarifas, líquidas de estornos. Não inclui transferências." href={`/lancamentos?${q}&tipo=despesa`} />
            <Kpi label="Resultado do período" cents={report.totals.result_cents} tone="signed" help="Receitas menos despesas do período." href={`/lancamentos?${q}`} />
            <div className="rounded-lg border border-line bg-surface p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Lançamentos no período</p>
              <p className="mt-1 text-xl font-semibold num">{report.totals.entries_count}</p>
              <p className="mt-1 text-xs text-muted">Com receita ou despesa, incluindo estornos.</p>
            </div>
          </div>

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
              <p className="mt-2 text-xs text-muted">Saldos calculados pelo sistema (saldo inicial + lançamentos). Ainda não há saldo informado pelo banco: as integrações chegam na Fase 3.</p>
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

          <Card title="Indicadores das próximas fases">
            <p className="text-sm text-muted">
              Contas vencidas e a vencer, projeção de caixa e orçado x realizado entram na Fase 4. Situação da conciliação na Fase 2 e saúde das integrações na Fase 3.
              Não mostramos esses números antes de existirem dados reais para eles. <Link className="text-brand underline" href="/relatorios">Definição de cada indicador</Link>.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
