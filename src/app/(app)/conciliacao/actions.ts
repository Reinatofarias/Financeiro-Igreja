"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionState } from "@/lib/errors";
import { decodeStatement, parseStatement, StatementParseError } from "@/lib/import/parse";

const uuid = z.string().uuid();
const optUuid = z.preprocess((v) => (v === "" || v === null ? undefined : v), uuid.optional());
const MAX_BYTES = 3_000_000;

export async function importStatement(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.can.operate) return { ok: false, message: "Seu perfil não importa extratos." };
  const account = uuid.safeParse(form.get("account_id"));
  const file = form.get("file");
  if (!account.success) return { ok: false, message: "Escolha a conta do extrato." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Escolha o arquivo do extrato." };
  if (file.size > MAX_BYTES) return { ok: false, message: "Arquivo grande demais (máximo 3 MB). Exporte um período menor." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  let parsed;
  try {
    parsed = parseStatement(decodeStatement(bytes), ctx.org.timezone);
  } catch (e) {
    if (e instanceof StatementParseError) return { ok: false, message: e.message };
    throw e;
  }
  if (parsed.lines.length === 0) return { ok: false, message: "O arquivo não tem movimentos." };

  const supabase = await createClient();
  const { data: acc } = await supabase.from("financial_accounts").select("provider").eq("id", account.data).maybeSingle();
  if (parsed.source.startsWith("mercado_pago") && acc?.provider !== "mercado_pago") {
    return { ok: false, message: "Este é um arquivo do Mercado Pago, mas a conta escolhida não é do Mercado Pago." };
  }

  const sha = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  const { data, error } = await supabase.rpc("import_statement", {
    p_org: ctx.org.id,
    p_account: account.data,
    p_source: parsed.source,
    p_file_name: file.name.slice(0, 200),
    p_file_sha256: sha,
    p_lines: parsed.lines,
    p_opening_balance_cents: parsed.opening_balance_cents,
    p_closing_balance_cents: parsed.closing_balance_cents,
  });
  if (error) return { ok: false, message: friendlyError(error) };
  const r = data as { total: number; new: number; duplicate: number };
  revalidatePath("/conciliacao");
  const parts = [`${r.new} movimento${r.new === 1 ? "" : "s"} novo${r.new === 1 ? "" : "s"}`];
  if (r.duplicate) parts.push(`${r.duplicate} já importado${r.duplicate === 1 ? "" : "s"} antes (ignorado${r.duplicate === 1 ? "" : "s"})`);
  return { ok: true, message: [`Importado: ${parts.join(", ")}.`, ...parsed.warnings].join(" ") };
}

function selectedIds(form: FormData) {
  return form.getAll("line_id").map(String).filter((v) => uuid.safeParse(v).success);
}

const postSchema = z.object({
  category_id: uuid,
  description: z.string().trim().min(2, "Informe a descrição.").max(240),
  fund_id: optUuid,
  ministry_id: optUuid,
  project_id: optUuid,
});

export async function postLines(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const ids = selectedIds(form);
  if (ids.length === 0) return { ok: false, message: "Marque ao menos um movimento na lista." };
  const parsed = postSchema.safeParse(Object.fromEntries(["category_id", "description", "fund_id", "ministry_id", "project_id"].map((k) => [k, form.get(k)])));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message === "Invalid UUID" ? "Escolha a categoria." : parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_statement_lines", {
    p_org: ctx.org.id,
    p_line_ids: ids,
    p_category_id: parsed.data.category_id,
    p_description: parsed.data.description,
    p_fund_id: parsed.data.fund_id ?? null,
    p_ministry_id: parsed.data.ministry_id ?? null,
    p_project_id: parsed.data.project_id ?? null,
  });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: `${data} lançamento${data === 1 ? "" : "s"} criado${data === 1 ? "" : "s"} e conciliado${data === 1 ? "" : "s"}.` };
}

export async function ignoreLines(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const ids = selectedIds(form);
  if (ids.length === 0) return { ok: false, message: "Marque ao menos um movimento na lista." };
  const reason = String(form.get("reason") ?? "").trim();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ignore_statement_lines", { p_line_ids: ids, p_reason: reason });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/conciliacao");
  return { ok: true, message: `${data} movimento${data === 1 ? "" : "s"} ignorado${data === 1 ? "" : "s"}.` };
}

export async function matchLine(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const line = uuid.safeParse(form.get("line_id"));
  const entry = uuid.safeParse(form.get("entry_id"));
  if (!line.success || !entry.success) return { ok: false, message: "Movimento inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reconcile_statement_line", { p_line: line.data, p_entry: entry.data });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/conciliacao");
  return { ok: true, message: "Conciliado." };
}

export async function reopenLine(_: ActionState, form: FormData): Promise<ActionState> {
  await requireContext();
  const line = uuid.safeParse(form.get("line_id"));
  if (!line.success) return { ok: false, message: "Movimento inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_statement_line", { p_line: line.data });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath("/conciliacao");
  return { ok: true, message: "Voltou para pendente." };
}
