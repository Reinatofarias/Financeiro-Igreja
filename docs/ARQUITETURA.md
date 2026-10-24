# Financeiro da Igreja — Arquitetura e plano

Versão 0.1 · 24/10/2026 · documento vivo, atualizado a cada fase.

## 1. Entendimento do produto

Um sistema de tesouraria para uma igreja brasileira, operado por voluntários e tesoureiros sem formação técnica, que:

- reúne em um só lugar as quatro contas iniciais (Mercado Pago A, Mercado Pago B, Cora, PagBank), o caixa físico e quaisquer outras contas cadastradas manualmente, cada uma com saldo, histórico e (quando houver) conexão própria;
- registra receitas (dízimos, ofertas, doações, campanhas, eventos), despesas, transferências e compromissos, com comprovantes;
- mantém por trás da tela simples um **razão de partidas dobradas**, de forma que todo total exibido é a soma de partidas identificáveis, sem duplicação;
- concilia o que a igreja lançou com o que o banco informou;
- produz dashboards, relatórios imprimíveis e uma prestação de contas pública aprovada e sem dados pessoais.

O sistema registra e concilia. Ele **não inicia pagamentos** na primeira versão.

## 2. Hipóteses adotadas (até resposta em contrário)

1. Uma organização (a igreja) com uma unidade-sede; o modelo já aceita unidades/congregações e ministérios, mas a interface não expõe multi-igreja.
2. Regime de visualização padrão: **caixa** (data do pagamento). Competência é registrada em todo lançamento e disponível como filtro.
3. Moeda única BRL; valores em **centavos inteiros** (`bigint`) no banco e na aplicação.
4. Fuso padrão `America/Recife`, configurável por organização. Datas exibidas como dd/mm/aaaa.
5. As contas Mercado Pago, Cora e PagBank são **PJ no CNPJ da igreja** e os titulares podem gerar credenciais oficiais de API.
6. Dízimos e ofertas podem ser anônimos; a identificação do doador é opcional e fica em tabela de acesso restrito.
7. Deploy na Vercel e Supabase em plano pago (ver custos). No plano Hobby da Vercel, cron só roda 1x/dia; sincronização mais frequente exige Pro ou um disparador externo.
8. Cada pessoa usuária tem um login individual (nada de senha compartilhada da tesouraria).

## 3. Perguntas que mudam arquitetura ou regras

1. **As contas são PJ (CNPJ da igreja) ou alguma é PF de um pastor/tesoureiro?** Conta PF muda o tratamento de dados e as APIs disponíveis.
2. **No PagBank, a igreja usa maquininha/link de pagamento ou só a conta (Pix, transferências)?** A API EDI documentada cobre movimentos de vendas; se o uso for só conta, a via provável é o extrato OFX/CSV.
3. **No Mercado Pago, as entradas são Pix recebidos na conta, QR Code, link de pagamento ou maquininha?** Define se o relatório de "dinheiro em conta" (settlement report) basta ou se também precisamos da API de pagamentos.
4. **Quantas pessoas vão operar e quem aprova despesas?** Existe um valor a partir do qual a despesa precisa de segundo aprovador?
5. **Quais fundos/finalidades são vinculados hoje?** Ex.: construção, missões, ação social. Eles têm saldo próprio a acompanhar desde já?
6. **A igreja quer controlar dízimo por pessoa (com nome) ou apenas totais?** Muda o escopo do cadastro de doadores e a LGPD.
7. **Qual a data de início (saldo inicial) e há histórico anterior para importar?** Ex.: planilhas de 2026.
8. **Plano da Vercel e do Supabase:** já existe conta paga, ou começamos no gratuito sabendo das limitações (cron diário, pausa do projeto Supabase gratuito por inatividade, sem backups automáticos)?

## 4. Arquitetura proposta

**Monólito modular** em Next.js 16 (App Router, TypeScript) na Vercel, com Supabase (Postgres, Auth, Storage).

