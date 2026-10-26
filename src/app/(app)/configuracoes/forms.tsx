"use client";

import { useActionState } from "react";
import { useState } from "react";
import { closeMonth, inviteMember, reopenMonth, revokeInvite, updateApproval, updateMember, updateOrganization } from "./actions";
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

export function InviteForm() {
  const [state, action] = useActionState(inviteMember, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field label="E-mail" htmlFor="inv-email"><Input id="inv-email" name="email" type="email" required className="min-w-64" /></Field>
      <Field label="Perfil" htmlFor="inv-role">
        <Select id="inv-role" name="role" defaultValue="operador">{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      </Field>
      <SubmitButton>Convidar</SubmitButton>
      <div className="w-full"><FormMessage state={state} /></div>
    </form>
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
