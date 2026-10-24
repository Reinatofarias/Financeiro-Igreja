"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { formatBRL, parseBRLToCents } from "@/lib/money";
import { friendlyError, type ActionState } from "@/lib/errors";

const DENOMS = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5];

/** Soma a contagem por cédula/moeda quando informada; senão usa o total digitado. */
function countedFrom(form: FormData): { cents: number | null; details: Record<string, number> | null } {
  const details: Record<string, number> = {};
  let sum = 0;
  let any = false;
  for (const d of DENOMS) {
    const q = Number(form.get(`q_${d}`) || 0);
    if (!Number.isInteger(q) || q < 0) return { cents: null, details: null };
    if (q > 0) {
      any = true;
      details[String(d)] = q;
      sum += d * q;
    }
  }
  if (any) return { cents: sum, details };
  return { cents: parseBRLToCents(String(form.get("counted") ?? "")), details: null };
}

export async function openCash(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const account = z.string().uuid().safeParse(form.get("account_id"));
  const { cents } = countedFrom(form);
  if (!account.success || cents === null || cents < 0) return { ok: false, message: "Informe o valor contado na abertura." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("open_cash_session", { p_account: account.data, p_counted_cents: cents, p_reason: String(form.get("reason") ?? "") || null });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/caixa");
  return { ok: true, message: "Caixa aberto." };
}

export async function closeCash(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const session = z.string().uuid().safeParse(form.get("session_id"));
  const { cents, details } = countedFrom(form);
  if (!session.success || cents === null || cents < 0) return { ok: false, message: "Informe o valor contado no fechamento." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("close_cash_session", {
    p_session: session.data,
    p_counted_cents: cents,
    p_count_details: details,
    p_reason: String(form.get("reason") ?? "") || null,
  });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/", "layout");
  const diff = Number(data);
  return { ok: true, message: diff === 0 ? "Caixa fechado sem diferença." : `Caixa fechado com diferença de ${formatBRL(diff)}, registrada como ajuste.` };
}

export async function verifyCash(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const session = z.string().uuid().safeParse(form.get("session_id"));
  if (!session.success) return { ok: false, message: "Caixa inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_cash_session", { p_session: session.data, p_notes: String(form.get("notes") ?? "") || null });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/caixa");
  return { ok: true, message: "Conferência registrada." };
}