```
src/
  app/                 interface (rotas, Server Components, Server Actions)
  lib/money            regras monetárias puras (centavos, parsing pt-BR)
  lib/finance          regras financeiras e chamadas às funções do banco
  lib/supabase         clientes (navegador, servidor, service-role só no servidor)
  lib/auth             sessão, papéis, MFA
  integrations/        adaptadores por provedor (Fase 3)
  jobs/                processadores de fila (Fase 2/3)
supabase/
  migrations/          SQL versionado (fonte da verdade do banco)
  tests/               testes SQL (partidas, RLS, períodos)
```

### Onde moram as regras

- **No banco**: partidas dobradas (constraint de soma zero), imutabilidade de lançamentos confirmados, estorno, bloqueio de período fechado, RLS por organização/unidade/papel, auditoria por trigger. Toda operação financeira é uma função SQL (`post_income`, `post_expense`, `post_transfer`, `reverse_entry`, `close_cash_session`...) executada em uma transação.
- **No servidor Next**: validação de entrada (zod), autorização de alto nível, orquestração e chamadas a provedores. A interface nunca é a única barreira.
- **No navegador**: só apresentação. A chave `service_role` e as credenciais bancárias nunca chegam ao navegador.

### Fluxos

| Tipo | Como funciona |
|---|---|
| Requisições síncronas | Server Actions/rotas chamam funções SQL com o JWT da pessoa usuária, então o RLS vale sempre. |
| Webhooks | Rota `/api/webhooks/{provedor}/{conexao}` valida assinatura, grava o evento bruto em `sync_events` (único por conexão + id do evento) e responde 200 em poucos ms. Nada é processado na própria requisição. |
| Importações (CSV/OFX) | Upload para bucket privado → registro em `imports` → prévia e mapeamento → confirmação cria job. |
| Sincronizações agendadas | Vercel Cron chama `/api/cron/tick` (protegido por `CRON_SECRET`), que só **enfileira** jobs por conexão. |
| Processamento demorado | Tabela `jobs` no Postgres como fila persistente: `status`, `attempts`, `run_after`, `locked_until`, `checkpoint jsonb`. O worker pega um job com `FOR UPDATE SKIP LOCKED`, processa em lotes curtos dentro do limite da função, grava checkpoint e reagenda o restante. |
| Reprocessamento | Falha incrementa `attempts` com backoff exponencial; após N tentativas vai a `dead`, visível na tela de integrações com botão "reprocessar". Como eventos brutos ficam guardados, normalização pode ser refeita sem consultar o banco de novo. |
| Concorrência | Um advisory lock por conexão impede duas sincronizações simultâneas da mesma conta. |

Nenhuma tarefa depende de código rodando após a resposta HTTP.

## 5. Matriz de integrações (fontes oficiais, 24/10/2026)

Legenda: ✅ confirmado na documentação · ⚠️ incerto/não documentado · ❌ não disponível.

