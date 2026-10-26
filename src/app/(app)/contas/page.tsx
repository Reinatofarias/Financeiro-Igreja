import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { ACCOUNT_KIND_LABEL, PROVIDER_LABEL } from "@/lib/finance/lookups";
import type { AccountBalance } from "@/lib/finance/reports";
import { formatDateBR, todayIn } from "@/lib/dates";
import { Badge, Card, EmptyState, Money, PageHeader, Table } from "@/components/ui";
import { NewAccountForm } from "./account-forms";

export const metadata: Metadata = { title: "Contas e saldos" };

export default async function AccountsPage() {
  const ctx = await requireContext();
  const supabase = await createClient();
  const [{ data }, { data: summary }] = await Promise.all([
    supabase.rpc("account_balances", { p_org: ctx.org.id, p_as_of: null }),
    supabase.rpc("balance_summary", { p_org: ctx.org.id, p_as_of: null }).single(),
  ]);
  const rows = (data ?? []) as AccountBalance[];
  const s = summary as { total_cents: number; in_transit_cents: number } | null;

  return (
    <>
      <PageHeader title="Contas e saldos" description="Cada conta tem saldo e histórico próprios. Os saldos abaixo são calculados pelo sistema." />
      {rows.length === 0 ? (
        <EmptyState title="Nenhuma conta cadastrada">Cadastre as contas Mercado Pago, Cora, PagBank e o caixa físico.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr><th>Conta</th><th>Tipo</th><th>Integração</th><th>Último movimento</th><th>Origem do saldo</th><th className="text-right">Saldo atual</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.account_id} className={r.is_active ? "" : "text-muted"}>
                <td><Link className="text-brand underline" href={`/contas/${r.account_id}`}>{r.name}</Link>{!r.is_active && <span className="ml-2"><Badge>Desativada</Badge></span>}</td>
                <td>{ACCOUNT_KIND_LABEL[r.kind as keyof typeof ACCOUNT_KIND_LABEL]}</td>
                <td>{PROVIDER_LABEL[r.provider]} {r.provider !== "manual" && <Badge>Não conectada (Fase 3)</Badge>}</td>
                <td>{formatDateBR(r.last_movement)}</td>
                <td>Calculado</td>
                <td className="text-right font-medium"><Money cents={r.balance_cents} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {s && s.in_transit_cents !== 0 && (
              <tr><td colSpan={5}>Transferências em trânsito</td><td className="text-right"><Money cents={s.in_transit_cents} /></td></tr>
            )}
            <tr className="font-semibold"><td colSpan={5}>Saldo consolidado</td><td className="text-right"><Money cents={s?.total_cents ?? 0} /></td></tr>
          </tfoot>
        </Table>
      )}
      {ctx.can.manage && (
        <Card title="Cadastrar conta">
          <NewAccountForm today={todayIn(ctx.org.timezone)} />
        </Card>
      )}
    </>
  );
}
