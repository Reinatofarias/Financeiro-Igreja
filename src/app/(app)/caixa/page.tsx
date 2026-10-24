import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeBR } from "@/lib/dates";
import type { AccountBalance } from "@/lib/finance/reports";
import { Badge, ButtonLink, Card, EmptyState, Money, PageHeader, Table } from "@/components/ui";
import { CloseCashForm, OpenCashForm, VerifyCashForm } from "./cash-forms";

export const metadata: Metadata = { title: "Caixa físico" };

type Session = {
  id: string; account_id: string; status: string; opened_at: string; opened_by: string; closed_at: string | null; closed_by: string | null;
  opening_counted_cents: number; closing_expected_cents: number | null; closing_counted_cents: number | null; difference_cents: number | null;
  difference_reason: string | null; verified_at: string | null; verified_by: string | null;
};

export default async function CashPage() {
  const ctx = await requireContext();
  const supabase = await createClient();
  const [{ data: balances }, { data: sessions }, { data: people }] = await Promise.all([
    supabase.rpc("account_balances", { p_org: ctx.org.id, p_as_of: null }),
    supabase.from("cash_sessions").select("*").eq("organization_id", ctx.org.id).order("opened_at", { ascending: false }).limit(30),
    supabase.from("profiles").select("id, full_name, email"),
  ]);
  const cash = ((balances ?? []) as AccountBalance[]).filter((b) => b.kind === "caixa_fisico" && b.is_active);
  const list = (sessions ?? []) as Session[];
  const who = (id: string | null) => (people ?? []).find((p) => p.id === id)?.full_name ?? "—";

  if (cash.length === 0) {
    return (
      <>
        <PageHeader title="Caixa físico" />
        <EmptyState title="Nenhum caixa físico cadastrado" action={ctx.can.manage ? <ButtonLink href="/contas">Cadastrar caixa</ButtonLink> : undefined}>
          Cadastre uma conta do tipo &quot;Caixa físico&quot; para controlar dinheiro em espécie.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Caixa físico" description="Abra o caixa antes do culto, lance as entradas e saídas em dinheiro e feche contando as cédulas. Outra pessoa confere." />
      {cash.map((c) => {
        const open = list.find((s) => s.account_id === c.account_id && s.status === "aberto");
        return (
          <Card key={c.account_id} title={c.name} actions={open ? <Badge tone="good">Aberto desde {formatDateTimeBR(open.opened_at, ctx.org.timezone)}</Badge> : <Badge>Fechado</Badge>}>
            <p className="mb-3 text-sm">Saldo calculado agora: <strong><Money cents={c.balance_cents} /></strong></p>
            {!ctx.can.operate ? (
              <p className="text-sm text-muted">Seu perfil não abre nem fecha caixa.</p>
            ) : open ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <ButtonLink href="/lancamentos/novo?tipo=receita" variant="secondary">Entrada em dinheiro</ButtonLink>
                  <ButtonLink href="/lancamentos/novo?tipo=despesa" variant="secondary">Saída em dinheiro</ButtonLink>
                  <ButtonLink href="/lancamentos/novo?tipo=transferencia" variant="secondary">Depositar no banco</ButtonLink>
                </div>
                <CloseCashForm sessionId={open.id} expected={c.balance_cents} />
              </div>
            ) : (
              <OpenCashForm accountId={c.account_id} expected={c.balance_cents} />
            )}
          </Card>
        );
      })}

      <Card title="Histórico de caixas">
        {list.length === 0 ? <p className="text-sm text-muted">Nenhum caixa aberto ainda.</p> : (
          <Table>
            <thead><tr><th>Abertura</th><th>Fechamento</th><th className="text-right">Esperado</th><th className="text-right">Contado</th><th className="text-right">Diferença</th><th>Situação</th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>{formatDateTimeBR(s.opened_at, ctx.org.timezone)}<div className="text-xs text-muted">{who(s.opened_by)}</div></td>
                  <td>{formatDateTimeBR(s.closed_at, ctx.org.timezone)}<div className="text-xs text-muted">{s.closed_by ? who(s.closed_by) : ""}</div></td>
                  <td className="text-right">{s.closing_expected_cents !== null ? <Money cents={s.closing_expected_cents} /> : "—"}</td>
                  <td className="text-right">{s.closing_counted_cents !== null ? <Money cents={s.closing_counted_cents} /> : "—"}</td>
                  <td className="text-right">{s.difference_cents !== null ? <Money cents={s.difference_cents} colored /> : "—"}{s.difference_reason && <div className="text-xs text-muted">{s.difference_reason}</div>}</td>
                  <td>
                    {s.status === "aberto" && <Badge tone="good">Aberto</Badge>}
                    {s.status === "fechado" && (
                      <div className="space-y-1">
                        <Badge tone="warn">Aguardando conferência</Badge>
                        {ctx.can.verifyCash && s.closed_by !== ctx.userId && s.opened_by !== ctx.userId && <VerifyCashForm sessionId={s.id} />}
                      </div>
                    )}
                    {s.status === "conferido" && <Badge tone="info">Conferido por {who(s.verified_by)}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-2 text-xs text-muted">Diferenças viram lançamentos de &quot;Sobra de caixa&quot; ou &quot;Falta de caixa&quot;. <Link className="underline" href="/lancamentos?tipo=ajuste&periodo=ano">Ver ajustes</Link>.</p>
      </Card>
    </>
  );
}
