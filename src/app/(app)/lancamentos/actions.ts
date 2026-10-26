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
const text = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(max).optional());

function fd(form: FormData) {
  return Object.fromEntries(Array.from(form.keys()).map((k) => [k, form.get(k)]));
}

/** Caixa aberto da conta, se for caixa físico: lançamentos em dinheiro ficam ligados à sessão. */
async function openSessionFor(accountId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("cash_sessions").select("id").eq("account_id", accountId).eq("status", "aberto").maybeSingle();
  return data?.id ?? null;
}

async function requireCashSessionIfNeeded(accountId: string): Promise<{ id: string | null; error?: string }> {
  const supabase = await createClient();
  const { data: acc } = await supabase.from("financial_accounts").select("kind").eq("id", accountId).maybeSingle();
  if (acc?.kind !== "caixa_fisico") return { id: null };
  const id = await openSessionFor(accountId);
  if (!id) return { id: null, error: "Abra o caixa físico antes de lançar movimentos em dinheiro (menu Caixa físico)." };
  return { id };
}

const incomeSchema = z.object({
  account_id: uuid,
  category_id: uuid,
  gross: money("Valor"),
  fee: money("Tarifa", true),
  cash_date: isoDate,
  competence_date: optDate,
  available_date: optDate,
  description: z.string().trim().min(2, "Descreva o lançamento.").max(240),
  fund_id: optUuid,
  ministry_id: optUuid,
  project_id: optUuid,
  cost_center_id: optUuid,
  donor_id: optUuid,
  payment_method_id: optUuid,
  document_ref: text(80),
  notes: text(1000),
});

