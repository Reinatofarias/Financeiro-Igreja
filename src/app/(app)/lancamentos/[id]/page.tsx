import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { ENTRY_KIND_LABEL, ORIGIN_LABEL, kindTone } from "@/lib/finance/labels";
import { formatDateBR, formatDateTimeBR, todayIn } from "@/lib/dates";
import { Badge, Card, Money, Notice, PageHeader, Table } from "@/components/ui";
import { ArrivalForm, AttachmentForm, ReverseForm } from "./entry-actions";

export const metadata: Metadata = { title: "Lançamento" };

type Line = {
  line_no: number; amount_cents: number; memo: string | null;
  ledger_accounts: { kind: string; name: string } | null;
  funds: { name: string } | null; ministries: { name: string } | null; projects: { name: string } | null; cost_centers: { name: string } | null;
};

export default async function EntryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();

  const { data: e } = await supabase
    .from("journal_entries")
    .select("*, contacts(name), payment_methods(name), counterpart:financial_accounts!journal_entries_counterpart_fk(name)")
    .eq("id", id)
    .maybeSingle();
  if (!e) notFound();

  const [{ data: lines }, { data: reversal }, { data: attachments }, { data: group }, { data: creator }] = await Promise.all([
    supabase.from("journal_lines").select("line_no, amount_cents, memo, ledger_accounts(kind, name), funds(name), ministries(name), projects(name), cost_centers(name)").eq("entry_id", id).order("line_no"),
    supabase.from("journal_entries").select("id, number, reversal_reason, cash_date").eq("reverses_entry_id", id).maybeSingle(),
    supabase.from("attachments").select("id, file_name, storage_path, size_bytes, uploaded_at").eq("entry_id", id).order("uploaded_at"),
    e.transfer_group_id
      ? supabase.from("journal_entries").select("id, number, kind, description, cash_date, status").eq("transfer_group_id", e.transfer_group_id).neq("id", id)
      : Promise.resolve({ data: [] as { id: string; number: number; kind: string; description: string; cash_date: string; status: string }[] }),
    e.created_by ? supabase.from("profiles").select("full_name, email").eq("id", e.created_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const links = await Promise.all(
    (attachments ?? []).map(async (a) => {
      const { data } = await supabase.storage.from("comprovantes").createSignedUrl(a.storage_path, 300);
      return { ...a, url: data?.signedUrl ?? null };
    }),
  );

  const isTransitSend = !!e.counterpart_account_id && e.status === "confirmado";
  const arrived = (group ?? []).some((g) => g.kind === "transferencia" && g.status === "confirmado");
  const canReverse = ctx.can.manage && e.status === "confirmado" && e.kind !== "estorno";
  const total = (lines as Line[] | null ?? []).reduce((s, l) => s + Math.abs(l.amount_cents), 0) / 2;

  return (
    <>
      <PageHeader
        title={`Lançamento nº ${e.number}`}
        description={e.description}
        actions={<Link href="/lancamentos" className="text-sm text-brand underline">Voltar para a lista</Link>}
      />
      {sp.criado && <Notice tone="info">Lançamento registrado.</Notice>}
      {sp.estorno && <Notice tone="info">Estorno registrado. O lançamento original foi preservado e marcado como estornado.</Notice>}
      {e.status === "estornado" && (
        <Notice>
          Este lançamento foi estornado{reversal ? <> em {formatDateBR(reversal.cash_date)} (<Link className="underline" href={`/lancamentos/${reversal.id}`}>nº {reversal.number}</Link>). Motivo: {reversal.reversal_reason}</> : "."}
        </Notice>
      )}
      {e.reverses_entry_id && (
        <Notice tone="info">
          Este é um estorno do <Link className="underline" href={`/lancamentos/${e.reverses_entry_id}`}>lançamento original</Link>. Motivo: {e.reversal_reason}
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Dados" className="lg:col-span-2">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Tipo</dt><dd><Badge tone={kindTone(e.kind)}>{ENTRY_KIND_LABEL[e.kind]}</Badge></dd></div>
            <div><dt className="text-muted">Valor</dt><dd className="text-lg font-semibold"><Money cents={total} /></dd></div>
            <div><dt className="text-muted">Data do pagamento/recebimento</dt><dd>{formatDateBR(e.cash_date)}</dd></div>
            <div><dt className="text-muted">Competência</dt><dd>{formatDateBR(e.competence_date)}</dd></div>
            {e.due_date && <div><dt className="text-muted">Vencimento</dt><dd>{formatDateBR(e.due_date)}</dd></div>}
            {e.available_date && <div><dt className="text-muted">Disponível em</dt><dd>{formatDateBR(e.available_date)}</dd></div>}
            <div><dt className="text-muted">Registrado via</dt><dd>{ORIGIN_LABEL[e.origin]}</dd></div>
            {e.payment_methods && <div><dt className="text-muted">Forma</dt><dd>{(e.payment_methods as { name: string }).name}</dd></div>}
            {e.contacts && <div><dt className="text-muted">Fornecedor/favorecido</dt><dd>{(e.contacts as { name: string }).name}</dd></div>}
            {e.donor_id && <div><dt className="text-muted">Doador</dt><dd>Identificado (restrito)</dd></div>}
            {e.document_ref && <div><dt className="text-muted">Comprovante nº</dt><dd>{e.document_ref}</dd></div>}
            {e.counterpart && <div><dt className="text-muted">Destino (em trânsito)</dt><dd>{(e.counterpart as { name: string }).name}</dd></div>}
            <div><dt className="text-muted">Registrado por</dt><dd>{creator?.full_name ?? creator?.email ?? "—"} em {formatDateTimeBR(e.created_at, ctx.org.timezone)}</dd></div>
            {e.notes && <div className="sm:col-span-2"><dt className="text-muted">Observações</dt><dd className="whitespace-pre-wrap">{e.notes}</dd></div>}
          </dl>
        </Card>
        <Card title="Comprovantes">
          {links.length === 0 ? <p className="text-sm text-muted">Nenhum comprovante anexado.</p> : (
            <ul className="space-y-1 text-sm">
              {links.map((a) => (
                <li key={a.id}>
                  {a.url ? <a className="text-brand underline" href={a.url} target="_blank" rel="noreferrer">{a.file_name}</a> : a.file_name}
                  <span className="text-muted"> · {Math.max(1, Math.round(a.size_bytes / 1024)).toLocaleString("pt-BR")} KB</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">Arquivos privados; os links expiram em 5 minutos.</p>
          {ctx.can.operate && <AttachmentForm entryId={e.id} />}
        </Card>
      </div>

      <Card title="Partidas (razão)">
        <Table>
          <thead><tr><th>#</th><th>Conta do razão</th><th>Classificação</th><th className="text-right">Débito</th><th className="text-right">Crédito</th></tr></thead>
          <tbody>
            {(lines as Line[] | null ?? []).map((l) => (
              <tr key={l.line_no}>
                <td>{l.line_no}</td>
                <td>{l.ledger_accounts?.name} <span className="text-xs text-muted">({l.ledger_accounts?.kind})</span>{l.memo && <div className="text-xs text-muted">{l.memo}</div>}</td>
                <td className="text-xs">{[l.funds?.name && `Fundo: ${l.funds.name}`, l.ministries?.name, l.projects?.name, l.cost_centers?.name].filter(Boolean).join(" · ") || "—"}</td>
                <td className="text-right">{l.amount_cents > 0 ? <Money cents={l.amount_cents} /> : ""}</td>
                <td className="text-right">{l.amount_cents < 0 ? <Money cents={-l.amount_cents} /> : ""}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-2 text-xs text-muted">Débitos e créditos sempre somam o mesmo valor. Débito em conta de ativo = entrada de dinheiro; crédito = saída.</p>
      </Card>

      {(group ?? []).length > 0 && (
        <Card title="Transferência relacionada">
          <ul className="text-sm">
            {(group ?? []).map((g) => <li key={g.id}><Link className="text-brand underline" href={`/lancamentos/${g.id}`}>nº {g.number} · {g.description}</Link> · {formatDateBR(g.cash_date)}</li>)}
          </ul>
        </Card>
      )}

      {isTransitSend && !arrived && ctx.can.operate && (
        <Card title="Confirmar chegada"><ArrivalForm entryId={e.id} today={todayIn(ctx.org.timezone)} /></Card>
      )}
      {canReverse && (
        <Card title="Estornar">
          <ReverseForm entryId={e.id} today={todayIn(ctx.org.timezone)} />
        </Card>
      )}
    </>
  );
}
