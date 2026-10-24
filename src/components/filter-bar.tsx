import type { Filters } from "@/lib/finance/filters";
import { categoryOptions, type Lookups } from "@/lib/finance/lookups";
import { buttonStyles, Input, Select } from "@/components/ui";

/** Filtros por período, regime, conta, fundo, ministério, projeto e categoria. Ficam na URL (podem ser salvos e compartilhados). */
export function FilterBar({ filters, lookups, action, showCategory = true }: { filters: Filters; lookups: Lookups; action: string; showCategory?: boolean }) {
  const label = "flex flex-col gap-1 text-xs font-medium text-muted";
  const cats = [...categoryOptions(lookups.categories, "receita", false), ...categoryOptions(lookups.categories, "despesa", false)];
  return (
    <form method="get" action={action} className="no-print rounded-lg border border-line bg-surface p-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <label className={label}>
          De
          <Input type="date" name="inicio" defaultValue={filters.start} required />
        </label>
        <label className={label}>
          Até
          <Input type="date" name="fim" defaultValue={filters.end} required />
        </label>
        <label className={label}>
          Regime
          <Select name="regime" defaultValue={filters.basis}>
            <option value="caixa">Caixa (pagamento)</option>
            <option value="competencia">Competência</option>
          </Select>
        </label>
        <label className={label}>
          Conta
          <Select name="conta" defaultValue={filters.account ?? ""}>
            <option value="">Todas</option>
            {lookups.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </label>
        <label className={label}>
          Fundo
          <Select name="fundo" defaultValue={filters.fund ?? ""}>
            <option value="">Todos</option>
            {lookups.funds.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </label>
        <label className={label}>
          Ministério
          <Select name="ministerio" defaultValue={filters.ministry ?? ""}>
            <option value="">Todos</option>
            {lookups.ministries.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </label>
        <label className={label}>
          Projeto
          <Select name="projeto" defaultValue={filters.project ?? ""}>
            <option value="">Todos</option>
            {lookups.projects.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </label>
        {showCategory && (
          <label className={label}>
            Categoria
            <Select name="categoria" defaultValue={filters.category ?? ""}>
              <option value="">Todas</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
          </label>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={buttonStyles.primary}>Aplicar filtros</button>
        <a className={buttonStyles.ghost} href={`${action}?periodo=mes-anterior`}>Mês anterior</a>
        <a className={buttonStyles.ghost} href={`${action}?periodo=12-meses`}>Últimos 12 meses</a>
        <a className={buttonStyles.ghost} href={`${action}?periodo=ano`}>Este ano</a>
        <a className={buttonStyles.ghost} href={action}>Limpar</a>
      </div>
    </form>
  );
}
