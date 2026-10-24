"use client";

import { useActionState } from "react";
import { confirmArrival, reverseEntry, uploadAttachment } from "../actions";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input, Textarea } from "@/components/ui";

export function ReverseForm({ entryId, today }: { entryId: string; today: string }) {
  const [state, action] = useActionState(reverseEntry, null);
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-muted">O estorno cria um lançamento inverso e preserva o original. Para corrigir um valor, estorne e lance novamente.</p>
      <input type="hidden" name="entry_id" value={entryId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label="Motivo" htmlFor="reason"><Textarea id="reason" name="reason" required minLength={5} maxLength={500} /></Field>
        </div>
        <Field label="Data do estorno" htmlFor="date"><Input id="date" name="date" type="date" defaultValue={today} required /></Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="danger" confirm="Confirmar o estorno deste lançamento?">Estornar lançamento</SubmitButton>
    </form>
  );
}

export function ArrivalForm({ entryId, today }: { entryId: string; today: string }) {
  const [state, action] = useActionState(confirmArrival, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="entry_id" value={entryId} />
      <Field label="Data em que chegou" htmlFor="arrival"><Input id="arrival" name="date" type="date" defaultValue={today} required /></Field>
      <SubmitButton>Confirmar chegada</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function AttachmentForm({ entryId }: { entryId: string }) {
  const [state, action] = useActionState(uploadAttachment, null);
  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="entry_id" value={entryId} />
      <input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" required className="block w-full text-sm" />
      <FormMessage state={state} />
      <SubmitButton variant="secondary">Anexar</SubmitButton>
    </form>
  );
}
