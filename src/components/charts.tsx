import { formatBRL } from "@/lib/money";
import { monthLabel } from "@/lib/dates";
import type { CategoryRow, MonthRow } from "@/lib/finance/reports";

// Gráficos em SVG renderizados no servidor: imprimem sem cortes, funcionam sem JavaScript
// e trazem a tabela de apoio com os mesmos números. Paleta validada para daltonismo e escala de cinza.
export const SERIES = { income: "#2a6fb0", expense: "#c26a12" };

function niceMax(v: number) {
  if (v <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * exp;
}

function shortBRL(cents: number) {
  const reais = cents / 100;
  if (Math.abs(reais) >= 1_000_000) return `R$ ${(reais / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (Math.abs(reais) >= 1_000) return `R$ ${(reais / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${reais.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

export function Legend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted" aria-hidden>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-sm" style={{ background: SERIES.income }} /> Receitas
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-3 w-3 rounded-sm"
          style={{ background: `repeating-linear-gradient(45deg, ${SERIES.expense} 0 2px, #e8b98a 2px 4px)` }}
        />{" "}
        Despesas
      </span>
    </div>
  );
}

/** Receitas e despesas por mês, barras lado a lado. */
export function MonthlyChart({ rows, height = 240, title = "Receitas e despesas por mês" }: { rows: MonthRow[]; height?: number; title?: string }) {
  const W = 720;
  const H = height;
  const pad = { top: 12, right: 8, bottom: 28, left: 64 };
  const max = niceMax(Math.max(0, ...rows.flatMap((r) => [r.income_cents, r.expense_cents])));
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const band = plotW / Math.max(rows.length, 1);
  const barW = Math.max(4, Math.min(22, band / 2 - 4));
  const y = (v: number) => pad.top + plotH - (Math.max(v, 0) / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);

  return (
    <figure className="avoid-break">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
        <defs>
          <pattern id="hatch-expense" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill={SERIES.expense} />
            <line x1="0" y1="0" x2="0" y2="5" stroke="#f3d9bf" strokeWidth="1.5" />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="#e3e7ec" strokeWidth="1" />
            <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#5b6673">
              {shortBRL(t)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = pad.left + band * i + band / 2;
          return (
            <g key={r.month}>
              <rect x={cx - barW - 1} y={y(r.income_cents)} width={barW} height={pad.top + plotH - y(r.income_cents)} rx="2" fill={SERIES.income}>
                <title>{`${monthLabel(r.month, true)} · Receitas ${formatBRL(r.income_cents)}`}</title>
              </rect>
              <rect x={cx + 1} y={y(r.expense_cents)} width={barW} height={pad.top + plotH - y(r.expense_cents)} rx="2" fill="url(#hatch-expense)">
                <title>{`${monthLabel(r.month, true)} · Despesas ${formatBRL(r.expense_cents)}`}</title>
              </rect>
              <text x={cx} y={H - 10} textAnchor="middle" fontSize="11" fill="#5b6673">
                {monthLabel(r.month)}
              </text>
            </g>
          );
        })}
        <line x1={pad.left} x2={W - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} stroke="#9aa4af" />
      </svg>
      <figcaption className="mt-2">
        <Legend />
      </figcaption>
    </figure>
  );
}

/** Distribuição por categoria: barras horizontais com rótulo e valor (legível também impresso). */
export function CategoryBars({ rows, kind, limit = 10 }: { rows: CategoryRow[]; kind: "receita" | "despesa"; limit?: number }) {
  const total = rows.reduce((s, r) => s + r.total_cents, 0);
  const shown = rows.slice(0, limit);
  const others = rows.slice(limit).reduce((s, r) => s + r.total_cents, 0);
  const list = others !== 0 ? [...shown, { category_id: "outros", category_name: "Outras categorias", parent_name: null, total_cents: others }] : shown;
  const max = Math.max(1, ...list.map((r) => r.total_cents));
  const color = kind === "receita" ? SERIES.income : SERIES.expense;
  if (list.length === 0) return <p className="text-sm text-muted">Nenhum valor no período.</p>;
  return (
    <ul className="space-y-2">
      {list.map((r) => {
        const pct = total ? (r.total_cents / total) * 100 : 0;
        return (
          <li key={r.category_id} className="avoid-break text-sm">
            <div className="flex justify-between gap-2">
              <span className="truncate">{r.parent_name ? `${r.parent_name} › ${r.category_name}` : r.category_name}</span>
              <span className="num">
                {formatBRL(r.total_cents)} <span className="text-muted">({pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)</span>
              </span>
            </div>
            <div className="mt-1 h-2 rounded bg-bg" aria-hidden>
              <div className="h-2 rounded" style={{ width: `${Math.max(0, (r.total_cents / max) * 100)}%`, background: color }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Tabela de apoio do gráfico mensal (mesmos números). */
export function MonthlyTable({ rows }: { rows: MonthRow[] }) {
  const sum = (k: keyof MonthRow) => rows.reduce((s, r) => s + Number(r[k]), 0);
  return (
    <table className="w-full text-sm [&_td]:border-t [&_td]:border-line [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-medium [&_th]:text-muted">
      <thead>
        <tr>
          <th className="text-left">Mês</th>
          <th className="text-right">Receitas</th>
          <th className="text-right">Despesas</th>
          <th className="text-right">Resultado</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.month}>
            <td>{monthLabel(r.month, true)}</td>
            <td className="num text-right">{formatBRL(r.income_cents)}</td>
            <td className="num text-right">{formatBRL(r.expense_cents)}</td>
            <td className="num text-right">{formatBRL(r.result_cents)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-semibold">
          <td>Total</td>
          <td className="num text-right">{formatBRL(sum("income_cents"))}</td>
          <td className="num text-right">{formatBRL(sum("expense_cents"))}</td>
          <td className="num text-right">{formatBRL(sum("result_cents"))}</td>
        </tr>
      </tfoot>
    </table>
  );
}
