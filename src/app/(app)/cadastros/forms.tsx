"use client";

import { useActionState, type ReactNode } from "react";
import { createRecord, setFundOpening, updateRecord } from "./actions";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input, MoneyInput } from "@/components/ui";

export function CreateForm({ table, children, submit = "Cadastrar" }: { table: string; children: ReactNode; submit?: string }) {
  const [state, action] = useActionState(createRecord, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="_table" value={table} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
      <FormMessage state={state} />
      <SubmitButton>{submit}</SubmitButton>
    </form>
  );
}

export function RowActions({ table, id, name, active }: { table: string; id: string; name: string; active: boolean }) {
  const [state, action] = useActionState(updateRecord, null);
  const [state2, action2] = useActionState(updateRecord, null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={action} className="flex items-center gap-1">
        <input type="hidden" name="_table" value={table} />
        <input type="hidden" name="_id" value={id} />
        <Input name="name" defaultValue={name} aria-label="Nome" className="min-h-8 max-w-56" />
        <SubmitButton variant="ghost">Renomear</SubmitButton>
      </form>
      <form action={action2}>
        <input type="hidden" name="_table" value={table} />
        <input type="hidden" name="_id" value={id} />
        <input type="hidden" name="is_active" value={String(!active)} />
        <SubmitButton variant="ghost">{active ? "Desativar" : "Reativar"}</SubmitButton>
      </form>
      <FormMessage state={state?.ok === false ? state : state2?.ok === false ? state2 : null} />
    </div>
  );
}

export function FundOpeningForm({ fundId, today }: { fundId: string; today: string }) {
  const [state, action] = useActionState(setFundOpening, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="fund_id" value={fundId} />
      <Field label="Saldo inicial do fundo (R$)" htmlFor={`fo-${fundId}`}><MoneyInput id={`fo-${fundId}`} name="amount" className="max-w-36" required /></Field>
      <Field label="Data" htmlFor={`fd-${fundId}`}><Input id={`fd-${fundId}`} name="date" type="date" defaultValue={today} required /></Field>
      <SubmitButton variant="secondary" confirm="Registrar este valor como já reservado para o fundo?">Registrar</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
