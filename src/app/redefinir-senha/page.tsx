"use client";

import { useActionState } from "react";
import { updatePassword } from "@/app/auth-actions";
import { AuthCard } from "@/components/auth-card";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input } from "@/components/ui";

export default function ResetPasswordPage() {
  const [state, action] = useActionState(updatePassword, null);
  return (
    <AuthCard title="Criar senha" subtitle="Use pelo menos 10 caracteres. Uma frase longa é mais segura e fácil de lembrar.">
      <form action={action} className="flex flex-col gap-4">
        <Field label="Nova senha" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <Field label="Repita a senha" htmlFor="confirm">
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <FormMessage state={state} />
        <SubmitButton>Salvar senha</SubmitButton>
      </form>
    </AuthCard>
  );
}
