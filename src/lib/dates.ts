// Datas de negócio são strings ISO "AAAA-MM-DD" (sem fuso). Exibição no padrão brasileiro.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = ISO.exec(iso.slice(0, 10));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function formatDateTimeBR(ts: string | null | undefined, timeZone = "America/Recife"): string {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(ts));
}

/** Data de hoje no fuso da organização. */
export function todayIn(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA já usa AAAA-MM-DD
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function monthEnd(iso: string): string {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

export function addMonths(iso: string, n: number): string {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_FULL = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function monthLabel(iso: string, full = false): string {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  return full ? `${MONTHS_FULL[m - 1]} de ${y}` : `${MONTHS[m - 1]}/${String(y).slice(2)}`;
}

/** Período legível: "01/02/2020 a 29/02/2020" ou "fevereiro de 2020" quando é um mês cheio. */
export function periodLabel(start: string, end: string): string {
  if (start === monthStart(start) && end === monthEnd(start)) return monthLabel(start, true);
  return `${formatDateBR(start)} a ${formatDateBR(end)}`;
}
