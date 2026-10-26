"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { parseBRLToCents } from "@/lib/money";
import { isIsoDate } from "@/lib/dates";
import { friendlyError, type ActionState } from "@/lib/errors";

const TABLES = ["categories", "ministries", "projects", "funds", "cost_centers", "payment_methods", "contacts"] as const;
type Table = (typeof TABLES)[number];

const opt = (max: number) => z.preprocess((v) => (v === "" || v === null ? undefined : typeof v === "string" ? v.trim() : v), z.string().max(max).optional());
const optUuid = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().uuid().optional());
const name = z.string().trim().min(2, "Informe o nome.").max(160);

const SCHEMAS: Record<Table, z.ZodTypeAny> = {
  categories: z.object({ name, kind: z.enum(["receita", "despesa"]), parent_id: optUuid, code: opt(20) }),
  ministries: z.object({ name, kind: z.enum(["ministerio", "departamento"]) }),
  projects: z.object({ name, kind: z.enum(["projeto", "campanha", "evento"]), starts_on: opt(10), ends_on: opt(10) }),
  funds: z.object({ name, is_restricted: z.preprocess((v) => v === "on" || v === "true", z.boolean()), description: opt(400) }),
  cost_centers: z.object({ name, code: opt(20) }),
  payment_methods: z.object({ name }),
  contacts: z.object({ name, kind: z.enum(["fornecedor", "favorecido", "outro"]), document: opt(20), pix_key: opt(120), email: opt(160), phone: opt(30), notes: opt(500) }),
};

export async function createRecord(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const table = String(form.get("_table")) as Table;
  if (!TABLES.includes(table)) return { ok: false, message: "Cadastro inválido." };
  const parsed = SCHEMAS[table].safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from(table).insert({ ...(parsed.data as object), organization_id: ctx.org.id });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/cadastros");
  return { ok: true, message: "Cadastrado." };
}

export async function updateRecord(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const table = String(form.get("_table")) as Table;
  const id = z.string().uuid().safeParse(form.get("_id"));
  if (!TABLES.includes(table) || !id.success) return { ok: false, message: "Cadastro inválido." };
  const patch: Record<string, unknown> = {};
  const newName = form.get("name");
  if (typeof newName === "string") {
    const n = name.safeParse(newName);
    if (!n.success) return { ok: false, message: n.error.issues[0].message };
    patch.name = n.data;
  }
  if (form.has("is_active")) patch.is_active = form.get("is_active") === "true";
  const supabase = await createClient();
  const { error } = await supabase.from(table).update(patch).eq("id", id.data);
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/cadastros");
  return { ok: true, message: "Atualizado." };
}

export async function setFundOpening(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const parsed = z.object({ fund_id: z.string().uuid(), amount: z.string(), date: z.string().refine(isIsoDate, "Data inválida.") }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const cents = parseBRLToCents(parsed.data.amount);
  if (!cents || cents <= 0) return { ok: false, message: "Informe o valor." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_fund_opening_balance", { p_fund: parsed.data.fund_id, p_amount_cents: cents, p_date: parsed.data.date });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: "Saldo inicial do fundo registrado." };
}
