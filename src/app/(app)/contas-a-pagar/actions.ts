"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { parseBRLToCents } from "@/lib/money";
import { isIsoDate } from "@/lib/dates";
import { friendlyError, type ActionState } from "@/lib/errors";

const uuid = z.string().uuid();
const optUuid = z.preprocess((v) => (v === "" || v === null ? undefined : v), uuid.optional());
const isoDate = z.string().refine(isIsoDate, "Data inválida.");
const optDate = z.preprocess((v) => (v === "" || v === null ? undefined : v), isoDate.optional());
const money = (label: string, allowZero = false) =>
  z.string().transform((v, ctx) => {
    const cents = parseBRLToCents(v === "" && allowZero ? "0" : v);
    if (cents === null || cents < 0 || (!allowZero && cents === 0)) {
      ctx.addIssue({ code: "custom", message: `${label}: informe um valor válido, como 1.234,56.` });
      return z.NEVER;
    }
    return cents;
  });
const optMoney = (label: string) => z.preprocess((v) => (v === "" || v === null ? undefined : v), money(label).optional());
const text = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(max).optional());

function fd(form: FormData) {
  return Object.fromEntries(Array.from(form.keys()).map((k) => [k, form.get(k)]));
}

function done(message: string): ActionState {
  revalidatePath("/contas-a-pagar");
  revalidatePath("/");
  return { ok: true, message };
}

const billSchema = z.object({
  kind: z.enum(["pagar", "receber"]),
  description: z.string().trim().min(2, "Descreva a conta.").max(200),
  amount: money("Valor"),
  due_date: isoDate,
  competence_date: optDate,
  category_id: z.string().uuid("Escolha a categoria."),
  account_id: optUuid,
  contact_id: optUuid,
  fund_id: optUuid,
  ministry_id: optUuid,
  project_id: optUuid,
  document_ref: text(80),
  notes: text(1000),
  repeat: z.coerce.number().int().min(1, "Repita de 1 a 36 meses.").max(36, "Repita de 1 a 36 meses."),
});

export async function createBill(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const parsed = billSchema.safeParse({ ...fd(form), repeat: form.get("repeat_on") === "on" ? form.get("repeat") : "1" });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_bill", {
    p_org: ctx.org.id,
    p_kind: v.kind,
    p_description: v.description,
    p_amount_cents: v.amount,
    p_due_date: v.due_date,
    p_category_id: v.category_id,
    p_competence_date: v.competence_date ?? null,
    p_account_id: v.account_id ?? null,
    p_contact_id: v.kind === "pagar" ? (v.contact_id ?? null) : null,
    p_fund_id: v.fund_id ?? null,
    p_ministry_id: v.ministry_id ?? null,
    p_project_id: v.project_id ?? null,
    p_document_ref: v.document_ref || null,
    p_notes: v.notes || null,
    p_repeat: v.repeat,
  });
  if (error) return { ok: false, message: friendlyError(error) };
  const n = Number(data ?? 1);
  return done(n > 1 ? `${n} contas cadastradas, uma por mês.` : "Conta cadastrada.");
}

const paySchema = z.object({ id: uuid, account_id: z.string().uuid("Escolha a conta."), paid_date: isoDate, amount: optMoney("Valor"), fee: optMoney("Tarifa"), payment_method_id: optUuid });

export async function payBill(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const parsed = paySchema.safeParse(fd(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("pay_bill", {
    p_bill: v.id,
    p_account_id: v.account_id,
    p_paid_date: v.paid_date,
    p_amount_cents: v.amount ?? null,
    p_fee_cents: v.fee ?? 0,
    p_payment_method_id: v.payment_method_id ?? null,
  });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/lancamentos");
  done("");
  // A conta sai da lista de abertas: o aviso aparece no topo da página.
  redirect(`/contas-a-pagar?tipo=${form.get("kind") === "receber" ? "receber" : "pagar"}&ok=pago`);
}

export async function decideBill(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const parsed = z.object({ id: uuid, decision: z.enum(["aprovar", "recusar"]), notes: text(500) }).safeParse(fd(form));
  if (!parsed.success) return { ok: false, message: "Dados inválidos." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_bill", { p_bill: parsed.data.id, p_approve: parsed.data.decision === "aprovar", p_notes: parsed.data.notes || null });
  if (error) return { ok: false, message: friendlyError(error) };
  return done(parsed.data.decision === "aprovar" ? "Despesa aprovada." : "Despesa recusada.");
}

export async function updateBill(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const parsed = z
    .object({ id: uuid, description: z.string().trim().min(2, "Descreva a conta.").max(240), amount: money("Valor"), due_date: isoDate })
    .safeParse(fd(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_bill", { p_bill: v.id, p_description: v.description, p_amount_cents: v.amount, p_due_date: v.due_date });
  if (error) return { ok: false, message: friendlyError(error) };
  return done("Conta atualizada.");
}

export async function cancelBill(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const parsed = z.object({ id: uuid, reason: z.string().trim().min(5, "Explique o motivo (mínimo 5 caracteres).").max(500) }).safeParse(fd(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_bill", { p_bill: parsed.data.id, p_reason: parsed.data.reason, p_rest_of_series: form.get("rest") === "on" });
  if (error) return { ok: false, message: friendlyError(error) };
  done("");
  redirect(`/contas-a-pagar?tipo=${form.get("kind") === "receber" ? "receber" : "pagar"}&ok=${Number(data ?? 1) > 1 ? "canceladas" : "cancelada"}`);
}
