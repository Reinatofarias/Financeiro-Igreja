"use client";

import { useActionState, useState } from "react";
import { closeCash, openCash, verifyCash } from "./actions";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input, MoneyInput, Textarea } from "@/components/ui";
import { formatBRL, parseBRLToCents } from "@/lib/money";

const DENOMS = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5];

function CountFields({ expected }: { expected: number }) {
  const [qty, setQty] = useState<Record<number, string>>({});
  const [typed, setTyped] = useState("");
  const byDenom = DENOMS.reduce((s, d) => s + d * (Number(qty[d]) || 0), 0);
  const counted = byDenom > 0 ? byDenom : parseBRLToCents(typed) ?? 0;
  const diff = counted - expected;
  return (
    <div className="space-y-3">
      <details>
        <summary className="cursor-pointer text-sm text-brand">Contar por cédula e moeda</summary>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {DENOMS.map((d) => (
            <label key={d} className="flex flex-col text-xs text-muted">
              {formatBRL(d)}
              <Input type="number" min={0} step={1} name={`q_${d}`} value={qty[d] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [d]: e.target.value }))} />
            </label>
          ))}
        </div>
      </details>
      <Field label="Valor contado (R$)" htmlFor="counted" hint={byDenom > 0 ? "Calculado pela contagem acima." : undefined}>
        <MoneyInput id="counted" name="counted" value={byDenom > 0 ? (byDenom / 100).toFixed(2).replace(".", ",") : typed} readOnly={byDenom > 0} onChange={(e) => setTyped(e.target.value)} required />
      </Field>
      <p className="text-sm">
        Esperado pelo sistema: <strong className="num">{formatBRL(expected)}</strong> · Diferença:{" "}
        <strong className={`num ${diff === 0 ? "" : diff > 0 ? "text-income" : "text-expense"}`}>{formatBRL(diff)}</strong>
      </p>
      {diff !== 0 && (
        <Field label="Motivo da diferença" htmlFor="reason" hint="Obrigatório quando o contado não bate. A diferença vira um ajuste de sobra ou falta de caixa.">
          <Textarea id="reason" name="reason" required minLength={5} maxLength={500} />
        </Field>
      )}
    </div>
  );
}

export function OpenCashForm({ accountId, expected }: { accountId: string; expected: number }) {
  const [state, action] = useActionState(openCash, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="account_id" value={accountId} />
      <CountFields expected={expected} />
      <FormMessage state={state} />
      <SubmitButton>Abrir caixa</SubmitButton>
    </form>
  );
}

export function CloseCashForm({ sessionId, expected }: { sessionId: string; expected: number }) {
  const [state, action] = useActionState(closeCash, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="session_id" value={sessionId} />
      <CountFields expected={expected} />
      <FormMessage state={state} />
      <SubmitButton confirm="Fechar o caixa com este valor contado?">Fechar caixa</SubmitButton>
    </form>
  );
}

export function VerifyCashForm({ sessionId }: { sessionId: string }) {
  const [state, action] = useActionState(verifyCash, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="session_id" value={sessionId} />
      <Input name="notes" placeholder="Observação (opcional)" className="max-w-xs" />
      <SubmitButton variant="secondary">Registrar conferência</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
