"use client";

import { useActionState, useMemo, useState } from "react";
import { ignoreLines, importStatement, matchLine, postLines, reopenLine, syncNow, undoImport } from "./actions";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input, Select, buttonStyles, cx } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { formatDateBR } from "@/lib/dates";

type Opt = { id: string; name: string };
type CatOpt = { id: string; label: string };

export function ImportForm({ accounts, defaultAccount }: { accounts: Opt[]; defaultAccount?: string }) {
  const [state, action] = useActionState(importStatement, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Conta do extrato" htmlFor="imp-account">
          <Select id="imp-account" name="account_id" required defaultValue={defaultAccount ?? ""}>
            <option value="">Escolha a conta</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Arquivo" htmlFor="imp-file" hint="CSV do Mercado Pago (extrato da conta ou liberações) ou OFX do banco.">
          <Input id="imp-file" name="file" type="file" accept=".csv,.ofx,.txt,text/csv,application/x-ofx" required className="py-1.5" />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton>Importar extrato</SubmitButton>
    </form>
  );
}

export type PendingLine = {
  id: string;
  posted_date: string;
  description: string | null;
  gross_cents: number | null;
  fee_cents: number;
  net_cents: number;
};
export type Candidate = { line_id: string; entry_id: string; number: number; cash_date: string; description: string };

