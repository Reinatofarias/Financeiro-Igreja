import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseStatement, StatementParseError } from "@/lib/import/parse";
import { createMercadoPagoClient, MercadoPagoError, nextRange, pendingReports, type Report } from "./mercadopago-api";

export type SyncStatus = "ok" | "aguardando" | "erro";
export type SyncResult = { status: SyncStatus; message: string; linesNew: number };

export function tokenEnvName(slot: number) {
  return `MERCADOPAGO_ACCESS_TOKEN_${slot}`;
}
export function hasToken(slot: number) {
  return Boolean(process.env[tokenEnvName(slot)]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sincroniza uma conta do Mercado Pago: baixa os relatórios prontos que ainda não entraram,
 * pede o relatório do período seguinte e espera um pouco por ele. Roda com a chave service_role,
 * então quem chama precisa ter conferido a permissão antes (o agendamento confere o CRON_SECRET).
 */
export async function syncIntegration(integrationId: string, trigger: "agendado" | "manual", opts: { requestedBy?: string; waitMs?: number } = {}): Promise<SyncResult> {
  const admin = createAdminClient();
  const record = async (r: SyncResult, syncedUntil: Date | null = null) => {
    const { error } = await admin.rpc("integration_record_run", {
      p_integration: integrationId, p_trigger: trigger, p_status: r.status, p_message: r.message,
      p_lines_new: r.linesNew, p_synced_until: syncedUntil?.toISOString() ?? null, p_requested_by: opts.requestedBy ?? null,
    });
    if (error) console.error("integration_record_run", error.message);
    return r;
  };

  const { data: integ } = await admin.from("integrations")
    .select("id, organization_id, financial_account_id, credential_slot, enabled, synced_until").eq("id", integrationId).maybeSingle();
  if (!integ || !integ.enabled) return { status: "erro", message: "Integração desativada.", linesNew: 0 };
  const [{ data: acc }, { data: org }] = await Promise.all([
    admin.from("financial_accounts").select("opening_date, is_active").eq("id", integ.financial_account_id).maybeSingle(),
    admin.from("organizations").select("timezone").eq("id", integ.organization_id).maybeSingle(),
  ]);
  if (!acc?.is_active) return record({ status: "erro", message: "A conta está desativada.", linesNew: 0 });
  const opening = String(acc.opening_date);
  const tz = org?.timezone ?? "America/Recife";

  const token = process.env[tokenEnvName(integ.credential_slot)];
  if (!token) {
    return record({ status: "erro", message: `Falta a variável ${tokenEnvName(integ.credential_slot)} na Vercel.`, linesNew: 0 });
  }
  const mp = createMercadoPagoClient(token);
  let linesNew = 0;
  let reportsDone = 0;
  let linesSeen = 0;
  const warnings = new Set<string>();

  const importReady = async (): Promise<Report[]> => {
    const [reports, { data: done }] = await Promise.all([
      mp.list(),
      admin.from("statement_imports").select("file_name").eq("financial_account_id", integ.financial_account_id).eq("source", "mercado_pago_api"),
    ]);
    const imported = new Set((done ?? []).map((d) => d.file_name as string));
    const todo = pendingReports(reports, imported, opening).slice(0, 5);
    for (const rep of todo) {
      const text = await mp.download(rep.file_name);
      const parsed = parseStatement(text, tz);
      if (parsed.source !== "mercado_pago_liberacoes") throw new StatementParseError("O Mercado Pago mandou um relatório num formato inesperado.");
      parsed.warnings.forEach((w) => warnings.add(w));
      // Movimentos anteriores ao saldo inicial já estão nele.
      const lines = parsed.lines.filter((l) => l.posted_date >= opening);
      const sha = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toString("hex");
      const { data, error } = await admin.rpc("integration_import", { p_integration: integ.id, p_file_name: rep.file_name, p_file_sha256: sha, p_lines: lines });
      if (error) throw new Error(error.message);
      linesNew += Number((data as { new?: number })?.new ?? 0);
      linesSeen += lines.length;
      reportsDone += 1;
    }
    return reports;
  };

  try {
    await mp.ensureConfig();
    let reports = await importReady();
    const range = nextRange(new Date(), integ.synced_until ? new Date(integ.synced_until) : null, opening);
    // O relatório pedido por último (nesta execução ou na anterior) já apareceu na lista do Mercado Pago?
    const target = range?.end ?? (integ.synced_until ? new Date(integ.synced_until) : null);
    const arrived = (list: Report[]) => !target || list.some((r) =>
      (r.end_date && Math.abs(Date.parse(r.end_date) - target.getTime()) < 5 * 60_000) ||
      (r.date_created && Date.parse(r.date_created) >= target.getTime() - 2 * 60_000));
    if (range) {
      await mp.request(range.begin, range.end);
      const deadline = Date.now() + (opts.waitMs ?? 20_000);
      reports = [];
      while (!arrived(reports) && Date.now() + 6_000 < deadline) {
        await sleep(6_000);
        reports = await importReady();
      }
    }
    const waiting = !arrived(reports);
    const novos = `${linesNew} movimento${linesNew === 1 ? "" : "s"} novo${linesNew === 1 ? "" : "s"} na conciliação.`;
    const detail = linesNew > 0 ? novos
      : reportsDone > 0 ? `Relatório conferido (${linesSeen} movimento${linesSeen === 1 ? "" : "s"}): nada novo, tudo já estava importado.`
      : "Nenhum movimento novo.";
    const result: SyncResult = waiting
      ? { status: "aguardando", message: `${linesNew ? novos + " " : ""}O Mercado Pago ainda está gerando o relatório mais recente. Clique de novo em alguns minutos ou espere a sincronização de amanhã.`, linesNew }
      : { status: "ok", message: [detail, ...warnings].join(" "), linesNew };
    return record(result, range?.end ?? null);
  } catch (e) {
    const message = e instanceof MercadoPagoError || e instanceof StatementParseError ? e.message : "Erro inesperado na sincronização.";
    if (!(e instanceof MercadoPagoError)) console.error("sync mercado pago", e instanceof Error ? e.message : e);
    return record({ status: "erro", message: linesNew ? `${linesNew} movimento(s) importado(s) antes do erro. ${message}` : message, linesNew });
  }
}

export async function syncAllIntegrations(budgetMs = 45_000) {
  const admin = createAdminClient();
  const { data } = await admin.from("integrations").select("id").eq("enabled", true).order("created_at");
  const ids = (data ?? []).map((d) => d.id as string);
  const each = ids.length ? Math.floor(budgetMs / ids.length) : 0;
  const results: SyncResult[] = [];
  for (const id of ids) results.push(await syncIntegration(id, "agendado", { waitMs: each }));
  return results;
}
