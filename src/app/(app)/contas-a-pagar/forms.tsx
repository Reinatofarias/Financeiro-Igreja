"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { cancelBill, createBill, decideBill, payBill, updateBill } from "./actions";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input, MoneyInput, Select, Textarea } from "@/components/ui";
import { formatAmount } from "@/lib/money";

type Opt = { id: string; name: string };
type CatOpt = { id: string; label: string };
export type BillOptions = {
  accounts: (Opt & { isCash: boolean })[];
  income: CatOpt[];
  expense: CatOpt[];
  funds: Opt[];
  ministries: Opt[];
  projects: Opt[];
  contacts: Opt[];
  paymentMethods: Opt[];
};

function Options({ items, empty = "—" }: { items: Opt[]; empty?: string }) {
  return (
    <>
      <option value="">{empty}</option>
      {items.map((i) => (
        <option key={i.id} value={i.id}>{i.name}</option>
      ))}
    </>
  );
}

/** Limpa o formulário depois de salvar com sucesso. */
function useResetOnSuccess(state: { ok: boolean } | null) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

export function NewBillForm({ kind, options, today, threshold }: { kind: "pagar" | "receber"; options: BillOptions; today: string; threshold: number | null }) {
  const [state, action] = useActionState(createBill, null);
  const ref = useResetOnSuccess(state);
  const cats = kind === "pagar" ? options.expense : options.income;
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <input type="hidden" name="kind" value={kind} />
      <div className="sm:col-span-2 lg:col-span-3">
        <Field label="Descrição" htmlFor="b-desc">
          <Input id="b-desc" name="description" required placeholder={kind === "pagar" ? "Ex.: Conta de energia" : "Ex.: Aluguel do salão para evento"} />
        </Field>
      </div>
      <Field label="Valor (R$)" htmlFor="b-amount" hint={kind === "pagar" && threshold !== null ? `A partir de R$ ${formatAmount(threshold)} precisa de aprovação.` : undefined}>
        <MoneyInput id="b-amount" name="amount" required />
      </Field>
      <Field label="Vencimento" htmlFor="b-due">
        <Input id="b-due" name="due_date" type="date" required defaultValue={today} />
      </Field>
      <Field label="Categoria" htmlFor="b-cat">
        <Select id="b-cat" name="category_id" required defaultValue="">
          <option value="">Escolha a categoria</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </Select>
      </Field>
      <Field label={kind === "pagar" ? "Pagar pela conta (previsão)" : "Receber na conta (previsão)"} htmlFor="b-acc">
        <Select id="b-acc" name="account_id"><Options items={options.accounts} empty="Decidir na hora" /></Select>
      </Field>
      {kind === "pagar" && (
        <Field label="Fornecedor / favorecido" htmlFor="b-contact">
          <Select id="b-contact" name="contact_id"><Options items={options.contacts} /></Select>
        </Field>
      )}
      <Field label="Fundo / finalidade" htmlFor="b-fund">
        <Select id="b-fund" name="fund_id"><Options items={options.funds} empty="Recurso livre" /></Select>
      </Field>
      <details className="sm:col-span-2 lg:col-span-3">
        <summary className="cursor-pointer text-sm text-brand">Mais detalhes (ministério, projeto, competência, documento)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Ministério" htmlFor="b-min">
            <Select id="b-min" name="ministry_id"><Options items={options.ministries} /></Select>
          </Field>
          <Field label="Projeto / campanha" htmlFor="b-proj">
            <Select id="b-proj" name="project_id"><Options items={options.projects} /></Select>
          </Field>
          <Field label="Competência" htmlFor="b-comp" hint="Mês a que a conta se refere. Em branco, usa o vencimento.">
            <Input id="b-comp" name="competence_date" type="date" />
          </Field>
          <Field label="Nº do documento / boleto" htmlFor="b-doc">
            <Input id="b-doc" name="document_ref" maxLength={80} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Observações" htmlFor="b-notes">
              <Textarea id="b-notes" name="notes" maxLength={1000} />
            </Field>
          </div>
        </div>
      </details>
      <div className="group/rep flex min-h-10 flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="repeat_on" className="h-4 w-4 accent-[var(--brand)]" />
          Repetir todo mês
        </label>
        <label className="hidden items-center gap-2 text-sm group-has-[:checked]/rep:flex">
          por
          <Input name="repeat" type="number" min={2} max={36} defaultValue={12} className="w-20" />
          meses
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
        <SubmitButton>{kind === "pagar" ? "Cadastrar conta a pagar" : "Cadastrar conta a receber"}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function PayBillForm({ bill, options, today }: { bill: { id: string; kind: string; amount_cents: number; financial_account_id: string | null }; options: BillOptions; today: string }) {
  const [state, action] = useActionState(payBill, null);
  const [account, setAccount] = useState(bill.financial_account_id ?? "");
  const isCash = options.accounts.find((a) => a.id === account)?.isCash;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="id" value={bill.id} />
      <input type="hidden" name="kind" value={bill.kind} />
      <Field label={bill.kind === "pagar" ? "Pago pela conta" : "Recebido na conta"} htmlFor={`p-acc-${bill.id}`} hint={isCash ? "Em dinheiro: o caixa precisa estar aberto." : undefined}>
        <Select id={`p-acc-${bill.id}`} name="account_id" required value={account} onChange={(e) => setAccount(e.target.value)}>
          <Options items={options.accounts} empty="Escolha a conta" />
        </Select>
      </Field>
      <Field label="Data" htmlFor={`p-date-${bill.id}`}>
        <Input id={`p-date-${bill.id}`} name="paid_date" type="date" required defaultValue={today} />
      </Field>
      <Field label="Valor (R$)" htmlFor={`p-amount-${bill.id}`} hint="Mude se pagou com juros ou desconto.">
        <MoneyInput id={`p-amount-${bill.id}`} name="amount" defaultValue={formatAmount(bill.amount_cents)} />
      </Field>
      {bill.kind === "receber" ? (
        <Field label="Tarifa (R$)" htmlFor={`p-fee-${bill.id}`}>
          <MoneyInput id={`p-fee-${bill.id}`} name="fee" />
        </Field>
      ) : (
        <Field label="Forma de pagamento" htmlFor={`p-pm-${bill.id}`}>
          <Select id={`p-pm-${bill.id}`} name="payment_method_id"><Options items={options.paymentMethods} /></Select>
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <SubmitButton>{bill.kind === "pagar" ? "Confirmar pagamento" : "Confirmar recebimento"}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function DecideBillForm({ id }: { id: string }) {
  const [state, action] = useActionState(decideBill, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <Field label="Observação" htmlFor={`d-notes-${id}`} hint="Obrigatória para recusar.">
        <Input id={`d-notes-${id}`} name="notes" maxLength={500} placeholder="Ex.: conforme orçamento aprovado" />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <button name="decision" value="aprovar" className="inline-flex min-h-10 items-center rounded-lg bg-income px-4 text-sm font-medium text-white shadow-sm hover:brightness-110">
          Aprovar
        </button>
        <button name="decision" value="recusar" className="inline-flex min-h-10 items-center rounded-lg border border-red-200 bg-red-50 px-4 text-sm font-medium text-expense hover:bg-red-100">
          Recusar
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function EditBillForm({ bill }: { bill: { id: string; description: string; amount_cents: number; due_date: string } }) {
  const [state, action] = useActionState(updateBill, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
      <input type="hidden" name="id" value={bill.id} />
      <Field label="Descrição" htmlFor={`e-desc-${bill.id}`}>
        <Input id={`e-desc-${bill.id}`} name="description" required defaultValue={bill.description} />
      </Field>
      <Field label="Valor (R$)" htmlFor={`e-amount-${bill.id}`}>
        <MoneyInput id={`e-amount-${bill.id}`} name="amount" required defaultValue={formatAmount(bill.amount_cents)} />
      </Field>
      <Field label="Vencimento" htmlFor={`e-due-${bill.id}`}>
        <Input id={`e-due-${bill.id}`} name="due_date" type="date" required defaultValue={bill.due_date} />
      </Field>
      <SubmitButton variant="secondary">Salvar</SubmitButton>
      <div className="sm:col-span-4"><FormMessage state={state} /></div>
    </form>
  );
}

export function CancelBillForm({ id, kind, inSeries }: { id: string; kind: string; inSeries: boolean }) {
  const [state, action] = useActionState(cancelBill, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="kind" value={kind} />
      <Field label="Motivo do cancelamento" htmlFor={`c-reason-${id}`}>
        <Input id={`c-reason-${id}`} name="reason" required minLength={5} maxLength={500} />
      </Field>
      {inSeries && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="rest" className="h-4 w-4 accent-[var(--brand)]" /> Cancelar também as próximas desta série
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton variant="danger" confirm="Cancelar esta conta?">Cancelar conta</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
