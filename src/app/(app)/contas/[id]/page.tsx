import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/lib/finance/filters";
import { ACCOUNT_KIND_LABEL, PROVIDER_LABEL } from "@/lib/finance/lookups";
import { ENTRY_KIND_LABEL } from "@/lib/finance/labels";
import { formatDateBR, formatDateTimeBR, periodLabel } from "@/lib/dates";
import { Badge, Card, EmptyState, Input, Money, PageHeader, Table, buttonStyles } from "@/components/ui";
import { IntegrationForm, OpeningBalanceForm, ToggleAccountForm } from "../account-forms";
import { hasToken } from "@/lib/integrations/sync";

export const metadata: Metadata = { title: "Extrato da conta" };

type Row = { entry_id: string; number: number; cash_date: string; kind: string; status: string; description: string; amount_cents: number; balance_cents: number };

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const f = parseFilters(await searchParams, ctx.org.timezone);
  const supabase = await createClient();
  const { data: acc } = await supabase.from("financial_accounts").select("id, name, kind, provider, institution, account_hint, opening_date, is_active").eq("id", id).maybeSingle();
  if (!acc) notFound();
  const { data } = await supabase.rpc("account_statement", { p_account: id, p_start: f.start, p_end: f.end });
  const rows = (data ?? []) as Row[];
  const { data: before } = await supabase.rpc("account_balances", { p_org: ctx.org.id, p_as_of: new Date(Date.parse(f.start) - 86400000).toISOString().slice(0, 10) });
  const opening = ((before ?? []) as { account_id: string; balance_cents: number }[]).find((b) => b.account_id === id)?.balance_cents ?? 0;
  const inflow = rows.filter((r) => r.amount_cents > 0).reduce((s, r) => s + r.amount_cents, 0);
  const outflow = rows.filter((r) => r.amount_cents < 0).reduce((s, r) => s - r.amount_cents, 0);
  const isMp = acc.provider === "mercado_pago";
  const { data: integ } = isMp
    ? await supabase.from("integrations").select("id, credential_slot, enabled, last_run_at, last_status, last_message").eq("financial_account_id", id).maybeSingle()
    : { data: null };
  const { data: runs } = integ
    ? await supabase.from("integration_runs").select("id, started_at, trigger, status, message").eq("integration_id", integ.id).order("started_at", { ascending: false }).limit(5)
    : { data: [] };

  return (
    <>
      <PageHeader
        title={acc.name}
        description={`${ACCOUNT_KIND_LABEL[acc.kind as keyof typeof ACCOUNT_KIND_LABEL]} · ${PROVIDER_LABEL[acc.provider]}${acc.account_hint ? ` · ${acc.account_hint}` : ""} · controlada desde ${formatDateBR(acc.opening_date)}`}
        actions={<Link className="text-sm text-brand underline" href="/contas">Todas as contas</Link>}
      />
      <form method="get" className="no-print flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">De<Input type="date" name="inicio" defaultValue={f.start} /></label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">Até<Input type="date" name="fim" defaultValue={f.end} /></label>
        <button className={buttonStyles.secondary}>Ver período</button>
      </form>
      <div className="grid gap-3 sm:grid-cols-4">
        <Card><p className="text-xs text-muted">Saldo anterior</p><p className="text-lg font-semibold"><Money cents={opening} /></p></Card>
        <Card><p className="text-xs text-muted">Entradas</p><p className="text-lg font-semibold text-income"><Money cents={inflow} /></p></Card>
        <Card><p className="text-xs text-muted">Saídas</p><p className="text-lg font-semibold text-expense"><Money cents={outflow} /></p></Card>
        <Card><p className="text-xs text-muted">Saldo final calculado</p><p className="text-lg font-semibold"><Money cents={opening + inflow - outflow} /></p></Card>
      </div>
      <h2 className="text-base font-semibold">Movimentos · {periodLabel(f.start, f.end)}</h2>
      {rows.length === 0 ? (
        <EmptyState title="Nenhum movimento no período" />
      ) : (
        <Table>
          <thead><tr><th>Data</th><th>Nº</th><th>Descrição</th><th>Tipo</th><th className="text-right">Valor</th><th className="text-right">Saldo</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.entry_id}-${i}`}>
                <td className="num">{formatDateBR(r.cash_date)}</td>
                <td className="num">{r.number}</td>
                <td><Link className="text-brand underline" href={`/lancamentos/${r.entry_id}`}>{r.description}</Link></td>
                <td>{ENTRY_KIND_LABEL[r.kind]}{r.status === "estornado" ? " (estornado)" : ""}</td>
                <td className="text-right"><Money cents={r.amount_cents} colored /></td>
                <td className="text-right"><Money cents={r.balance_cents} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {ctx.can.manage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Saldo inicial"><OpeningBalanceForm accountId={acc.id} openingDate={acc.opening_date} /></Card>
          <Card title="Situação"><ToggleAccountForm accountId={acc.id} active={acc.is_active} /></Card>
        </div>
      )}
      {isMp && (ctx.can.manage || integ) && (
        <Card title="Integração com o Mercado Pago">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2 text-sm">
              <p className="text-muted">
                Uma vez por dia o sistema pede ao Mercado Pago o relatório desta conta e coloca os movimentos novos em
                {" "}<Link className="text-brand underline" href={`/conciliacao?conta=${acc.id}`}>Conciliação</Link>, como pendentes.
                Nada é lançado sem alguém do financeiro conferir. O token fica só na Vercel.
              </p>
              {integ?.last_run_at && (
                <p>
                  Última sincronização: {formatDateTimeBR(integ.last_run_at, ctx.org.timezone)}{" "}
                  <Badge tone={integ.last_status === "ok" ? "good" : integ.last_status === "erro" ? "bad" : "warn"}>{integ.last_status}</Badge>
                  <span className="block text-muted">{integ.last_message}</span>
                </p>
              )}
              {(runs ?? []).length > 0 && (
                <ul className="space-y-1 border-t border-line pt-2 text-xs text-muted">
                  {(runs ?? []).map((r) => (
                    <li key={r.id}>{formatDateTimeBR(r.started_at, ctx.org.timezone)} · {r.trigger} · {r.status} · {r.message}</li>
                  ))}
                </ul>
              )}
            </div>
            {ctx.can.manage && (
              <IntegrationForm accountId={acc.id} slot={integ?.credential_slot ?? null} enabled={integ?.enabled ?? true} tokens={[1, 2, 3, 4].map(hasToken)} />
            )}
          </div>
        </Card>
      )}
    </>
  );
}
