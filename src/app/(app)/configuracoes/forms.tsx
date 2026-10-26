"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { closeMonth, createMember, reopenMonth, revokeInvite, updateApproval, updateMember, updateOrganization } from "./actions";
import { formatAmount } from "@/lib/money";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input, MoneyInput, Select } from "@/components/ui";

const ROLES: [string, string][] = [
  ["admin", "Administrador"],
  ["tesoureiro", "Tesoureiro"],
  ["operador", "Operador financeiro"],
  ["aprovador", "Aprovador"],
  ["auditor", "Conselho fiscal / auditor"],
  ["lideranca", "Liderança"],
];

export function NewMemberForm({ siteUrl }: { siteUrl: string }) {
  const [state, action] = useActionState(createMember, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <div className="space-y-3">
      <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end">
        <Field label="Nome" htmlFor="nm-name"><Input id="nm-name" name="name" required maxLength={120} autoComplete="off" /></Field>
        <Field label="E-mail" htmlFor="nm-email"><Input id="nm-email" name="email" type="email" required autoComplete="off" /></Field>
        <Field label="Perfil" htmlFor="nm-role">
          <Select id="nm-role" name="role" defaultValue="operador">{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        <SubmitButton>Cadastrar</SubmitButton>
      </form>
      {state?.password ? (
        <div role="status" className="rounded-xl border border-income/30 bg-income/5 p-4 text-sm">
          <p className="font-medium text-income">Pessoa cadastrada. Passe estes dados para ela (pessoalmente ou por mensagem):</p>
          <dl className="mt-2 grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-3">
            <dt className="text-muted">Endereço</dt><dd className="break-all font-medium">{siteUrl}</dd>
            <dt className="text-muted">E-mail</dt><dd className="break-all font-medium">{state.email}</dd>
            <dt className="text-muted">Senha provisória</dt><dd className="font-mono text-base font-semibold tracking-wide">{state.password}</dd>
          </dl>
          <p className="mt-2 text-xs text-muted">A senha aparece só agora. No primeiro acesso o sistema pede para ela criar a própria senha.</p>
        </div>
      ) : (
        <FormMessage state={state} />
      )}
    </div>
  );
}

export function RevokeInviteForm({ id }: { id: string }) {
  const [state, action] = useActionState(revokeInvite, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" confirm="Revogar este convite?">Revogar</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function MemberForm({ id, role, active, self }: { id: string; role: string; active: boolean; self: boolean }) {
  const [state, action] = useActionState(updateMember, null);
  if (self) return <span className="text-xs text-muted">Seu acesso só pode ser alterado por outro administrador.</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Select name="role" defaultValue={role} aria-label="Perfil" className="min-h-8 w-auto">{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      <Select name="active" defaultValue={String(active)} aria-label="Situação" className="min-h-8 w-auto">
        <option value="true">Ativo</option>
        <option value="false">Acesso revogado</option>
      </Select>
      <SubmitButton variant="secondary" confirm="Salvar a alteração de acesso?">Salvar</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function OrgForm({ org }: { org: { name: string; legal_name: string | null; document: string | null; timezone: string; require_mfa: boolean } }) {
  const [state, action] = useActionState(updateOrganization, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome" htmlFor="o-name"><Input id="o-name" name="name" defaultValue={org.name} required /></Field>
        <Field label="Razão social" htmlFor="o-legal"><Input id="o-legal" name="legal_name" defaultValue={org.legal_name ?? ""} /></Field>
        <Field label="CNPJ" htmlFor="o-doc"><Input id="o-doc" name="document" defaultValue={org.document ?? ""} /></Field>
        <Field label="Fuso horário" htmlFor="o-tz" hint="Ex.: America/Recife"><Input id="o-tz" name="timezone" defaultValue={org.timezone} required /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="require_mfa" defaultChecked={org.require_mfa} /> Exigir verificação em duas etapas para administrador e tesoureiro (recomendado)</label>
      <FormMessage state={state} />
      <SubmitButton>Salvar</SubmitButton>
    </form>
  );
}

export function CloseMonthForm({ defaultMonth }: { defaultMonth: string }) {
  const [state, action] = useActionState(closeMonth, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Mês" htmlFor="cm"><Input id="cm" name="month" type="month" defaultValue={defaultMonth} required /></Field>
      <SubmitButton confirm="Fechar o mês? Nenhum lançamento poderá entrar nele sem reabertura justificada.">Fechar mês</SubmitButton>
      <div className="w-full"><FormMessage state={state} /></div>
    </form>
  );
}

export function ReopenMonthForm({ month }: { month: string }) {
  const [state, action] = useActionState(reopenMonth, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="month" value={month} />
      <Input name="reason" placeholder="Justificativa (mín. 10 caracteres)" minLength={10} required className="min-h-8 max-w-xs" />
      <SubmitButton variant="ghost" confirm="Reabrir este mês?">Reabrir</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function ApprovalForm({ threshold }: { threshold: number | null }) {
  const [state, action] = useActionState(updateApproval, null);
  const [mode, setMode] = useState(threshold === null ? "nenhuma" : threshold === 0 ? "todas" : "valor");
  const opt = (value: string, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="h-4 w-4 accent-[var(--brand)]" />
      {label}
    </label>
  );
  return (
    <form action={action} className="space-y-3">
      {opt("nenhuma", "Contas a pagar não precisam de aprovação")}
      {opt("todas", "Toda conta a pagar precisa de aprovação")}
      {opt("valor", "Precisa de aprovação a partir de um valor")}
      {mode === "valor" && (
        <Field label="A partir de (R$)" htmlFor="ap-amount">
          <MoneyInput id="ap-amount" name="amount" defaultValue={threshold ? formatAmount(threshold) : ""} className="max-w-40" />
        </Field>
      )}
      <p className="text-xs text-muted">Aprovam: administrador, tesoureiro e aprovador. Quem cadastrou a conta não aprova a própria conta.</p>
      <FormMessage state={state} />
      <SubmitButton>Salvar regra</SubmitButton>
    </form>
  );
}