| Item | Mercado Pago (2 contas) | Cora | PagBank |
|---|---|---|---|
| Autenticação | Access token por aplicação (Bearer). Cada conta = aplicação/credencial própria ✅ | Integração Direta: `client_credentials` com **mTLS** (certificado + chave privada), token de 24h ✅ | EDI: Basic Auth com ID do estabelecimento + token EDI ✅ |
| Habilitação | Criar aplicação no painel de desenvolvedor de cada conta ⚠️ (requisitos PJ a confirmar) | Credenciais solicitadas pelo app/Cora Web ✅; plano exigido ⚠️ | Conta vendedor + **produto EDI habilitado** ✅ |
| Saldo | ⚠️ não há endpoint de saldo da conta confirmado; usar saldo do relatório/calculado | `GET` saldo de conta ✅ | ❌ não documentado na API EDI |
| Extrato / cobertura | Relatório "dinheiro em conta" (settlement report): movimentos que afetaram o saldo, gerado de forma **assíncrona**, CSV/XLSX, até 60 dias por relatório ✅. Cobertura total (ex.: Pix recebido fora de cobranças) ⚠️ validar com amostra real | `GET /bank-statement/statement` com `start`, `end`, `type`, `page`, `perPage` (máx. 500), valores em centavos, saldo inicial e final do período ✅ | `GET /movimentos?dataMovimento=...` por dia, versões 1.05/2.00/2.01 ✅. Campos indicam **movimentos de vendas (cartão)**; Pix/transferências/saques da conta ⚠️ não confirmados |
| Tarifas | Colunas de tarifa e líquido no relatório (ex.: `FEE_AMOUNT`, `SETTLEMENT_NET_AMOUNT`) ✅ | Tipo `FEE` no extrato ✅ | `taxa_intermediacao`, `tarifa_intermediacao`, `valor_liquido_transacao` ✅ |
| Estornos/chargebacks | Tipos de transação do relatório ⚠️ mapear com amostra | ⚠️ não detalhado | `tipo_evento`/`status_pagamento` ⚠️ códigos no apêndice |
| Transferências | Aparecem no relatório (saques) ⚠️ | Tipo `TRANSFER` no extrato ✅ | ⚠️ |
| Webhooks | Notificações com `x-signature` (`ts`, `v1`) validada com segredo da aplicação; reenvio a cada 15 min se não houver 200/201 ✅. Webhook de relatório pronto com assinatura BCrypt ✅ | Endpoints de notificação (criação/lista/remoção) ✅; mecanismo de assinatura ⚠️ | ⚠️ não documentado para EDI |
| Paginação | Lista de relatórios ✅; dentro do arquivo não se aplica | `page`/`perPage` ✅ | `pageNumber`/`pageSize`, `totalPages` ✅ |
| Limites de requisição | ⚠️ não documentado na página lida | ⚠️ não documentado | ⚠️ não documentado |
| Histórico | ⚠️ até 60 dias **por relatório**; profundidade total a confirmar | ⚠️ não documentado | ⚠️ não documentado |
| Atraso dos dados | Relatório assíncrono (minutos/horas) ⚠️ | ⚠️ aparentemente próximo do tempo real | ⚠️ EDI costuma ser D+1; **não encontrei o atraso documentado** na página lida |
| Sandbox | Credenciais de teste ✅ | Ambiente **Stage** com credenciais próprias ✅ | ❌ "Não possuímos um ambiente de SandBox para esse produto" |
| Compatibilidade Vercel | ✅ HTTP comum | mTLS via `https.Agent` com certificado em variável/segredo — funciona em Node runtime ⚠️ testar no deploy | ✅ HTTP comum |

**Conclusão prática:** a Fase 3 começa pela **Cora** (melhor cobertura documentada: extrato completo e saldo), depois **Mercado Pago** (relatório assíncrono + webhook), e **PagBank** por último, provavelmente por arquivo OFX/CSV se a conta não usar vendas. Nenhuma integração é considerada pronta sem conciliar uma amostra real.

