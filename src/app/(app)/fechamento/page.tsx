import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { addMonths, formatDateTimeBR, monthEnd, monthLabel, monthStart, todayIn } from "@/lib/dates";
import { Badge, Card, Money, Notice, PageHeader, cx } from "@/components/ui";
import type { AccountBalance } from "@/lib/finance/reports";
import { CloseThisMonthForm, ReopenThisMonthForm } from "./forms";

export const metadata: Metadata = { title: "Fechamento mensal" };

const CHECKS: Record<string, { label: string; ok: string; href: string; action: string }> = {
  caixas_abertos: { label: "Caixa físico aberto", ok: "Nenhum caixa aberto", href: "/caixa", action: "Fechar o caixa" },
  extrato_pendente: { label: "Movimentos do extrato sem conciliar", ok: "Extrato conciliado", href: "/conciliacao", action: "Conciliar" },
  contas_em_aberto: { label: "Contas com vencimento no mês ainda em aberto", ok: "Contas do mês resolvidas", href: "/contas-a-pagar", action: "Ver contas" },
  aguardando_aprovacao: { label: "Despesas aguardando aprovação", ok: "Nada aguardando aprovação", href: "/contas-a-pagar?ver=abertas", action: "Ver despesas" },
  transferencias_em_transito: { label: "Transferências ainda em trânsito", ok: "Nenhuma transferência em trânsito", href: "/lancamentos?tipo=transferencia", action: "Confirmar chegada" },
};

export default async function ClosingPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const ctx = await requireContext();
  const { mes } = await searchParams;
  const today = todayIn(ctx.org.timezone);
  const current = monthStart(today);
  const lastMonth = addMonths(current, -1);
  const month = mes && /^\d{4}-\d{2}$/.test(mes) && `${mes}-01` < current ? `${mes}-01` : lastMonth;
  const end = monthEnd(month);

  const supabase = await createClient();
  const [{ data: periods }, { data: checklist }, { data: balances }] = await Promise.all([
    supabase.from("accounting_periods").select("month, status, closed_at, reopened_at, reopen_reason").eq("organization_id", ctx.org.id),
    supabase.rpc("period_checklist", { p_org: ctx.org.id, p_month: month }),
    supabase.rpc("account_balances", { p_org: ctx.org.id, p_as_of: end }),
  ]);
  const byMonth = new Map((periods ?? []).map((p) => [p.month as string, p]));
  const period = byMonth.get(month);
  const closed = period?.status === "fechado";
  const items = (checklist ?? []) as { item: string; pending: number; blocking: boolean }[];
  const warnings = items.filter((i) => Number(i.pending) > 0).length;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(current, -(i + 1)));
  const rows = ((balances ?? []) as AccountBalance[]).filter((b) => b.is_active || b.balance_cents !== 0);
  const total = rows.reduce((a, b) => a + Number(b.balance_cents), 0);

  return (
    <>
      <PageHeader title="Fechamento mensal" description="Confira o mês, feche e ele fica protegido: nada entra nem sai com data nele sem reabertura justificada." />

      <nav className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" aria-label="Meses">
        {months.map((m) => {
          const p = byMonth.get(m);
          return (
            <Link
              key={m}
              href={`/fechamento?mes=${m.slice(0, 7)}`}
              aria-current={m === month ? "page" : undefined}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-muted transition aria-[current=page]:border-brand aria-[current=page]:bg-brand-soft aria-[current=page]:font-medium aria-[current=page]:text-brand"
            >
              <span aria-hidden className={cx("h-2 w-2 rounded-full", p?.status === "fechado" ? "bg-income" : "bg-line")} />
              {monthLabel(m)}
              <span className="sr-only">{p?.status === "fechado" ? "(fechado)" : "(aberto)"}</span>
            </Link>
          );
        })}
      </nav>

      <Card
        title={monthLabel(month, true).replace(/^./, (c) => c.toUpperCase())}
        actions={closed ? <Badge tone="good">Fechado</Badge> : <Badge tone="warn">Aberto</Badge>}
      >
        {closed ? (
          <p className="text-sm text-muted">
            Fechado em {formatDateTimeBR(period?.closed_at, ctx.org.timezone)}.
            {period?.reopened_at && ` Já foi reaberto antes: ${period.reopen_reason}`}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {items.map((i) => {
                const meta = CHECKS[i.item];
                if (!meta) return null;
                const pending = Number(i.pending);
                return (
                  <li key={i.item} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2.5 text-sm">
                      <span aria-hidden className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold", pending ? (i.blocking ? "bg-red-50 text-expense" : "bg-warn-bg text-warn") : "bg-green-50 text-income")}>
                        {pending ? "!" : "✓"}
                      </span>
                      <span className={pending ? "font-medium" : "text-muted"}>{pending ? `${meta.label}: ${pending}` : meta.ok}</span>
                    </span>
                    {pending > 0 && (
                      <Link href={meta.href} className="shrink-0 text-sm text-brand underline">{meta.action}</Link>
                    )}
                  </li>
                );
              })}
            </ul>
            {items.some((i) => i.blocking && Number(i.pending) > 0) && (
              <div className="mt-3"><Notice tone="bad">Feche os caixas abertos antes de fechar o mês.</Notice></div>
            )}
            {ctx.can.manage ? (
              <div className="mt-4"><CloseThisMonthForm month={month} warnings={warnings} /></div>
            ) : (
              <p className="mt-4 text-sm text-muted">Quem fecha o mês é o administrador ou o tesoureiro.</p>
            )}
          </>
        )}
        {closed && ctx.can.manage && (
          <div className="mt-4 border-t border-line pt-4"><ReopenThisMonthForm month={month} /></div>
        )}
      </Card>

      <Card title={`Saldos no fim de ${monthLabel(month, true)}`}>
        <ul className="divide-y divide-line">
          {rows.map((b) => (
            <li key={b.account_id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <Link href={`/contas/${b.account_id}`} className="min-w-0 truncate text-brand underline">{b.name}</Link>
              <Money cents={b.balance_cents} className="font-medium" />
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 py-2.5 text-sm font-semibold">
            <span>Total</span>
            <Money cents={total} />
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted">Compare cada saldo com o extrato do banco no último dia do mês antes de fechar.</p>
      </Card>
    </>
  );
}
