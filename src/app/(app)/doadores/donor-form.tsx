"use client";

import { useActionState } from "react";
import { createDonor } from "./actions";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input } from "@/components/ui";

export function DonorForm() {
  const [state, action] = useActionState(createDonor, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Nome" htmlFor="d-name"><Input id="d-name" name="name" required /></Field>
        <Field label="CPF (opcional)" htmlFor="d-doc" hint="Só se a pessoa pediu recibo."><Input id="d-doc" name="document" inputMode="numeric" /></Field>
        <Field label="E-mail (opcional)" htmlFor="d-email"><Input id="d-email" name="email" type="email" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="consent" required /> A pessoa autorizou o registro dos dados para fins de recibo e prestação de contas.</label>
      <FormMessage state={state} />
      <SubmitButton>Cadastrar doador</SubmitButton>
    </form>
  );
}
