import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { monthEnd, monthLabel, todayIn } from "@/lib/dates";
import { Card, EmptyState, Money, PageHeader, Select, Stat, buttonStyles, cx } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { BudgetForm } from "./forms";

export const metadata: Metadata = { title: "Orçamento" };

type Row = { category_id: string; category_name: string; kind: "receita" | "despesa"; budget_cents: number; actual_cents: number };

export default async function BudgetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const today = todayIn(ctx.org.timezone);
  const thisYear = Number(today.slice(0, 4));
  const year = Math.min(2100, Math.max(2000, Number(sp.ano) || thisYear));
  const month = typeof sp.mes === "string" && /^(0?[1-9]|1[0-2])$/.test(sp.mes) ? Number(sp.mes) : year === thisYear ? Number(today.slice(5, 7)) : 12;
  const scope = sp.periodo === "ano" ? "ano" : "mes";
  const mm = String(month).padStart(2, "0");
  const start = scope === "ano" ? `${year}-01-01` : `${year}-${mm}-01`;
  const end = monthEnd(`${year}-${mm}-01`);

  const supabase = await createClient();
  const [{ data: rows }, { data: budgets }, { data: cats }] = await Promise.all([
    supabase.rpc("budget_vs_actual", { p_org: ctx.org.id, p_start: start, p_end: end }),
    supabase.from("budgets").select("category_id, month, amount_cents").eq("organization_id", ctx.org.id).gte("month", `${year}-01-01`).lte("month", `${year}-12-01`),
    supabase.from("categories").select("id, name, kind, is_active, system_code").eq("organization_id", ctx.org.id).is("parent_id", null).order("name"),
  ]);
  const data = (rows ?? []) as Row[];
  const expense = data.filter((r) => r.kind === "despesa");
  const income = data.filter((r) => r.kind === "receita");
  const sum = (xs: Row[], k: "budget_cents" | "actual_cents") => xs.reduce((a, r) => a + Number(r[k]), 0);

  // Valor mensal atual de cada categoria (o do mês escolhido) e se ele varia ao longo do ano.
  const byCat = new Map<string, Map<string, number>>();
  for (const b of budgets ?? []) {
    const m = byCat.get(b.category_id) ?? new Map<string, number>();
    m.set(b.month as string, Number(b.amount_cents));
    byCat.set(b.category_id, m);
  }
  const monthKey = `${year}-${mm}-01`;
  const periodText = scope === "ano" ? `janeiro a ${monthLabel(monthKey, true).split(" ")[0]} de ${year}` : monthLabel(monthKey, true);

  return (
    <>
      <PageHeader title="Orçamento" description={`Orçado x realizado por categoria principal, em regime de competência · ${periodText}`} />

      <form method="get" className="no-print flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Ano
          <Select name="ano" defaultValue={String(year)} className="w-28">
            {[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Mês
          <Select name="mes" defaultValue={String(month)} className="w-36">
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthLabel(`2000-${String(i + 1).padStart(2, "0")}-01`, true).split(" ")[0]}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Período
          <Select name="periodo" defaultValue={scope} className="w-44">
            <option value="mes">Só o mês</option>
            <option value="ano">Ano até o mês</option>
          </Select>
        </label>
        <button className={buttonStyles.primary}>Ver</button>
      </form>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Despesas orçadas" value={<Money cents={sum(expense, "budget_cents")} />} />
        <Stat label="Despesas realizadas" tone="expense" value={<Money cents={sum(expense, "actual_cents")} />} help={pct(sum(expense, "actual_cents"), sum(expense, "budget_cents"), "do orçado")} />
        <Stat label="Receitas previstas" value={<Money cents={sum(income, "budget_cents")} />} />
        <Stat label="Receitas realizadas" tone="income" value={<Money cents={sum(income, "actual_cents")} />} help={pct(sum(income, "actual_cents"), sum(income, "budget_cents"), "da meta")} />
      </div>

      {data.length === 0 ? (
        <EmptyState title="Ainda não há orçamento nem movimento neste período">
          {ctx.can.manage ? "Defina abaixo quanto a igreja espera gastar e arrecadar por mês em cada categoria." : "O tesoureiro define o orçamento por categoria."}
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Despesas"><BudgetBars rows={expense} kind="despesa" /></Card>
          <Card title="Receitas"><BudgetBars rows={income} kind="receita" /></Card>
        </div>
      )}

      {ctx.can.manage && (
        <Card title={`Definir orçamento de ${year}`}>
          <p className="mb-4 text-sm text-muted">
            Informe o valor por mês de cada categoria principal (as subcategorias somam nela). Ele vale do mês escolhido até dezembro; deixe em branco para remover.
          </p>
          {(["despesa", "receita"] as const).map((k) => (
            <div key={k} className="mb-6 last:mb-0">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{k === "despesa" ? "Despesas" : "Receitas"}</h3>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {(cats ?? [])
                  .filter((c) => c.kind === k && c.is_active && !c.system_code)
                  .map((c) => {
                    const months = byCat.get(c.id);
                    const current = months?.get(monthKey) ?? null;
                    const values = new Set(months?.values() ?? []);
                    return (
                      <li key={c.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-muted">
                            {!months ? "Sem orçamento" : values.size === 1 && months.size === 12 ? `${formatBRL([...values][0])} por mês` : `${months.size} mês(es) com orçamento${values.size > 1 ? ", valores diferentes" : ""}`}
                          </p>
                        </div>
                        <BudgetForm categoryId={c.id} year={year} current={current} fromMonth={year === thisYear ? Number(today.slice(5, 7)) : 1} />
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </Card>
      )}
      <p className="text-xs text-muted">
        O realizado vem dos lançamentos (receitas e despesas pela data de competência). Para ver os lançamentos de uma categoria, use os filtros em{" "}
        <Link href="/lancamentos" className="text-brand underline">Lançamentos</Link>.
      </p>
    </>
  );
}

function pct(actual: number, budget: number, of: string) {
  if (!budget) return "Sem orçamento definido.";
  return `${Math.round((actual / budget) * 100)}% ${of}.`;
}

function BudgetBars({ rows, kind }: { rows: Row[]; kind: "receita" | "despesa" }) {
  if (rows.length === 0) return <p className="text-sm text-muted">Nada neste período.</p>;
  return (
    <ul className="space-y-4">
      {rows.map((r) => {
        const budget = Number(r.budget_cents);
        const actual = Number(r.actual_cents);
        const ratio = budget > 0 ? actual / budget : null;
        const over = ratio !== null && ratio > 1;
        const tone =
          ratio === null ? "bg-muted/40" : kind === "despesa" ? (over ? "bg-expense" : ratio >= 0.9 ? "bg-gold" : "bg-brand") : ratio >= 1 ? "bg-income" : "bg-brand";
        return (
          <li key={r.category_id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{r.category_name}</span>
              <span className="shrink-0 text-right">
                <Money cents={actual} /> <span className="text-muted">/ {budget ? formatBRL(budget) : "sem orçamento"}</span>
              </span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-bg" role="img" aria-label={ratio === null ? "Sem orçamento" : `${Math.round(ratio * 100)}% do orçado`}>
              <div className={cx("h-full rounded-full", tone)} style={{ width: `${Math.min(100, ratio === null ? 100 : ratio * 100)}%` }} />
            </div>
            {ratio !== null && (
              <p className={cx("mt-1 text-xs", over && kind === "despesa" ? "font-medium text-expense" : "text-muted")}>
                {Math.round(ratio * 100)}% {kind === "despesa" ? "do orçado" : "da meta"}
                {over && kind === "despesa" && ` · passou ${formatBRL(actual - budget)}`}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
