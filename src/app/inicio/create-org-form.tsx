"use client";

import { useActionState } from "react";
import { createOrganization } from "@/app/auth-actions";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input, Select } from "@/components/ui";

const TIMEZONES = [
  ["America/Recife", "Pernambuco, Paraíba, RN, Alagoas (Recife)"],
  ["America/Bahia", "Bahia"],
  ["America/Fortaleza", "Ceará, Piauí, Maranhão"],
  ["America/Sao_Paulo", "Brasília / Sul e Sudeste"],
  ["America/Manaus", "Amazonas"],
  ["America/Cuiaba", "Mato Grosso"],
  ["America/Belem", "Pará, Amapá"],
  ["America/Noronha", "Fernando de Noronha"],
  ["America/Rio_Branco", "Acre"],
];

export function CreateOrgForm() {
  const [state, action] = useActionState(createOrganization, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Nome da igreja" htmlFor="name">
        <Input id="name" name="name" required maxLength={160} />
      </Field>
      <Field label="CNPJ (opcional)" htmlFor="document">
        <Input id="document" name="document" inputMode="numeric" maxLength={20} />
      </Field>
      <Field label="Fuso horário" htmlFor="timezone">
        <Select id="timezone" name="timezone" defaultValue="America/Recife">
          {TIMEZONES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage state={state} />
      <SubmitButton>Cadastrar igreja</SubmitButton>
    </form>
  );
}
