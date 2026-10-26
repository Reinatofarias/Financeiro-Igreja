"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset } from "@/app/auth-actions";
import { AuthCard } from "@/components/auth-card";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [state, action] = useActionState(requestPasswordReset, null);
  return (
    <AuthCard title="Recuperar acesso" subtitle="Enviaremos um link para você criar uma nova senha.">
      <form action={action} className="flex flex-col gap-4">
        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </Field>
        <FormMessage state={state} />
        <SubmitButton>Enviar link</SubmitButton>
        <Link href="/login" className="text-center text-sm text-brand underline">
          Voltar para o login
        </Link>
      </form>
    </AuthCard>
  );
}