Fontes: [Cora — client credentials](https://developers.cora.com.br/docs/client-credentials-int-direta) · [Cora — extrato](https://developers.cora.com.br/reference/consulta-de-extrato) · [Cora — saldo](https://developers.cora.com.br/reference/saldo-de-conta) · [Cora — notificações](https://developers.cora.com.br/reference/cria%C3%A7%C3%A3o-de-endpoints) · [Mercado Pago — relatórios](https://mercadopago.cl/developers/en/docs/reports/introduction) · [Mercado Pago — settlement report via API](https://www.mercadopago.com.uy/developers/en/docs/additional-content/reports/account-money/api) · [Mercado Pago — webhooks](https://www.mercadopago.com.br/developers/en/docs/checkout-api-v2/notifications) · [PagBank — ambientes EDI](https://developer.pagbank.com.br/v1/reference/api-de-conciliacao-ambientes-disponiveis) · [PagBank — requisitos EDI](https://developer.pagbank.com.br/v1/reference/api-de-conciliacao-guide) · [PagBank — movimentação financeira](https://developer.pagbank.com.br/v1/reference/api-de-conciliacao-movimentacao-financeira) · [Vercel — limites de cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)

Nunca pediremos senha de internet banking nem usaremos automação de tela.

## 6. Conceitos financeiros (glossário do sistema)

| Conceito | Definição |
|---|---|
| **Compromisso** | Obrigação ou direito futuro (conta a pagar/receber), com vencimento. Não altera saldo. |
| **Movimento bancário** | Linha importada do provedor ou arquivo, imutável, com id externo. É o que o banco diz. |
| **Lançamento** | Fato financeiro registrado pela igreja (receita, despesa, transferência, ajuste), composto por partidas que somam zero. |
| **Partida** | Linha do lançamento: conta do razão + valor em centavos (positivo = débito, negativo = crédito) + dimensões (ministério, projeto, fundo, centro de custo). |
| **Liquidação** | Vínculo entre um compromisso e o lançamento que o pagou/recebeu, total ou parcial. |
| **Conciliação** | Vínculo entre movimentos bancários e lançamentos (1:1, 1:N, N:1), com auditoria e possibilidade de desfazer. |
| **Saldo informado** | Saldo que o provedor declara, com data de referência. |
| **Saldo calculado** | Saldo inicial + soma das partidas da conta. Divergência entre os dois vira pendência. |

Regras derivadas: transferências e depósitos do caixa só movimentam contas de ativo, então **não aparecem em receitas nem despesas**; tarifa é partida separada de despesa; saldo inicial é lançado contra "Saldos iniciais" (patrimônio), nunca como receita; fundo vinculado é uma dimensão das partidas e seu saldo é apresentado separadamente dos recursos livres.

## 7. Modelo de dados inicial

Todas as tabelas têm `organization_id`, RLS ativa e `created_at`. Dinheiro sempre `bigint` em centavos.

| Entidade | Responsabilidade | Fase |
|---|---|---|
| `organizations`, `units` | Igreja, fuso horário, logotipo; unidades/congregações (hierarquia) | 1 |
| `profiles`, `memberships`, `invitations` | Pessoa, papel por organização (e opcionalmente unidade), convites com validade | 1 |
| `financial_accounts` | Conta bancária, carteira digital, caixa físico ou outra; provedor; data e saldo inicial | 1 |
| `ledger_accounts` | Plano de contas do razão: ativo (1 por conta financeira), receita/despesa (1 por categoria), patrimônio (saldos iniciais), transitória (transferências em trânsito) | 1 |
| `categories` | Categorias hierárquicas de receita e despesa (código, nome, pai) | 1 |
| `ministries`, `cost_centers`, `projects`, `funds` | Dimensões; `funds.is_restricted` marca recurso vinculado | 1 |
| `contacts` | Fornecedores e favorecidos | 1 |
| `donors` | Doadores identificados, acesso restrito (admin/tesoureiro), CPF opcional | 1 |
| `payment_methods` | Pix, dinheiro, cartão, boleto... | 1 |
| `journal_entries` | Cabeçalho do lançamento: tipo, datas de competência/pagamento/disponibilidade, origem, status, estorno de/estornado por | 1 |
| `journal_lines` | Partidas (soma zero por lançamento, imutáveis após confirmação) | 1 |
| `cash_sessions` | Abertura, fechamento e conferência do caixa físico | 1 |
| `accounting_periods` | Status do mês (aberto/fechado), quem fechou, reabertura justificada | 1 (bloqueio) / 4 (tela) |
| `audit_log` | Registro append-only de quem fez o quê, antes/depois | 1 |
| `attachments` | Comprovantes no Storage privado, vinculados a lançamento/compromisso | 1 |
| `commitments`, `commitment_installments`, `settlements` | Contas a pagar/receber, parcelas, recorrência, liquidações parciais | 4 |
| `bank_connections` | Conexão por conta/provedor, capacidades declaradas, segredos em Supabase Vault | 3 |
| `bank_transactions` | Movimentos normalizados, `unique(connection_id, external_id)` | 2 |
| `imports`, `import_rows` | Arquivos CSV/OFX, mapeamento, prévia, hash do arquivo e da linha | 2 |
| `sync_runs`, `sync_events`, `jobs` | Execuções com cobertura e erros, eventos brutos (retenção 180 dias), fila persistente | 2/3 |
| `reconciliations`, `reconciliation_items` | Conciliações N:M com status e justificativa | 2 |
| `budgets`, `budget_lines` | Orçamento por período, categoria e centro de custo | 4 |
| `approvals`, `approval_rules` | Aprovação por valor/perfil, solicitante ≠ aprovador | 4 |
| `publications` | Prestação de contas pública: snapshot imutável aprovado, versão, revogação | 5 |

Integridade: FKs compostas com `organization_id` impedem misturar organizações; trigger de constraint diferida garante soma zero; trigger impede `UPDATE/DELETE` em partidas confirmadas; trigger impede lançar em período fechado; índices em `(organization_id, cash_date)`, `(ledger_account_id)`, `(entry_id)`. Totais não são armazenados: saldos vêm de soma das partidas (com índice), e snapshots só existem em fechamentos e publicações, que são imutáveis.

## 8. Perfis e permissões (resumo)

| Ação | Admin | Tesoureiro | Operador | Aprovador | Auditor | Liderança |
|---|---|---|---|---|---|---|
| Ver lançamentos e saldos | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (sem doadores) |
| Ver doadores identificados | ✅ | ✅ | ❌ | ❌ | ✅ leitura | ❌ |
| Criar receita/despesa/transferência | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Estornar lançamento | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Abrir/fechar caixa | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Conferir caixa (outra pessoa) | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Cadastros (contas, categorias, fundos) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Fechar/reabrir mês | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Aprovar despesa (Fase 4) | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Convidar e mudar papéis | ✅ (nunca o próprio) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Publicar prestação de contas (Fase 5) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

Admin e tesoureiro precisam de **MFA (TOTP)** para ações de escrita quando a organização exige (padrão: exige). O banco confere `aal2` no JWT, não só a tela.

## 9. Fases e critérios de conclusão

| Fase | Escopo | Pronto quando |
|---|---|---|
| **1** | Login, convites, papéis, MFA, cadastros, lançamentos em partidas dobradas, estorno, transferências, caixa físico, dashboard, relatório mensal imprimível | Testes SQL de partidas/RLS/período passam; dashboard e relatório batem com a soma das partidas; Renato cadastra contas reais e lança um mês de teste em homologação |
| **2** | Importação CSV/OFX, deduplicação, conciliação N:M | Mesmo arquivo importado 2x não duplica; extrato de um mês real concilia com divergência zero ou justificada |
| **3** | Cora → Mercado Pago (2 conexões) → PagBank, uma por vez | Autenticação, cobertura e conciliação de amostra real validadas com acesso autorizado |
| **4** | Contas a pagar/receber, recorrências, orçamento, aprovações, fechamento mensal, relatórios avançados, PDF/XLSX | Fechamento bloqueia alteração; reabertura exige justificativa auditada |
| **5** | Prestação de contas pública, alertas, campanhas, patrimônio, portal do contribuinte | Publicação revisada, versionada, revogável e sem dados pessoais (teste automatizado) |

## 10. Primeira entrega funcional (Fase 1)

1. Criar a igreja no primeiro acesso, convidar pessoas e definir papéis.
2. Cadastrar as contas (Mercado Pago A, Mercado Pago B, Cora, PagBank, Caixa) com saldo inicial e data.
3. Plano de categorias padrão de igreja já carregado e editável; ministérios, projetos e fundos.
4. Lançar receita, despesa (com rateio), transferência entre contas (inclusive depósito do caixa) e estornar.
5. Abrir, movimentar, fechar e conferir o caixa físico, com diferença justificada.
6. Visão geral: saldo por conta e consolidado, livres x vinculados, receitas x despesas do mês, evolução mensal, despesas por categoria.
7. Relatório mensal A4 imprimível com cabeçalho da igreja, período, data de geração, totais, gráfico e tabela de apoio.

Limitações da Fase 1: sem integração bancária, sem conciliação, sem contas a pagar/receber e sem publicação pública. Os saldos são **calculados** pelo sistema.

## 11. Custos estimados (a confirmar no momento da contratação)

- Vercel Hobby: gratuito, mas cron só 1x/dia e uso não comercial; Vercel Pro: por pessoa/mês (verificar preço vigente em vercel.com/pricing).
- Supabase Free: projeto pausa por inatividade e sem backup diário; Supabase Pro: plano mensal com backups diários (verificar em supabase.com/pricing).
- Para dados financeiros reais recomendo **Supabase Pro** desde o início, por causa dos backups.

## 12. Ambientes

- **dev**: local ou projeto Supabase de desenvolvimento, com dados demonstrativos marcados.
- **homologação**: projeto Supabase separado + Preview da Vercel, sem dados reais.
- **produção**: projeto Supabase próprio; somente o domínio de produção aponta para ele.
