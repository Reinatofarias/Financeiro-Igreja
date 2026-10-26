import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { filtersToQuery, parseFilters } from "@/lib/finance/filters";
import { loadLookups } from "@/lib/finance/lookups";
import { ENTRY_KIND_LABEL, kindTone } from "@/lib/finance/labels";
import { formatDateBR, periodLabel } from "@/lib/dates";
import { Badge, ButtonLink, EmptyState, Input, Money, PageHeader, Select, Table, buttonStyles } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";

export const metadata: Metadata = { title: "Lançamentos" };
const PAGE_SIZE = 50;
const KINDS = ["receita", "despesa", "transferencia", "ajuste", "estorno", "saldo_inicial", "reclassificacao"];

export default async function EntriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const filters = parseFilters(sp, ctx.org.timezone);
  const lookups = await loadLookups(ctx.org.id);
  const kind = typeof sp.tipo === "string" && KINDS.includes(sp.tipo) ? sp.tipo : "";
  const search = typeof sp.busca === "string" ? sp.busca.trim().slice(0, 80) : "";
  const page = Math.max(1, Number(sp.pagina) || 1);
  const dateCol = filters.basis === "competencia" ? "competence_date" : "cash_date";

  const supabase = await createClient();
  let query = supabase
    .from("entry_index")
    .select("id, number, kind, status, description, cash_date, competence_date, origin, amount_cents, cash_effect_cents, account_names, category_names, touches_transit", { count: "exact" })
    .eq("organization_id", ctx.org.id)
    .gte(dateCol, filters.start)
    .lte(dateCol, filters.end)
    .order(dateCol, { ascending: false })
    .order("number", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (kind) query = query.eq("kind", kind);
  if (search) query = query.ilike("description", `%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
  if (filters.account) query = query.contains("account_ids", [filters.account]);
  if (filters.fund) query = query.contains("fund_ids", [filters.fund]);
  if (filters.ministry) query = query.contains("ministry_ids", [filters.ministry]);
  if (filters.project) query = query.contains("project_ids", [filters.project]);
  if (filters.category) {
    const ids = new Set([filters.category]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of lookups.categories) if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) { ids.add(c.id); grew = true; }
    }
    query = query.overlaps("category_ids", [...ids]);
  }
  const { data: rows, count, error } = await query;
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const baseQ = filtersToQuery(filters, { tipo: kind, busca: search });

  return (
    <>
      <PageHeader
        title="Lançamentos"
        description={`${periodLabel(filters.start, filters.end)} · ${total} lançamento(s)`}
        actions={
          ctx.can.operate ? (
            <>
              <ButtonLink href="/lancamentos/novo?tipo=receita">Nova receita</ButtonLink>
              <ButtonLink href="/lancamentos/novo?tipo=despesa" variant="secondary">Nova despesa</ButtonLink>
              <ButtonLink href="/lancamentos/novo?tipo=transferencia" variant="secondary">Transferência</ButtonLink>
            </>
          ) : undefined
        }
      />
      <FilterBar filters={filters} lookups={lookups} action="/lancamentos" />
      <form method="get" className="no-print flex flex-wrap items-end gap-2">
        {Object.entries(Object.fromEntries(new URLSearchParams(filtersToQuery(filters)))).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Tipo
          <Select name="tipo" defaultValue={kind}>
            <option value="">Todos</option>
            {KINDS.map((k) => <option key={k} value={k}>{ENTRY_KIND_LABEL[k]}</option>)}
          </Select>
        </label>
        <label className="flex min-w-0 flex-1 basis-60 flex-col gap-1 text-xs font-medium text-muted">
          Buscar na descrição
          <Input type="search" name="busca" defaultValue={search} placeholder="Ex.: energia, culto, oferta missionária" />
        </label>
        <button className={buttonStyles.secondary}>Buscar</button>
        <a className={buttonStyles.ghost} href={`/api/exportar/lancamentos?${baseQ}`}>Exportar CSV</a>
      </form>

      {error ? (
        <EmptyState title="Não foi possível carregar os lançamentos.">Tente novamente em instantes.</EmptyState>
      ) : !rows?.length ? (
        <EmptyState
          title="Nenhum lançamento encontrado"
          action={ctx.can.operate ? <ButtonLink href="/lancamentos/novo?tipo=receita">Lançar a primeira receita</ButtonLink> : undefined}
        >
          Ajuste o período ou os filtros acima.
        </EmptyState>
      ) : (
        <>
        {/* Celular: lista em cartões, fácil de tocar */}
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface sm:hidden">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/lancamentos/${r.id}`} className={`flex items-start justify-between gap-3 px-4 py-3 active:bg-bg ${r.status === "estornado" ? "text-muted" : ""}`}>
                <div className="min-w-0">
                  <p className={`truncate font-medium ${r.status === "estornado" ? "line-through" : ""}`}>{r.description}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {formatDateBR(filters.basis === "competencia" ? r.competence_date : r.cash_date)} · {r.account_names ?? (r.touches_transit ? "Em trânsito" : "—")}
                    {r.category_names ? ` · ${r.category_names}` : ""}
                  </p>
                  <div className="mt-1.5 flex gap-1">
                    <Badge tone={kindTone(r.kind)}>{ENTRY_KIND_LABEL[r.kind]}</Badge>
                    {r.status === "estornado" && <Badge tone="warn">Estornado</Badge>}
                  </div>
                </div>
                <Money
                  className="shrink-0 font-semibold"
                  cents={r.kind === "despesa" ? -r.amount_cents : r.kind === "receita" ? r.amount_cents : r.cash_effect_cents || r.amount_cents}
                  colored={r.kind === "receita" || r.kind === "despesa"}
                />
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden sm:block">
        <Table>
          <thead>
            <tr>
              <th>Nº</th>
              <th>{filters.basis === "competencia" ? "Competência" : "Data"}</th>
              <th>Descrição</th>
              <th>Conta</th>
              <th>Categoria</th>
              <th>Tipo</th>
              <th className="text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.status === "estornado" ? "text-muted line-through decoration-1" : ""}>
                <td className="num">{r.number}</td>
                <td className="num">{formatDateBR(filters.basis === "competencia" ? r.competence_date : r.cash_date)}</td>
                <td><Link href={`/lancamentos/${r.id}`} className="text-brand underline">{r.description}</Link></td>
                <td>{r.account_names ?? (r.touches_transit ? "Em trânsito" : "—")}</td>
                <td>{r.category_names ?? "—"}</td>
                <td><Badge tone={kindTone(r.kind)}>{ENTRY_KIND_LABEL[r.kind]}</Badge>{r.status === "estornado" && <span className="ml-1"><Badge tone="warn">Estornado</Badge></span>}</td>
                <td className="text-right">
                  <Money cents={r.kind === "despesa" ? -r.amount_cents : r.kind === "receita" ? r.amount_cents : r.cash_effect_cents || r.amount_cents} colored={r.kind === "receita" || r.kind === "despesa"} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        </div>
        </>
      )}
      {pages > 1 && (
        <nav className="no-print flex items-center justify-between text-sm" aria-label="Paginação">
          <span className="text-muted">Página {page} de {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <a className={buttonStyles.secondary} href={`/lancamentos?${baseQ}&pagina=${page - 1}`}>Anterior</a>}
            {page < pages && <a className={buttonStyles.secondary} href={`/lancamentos?${baseQ}&pagina=${page + 1}`}>Próxima</a>}
          </div>
        </nav>
      )}
    </>
  );
}
