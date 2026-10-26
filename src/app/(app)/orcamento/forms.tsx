"use client";

import { useActionState } from "react";
import { saveBudget } from "./actions";
import { FormMessage, SubmitButton } from "@/components/form";
import { MoneyInput, Select } from "@/components/ui";
import { formatAmount } from "@/lib/money";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function BudgetForm({ categoryId, year, current, fromMonth }: { categoryId: string; year: number; current: number | null; fromMonth: number }) {
  const [state, action] = useActionState(saveBudget, null);
  return (
    <form action={action} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-2 sm:w-[26rem]">
      <input type="hidden" name="category_id" value={categoryId} />
      <input type="hidden" name="year" value={year} />
      <MoneyInput name="amount" defaultValue={current ? formatAmount(current) : ""} aria-label="Valor por mês" />
      <Select name="from" defaultValue={String(fromMonth)} aria-label="A partir de">
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>a partir de {m}</option>
        ))}
      </Select>
      <SubmitButton variant="secondary">Salvar</SubmitButton>
      <div className="col-span-3 empty:hidden"><FormMessage state={state} /></div>
    </form>
  );
}
