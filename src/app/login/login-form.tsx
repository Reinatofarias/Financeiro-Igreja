"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "@/app/auth-actions";
import { AuthCard } from "@/components/auth-card";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input } from "@/components/ui";

export function LoginForm() {
  const [state, action] = useActionState(signIn, null);
  return (
    <AuthCard title="Entrar" subtitle="O acesso é feito por convite do administrador da igreja.">
      <form action={action} className="flex flex-col gap-4">
        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Senha" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FormMessage state={state} />
        <SubmitButton>Entrar</SubmitButton>
        <Link href="/esqueci-senha" className="text-center text-sm text-brand underline">
          Esqueci minha senha
        </Link>
      </form>
    </AuthCard>
  );
}
