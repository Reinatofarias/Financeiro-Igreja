"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { parseBRLToCents } from "@/lib/money";
import { friendlyError, type ActionState } from "@/lib/errors";

export async function saveBudget(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const parsed = z
    .object({ category_id: z.string().uuid(), year: z.coerce.number().int().min(2000).max(2100), from: z.coerce.number().int().min(1).max(12), amount: z.string() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Dados inválidos." };
  const cents = parsed.data.amount.trim() === "" ? 0 : parseBRLToCents(parsed.data.amount);
  if (cents === null || cents < 0) return { ok: false, message: "Informe um valor válido, como 1.500,00." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_budget", {
    p_org: ctx.org.id,
    p_category: parsed.data.category_id,
    p_year: parsed.data.year,
    p_monthly_cents: cents,
    p_from_month: parsed.data.from,
  });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/orcamento");
  return { ok: true, message: cents === 0 ? "Orçamento removido." : "Salvo." };
}
