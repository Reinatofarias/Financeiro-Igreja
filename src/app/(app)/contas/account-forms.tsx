"use client";

import { useActionState } from "react";
import { createAccount, setOpeningBalance, toggleAccount } from "./actions";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input, MoneyInput, Select } from "@/components/ui";

export function NewAccountForm({ today }: { today: string }) {
  const [state, action] = useActionState(createAccount, null);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Nome" htmlFor="name" hint='Ex.: "Mercado Pago - Dízimos"'>
          <Input id="name" name="name" required maxLength={80} />
        </Field>
        <Field label="Tipo" htmlFor="kind">
          <Select id="kind" name="kind" defaultValue="banco">
            <option value="banco">Conta bancária</option>
            <option value="carteira_digital">Carteira digital</option>
            <option value="caixa_fisico">Caixa físico (dinheiro)</option>
            <option value="outra">Outra</option>
          </Select>
        </Field>
        <Field label="Instituição" htmlFor="provider">
          <Select id="provider" name="provider" defaultValue="manual">
            <option value="mercado_pago">Mercado Pago</option>
            <option value="cora">Cora</option>
            <option value="pagbank">PagBank</option>
            <option value="manual">Outra / manual</option>
          </Select>
        </Field>
        <Field label="Identificação" htmlFor="account_hint" hint="Só o final da conta, ex.: final 1234.">
          <Input id="account_hint" name="account_hint" maxLength={30} />
        </Field>
        <Field label="Data do saldo inicial" htmlFor="opening_date" hint="A partir de quando o sistema controla esta conta.">
          <Input id="opening_date" name="opening_date" type="date" defaultValue={today} required />
        </Field>
        <Field label="Saldo inicial (R$)" htmlFor="opening" hint="Saldo que a conta tinha no começo desta data.">
          <MoneyInput id="opening" name="opening" />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton>Cadastrar conta</SubmitButton>
    </form>
  );
}

export function OpeningBalanceForm({ accountId, openingDate }: { accountId: string; openingDate: string }) {
  const [state, action] = useActionState(setOpeningBalance, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="account_id" value={accountId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Data" htmlFor="ob-date"><Input id="ob-date" name="opening_date" type="date" defaultValue={openingDate} required /></Field>
        <Field label="Saldo inicial (R$)" htmlFor="ob-val"><MoneyInput id="ob-val" name="opening" required /></Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" confirm="Substituir o saldo inicial? O anterior será estornado e ficará no histórico.">Ajustar saldo inicial</SubmitButton>
    </form>
  );
}

export function ToggleAccountForm({ accountId, active }: { accountId: string; active: boolean }) {
  const [state, action] = useActionState(toggleAccount, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="account_id" value={accountId} />
      <input type="hidden" name="active" value={String(!active)} />
      <SubmitButton variant="secondary" confirm={active ? "Desativar esta conta? Ela some dos formulários, mas o histórico fica." : undefined}>
        {active ? "Desativar conta" : "Reativar conta"}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
