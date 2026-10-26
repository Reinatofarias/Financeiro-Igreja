# Indicadores: definição de cada número

Todos os valores são guardados em centavos (inteiros) e calculados no banco, pelas mesmas funções usadas no painel, nos relatórios e nas exportações. Nenhum número da tela é digitado à mão.

| Indicador | Fórmula | Função no banco |
|---|---|---|
| Saldo por conta | Saldo inicial + entradas − saídas registradas até a data de referência (regime de caixa). Saldo calculado, não o informado pelo banco. | `account_balances(org, data)` |
| Saldo consolidado | Soma dos saldos das contas + valores em trânsito. Transferências internas não mudam o total. | `balance_summary` |
| Em trânsito | Transferências enviadas e ainda não confirmadas no destino (conta transitória). | `balance_summary` |
| Saldo de um fundo | Saldo inicial do fundo + receitas marcadas com o fundo − despesas marcadas com o fundo. | `fund_balances` |
| Recursos vinculados | Soma dos saldos **positivos** dos fundos marcados como vinculados. | `balance_summary` |
| Recursos livres | Saldo consolidado − recursos vinculados. Pode ficar negativo quando dinheiro vinculado foi usado para outra finalidade: é um alerta, não um erro de cálculo. | `balance_summary` |
| Receitas do período | Valor **bruto** das receitas no período, menos estornos. Não inclui saldo inicial nem transferências. | `report_totals` |
| Despesas do período | Despesas + tarifas no período, menos estornos. Não inclui transferências. | `report_totals` |
| Resultado do período | Receitas − despesas. | `report_totals` |
| Por categoria | Mesma base acima, agrupada pela categoria principal (subcategorias somam na mãe). Percentual sobre o total do tipo. | `report_by_category` |
| Diferença de caixa | Valor contado − saldo calculado no fechamento do caixa físico. Vira lançamento de sobra (receita) ou falta (despesa). | `close_cash_session` |

## Regime de caixa e de competência

- **Caixa**: usa a data em que o dinheiro entrou ou saiu.
- **Competência**: usa o mês a que o valor se refere (ex.: conta de energia de setembro paga em outubro).

## Receita com tarifa

Uma receita de R$ 100,00 com tarifa de R$ 0,99 gera três partidas: débito de R$ 99,01 na conta, débito de R$ 0,99 em "Tarifas bancárias" e crédito de R$ 100,00 na categoria da receita. Assim a receita aparece pelo valor bruto e a tarifa aparece como despesa, e o saldo da conta bate com o valor líquido.

## Data de referência dos saldos

Os saldos usam o fim do período filtrado ou hoje, o que vier antes. Nunca mostramos saldo "datado no futuro".
