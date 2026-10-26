"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionState } from "@/lib/errors";

export async function createDonor(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Informe o nome.").max(160),
      document: z.string().trim().max(20).optional(),
      email: z.union([z.literal(""), z.string().trim().email("E-mail inválido.")]).optional(),
      consent: z.string().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("donors").insert({
    organization_id: ctx.org.id,
    name: parsed.data.name,
    document: parsed.data.document?.replace(/\D/g, "") || null,
    email: parsed.data.email || null,
    consent_at: parsed.data.consent === "on" ? new Date().toISOString() : null,
  });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/doadores");
  return { ok: true, message: "Doador cadastrado." };
}
