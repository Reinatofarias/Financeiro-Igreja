import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { categoryOptions, loadLookups, PROVIDER_LABEL } from "@/lib/finance/lookups";
import { formatDateBR, formatDateTimeBR } from "@/lib/dates";
import { Badge, Card, EmptyState, Money, Notice, PageHeader, Table, cx } from "@/components/ui";
import { ImportForm, PendingWorkbench, ReopenButton, SyncButton, UndoImportButton, type Candidate, type PendingLine } from "./forms";

export const metadata: Metadata = { title: "Conciliação" };
// "Sincronizar agora" espera o Mercado Pago gerar o relatório.
export const maxDuration = 60;
const STATUSES = { pendente: "Pendentes", conciliado: "Conciliados", ignorado: "Ignorados" } as const;
type Status = keyof typeof STATUSES;
const LIMIT = 300;

type Summary = { financial_account_id: string; pending: number; pending_in_cents: number; pending_out_cents: number; reconciled: number; ignored: number; last_line_date: string | null; last_import_at: string | null };

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  if (!ctx.can.seeStatements) {
    return <EmptyState title="Acesso restrito">{ctx.needsMfa ? "Ative a verificação em duas etapas para ver os extratos." : "Os extratos trazem nomes de quem fez Pix. Só administrador, tesoureiro, operador e auditor veem esta tela."}</EmptyState>;
  }
  const sp = await searchParams;
  const supabase = await createClient();
  const lookups = await loadLookups(ctx.org.id);
  const accounts = lookups.accounts.filter((a) => a.kind !== "caixa_fisico" && a.is_active);
  const { data: summaryData } = await supabase.rpc("reconciliation_summary", { p_org: ctx.org.id });
  const summary = new Map(((summaryData ?? []) as Summary[]).map((s) => [s.financial_account_id, s]));

  const firstPending = accounts.find((a) => (summary.get(a.id)?.pending ?? 0) > 0);
  const accountId = accounts.some((a) => a.id === sp.conta) ? sp.conta! : (firstPending ?? accounts[0])?.id;
  const status: Status = sp.status && sp.status in STATUSES ? (sp.status as Status) : "pendente";
  const account = accounts.find((a) => a.id === accountId);

  if (!account) {
    return (
      <>
        <PageHeader title="Conciliação" description="Compare o extrato do banco com os lançamentos do sistema." />
        <EmptyState title="Nenhuma conta bancária ou digital cadastrada">Cadastre as contas em <Link className="underline" href="/contas">Contas e saldos</Link> para importar extratos.</EmptyState>
      </>
    );
  }

  const [linesRes, candRes, importRes, integRes] = await Promise.all([
    supabase
      .from("statement_lines")
      .select("id, posted_date, description, gross_cents, fee_cents, net_cents, status, entry_id, created_entry, ignore_reason, resolved_at, journal_entries(number)")
      .eq("financial_account_id", account.id)
      .eq("status", status)
      .order("posted_date", { ascending: status === "pendente" })
      .order("created_at")
      .limit(LIMIT),
    status === "pendente" ? supabase.rpc("statement_match_candidates_for_account", { p_account: account.id }) : Promise.resolve({ data: [] }),
    supabase
      .from("statement_imports")
      .select("id, file_name, source, period_start, period_end, lines_total, lines_new, opening_balance_cents, closing_balance_cents, created_at")
      .eq("financial_account_id", account.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("integrations").select("id, enabled, last_run_at, last_status, last_message").eq("financial_account_id", account.id).maybeSingle(),
  ]);
  const integ = integRes.data;
  type Row = PendingLine & { status: Status; entry_id: string | null; created_entry: boolean; ignore_reason: string | null; resolved_at: string | null; journal_entries: { number: number } | { number: number }[] | null };
  const lines = ((linesRes.data ?? []) as unknown as Row[]).map((l) => ({
    ...l,
    entry_number: Array.isArray(l.journal_entries) ? l.journal_entries[0]?.number : l.journal_entries?.number,
  }));
  const imports = importRes.data ?? [];
  const accSummary = summary.get(account.id);

  // Saldo do banco (último arquivo com saldo final) comparado com o saldo do sistema na mesma data.
  const lastWithBalance = imports.find((i) => i.closing_balance_cents !== null && i.period_end);
  let systemAtBankDate: number | null = null;
  if (lastWithBalance) {
    const { data } = await supabase.rpc("account_balances", { p_org: ctx.org.id, p_as_of: lastWithBalance.period_end });
    systemAtBankDate = ((data ?? []) as { account_id: string; balance_cents: number }[]).find((r) => r.account_id === account.id)?.balance_cents ?? null;
  }
  const diff = lastWithBalance && systemAtBankDate !== null ? Number(lastWithBalance.closing_balance_cents) - systemAtBankDate : null;
  const tab = (s: Status) => `/conciliacao?conta=${account.id}&status=${s}`;

  return (
    <>
      <PageHeader title="Conciliação" description="Importe o extrato, confira cada movimento e deixe o saldo do sistema igual ao do banco." />

      <nav aria-label="Contas" className="mb-4 flex flex-wrap gap-2">
        {accounts.map((a) => {
          const s = summary.get(a.id);
          const active = a.id === account.id;
          return (
            <Link key={a.id} href={`/conciliacao?conta=${a.id}`} aria-current={active ? "page" : undefined}
              className={cx("rounded-md border px-3 py-2 text-sm", active ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface hover:bg-bg")}>
              <span className="font-medium">{a.name}</span>
              <span className={cx("ml-2", active ? "opacity-90" : "text-muted")}>{s?.pending ? `${s.pending} pendente(s)` : s?.last_import_at ? "em dia" : "sem extrato"}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title="Importar extrato">
          <ImportForm accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} defaultAccount={account.id} />
          {integ?.enabled && (
            <div className="mt-4 space-y-2 border-t border-line pt-3 text-sm">
              <p className="font-medium">Sincronização automática com o Mercado Pago</p>
              <p className="text-muted">
                {integ.last_run_at ? `Última: ${formatDateTimeBR(integ.last_run_at, ctx.org.timezone)}. ${integ.last_message ?? ""}` : "Ainda não sincronizou."}
              </p>
              {ctx.can.operate && <SyncButton integrationId={integ.id} />}
            </div>
          )}
          <p className="mt-3 text-xs text-muted">
            Mercado Pago: Seu negócio › Relatórios › Extrato da conta (CSV). Cora e PagBank: exporte o extrato em OFX.
            Pode importar o mesmo período de novo: movimentos já importados são ignorados.
            Importou na conta errada? Use Desfazer em Últimas importações.
          </p>
        </Card>
        <Card title={`Situação · ${account.name}`}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted">Pendentes</dt><dd className="text-lg font-semibold">{accSummary?.pending ?? 0}</dd></div>
            <div><dt className="text-muted">Conciliados / ignorados</dt><dd className="text-lg font-semibold">{accSummary?.reconciled ?? 0} / {accSummary?.ignored ?? 0}</dd></div>
            <div><dt className="text-muted">Entradas pendentes</dt><dd><Money cents={accSummary?.pending_in_cents ?? 0} /></dd></div>
            <div><dt className="text-muted">Saídas pendentes</dt><dd><Money cents={accSummary?.pending_out_cents ?? 0} /></dd></div>
          </dl>
          {lastWithBalance && systemAtBankDate !== null && (
            <div className="mt-4 border-t border-line pt-3 text-sm">
              <p className="font-medium">Saldo em {formatDateBR(lastWithBalance.period_end)}</p>
              <div className="mt-1 grid grid-cols-3 gap-2">
                <div><p className="text-muted">No banco</p><Money cents={Number(lastWithBalance.closing_balance_cents)} /></div>
                <div><p className="text-muted">No sistema</p><Money cents={systemAtBankDate} /></div>
                <div><p className="text-muted">Diferença</p><Money cents={diff} className={diff === 0 ? "text-income" : "text-expense"} /></div>
              </div>
              <p className="mt-2 text-xs text-muted">
                {diff === 0 ? "Saldo conferido com o banco." : "A diferença some quando todos os movimentos estiverem conciliados e o saldo inicial da conta estiver certo."}
              </p>
            </div>
          )}
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap gap-4 border-b border-line text-sm">
        {(Object.keys(STATUSES) as Status[]).map((s) => (
          <Link key={s} href={tab(s)} aria-current={s === status ? "page" : undefined}
            className={cx("-mb-px border-b-2 px-1 pb-2", s === status ? "border-brand font-semibold text-brand" : "border-transparent text-muted hover:text-ink")}>
            {STATUSES[s]}
          </Link>
        ))}
      </div>

      {lines.length === LIMIT && <div className="mb-3"><Notice>Mostrando os primeiros {LIMIT} movimentos. Resolva estes para ver os próximos.</Notice></div>}

      {lines.length === 0 ? (
        <EmptyState title={status === "pendente" ? "Nenhum movimento pendente" : `Nenhum movimento ${STATUSES[status].toLowerCase()}`}>
          {status === "pendente" ? "Importe um extrato para começar ou confira as outras abas." : null}
        </EmptyState>
      ) : status === "pendente" ? (
        <PendingWorkbench
          lines={lines.map(({ id, posted_date, description, gross_cents, fee_cents, net_cents }) => ({ id, posted_date, description, gross_cents, fee_cents: Number(fee_cents), net_cents: Number(net_cents) }))}
          candidates={(candRes.data ?? []) as Candidate[]}
          income={categoryOptions(lookups.categories, "receita")}
          expense={categoryOptions(lookups.categories, "despesa")}
          funds={lookups.funds.filter((f) => f.is_active)}
          ministries={lookups.ministries.filter((m) => m.is_active)}
          projects={lookups.projects.filter((p) => p.is_active)}
          canOperate={ctx.can.operate}
        />
      ) : (
        <Table>
          <thead>
            <tr><th>Data</th><th>Descrição no extrato</th><th className="text-right">Valor</th><th>{status === "conciliado" ? "Lançamento" : "Motivo"}</th><th>Resolvido em</th>{ctx.can.manage && <th><span className="sr-only">Ações</span></th>}</tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap">{formatDateBR(l.posted_date)}</td>
                <td>{l.description ?? "—"}</td>
                <td className="text-right"><Money cents={Number(l.net_cents)} colored /></td>
                <td>
                  {status === "conciliado" && l.entry_id ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Link className="text-brand underline" href={`/lancamentos/${l.entry_id}`}>nº {l.entry_number}</Link>
                      <Badge tone={l.created_entry ? "info" : "neutral"}>{l.created_entry ? "criado do extrato" : "casado"}</Badge>
                    </span>
                  ) : l.ignore_reason}
                </td>
                <td className="whitespace-nowrap text-muted">{formatDateTimeBR(l.resolved_at, ctx.org.timezone)}</td>
                {ctx.can.manage && <td>{l.created_entry ? <span className="text-xs text-muted">Para desfazer, estorne o lançamento</span> : <ReopenButton lineId={l.id} />}</td>}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {imports.length > 0 && (
        <Card title="Últimas importações" className="mt-6">
          <ul className="space-y-1 text-sm">
            {imports.map((i) => (
              <li key={i.id} className="flex flex-wrap justify-between gap-2">
                <span>{i.file_name} <span className="text-muted">· {PROVIDER_LABEL[account.provider] ?? ""} {i.period_start ? `· ${formatDateBR(i.period_start)} a ${formatDateBR(i.period_end)}` : ""}</span></span>
                <span className="flex flex-wrap items-center gap-3 text-muted">
                  {i.lines_new} novo(s) de {i.lines_total} · {formatDateTimeBR(i.created_at, ctx.org.timezone)}
                  {ctx.can.operate && <UndoImportButton importId={i.id} fileName={i.file_name} />}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
