// Cliente mínimo da API de relatórios do Mercado Pago (relatório "Dinheiro em conta" / liberações).
// Sem imports com "@/": os testes rodam este arquivo direto no Node.
// O token vem das variáveis de ambiente do servidor e nunca é registrado em log nem salvo no banco.

const API = "https://api.mercadopago.com/v1/account/settlement_report";
export const REPORT_PREFIX = "financeiro-igreja";
/** Colunas que o leitor do relatório de liberações usa (ver parseMercadoPagoLiberacoes). */
export const REQUIRED_COLUMNS = [
  "SOURCE_ID", "TRANSACTION_TYPE", "TRANSACTION_AMOUNT", "FEE_AMOUNT", "SETTLEMENT_NET_AMOUNT",
  "TRANSACTION_DATE", "MONEY_RELEASE_DATE", "PAYMENT_METHOD", "SUB_UNIT",
];
const DAY = 86_400_000;
/** O Mercado Pago gera relatórios de no máximo 60 dias. */
export const MAX_RANGE_DAYS = 59;

export type Report = { file_name: string; begin_date?: string; end_date?: string; date_created?: string; created_from?: string };
type Fetch = typeof fetch;

export class MercadoPagoError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) { super(message); this.status = status; }
}

function friendly(status: number): string {
  if (status === 401) return "O Mercado Pago recusou o token (401). Confira se é o Access Token de produção e se não foi renovado.";
  if (status === 403) return "O token não tem permissão para relatórios (403). Gere o token na conta da igreja, não numa conta de teste.";
  if (status === 429) return "O Mercado Pago pediu para esperar (muitas requisições). Tente de novo mais tarde.";
  if (status >= 500) return `O Mercado Pago está instável agora (${status}). A próxima sincronização tenta de novo.`;
  return `O Mercado Pago respondeu com erro ${status}.`;
}

export function createMercadoPagoClient(token: string, f: Fetch = fetch) {
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await f(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
      cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });
    return res;
  }
  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await call(path, init);
    if (!res.ok) throw new MercadoPagoError(friendly(res.status), res.status);
    return (await res.json()) as T;
  }

  return {
    /** Garante que o relatório traga as colunas que o sistema lê, sem apagar o que já estiver configurado. */
    async ensureConfig(): Promise<{ prefix: string }> {
      const res = await call("/config");
      if (res.status === 404) {
        await json("/config", { method: "POST", body: JSON.stringify({
          file_name_prefix: REPORT_PREFIX, separator: ",", display_timezone: "GMT-03",
          columns: REQUIRED_COLUMNS.map((key) => ({ key })),
        }) });
        return { prefix: REPORT_PREFIX };
      }
      if (!res.ok) throw new MercadoPagoError(friendly(res.status), res.status);
      const cfg = (await res.json()) as Record<string, unknown> & { columns?: { key: string }[]; file_name_prefix?: string; separator?: string };
      const have = new Set((cfg.columns ?? []).map((c) => c.key));
      const missing = REQUIRED_COLUMNS.filter((k) => !have.has(k));
      const prefix = cfg.file_name_prefix || REPORT_PREFIX;
      const translated = typeof cfg.report_translation === "string" && cfg.report_translation !== "en";
      if (missing.length > 0 || (cfg.separator && cfg.separator !== ",") || translated) {
        const keep = Object.fromEntries(Object.entries(cfg).filter(([k]) =>
          ["display_timezone", "notification_email_list", "frequency", "refund_detailed", "include_withdrawal", "coupon_detailed", "check_available_balance", "compensate_detail", "unite_reserve", "sftp_info"].includes(k)));
        await json("/config", { method: "PUT", body: JSON.stringify({
          ...keep, file_name_prefix: prefix, separator: ",", ...(translated ? { report_translation: "en" } : {}),
          columns: [...(cfg.columns ?? []), ...missing.map((key) => ({ key }))],
        }) });
      }
      return { prefix };
    },
    async list(): Promise<Report[]> {
      const data = await json<Report[] | { results?: Report[] }>("/list");
      return Array.isArray(data) ? data : data.results ?? [];
    },
    async download(fileName: string): Promise<string> {
      if (!/^[\w.\-]+$/.test(fileName)) throw new MercadoPagoError("Nome de relatório inválido.");
      const res = await call(`/${encodeURIComponent(fileName)}`, { headers: { Accept: "text/csv" } });
      if (!res.ok) throw new MercadoPagoError(friendly(res.status), res.status);
      return await res.text();
    },
    /** Pede um relatório novo. O Mercado Pago gera em segundo plano (202). */
    async request(begin: Date, end: Date): Promise<void> {
      const res = await call("", { method: "POST", body: JSON.stringify({ begin_date: isoSeconds(begin), end_date: isoSeconds(end) }) });
      if (res.status === 202 || res.status === 200 || res.status === 201) return;
      if (res.status === 203) throw new MercadoPagoError("O Mercado Pago não aceitou o período pedido. A próxima sincronização ajusta as datas.", 203);
      throw new MercadoPagoError(friendly(res.status), res.status);
    },
  };
}

export function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Período do próximo relatório: continua de onde a última sincronização parou (com 1 dia de folga,
 * porque movimentos repetidos são descartados), nunca antes do saldo inicial da conta e no máximo 59 dias.
 * Retorna null quando a última sincronização foi há menos de 1 hora.
 */
export function nextRange(now: Date, syncedUntil: Date | null, openingDate: string): { begin: Date; end: Date } | null {
  const end = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  if (syncedUntil && end.getTime() - syncedUntil.getTime() < 3_600_000) return null;
  const opening = new Date(`${openingDate}T00:00:00-03:00`);
  const fromLast = syncedUntil ? new Date(syncedUntil.getTime() - DAY) : opening;
  const floor = new Date(end.getTime() - MAX_RANGE_DAYS * DAY);
  const begin = new Date(Math.max(fromLast.getTime(), opening.getTime(), floor.getTime()));
  return { begin, end };
}

/** Relatórios que ainda não foram importados e cobrem algum dia a partir do saldo inicial. */
export function pendingReports(reports: Report[], imported: Set<string>, openingDate: string): Report[] {
  const opening = Date.parse(`${openingDate}T00:00:00-03:00`);
  return reports
    .filter((r) => r.file_name && /\.csv$/i.test(r.file_name) && !imported.has(r.file_name))
    .filter((r) => !r.end_date || Date.parse(r.end_date) >= opening)
    .sort((a, b) => (a.date_created ?? "").localeCompare(b.date_created ?? ""));
}
