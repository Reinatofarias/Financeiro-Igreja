"use client";

import { useActionState } from "react";
import { closeMonth, reopenMonth } from "../configuracoes/actions";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input } from "@/components/ui";

export function CloseThisMonthForm({ month, warnings }: { month: string; warnings: number }) {
  const [state, action] = useActionState(closeMonth, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="month" value={month.slice(0, 7)} />
      <SubmitButton
        confirm={`${warnings > 0 ? `Ainda há ${warnings} ponto(s) para conferir. ` : ""}Fechar o mês? Nenhum lançamento poderá entrar nele sem reabertura justificada.`}
      >
        Fechar o mês
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function ReopenThisMonthForm({ month }: { month: string }) {
  const [state, action] = useActionState(reopenMonth, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="month" value={month} />
      <Field label="Por que reabrir?" htmlFor="reopen-reason" hint="Fica registrado na auditoria. Mínimo 10 caracteres.">
        <Input id="reopen-reason" name="reason" minLength={10} required placeholder="Ex.: faltou lançar a conta de água de outubro" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" confirm="Reabrir este mês?">Reabrir o mês</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
