"use client";

import { useActionState, useEffect, useState } from "react";
import { startMfaEnroll, verifyMfa, type EnrollState } from "@/app/auth-actions";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input } from "@/components/ui";

function CodeForm({ factorId }: { factorId: string }) {
  const [state, action] = useActionState(verifyMfa, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="factorId" value={factorId} />
      <Field label="Código" htmlFor="code">
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
      </Field>
      <FormMessage state={state} />
      <SubmitButton>Confirmar</SubmitButton>
    </form>
  );
}

export function MfaVerify({ factorId }: { factorId: string }) {
  return <CodeForm factorId={factorId} />;
}

export function MfaEnroll() {
  const [enroll, setEnroll] = useState<EnrollState | undefined>(undefined);
  useEffect(() => {
    startMfaEnroll().then(setEnroll);
  }, []);
  if (enroll === undefined) return <p className="text-sm text-muted">Gerando o código…</p>;
  if (enroll === null) return <p className="text-sm text-expense">Não foi possível iniciar a ativação. Recarregue a página.</p>;
  return (
    <div className="flex flex-col gap-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Abra o aplicativo autenticador no celular.</li>
        <li>Escaneie o QR code abaixo (ou digite a chave).</li>
        <li>Digite o código de 6 números que aparecer.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={enroll.qr} alt="QR code para o aplicativo autenticador" className="mx-auto h-48 w-48 rounded border border-line bg-white p-2" />
      <p className="break-all rounded bg-bg p-2 text-center font-mono text-xs">{enroll.secret}</p>
      <CodeForm factorId={enroll.factorId} />
    </div>
  );
}
