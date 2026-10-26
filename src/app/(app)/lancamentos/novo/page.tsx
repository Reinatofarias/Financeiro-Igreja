import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { categoryOptions, loadLookups } from "@/lib/finance/lookups";
import { todayIn } from "@/lib/dates";
import { Card, EmptyState, Notice, PageHeader, cx } from "@/components/ui";
import { ExpenseForm, IncomeForm, TransferForm } from "./entry-forms";

export const metadata: Metadata = { title: "Novo lançamento" };

export default async function NewEntryPage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const ctx = await requireContext();
  const { tipo = "receita" } = await searchParams;
  const kind = ["receita", "despesa", "transferencia"].includes(tipo) ? tipo : "receita";
  if (!ctx.can.operate) {
    return <EmptyState title="Seu perfil não lança movimentações.">{ctx.needsMfa ? "Ative a verificação em duas etapas para lançar." : "Peça ao administrador se precisar desse acesso."}</EmptyState>;
  }
  const lookups = await loadLookups(ctx.org.id);
  const supabase = await createClient();
  const [{ data: openSessions }, donors] = await Promise.all([
    supabase.from("cash_sessions").select("account_id").eq("organization_id", ctx.org.id).eq("status", "aberto"),
    ctx.can.manage ? supabase.from("donors").select("id, name").eq("organization_id", ctx.org.id).eq("is_active", true).order("name") : Promise.resolve({ data: [] }),
  ]);
  const active = <T extends { is_active: boolean }>(xs: T[]) => xs.filter((x) => x.is_active).map((x) => ({ id: (x as unknown as { id: string }).id, name: (x as unknown as { name: string }).name }));
  const options = {
    accounts: lookups.accounts.filter((a) => a.is_active).map((a) => ({ id: a.id, name: a.name, isCash: a.kind === "caixa_fisico", cashOpen: (openSessions ?? []).some((s) => s.account_id === a.id) })),
    income: categoryOptions(lookups.categories, "receita"),
    expense: categoryOptions(lookups.categories, "despesa"),
    funds: lookups.funds.filter((f) => f.is_active).map((f) => ({ id: f.id, name: f.is_restricted ? `${f.name} (vinculado)` : f.name })),
    ministries: active(lookups.ministries),
    projects: active(lookups.projects),
    costCenters: active(lookups.costCenters),
    paymentMethods: active(lookups.paymentMethods),
    contacts: active(lookups.contacts),
    donors: (donors.data ?? []) as { id: string; name: string }[],
  };
  const today = todayIn(ctx.org.timezone);
  const tabs = [
    ["receita", "Receita"],
    ["despesa", "Despesa"],
    ["transferencia", "Transferência entre contas"],
  ];

  return (
    <>
      <PageHeader title="Novo lançamento" description="Lançamentos confirmados não são editados: para corrigir, estorne e lance de novo." />
      <nav className="flex flex-wrap gap-2" aria-label="Tipo de lançamento">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/lancamentos/novo?tipo=${k}`} aria-current={k === kind ? "page" : undefined}
            className={cx("rounded-md border px-3 py-2 text-sm", k === kind ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface")}>
            {label}
          </Link>
        ))}
      </nav>
      {options.accounts.length === 0 ? (
        <Notice>Cadastre ao menos uma conta antes de lançar.</Notice>
      ) : (
        <Card>
          {kind === "receita" && <IncomeForm options={options} today={today} />}
          {kind === "despesa" && <ExpenseForm options={options} today={today} />}
          {kind === "transferencia" && <TransferForm options={options} today={today} />}
        </Card>
      )}
    </>
  );
}
