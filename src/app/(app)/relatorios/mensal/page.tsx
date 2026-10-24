import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { filtersToQuery, parseFilters } from "@/lib/finance/filters";
import { loadLookups } from "@/lib/finance/lookups";
import { loadFinancialReport } from "@/lib/finance/reports";
import { todayIn, formatDateBR, formatDateTimeBR, periodLabel } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { CategoryBars, MonthlyChart, MonthlyTable } from "@/components/charts";
import { PrintButton } from "@/components/print-button";
import { cx } from "@/components/ui";

export const metadata: Metadata = { title: "Relatório financeiro" };

const FORMATS = { a4: "A4 retrato", paisagem: "A4 paisagem", a3: "A3 (gráficos ampliados)", tela: "Tela / projetor" } as const;
type Format = keyof typeof FORMATS;

export default async function MonthlyReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const format: Format = typeof sp.formato === "string" && sp.formato in FORMATS ? (sp.formato as Format) : "a4";
  const filters = parseFilters(sp, ctx.org.timezone);
  const [report, lookups] = await Promise.all([loadFinancialReport(ctx.org.id, filters, todayIn(ctx.org.timezone)), loadLookups(ctx.org.id)]);

  let logoUrl: string | null = null;
  if (ctx.org.logo_path) {
    const supabase = await createClient();
    logoUrl = (await supabase.storage.from("identidade").createSignedUrl(ctx.org.logo_path, 600)).data?.signedUrl ?? null;
  }
  const name = (list: { id: string; name: string }[], id: string | null) => (id ? list.find((x) => x.id === id)?.name : null);
  const filterText = [
    `Regime de ${filters.basis === "caixa" ? "caixa" : "competência"}`,
    name(lookups.accounts, filters.account) && `Conta: ${name(lookups.accounts, filters.account)}`,
    name(lookups.funds, filters.fund) && `Fundo: ${name(lookups.funds, filters.fund)}`,
    name(lookups.ministries, filters.ministry) && `Ministério: ${name(lookups.ministries, filters.ministry)}`,
    name(lookups.projects, filters.project) && `Projeto: ${name(lookups.projects, filters.project)}`,
  ].filter(Boolean).join(" · ");
  const q = filtersToQuery(filters);
  const big = format === "a3" || format === "tela";
  const totalIn = report.balances.reduce((s, b) => s + b.balance_cents, 0);

  return (
    <div className={cx(format === "paisagem" && "print-landscape", format === "a3" && "print-a3", format === "tela" && "text-lg")}>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <PrintButton />
        {(Object.keys(FORMATS) as Format[]).map((f) => (
          <Link key={f} href={`/relatorios/mensal?${q}&formato=${f}`} aria-current={f === format ? "page" : undefined}
            className={cx("rounded-md border px-3 py-2 text-sm", f === format ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface")}>{FORMATS[f]}</Link>
        ))}
        <Link className="text-sm text-brand underline" href={`/?${q}`}>Voltar ao painel</Link>
      </div>

      <article className={cx("print-sheet mx-auto space-y-6 rounded-lg border border-line bg-white p-6 text-black sm:p-10", format === "a4" ? "max-w-[210mm]" : "max-w-none")}>
        <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-4">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logoUrl && <img src={logoUrl} alt="" className="h-16 w-16 object-contain" />}
            <div>
              <p className="text-xl font-bold">{ctx.org.legal_name || ctx.org.name}</p>
              {ctx.org.document && <p className="text-sm">CNPJ {ctx.org.document.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}</p>}
              <p className="mt-1 text-lg font-semibold">Relatório financeiro · {periodLabel(filters.start, filters.end)}</p>
            </div>
          </div>
          <div className="text-right text-xs leading-5">
            <p>Gerado em {formatDateTimeBR(report.generatedAt, ctx.org.timezone)}</p>
            <p>Dados até {formatDateBR(report.asOf)}</p>
            <p>{filterText}</p>
            <p>Uso interno</p>
          </div>
        </header>

        <section className="avoid-break">
          <h2 className="mb-2 text-base font-bold">1. Resumo do período</h2>
          <table className="w-full text-sm [&_td]:border [&_td]:border-gray-400 [&_td]:px-2 [&_td]:py-1.5">
            <tbody>
              <tr><td>Receitas</td><td className="num text-right">{formatBRL(report.totals.income_cents)}</td></tr>
              <tr><td>Despesas</td><td className="num text-right">{formatBRL(report.totals.expense_cents)}</td></tr>
              <tr className="font-bold"><td>Resultado do período</td><td className="num text-right">{formatBRL(report.totals.result_cents)}</td></tr>
              <tr><td>Saldo consolidado em {formatDateBR(report.asOf)}</td><td className="num text-right">{formatBRL(report.summary.total_cents)}</td></tr>
              <tr><td>· Recursos vinculados a fundos</td><td className="num text-right">{formatBRL(report.summary.restricted_cents)}</td></tr>
              <tr><td>· Recursos livres</td><td className="num text-right">{formatBRL(report.summary.free_cents)}</td></tr>
              {report.summary.in_transit_cents !== 0 && <tr><td>· Em trânsito entre contas</td><td className="num text-right">{formatBRL(report.summary.in_transit_cents)}</td></tr>}
            </tbody>
          </table>
          <p className="mt-1 text-xs">Valores realizados. Transferências entre contas da igreja e saldos iniciais não entram em receitas e despesas.</p>
        </section>

        <section className="avoid-break">
          <h2 className="mb-2 text-base font-bold">2. Saldos por conta em {formatDateBR(report.asOf)}</h2>
          <table className="w-full text-sm [&_td]:border [&_td]:border-gray-400 [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-gray-400 [&_th]:bg-gray-100 [&_th]:px-2 [&_th]:py-1.5 [&_th:not(.text-right)]:text-left">
            <thead><tr><th>Conta</th><th>Origem do saldo</th><th className="text-right">Saldo</th></tr></thead>
            <tbody>
              {report.balances.map((b) => <tr key={b.account_id}><td>{b.name}</td><td>Calculado pelo sistema</td><td className="num text-right">{formatBRL(b.balance_cents)}</td></tr>)}
            </tbody>
            <tfoot><tr className="font-bold"><td colSpan={2}>Total das contas</td><td className="num text-right">{formatBRL(totalIn)}</td></tr></tfoot>
          </table>
        </section>

        <section className="avoid-break">
          <h2 className="mb-2 text-base font-bold">3. Fundos</h2>
          <table className="w-full text-sm [&_td]:border [&_td]:border-gray-400 [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-gray-400 [&_th]:bg-gray-100 [&_th]:px-2 [&_th]:py-1.5 [&_th:not(.text-right)]:text-left">
            <thead><tr><th>Fundo</th><th>Tipo</th><th className="text-right">Saldo</th></tr></thead>
            <tbody>
              {report.funds.map((f) => <tr key={f.fund_id}><td>{f.name}</td><td>{f.is_restricted ? "Vinculado" : "Livre"}</td><td className="num text-right">{formatBRL(f.balance_cents)}</td></tr>)}
            </tbody>
          </table>
        </section>

        <section className={cx(big && "page-break")}>
          <h2 className="mb-2 text-base font-bold">4. Evolução mensal (receitas e despesas)</h2>
          <MonthlyChart rows={report.monthly} height={big ? 380 : 240} />
          <div className="mt-3"><MonthlyTable rows={report.monthly} /></div>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="avoid-break"><h2 className="mb-2 text-base font-bold">5. Receitas por categoria</h2><CategoryBars rows={report.incomeByCategory} kind="receita" limit={15} /></div>
          <div className="avoid-break"><h2 className="mb-2 text-base font-bold">6. Despesas por categoria</h2><CategoryBars rows={report.expenseByCategory} kind="despesa" limit={15} /></div>
        </section>

        <footer className="border-t border-gray-400 pt-3 text-xs">
          <p>Relatório gerencial gerado pelo sistema financeiro da igreja a partir dos lançamentos registrados. Os saldos são calculados pelo sistema e ainda não foram conciliados com extratos bancários. Não substitui a escrituração contábil.</p>
          <div className="print-only">
            <div className="mt-12 grid grid-cols-2 gap-12">
              <p className="border-t border-black pt-1 text-center">Tesoureiro(a)</p>
              <p className="border-t border-black pt-1 text-center">Conselho fiscal</p>
            </div>
          </div>
        </footer>
      </article>
    </div>
  );
}
