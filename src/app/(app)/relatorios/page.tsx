import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { addMonths, monthEnd, monthStart, todayIn } from "@/lib/dates";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Relatórios" };

const INDICATORS: [string, string][] = [
  ["Saldo por conta", "Saldo inicial da conta + soma das entradas − soma das saídas registradas até a data de referência (regime de caixa). É o saldo calculado pelo sistema, não o informado pelo banco."],
  ["Saldo consolidado", "Soma dos saldos de todas as contas + valores em trânsito. Transferências internas não alteram este total."],
  ["Recursos vinculados", "Soma dos saldos positivos dos fundos marcados como vinculados. Saldo do fundo = saldo inicial do fundo + receitas marcadas com o fundo − despesas marcadas com o fundo."],
  ["Recursos livres", "Saldo consolidado − recursos vinculados. Pode ficar negativo se o dinheiro vinculado foi usado para outra finalidade."],
  ["Em trânsito", "Transferências enviadas e ainda não confirmadas na conta de destino."],
  ["Receitas do período", "Soma, pelo valor bruto, das receitas com data no período (caixa = data do recebimento; competência = mês de referência), menos estornos. Não inclui saldo inicial nem transferências."],
  ["Despesas do período", "Soma das despesas e tarifas no período, menos estornos. Não inclui transferências."],
  ["Resultado do período", "Receitas do período − despesas do período."],
  ["Distribuição por categoria", "Mesma base das receitas e despesas do período, agrupada pela categoria principal; o percentual é sobre o total do tipo."],
  ["Diferença de caixa", "Valor contado − saldo calculado no fechamento do caixa físico. Vira lançamento de sobra (receita) ou falta (despesa)."],
];

export default async function ReportsPage() {
  const ctx = await requireContext();
  const today = todayIn(ctx.org.timezone);
  const cur = monthStart(today);
  const prev = addMonths(cur, -1);
  const link = (start: string, end: string, extra = "") => `/relatorios/mensal?inicio=${start}&fim=${end}${extra}`;

  return (
    <>
      <PageHeader title="Relatórios" description="Os relatórios usam as mesmas funções e a mesma data de referência do painel." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Prestação de contas mensal">
          <p className="text-sm text-muted">Resumo, saldos por conta, fundos, gráfico mensal com tabela de apoio e totais por categoria. Pronto para imprimir ou salvar em PDF.</p>
          <ul className="mt-3 space-y-1 text-sm">
            <li><Link className="text-brand underline" href={link(prev, monthEnd(prev))}>Mês anterior (A4 retrato)</Link></li>
            <li><Link className="text-brand underline" href={link(cur, monthEnd(cur))}>Mês atual, parcial (A4 retrato)</Link></li>
            <li><Link className="text-brand underline" href={link(`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`, "&formato=paisagem")}>Ano corrente (A4 paisagem)</Link></li>
            <li><Link className="text-brand underline" href={link(addMonths(cur, -11), monthEnd(cur), "&formato=a3")}>Gráficos ampliados, últimos 12 meses (A3)</Link></li>
            <li><Link className="text-brand underline" href={link(prev, monthEnd(prev), "&formato=tela")}>Apresentação em tela ou projetor</Link></li>
          </ul>
        </Card>
        <Card title="Exportações">
          <ul className="space-y-1 text-sm">
            <li><a className="text-brand underline" href={`/api/exportar/lancamentos?inicio=${prev}&fim=${monthEnd(prev)}`}>Lançamentos do mês anterior (CSV)</a></li>
            <li><a className="text-brand underline" href={`/api/exportar/resumo?inicio=${addMonths(cur, -11)}&fim=${monthEnd(cur)}`}>Resumo mensal dos últimos 12 meses (CSV)</a></li>
          </ul>
          <p className="mt-2 text-xs text-muted">CSV com ponto e vírgula, abre direto no Excel e no Google Planilhas. XLSX e pacote para o contador ficam para uma próxima etapa.</p>
        </Card>
      </div>
      <Card title="Como cada indicador é calculado">
        <dl className="space-y-3 text-sm">
          {INDICATORS.map(([k, v]) => (
            <div key={k}><dt className="font-medium">{k}</dt><dd className="text-muted">{v}</dd></div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted">O sistema organiza as informações financeiras e apoia o trabalho do contador, mas não substitui a escrituração contábil nem declara conformidade fiscal.</p>
      </Card>
    </>
  );
}
