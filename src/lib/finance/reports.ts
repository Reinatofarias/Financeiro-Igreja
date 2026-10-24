import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addMonths, monthStart } from "@/lib/dates";
import { rpcFilterArgs, type Filters } from "./filters";

export type AccountBalance = { account_id: string; name: string; kind: string; provider: string; is_active: boolean; color: string | null; balance_cents: number; last_movement: string | null; balance_source: string };
export type FundBalance = { fund_id: string; name: string; is_restricted: boolean; balance_cents: number };
export type Totals = { income_cents: number; expense_cents: number; result_cents: number; entries_count: number };
export type MonthRow = { month: string; income_cents: number; expense_cents: number; result_cents: number };
export type CategoryRow = { category_id: string; category_name: string; parent_name: string | null; total_cents: number };

/**
 * Todos os números do dashboard e do relatório impresso vêm daqui, com os mesmos filtros e a
 * mesma data de referência, para que tela, impressão e exportação batam entre si.
 */
export async function loadFinancialReport(orgId: string, f: Filters, today: string) {
  const supabase = await createClient();
  // Saldos nunca são datados no futuro: a referência é o fim do período ou hoje, o que vier antes.
  const asOf = f.end < today ? f.end : today;
  const args = rpcFilterArgs(orgId, f);
  const evolutionStart = f.start < addMonths(monthStart(f.end), -11) ? f.start : addMonths(monthStart(f.end), -11);

  const [summary, balances, funds, totals, monthly, incomeByCat, expenseByCat] = await Promise.all([
    supabase.rpc("balance_summary", { p_org: orgId, p_as_of: asOf }).single(),
    supabase.rpc("account_balances", { p_org: orgId, p_as_of: asOf }),
    supabase.rpc("fund_balances", { p_org: orgId, p_as_of: asOf }),
    supabase.rpc("report_totals", { ...args, p_category: f.category }).single(),
    supabase.rpc("report_monthly", { ...args, p_start: evolutionStart, p_category: f.category }),
    supabase.rpc("report_by_category", { ...args, p_kind: "receita" }),
    supabase.rpc("report_by_category", { ...args, p_kind: "despesa" }),
  ]);
  const firstError = [summary, balances, funds, totals, monthly, incomeByCat, expenseByCat].find((r) => r.error)?.error;
  if (firstError) throw new Error(`Falha ao carregar relatório: ${firstError.code}`);

  return {
    generatedAt: new Date().toISOString(),
    asOf,
    summary: summary.data as { total_cents: number; restricted_cents: number; free_cents: number; in_transit_cents: number; as_of: string },
    balances: (balances.data ?? []) as AccountBalance[],
    funds: (funds.data ?? []) as FundBalance[],
    totals: totals.data as Totals,
    monthly: (monthly.data ?? []) as MonthRow[],
    incomeByCategory: (incomeByCat.data ?? []) as CategoryRow[],
    expenseByCategory: (expenseByCat.data ?? []) as CategoryRow[],
  };
}

export type FinancialReport = Awaited<ReturnType<typeof loadFinancialReport>>;
