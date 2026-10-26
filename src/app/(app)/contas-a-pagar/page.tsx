import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { categoryOptions, loadLookups } from "@/lib/finance/lookups";
import { addMonths, formatDateBR, todayIn } from "@/lib/dates";
import { Badge, Card, EmptyState, Money, Notice, PageHeader, Stat, cx } from "@/components/ui";
import { Collapsible } from "@/components/collapsible";
import { CancelBillForm, DecideBillForm, EditBillForm, NewBillForm, PayBillForm, type BillOptions } from "./forms";

export const metadata: Metadata = { title: "Contas a pagar e receber" };

type Bill = {
  id: string;
  kind: "pagar" | "receber";
  description: string;
  amount_cents: number;
  due_date: string;
  status: "aberta" | "paga" | "cancelada";
  approval_status: "dispensada" | "pendente" | "aprovada" | "recusada";
  decision_notes: string | null;
  category_id: string;
  financial_account_id: string | null;
  contact_id: string | null;
  series_id: string | null;
  paid_entry_id: string | null;
  paid_date: string | null;
  canceled_reason: string | null;
  created_by: string | null;
};

const VIEWS = [
  ["abertas", "Em aberto"],
  ["pagas", "Pagas"],
  ["canceladas", "Canceladas"],
] as const;