export function PendingWorkbench({
  lines, candidates, income, expense, funds, ministries, projects, canOperate,
}: {
  lines: PendingLine[];
  candidates: Candidate[];
  income: CatOpt[];
  expense: CatOpt[];
  funds: Opt[];
  ministries: Opt[];
  projects: Opt[];
  canOperate: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [postState, postAction] = useActionState(postLines, null);
  const [ignoreState, ignoreAction] = useActionState(ignoreLines, null);
  const byLine = useMemo(() => {
    const m = new Map<string, Candidate[]>();
    for (const c of candidates) m.set(c.line_id, [...(m.get(c.line_id) ?? []), c]);
    return m;
  }, [candidates]);

  const chosen = lines.filter((l) => selected.has(l.id));
  const total = chosen.reduce((s, l) => s + l.net_cents, 0);
  const hasIn = chosen.some((l) => l.net_cents > 0);
  const hasOut = chosen.some((l) => l.net_cents < 0);
  const mixed = hasIn && hasOut;
  const cats = hasOut && !hasIn ? expense : income;

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pick = (pred: (l: PendingLine) => boolean) => setSelected(new Set(lines.filter(pred).map((l) => l.id)));
  const hidden = chosen.map((l) => <input key={l.id} type="hidden" name="line_id" value={l.id} />);

  return (
    <div className="space-y-4">
      {canOperate && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Selecionar:</span>
          <button type="button" className={buttonStyles.secondary} onClick={() => pick((l) => l.net_cents > 0 && !byLine.has(l.id))}>Entradas sem sugestão</button>
          <button type="button" className={buttonStyles.secondary} onClick={() => pick((l) => l.net_cents < 0 && !byLine.has(l.id))}>Saídas sem sugestão</button>
          <button type="button" className={buttonStyles.ghost} onClick={() => setSelected(new Set())}>Limpar seleção</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm [&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_th]:bg-bg [&_th]:px-3 [&_th]:py-2 [&_th:not(.text-right)]:text-left [&_th]:font-medium [&_th]:text-muted">
          <thead>
            <tr>
              {canOperate && <th className="w-8"><span className="sr-only">Selecionar</span></th>}
              <th>Data</th>
              <th>Descrição no extrato</th>
              <th className="text-right">Tarifa</th>
              <th className="text-right">Valor</th>
              <th>Sugestão</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const sugg = byLine.get(l.id) ?? [];
              return (
                <tr key={l.id} className={cx(selected.has(l.id) && "bg-rose-50/60")}>
                  {canOperate && (
                    <td>
                      <input type="checkbox" aria-label={`Selecionar movimento de ${formatDateBR(l.posted_date)}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                    </td>
                  )}
                  <td className="whitespace-nowrap">{formatDateBR(l.posted_date)}</td>
                  <td className="min-w-48">{l.description ?? "—"}</td>
                  <td className="num text-right text-muted">{l.fee_cents ? formatBRL(l.fee_cents) : ""}</td>
                  <td className={cx("num text-right font-medium", l.net_cents > 0 ? "text-income" : "text-expense")}>{formatBRL(l.net_cents)}</td>
                  <td>
                    {sugg.length === 0 ? <span className="text-muted">—</span> : (
                      <div className="flex flex-col gap-1">
                        {sugg.map((c) => <MatchButton key={c.entry_id} lineId={l.id} candidate={c} disabled={!canOperate} />)}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canOperate && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <form action={postAction} className="space-y-3 rounded-xl border border-line bg-surface p-4">
            {hidden}
            <p className="text-sm font-semibold">Lançar os selecionados</p>
            <p className="text-sm text-muted">
              {chosen.length === 0 ? "Marque os movimentos na lista." : `${chosen.length} movimento(s), total ${formatBRL(total)}.`}
              {" "}Cada movimento vira um lançamento com a mesma classificação. Entradas com tarifa entram pelo valor bruto, com a tarifa separada.
            </p>
            {mixed ? (
              <p className="text-sm text-expense" role="alert">A seleção tem entradas e saídas. Lance as entradas e as saídas separadamente.</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Categoria" htmlFor="post-cat">
                    <Select id="post-cat" name="category_id" required defaultValue="" key={hasOut ? "out" : "in"}>
                      <option value="">Escolha a categoria</option>
                      {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Descrição" htmlFor="post-desc">
                    <Input id="post-desc" name="description" required maxLength={240} key={hasOut ? "out" : "in"}
                      defaultValue={hasOut ? "" : "Dízimos e ofertas via Pix"} />
                  </Field>
                  <Field label="Fundo" htmlFor="post-fund">
                    <Select id="post-fund" name="fund_id"><option value="">Recurso livre</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>
                  </Field>
                  <Field label="Ministério" htmlFor="post-min">
                    <Select id="post-min" name="ministry_id"><option value="">—</option>{ministries.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>
                  </Field>
                  {projects.length > 0 && (
                    <Field label="Projeto" htmlFor="post-proj">
                      <Select id="post-proj" name="project_id"><option value="">—</option>{projects.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>
                    </Field>
                  )}
                </div>
                <FormMessage state={postState} />
                <SubmitButton>Lançar selecionados</SubmitButton>
              </>
            )}
          </form>

          <form action={ignoreAction} className="space-y-3 rounded-xl border border-line bg-surface p-4">
            {hidden}
            <p className="text-sm font-semibold">Ignorar os selecionados</p>
            <p className="text-sm text-muted">Para movimentos que já estão no saldo inicial ou que não são da igreja. Fica registrado quem ignorou e por quê.</p>
            <Field label="Motivo" htmlFor="ign-reason">
              <Input id="ign-reason" name="reason" required minLength={3} maxLength={240} placeholder="Ex.: já incluído no saldo inicial" />
            </Field>
            <FormMessage state={ignoreState} />
            <SubmitButton variant="secondary">Ignorar selecionados</SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}

function MatchButton({ lineId, candidate, disabled }: { lineId: string; candidate: Candidate; disabled: boolean }) {
  const [state, action] = useActionState(matchLine, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="line_id" value={lineId} />
      <input type="hidden" name="entry_id" value={candidate.entry_id} />
      <button type="submit" disabled={disabled} className="text-left text-sm text-brand underline disabled:no-underline disabled:opacity-60"
        title={candidate.description}>
        Casar com nº {candidate.number} ({formatDateBR(candidate.cash_date)})
      </button>
      {state && !state.ok && <span className="text-xs text-expense" role="alert">{state.message}</span>}
    </form>
  );
}

export function ReopenButton({ lineId }: { lineId: string }) {
  const [state, action] = useActionState(reopenLine, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="line_id" value={lineId} />
      <SubmitButton variant="ghost">Voltar para pendente</SubmitButton>
      {state && !state.ok && <span className="text-xs text-expense" role="alert">{state.message}</span>}
    </form>
  );
}

export function UndoImportButton({ importId, fileName }: { importId: string; fileName: string }) {
  const [state, action] = useActionState(undoImport, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="import_id" value={importId} />
      <SubmitButton variant="ghost" confirm={`Desfazer a importação de "${fileName}"? Os movimentos pendentes deste arquivo serão removidos.`}>Desfazer</SubmitButton>
      {state && <span className={cx("text-xs", state.ok ? "text-income" : "text-expense")} role={state.ok ? "status" : "alert"}>{state.message}</span>}
    </form>
  );
}

export function SyncButton({ integrationId }: { integrationId: string }) {
  const [state, action] = useActionState(syncNow, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="integration_id" value={integrationId} />
      <SubmitButton variant="secondary">Sincronizar agora</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
