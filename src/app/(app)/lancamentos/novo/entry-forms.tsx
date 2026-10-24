"use client";

import { useActionState, useMemo, useState } from "react";
import { createExpense, createIncome, createTransfer } from "../actions";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input, MoneyInput, Select, Textarea, buttonStyles } from "@/components/ui";
import { formatBRL, parseBRLToCents } from "@/lib/money";

type Opt = { id: string; name: string };
type CatOpt = { id: string; label: string };
export type EntryOptions = {
  accounts: (Opt & { isCash: boolean; cashOpen: boolean })[];
  income: CatOpt[];
  expense: CatOpt[];
  funds: Opt[];
  ministries: Opt[];
  projects: Opt[];
  costCenters: Opt[];
  paymentMethods: Opt[];
  contacts: Opt[];
  donors: Opt[];
};

function OptionList({ items, empty = "—" }: { items: Opt[]; empty?: string }) {
  return (
    <>
      <option value="">{empty}</option>
      {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
    </>
  );
}

function AccountSelect({ name, label, options, value, onChange }: { name: string; label: string; options: EntryOptions; value?: string; onChange?: (v: string) => void }) {
  const selected = options.accounts.find((a) => a.id === value);
  return (
    <Field label={label} htmlFor={name} error={selected?.isCash && !selected.cashOpen ? "Este caixa está fechado. Abra o caixa antes de lançar em dinheiro." : undefined}>
      <Select id={name} name={name} required value={value} onChange={(e) => onChange?.(e.target.value)}>
        <option value="">Escolha a conta</option>
        {options.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isCash ? (a.cashOpen ? " (caixa aberto)" : " (caixa fechado)") : ""}</option>)}
      </Select>
    </Field>
  );
}

function Dimensions({ options, prefix = "" }: { options: EntryOptions; prefix?: string }) {
  return (
    <>
      <Field label="Fundo / finalidade" htmlFor={`${prefix}fund_id`} hint="Escolha um fundo vinculado quando o dinheiro tem destino definido.">
        <Select id={`${prefix}fund_id`} name="fund_id"><OptionList items={options.funds} empty="Recurso livre" /></Select>
      </Field>
      <Field label="Ministério" htmlFor={`${prefix}ministry_id`}>
        <Select id={`${prefix}ministry_id`} name="ministry_id"><OptionList items={options.ministries} /></Select>
      </Field>
      <Field label="Projeto / campanha" htmlFor={`${prefix}project_id`}>
        <Select id={`${prefix}project_id`} name="project_id"><OptionList items={options.projects} /></Select>
      </Field>
      {options.costCenters.length > 0 && (
        <Field label="Centro de custo" htmlFor={`${prefix}cost_center_id`}>
          <Select id={`${prefix}cost_center_id`} name="cost_center_id"><OptionList items={options.costCenters} /></Select>
        </Field>
      )}
    </>
  );
}

const grid = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