export async function createIncome(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const parsed = incomeSchema.safeParse(fd(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const session = await requireCashSessionIfNeeded(v.account_id);
  if (session.error) return { ok: false, message: session.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_income", {
    p_org: ctx.org.id,
    p_account_id: v.account_id,
    p_category_id: v.category_id,
    p_gross_cents: v.gross,
    p_cash_date: v.cash_date,
    p_description: v.description,
    p_competence_date: v.competence_date ?? null,
    p_fee_cents: v.fee,
    p_fund_id: v.fund_id ?? null,
    p_ministry_id: v.ministry_id ?? null,
    p_project_id: v.project_id ?? null,
    p_cost_center_id: v.cost_center_id ?? null,
    p_donor_id: v.donor_id ?? null,
    p_payment_method_id: v.payment_method_id ?? null,
    p_document_ref: v.document_ref ?? null,
    p_cash_session_id: session.id,
    p_available_date: v.available_date ?? null,
    p_notes: v.notes ?? null,
  });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/", "layout");
  redirect(`/lancamentos/${data}?criado=1`);
}

const splitSchema = z.array(
  z.object({
    category_id: uuid,
    amount: z.string(),
    fund_id: optUuid,
    ministry_id: optUuid,
    project_id: optUuid,
    cost_center_id: optUuid,
    memo: text(200),
  }),
).min(1, "Informe ao menos uma categoria.");

const expenseSchema = z.object({
  account_id: uuid,
  cash_date: isoDate,
  competence_date: optDate,
  due_date: optDate,
  description: z.string().trim().min(2, "Descreva o lançamento.").max(240),
  contact_id: optUuid,
  payment_method_id: optUuid,
  document_ref: text(80),
  notes: text(1000),
  splits: z.string(),
});

export async function createExpense(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const parsed = expenseSchema.safeParse(fd(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  let splitsRaw: unknown;
  try {
    splitsRaw = JSON.parse(v.splits);
  } catch {
    return { ok: false, message: "Rateio inválido." };
  }
  const splits = splitSchema.safeParse(splitsRaw);
  if (!splits.success) return { ok: false, message: splits.error.issues[0].message.includes("uuid") ? "Escolha a categoria de cada linha do rateio." : splits.error.issues[0].message };
  const p_splits = [];
  for (const s of splits.data) {
    const cents = parseBRLToCents(s.amount);
    if (cents === null || cents <= 0) return { ok: false, message: "Informe o valor de cada linha do rateio." };
    p_splits.push({ category_id: s.category_id, amount_cents: cents, fund_id: s.fund_id, ministry_id: s.ministry_id, project_id: s.project_id, cost_center_id: s.cost_center_id, memo: s.memo });
  }
  const session = await requireCashSessionIfNeeded(v.account_id);
  if (session.error) return { ok: false, message: session.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_expense", {
    p_org: ctx.org.id,
    p_account_id: v.account_id,
    p_splits,
    p_cash_date: v.cash_date,
    p_description: v.description,
    p_competence_date: v.competence_date ?? null,
    p_due_date: v.due_date ?? null,
    p_contact_id: v.contact_id ?? null,
    p_payment_method_id: v.payment_method_id ?? null,
    p_document_ref: v.document_ref ?? null,
    p_cash_session_id: session.id,
    p_notes: v.notes ?? null,
  });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/", "layout");
  redirect(`/lancamentos/${data}?criado=1`);
}

const transferSchema = z.object({
  from_account: uuid,
  to_account: uuid,
  amount: money("Valor"),
  fee: money("Tarifa", true),
  sent_date: isoDate,
  description: text(240),
  in_transit: z.preprocess((v) => v === "on", z.boolean()),
  document_ref: text(80),
});

export async function createTransfer(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const parsed = transferSchema.safeParse(fd(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const v = parsed.data;
  const session = await requireCashSessionIfNeeded(v.from_account);
  if (session.error) return { ok: false, message: session.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_transfer", {
    p_org: ctx.org.id,
    p_from_account: v.from_account,
    p_to_account: v.to_account,
    p_amount_cents: v.amount,
    p_sent_date: v.sent_date,
    p_description: v.description ?? null,
    p_in_transit: v.in_transit,
    p_fee_cents: v.fee,
    p_cash_session_id: session.id,
    p_document_ref: v.document_ref ?? null,
  });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/", "layout");
  redirect(`/lancamentos/${data}?criado=1`);
}

export async function reverseEntry(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const parsed = z.object({ entry_id: uuid, reason: z.string().trim().min(5, "Explique o motivo do estorno."), date: isoDate }).safeParse(fd(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reverse_entry", { p_entry_id: parsed.data.entry_id, p_reason: parsed.data.reason, p_date: parsed.data.date });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/", "layout");
  redirect(`/lancamentos/${data}?estorno=1`);
}

export async function confirmArrival(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const parsed = z.object({ entry_id: uuid, date: isoDate }).safeParse(fd(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_transfer_arrival", { p_entry_id: parsed.data.entry_id, p_received_date: parsed.data.date });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/", "layout");
  redirect(`/lancamentos/${data}`);
}

const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]);

export async function uploadAttachment(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const entryId = uuid.safeParse(form.get("entry_id"));
  const file = form.get("file");
  if (!entryId.success || !(file instanceof File) || file.size === 0) return { ok: false, message: "Escolha um arquivo." };
  if (!ALLOWED.has(file.type)) return { ok: false, message: "Envie PDF ou imagem (JPG, PNG, WEBP, HEIC)." };
  if (file.size > 4 * 1000 * 1000 - 50_000) return { ok: false, message: "O arquivo pode ter no máximo 3,9 MB. Comprima a foto ou o PDF e tente de novo." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  const safeName = file.name.normalize("NFD").replace(/[^\w.\-]+/g, "_").slice(-80) || "arquivo";
  const path = `${ctx.org.id}/${entryId.data}/${crypto.randomUUID()}-${safeName}`;

  const supabase = await createClient();
  const up = await supabase.storage.from("comprovantes").upload(path, bytes, { contentType: file.type, upsert: false });
  if (up.error) return { ok: false, message: "Não foi possível enviar o arquivo. Verifique sua permissão." };
  const { error } = await supabase.from("attachments").insert({
    organization_id: ctx.org.id,
    entry_id: entryId.data,
    storage_path: path,
    file_name: file.name.slice(0, 200),
    mime_type: file.type,
    size_bytes: file.size,
    sha256: hash,
  });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath(`/lancamentos/${entryId.data}`);
  return { ok: true, message: "Comprovante anexado." };
}