export default async function BillsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const kind = sp.tipo === "receber" ? "receber" : "pagar";
  const view = VIEWS.some(([v]) => v === sp.ver) ? (sp.ver as (typeof VIEWS)[number][0]) : "abertas";
  const today = todayIn(ctx.org.timezone);
  const week = addDays(today, 7);

  const supabase = await createClient();
  let query = supabase
    .from("bills")
    .select("id, kind, description, amount_cents, due_date, status, approval_status, decision_notes, category_id, financial_account_id, contact_id, series_id, paid_entry_id, paid_date, canceled_reason, created_by")
    .eq("organization_id", ctx.org.id)
    .eq("kind", kind);
  if (view === "abertas") query = query.eq("status", "aberta").order("due_date").limit(300);
  else if (view === "pagas") query = query.eq("status", "paga").gte("paid_date", addMonths(today, -6)).order("paid_date", { ascending: false }).limit(300);
  else query = query.eq("status", "cancelada").order("due_date", { ascending: false }).limit(100);

  const [{ data, error }, lookups, { data: summary }] = await Promise.all([query, loadLookups(ctx.org.id), supabase.rpc("bills_summary", { p_org: ctx.org.id }).single()]);
  const bills = (data ?? []) as Bill[];
  const s = summary as {
    overdue_pay_cents: number; overdue_pay_count: number; week_pay_cents: number; week_pay_count: number;
    overdue_receive_cents: number; week_receive_cents: number; pending_approval_count: number;
  } | null;

  const names = <T extends { id: string; name: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x.name]));
  const accountName = names(lookups.accounts);
  const contactName = names(lookups.contacts);
  const catLabel = new Map([...categoryOptions(lookups.categories, "despesa", false), ...categoryOptions(lookups.categories, "receita", false)].map((c) => [c.id, c.label]));
  const active = <T extends { id: string; name: string; is_active: boolean }>(xs: T[]) => xs.filter((x) => x.is_active).map((x) => ({ id: x.id, name: x.name }));
  const options: BillOptions = {
    accounts: lookups.accounts.filter((a) => a.is_active).map((a) => ({ id: a.id, name: a.name, isCash: a.kind === "caixa_fisico" })),
    income: categoryOptions(lookups.categories, "receita"),
    expense: categoryOptions(lookups.categories, "despesa"),
    funds: lookups.funds.filter((f) => f.is_active).map((f) => ({ id: f.id, name: f.is_restricted ? `${f.name} (vinculado)` : f.name })),
    ministries: active(lookups.ministries),
    projects: active(lookups.projects),
    contacts: active(lookups.contacts),
    paymentMethods: active(lookups.paymentMethods),
  };

  const totalOpen = bills.reduce((acc, b) => acc + (b.status === "aberta" ? b.amount_cents : 0), 0);
  const tab = (k: string) => `/contas-a-pagar?tipo=${k}`;
  const viewHref = (v: string) => `/contas-a-pagar?tipo=${kind}&ver=${v}`;

  return (
    <>
      <PageHeader
        title="Contas a pagar e receber"
        description="Previsões com vencimento. O lançamento só entra no caixa quando a conta é paga ou recebida."
      />

      {sp.ok === "pago" && <Notice tone="info">{kind === "pagar" ? "Pagamento registrado." : "Recebimento registrado."} O lançamento foi criado e a conta está em Pagas.</Notice>}
      {(sp.ok === "cancelada" || sp.ok === "canceladas") && <Notice tone="info">{sp.ok === "canceladas" ? "Contas canceladas." : "Conta cancelada."} O motivo ficou registrado.</Notice>}

      <div className="inline-flex rounded-xl border border-line bg-surface p-1 shadow-sm">
        {[["pagar", "A pagar"], ["receber", "A receber"]].map(([k, label]) => (
          <Link
            key={k}
            href={tab(k)}
            aria-current={kind === k ? "page" : undefined}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted transition aria-[current=page]:bg-brand aria-[current=page]:text-white"
          >
            {label}
          </Link>
        ))}
      </div>

      {s && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {kind === "pagar" ? (
            <>
              <Stat label="Vencidas" tone={s.overdue_pay_count > 0 ? "expense" : undefined} value={<Money cents={s.overdue_pay_cents} />} help={`${s.overdue_pay_count} conta(s) com vencimento já passado.`} />
              <Stat label="Próximos 7 dias" value={<Money cents={s.week_pay_cents} />} help={`${s.week_pay_count} conta(s) vencendo até ${formatDateBR(week)}.`} />
              <Stat label="Aguardando aprovação" value={<span className="num">{s.pending_approval_count}</span>} help={ctx.org.approval_threshold_cents === null ? "Aprovação desligada (Configurações)." : "Despesas que precisam do ok antes de pagar."} />
            </>
          ) : (
            <>
              <Stat label="Atrasadas" tone={s.overdue_receive_cents > 0 ? "expense" : undefined} value={<Money cents={s.overdue_receive_cents} />} help="Valores a receber com vencimento passado." />
              <Stat label="Próximos 7 dias" tone="income" value={<Money cents={s.week_receive_cents} />} help={`A receber até ${formatDateBR(week)}.`} />
              <Stat label="Em aberto nesta lista" value={<Money cents={view === "abertas" ? totalOpen : 0} />} help="Soma das contas a receber em aberto." />
            </>
          )}
        </div>
      )}

      {ctx.can.operate && (
        <Collapsible
          className="group rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(31_26_28/0.04)]"
          summary={
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="font-semibold">{kind === "pagar" ? "Nova conta a pagar" : "Nova conta a receber"}</span>
              <span className="text-xs text-brand group-open:hidden">Abrir</span>
              <span className="hidden text-xs text-brand group-open:inline">Fechar</span>
            </summary>
          }
        >
          <div className="border-t border-line p-4 sm:p-5">
            <NewBillForm kind={kind} options={options} today={today} threshold={ctx.org.approval_threshold_cents} />
          </div>
        </Collapsible>
      )}

      <nav className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]" aria-label="Situação">
        {VIEWS.map(([v, label]) => (
          <Link
            key={v}
            href={viewHref(v)}
            aria-current={view === v ? "page" : undefined}
            className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-muted transition aria-[current=page]:border-brand aria-[current=page]:bg-brand-soft aria-[current=page]:font-medium aria-[current=page]:text-brand"
          >
            {label}
          </Link>
        ))}
      </nav>

      {error ? (
        <EmptyState title="Não foi possível carregar as contas.">Tente novamente em instantes.</EmptyState>
      ) : bills.length === 0 ? (
        <EmptyState title={view === "abertas" ? "Nenhuma conta em aberto" : "Nada por aqui"}>
          {view === "abertas" ? "Cadastre energia, água, aluguel, prebenda e outras contas para acompanhar os vencimentos." : "Mude a situação acima para ver outras contas."}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {bills.map((b) => {
            const overdue = b.status === "aberta" && b.due_date < today;
            const soon = b.status === "aberta" && !overdue && b.due_date <= week;
            const canPay = ctx.can.operate && b.status === "aberta" && (b.approval_status === "dispensada" || b.approval_status === "aprovada");
            const canDecide = ctx.can.approve && b.status === "aberta" && b.approval_status === "pendente" && b.created_by !== ctx.userId;
            return (
              <li key={b.id} className={cx("rounded-xl border bg-surface shadow-[0_1px_2px_rgb(31_26_28/0.04)]", overdue ? "border-red-200" : "border-line")}>
                <div className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-medium">{b.description}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {b.status === "paga" ? `${kind === "pagar" ? "Pago" : "Recebido"} em ${formatDateBR(b.paid_date)}` : `Vence ${formatDateBR(b.due_date)}`}
                      {" · "}
                      {catLabel.get(b.category_id) ?? "—"}
                      {b.contact_id && ` · ${contactName.get(b.contact_id) ?? ""}`}
                      {b.financial_account_id && ` · ${accountName.get(b.financial_account_id) ?? ""}`}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {overdue && <Badge tone="bad">Vencida</Badge>}
                      {soon && <Badge tone="warn">Vence em breve</Badge>}
                      {b.approval_status === "pendente" && <Badge tone="warn">Aguardando aprovação</Badge>}
                      {b.approval_status === "aprovada" && <Badge tone="good">Aprovada</Badge>}
                      {b.approval_status === "recusada" && <Badge tone="bad">Recusada</Badge>}
                      {b.status === "paga" && <Badge tone="good">{kind === "pagar" ? "Paga" : "Recebida"}</Badge>}
                      {b.status === "cancelada" && <Badge>Cancelada</Badge>}
                    </div>
                    {b.approval_status === "recusada" && b.decision_notes && <p className="mt-2 text-xs text-expense">Motivo da recusa: {b.decision_notes}</p>}
                    {b.status === "cancelada" && b.canceled_reason && <p className="mt-2 text-xs text-muted">Motivo: {b.canceled_reason}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <Money cents={b.amount_cents} className={cx("text-base font-semibold", kind === "receber" && "text-income")} />
                    {b.paid_entry_id && (
                      <Link href={`/lancamentos/${b.paid_entry_id}`} className="mt-1 block text-xs text-brand underline">Ver lançamento</Link>
                    )}
                  </div>
                </div>

                {b.status === "aberta" && (ctx.can.operate || canDecide) && (
                  <div className="space-y-px border-t border-line">
                    {canDecide && (
                      <BillAction label="Aprovar ou recusar" open>
                        <DecideBillForm id={b.id} />
                      </BillAction>
                    )}
                    {canPay && (
                      <BillAction label={kind === "pagar" ? "Registrar pagamento" : "Registrar recebimento"} primary>
                        <PayBillForm bill={b} options={options} today={today} />
                      </BillAction>
                    )}
                    {ctx.can.operate && (
                      <>
                        <BillAction label="Ajustar valor ou vencimento">
                          <EditBillForm bill={b} />
                          {b.approval_status !== "dispensada" && <p className="mt-2 text-xs text-muted">Mudar o valor pede nova aprovação.</p>}
                        </BillAction>
                        <BillAction label="Cancelar">
                          <CancelBillForm id={b.id} kind={b.kind} inSeries={!!b.series_id} />
                        </BillAction>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {kind === "pagar" && ctx.org.approval_threshold_cents === null && ctx.can.admin && (
        <Card>
          <p className="text-sm text-muted">
            Quer que despesas acima de um valor precisem de aprovação antes de pagar? Defina o limite em{" "}
            <Link href="/configuracoes" className="text-brand underline">Configurações</Link>.
          </p>
        </Card>
      )}
    </>
  );
}

function BillAction({ label, children, primary, open }: { label: string; children: React.ReactNode; primary?: boolean; open?: boolean }) {
  return (
    <details className="group/a" open={open}>
      <summary className={cx("flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden", primary ? "font-medium text-brand" : "text-muted")}>
        {label}
        <span aria-hidden className="transition group-open/a:rotate-90">›</span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