export function IncomeForm({ options, today }: { options: EntryOptions; today: string }) {
  const [state, action] = useActionState(createIncome, null);
  const [account, setAccount] = useState("");
  const [gross, setGross] = useState("");
  const [fee, setFee] = useState("");
  const net = (parseBRLToCents(gross) ?? 0) - (parseBRLToCents(fee || "0") ?? 0);
  return (
    <form action={action} className="space-y-6">
      <div className={grid}>
        <AccountSelect name="account_id" label="Conta que recebeu" options={options} value={account} onChange={setAccount} />
        <Field label="Categoria" htmlFor="category_id">
          <Select id="category_id" name="category_id" required defaultValue="">
            <option value="">Escolha a categoria</option>
            {options.income.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Descrição" htmlFor="description">
          <Input id="description" name="description" required maxLength={240} placeholder="Ex.: Dízimos do culto de domingo" />
        </Field>
        <Field label="Valor bruto (R$)" htmlFor="gross">
          <MoneyInput id="gross" name="gross" required value={gross} onChange={(e) => setGross(e.target.value)} />
        </Field>
        <Field label="Tarifa cobrada (R$)" htmlFor="fee" hint="Ex.: taxa do Mercado Pago. Deixe vazio se não houve.">
          <MoneyInput id="fee" name="fee" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
        <Field label="Valor líquido na conta">
          <p className="flex min-h-10 items-center rounded-md bg-bg px-3 text-sm num">{formatBRL(net)}</p>
        </Field>
        <Field label="Data do recebimento" htmlFor="cash_date">
          <Input id="cash_date" name="cash_date" type="date" required defaultValue={today} />
        </Field>
        <Field label="Competência" htmlFor="competence_date" hint="Mês a que o valor se refere, se diferente.">
          <Input id="competence_date" name="competence_date" type="date" />
        </Field>
        <Field label="Disponível em" htmlFor="available_date" hint="Quando o provedor libera o dinheiro, se for depois.">
          <Input id="available_date" name="available_date" type="date" />
        </Field>
        <Field label="Forma de recebimento" htmlFor="payment_method_id">
          <Select id="payment_method_id" name="payment_method_id"><OptionList items={options.paymentMethods} /></Select>
        </Field>
        {options.donors.length > 0 && (
          <Field label="Doador identificado (opcional)" htmlFor="donor_id" hint="Visível só para administrador, tesoureiro e auditor.">
            <Select id="donor_id" name="donor_id"><OptionList items={options.donors} empty="Anônimo / não identificar" /></Select>
          </Field>
        )}
        <Field label="Nº do comprovante" htmlFor="document_ref">
          <Input id="document_ref" name="document_ref" maxLength={80} />
        </Field>
      </div>
      <fieldset className={grid}>
        <legend className="mb-2 text-sm font-semibold">Destino e classificação</legend>
        <Dimensions options={options} />
      </fieldset>
      <Field label="Observações" htmlFor="notes">
        <Textarea id="notes" name="notes" maxLength={1000} placeholder="Evite nomes de doadores e dados pessoais aqui." />
      </Field>
      <FormMessage state={state} />
      <SubmitButton>Lançar receita</SubmitButton>
    </form>
  );
}

type Split = { key: number; category_id: string; amount: string; fund_id: string; ministry_id: string; project_id: string; memo: string };

export function ExpenseForm({ options, today }: { options: EntryOptions; today: string }) {
  const [state, action] = useActionState(createExpense, null);
  const [account, setAccount] = useState("");
  const [splits, setSplits] = useState<Split[]>([{ key: 1, category_id: "", amount: "", fund_id: "", ministry_id: "", project_id: "", memo: "" }]);
  const total = useMemo(() => splits.reduce((s, x) => s + (parseBRLToCents(x.amount) ?? 0), 0), [splits]);
  const update = (key: number, patch: Partial<Split>) => setSplits((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="splits" value={JSON.stringify(splits.map((s) => ({ category_id: s.category_id, amount: s.amount, fund_id: s.fund_id, ministry_id: s.ministry_id, project_id: s.project_id, memo: s.memo })))} />
      <div className={grid}>
        <AccountSelect name="account_id" label="Conta que pagou" options={options} value={account} onChange={setAccount} />
        <Field label="Descrição" htmlFor="description">
          <Input id="description" name="description" required maxLength={240} placeholder="Ex.: Conta de energia de outubro" />
        </Field>
        <Field label="Fornecedor / favorecido" htmlFor="contact_id">
          <Select id="contact_id" name="contact_id"><OptionList items={options.contacts} /></Select>
        </Field>
        <Field label="Data do pagamento" htmlFor="cash_date">
          <Input id="cash_date" name="cash_date" type="date" required defaultValue={today} />
        </Field>
        <Field label="Competência" htmlFor="competence_date" hint="Mês a que a despesa se refere, se diferente.">
          <Input id="competence_date" name="competence_date" type="date" />
        </Field>
        <Field label="Vencimento" htmlFor="due_date">
          <Input id="due_date" name="due_date" type="date" />
        </Field>
        <Field label="Forma de pagamento" htmlFor="payment_method_id">
          <Select id="payment_method_id" name="payment_method_id"><OptionList items={options.paymentMethods} /></Select>
        </Field>
        <Field label="Nº da nota / recibo" htmlFor="document_ref">
          <Input id="document_ref" name="document_ref" maxLength={80} />
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Categorias (rateio)</legend>
        <p className="text-xs text-muted">Divida o valor entre categorias, ministérios, projetos ou fundos quando a despesa atender mais de um.</p>
        {splits.map((s, i) => (
          <div key={s.key} className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <Field label={`Categoria ${i + 1}`} htmlFor={`cat-${s.key}`}>
                <Select id={`cat-${s.key}`} required value={s.category_id} onChange={(e) => update(s.key, { category_id: e.target.value })}>
                  <option value="">Escolha a categoria</option>
                  {options.expense.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Valor (R$)" htmlFor={`amt-${s.key}`}>
              <MoneyInput id={`amt-${s.key}`} required value={s.amount} onChange={(e) => update(s.key, { amount: e.target.value })} />
            </Field>
            <Field label="Fundo" htmlFor={`fund-${s.key}`}>
              <Select id={`fund-${s.key}`} value={s.fund_id} onChange={(e) => update(s.key, { fund_id: e.target.value })}><OptionList items={options.funds} empty="Recurso livre" /></Select>
            </Field>
            <Field label="Ministério" htmlFor={`min-${s.key}`}>
              <Select id={`min-${s.key}`} value={s.ministry_id} onChange={(e) => update(s.key, { ministry_id: e.target.value })}><OptionList items={options.ministries} /></Select>
            </Field>
            <Field label="Projeto" htmlFor={`proj-${s.key}`}>
              <Select id={`proj-${s.key}`} value={s.project_id} onChange={(e) => update(s.key, { project_id: e.target.value })}><OptionList items={options.projects} /></Select>
            </Field>
            {splits.length > 1 && (
              <div className="lg:col-span-6">
                <button type="button" className="text-sm text-expense underline" onClick={() => setSplits((xs) => xs.filter((x) => x.key !== s.key))}>Remover linha</button>
              </div>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={buttonStyles.secondary}
            onClick={() => setSplits((xs) => [...xs, { key: Math.max(...xs.map((x) => x.key)) + 1, category_id: "", amount: "", fund_id: "", ministry_id: "", project_id: "", memo: "" }])}>
            Adicionar categoria
          </button>
          <p className="text-sm">Total da despesa: <strong className="num">{formatBRL(total)}</strong></p>
        </div>
      </fieldset>
      <Field label="Observações" htmlFor="notes">
        <Textarea id="notes" name="notes" maxLength={1000} placeholder="Evite dados pessoais de pessoas assistidas aqui." />
      </Field>
      <FormMessage state={state} />
      <SubmitButton>Lançar despesa</SubmitButton>
    </form>
  );
}

export function TransferForm({ options, today }: { options: EntryOptions; today: string }) {
  const [state, action] = useActionState(createTransfer, null);
  const [from, setFrom] = useState("");
  return (
    <form action={action} className="space-y-6">
      <p className="text-sm text-muted">Use para saques, depósitos do caixa no banco e movimentações entre contas da igreja. Transferências não contam como receita nem despesa.</p>
      <div className={grid}>
        <AccountSelect name="from_account" label="Sai da conta" options={options} value={from} onChange={setFrom} />
        <Field label="Entra na conta" htmlFor="to_account">
          <Select id="to_account" name="to_account" required defaultValue="">
            <option value="">Escolha a conta</option>
            {options.accounts.filter((a) => a.id !== from).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Valor (R$)" htmlFor="amount">
          <MoneyInput id="amount" name="amount" required />
        </Field>
        <Field label="Tarifa (R$)" htmlFor="fee" hint="Se a conta de origem cobrou pela transferência.">
          <MoneyInput id="fee" name="fee" />
        </Field>
        <Field label="Data de envio" htmlFor="sent_date">
          <Input id="sent_date" name="sent_date" type="date" required defaultValue={today} />
        </Field>
        <Field label="Descrição" htmlFor="description">
          <Input id="description" name="description" maxLength={240} placeholder="Ex.: Depósito das ofertas de domingo" />
        </Field>
        <Field label="Nº do comprovante" htmlFor="document_ref">
          <Input id="document_ref" name="document_ref" maxLength={80} />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="in_transit" className="mt-1" />
        <span>O dinheiro ainda não chegou na conta de destino (fica &quot;em trânsito&quot; até você confirmar a chegada).</span>
      </label>
      <FormMessage state={state} />
      <SubmitButton>Registrar transferência</SubmitButton>
    </form>
  );
}
