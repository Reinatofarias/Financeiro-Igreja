import { addMonths, isIsoDate, monthEnd, monthStart, todayIn } from "@/lib/dates";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Filters = {
  start: string;
  end: string;
  basis: "caixa" | "competencia";
  account: string | null;
  fund: string | null;
  ministry: string | null;
  project: string | null;
  category: string | null;
};

type SP = Record<string, string | string[] | undefined>;

function one(sp: SP, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}
const uuid = (v: string | undefined) => (v && UUID.test(v) ? v : null);

/** Lê e valida os filtros da URL. Padrão: mês corrente, regime de caixa. */
export function parseFilters(sp: SP, timeZone: string): Filters {
  const today = todayIn(timeZone);
  const preset = one(sp, "periodo");
  let start = one(sp, "inicio");
  let end = one(sp, "fim");
  if (preset === "mes-anterior") {
    start = addMonths(monthStart(today), -1);
    end = monthEnd(start);
  } else if (preset === "ano") {
    start = `${today.slice(0, 4)}-01-01`;
    end = `${today.slice(0, 4)}-12-31`;
  } else if (preset === "12-meses") {
    start = addMonths(monthStart(today), -11);
    end = monthEnd(today);
  }
  if (!isIsoDate(start)) start = monthStart(today);
  if (!isIsoDate(end)) end = monthEnd(start);
  if (end < start) end = monthEnd(start);
  return {
    start,
    end,
    basis: one(sp, "regime") === "competencia" ? "competencia" : "caixa",
    account: uuid(one(sp, "conta")),
    fund: uuid(one(sp, "fundo")),
    ministry: uuid(one(sp, "ministerio")),
    project: uuid(one(sp, "projeto")),
    category: uuid(one(sp, "categoria")),
  };
}

export function rpcFilterArgs(orgId: string, f: Filters) {
  return {
    p_org: orgId,
    p_start: f.start,
    p_end: f.end,
    p_basis: f.basis,
    p_account: f.account,
    p_fund: f.fund,
    p_ministry: f.ministry,
    p_project: f.project,
  };
}

/** Querystring equivalente, para links de "ver origem" e relatório impresso com os mesmos filtros. */
export function filtersToQuery(f: Filters, extra: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams();
  q.set("inicio", f.start);
  q.set("fim", f.end);
  if (f.basis !== "caixa") q.set("regime", f.basis);
  if (f.account) q.set("conta", f.account);
  if (f.fund) q.set("fundo", f.fund);
  if (f.ministry) q.set("ministerio", f.ministry);
  if (f.project) q.set("projeto", f.project);
  if (f.category) q.set("categoria", f.category);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  return q.toString();
}
