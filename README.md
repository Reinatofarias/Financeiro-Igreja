# Financeiro da Igreja

Sistema financeiro da igreja: contas (Mercado Pago, Cora, PagBank, caixa físico), lançamentos com partidas dobradas, fundos vinculados, caixa físico com conferência, painel e relatórios para impressão.

Stack: Next.js 16 (App Router) + TypeScript, Supabase (Postgres, Auth, Storage) e Vercel.

O desenho completo (arquitetura, matriz de integrações, modelo de dados e fases) está em [docs/ARQUITETURA.md](docs/ARQUITETURA.md). A definição de cada número do painel está em [docs/INDICADORES.md](docs/INDICADORES.md).

## O que já funciona (Fases 1 e 2)

- Login com e-mail e senha, recuperação de senha, verificação em duas etapas (TOTP, obrigatória para administrador e tesoureiro).
- Perfis: administrador, tesoureiro, operador financeiro, aprovador, conselho fiscal/auditor e liderança. Convites por e-mail.
- Contas financeiras com saldo inicial, categorias (com subcategorias), fundos, ministérios, projetos, centros de custo, formas de pagamento, fornecedores e doadores (dados restritos).
- Receitas (com tarifa), despesas com rateio, transferências entre contas (com opção "em trânsito"), estorno em vez de edição, comprovantes privados.
- Caixa físico: abertura, fechamento com contagem por cédulas e moedas, diferença lançada como sobra ou falta, conferência por uma segunda pessoa.
- Fechamento de mês (nada entra num mês fechado sem reabertura justificada).
- Painel com filtros, relatório mensal para impressão (A4 retrato, A4 paisagem, A3 e tela) e exportação CSV.
- Auditoria de todas as alterações (sem CPF, Pix ou telefone de doadores no histórico).

## Conciliação (Fase 2)

Em **Conciliação**, importe o extrato e resolva cada movimento:

- **Mercado Pago**: Seu negócio › Relatórios › **Extrato da conta** (CSV). Este é o recomendado, porque traz saldo inicial e final do período e mostra se o saldo do sistema bate com o do banco. O relatório de **liberações** também é aceito.
- **Cora e PagBank**: extrato em **OFX**.
- Importar o mesmo período de novo não duplica nada: o extrato e o relatório de liberações usam a mesma identificação do pagamento.

Cada movimento pendente pode ser:

- **Lançado**: marque vários (ex.: todos os Pix recebidos de domingo) e lance com uma categoria. Entradas com tarifa entram pelo valor bruto, com a tarifa separada.
- **Casado** com um lançamento que já existe (o sistema sugere os de mesmo valor, até 5 dias de diferença).
- **Ignorado** com motivo, para movimentos anteriores ao saldo inicial da conta ou que não são da igreja.

O extrato traz o nome de quem fez o Pix, então só administrador, tesoureiro, operador e auditor (com verificação em duas etapas) veem esta tela. O valor importado não pode ser alterado depois; para desfazer um lançamento criado do extrato, estorne o lançamento e o movimento volta a ficar pendente.

## O que ainda NÃO existe

- Nenhuma integração bancária automática: o extrato é importado por arquivo. APIs da Cora, Mercado Pago e PagBank ficam para a Fase 3.
- Contas a pagar/receber, orçamento e aprovações (Fase 4).
- Prestação de contas pública (Fase 5).

## Instalação (Supabase + Vercel, plano gratuito)

### 1. Banco de dados

1. Crie um projeto no Supabase.
2. Abra **SQL Editor**, cole o conteúdo de [`supabase/instalar.sql`](supabase/instalar.sql) e clique em **Run**. Ele cria tudo de uma vez (é a junção das migrações de `supabase/migrations/`, na ordem).
3. Em **Authentication > Sign In / Providers**, desative **Allow new users to sign up**. As pessoas entram só por convite.
4. Em **Authentication > Multi-Factor**, deixe **TOTP** ativado.
5. Em **Authentication > URL Configuration**:
   - Site URL: o endereço do sistema na Vercel (ex.: `https://financeiro-igreja.vercel.app`).
   - Redirect URLs: o mesmo endereço seguido de `/**`.
6. Em **Authentication > Emails**, troque os modelos:
   - **Invite user**: assunto "Convite para o financeiro da igreja", corpo de [`supabase/templates/convite.html`](supabase/templates/convite.html).
   - **Reset password**: assunto "Criar nova senha", corpo de [`supabase/templates/recuperar-senha.html`](supabase/templates/recuperar-senha.html).

   Os dois apontam para `/auth/confirm`, que é o caminho que o sistema usa para validar o link.

### 2. Vercel

1. Importe o repositório na Vercel.
2. Em **Settings > Environment Variables**, crie as variáveis de [`.env.example`](.env.example). Os valores ficam em **Supabase > Project Settings > API**.
   - `SUPABASE_SERVICE_ROLE_KEY` é secreta: nunca com prefixo `NEXT_PUBLIC_`, nunca em chat, print ou planilha.
3. Faça o deploy.

### Atualizar um banco já instalado

Cada fase nova traz um arquivo em `supabase/migrations/`. Rode no **SQL Editor** só os arquivos novos, na ordem (a Fase 2 é `20261026000700_conciliacao.sql`). Para instalar do zero, `supabase/instalar.sql` já tem tudo.

### 3. Primeiro acesso

1. No Supabase, **Authentication > Users > Add user > Send invitation** com o e-mail da pastora.
2. Ela abre o e-mail, cria a senha, cadastra a igreja e ativa a verificação em duas etapas. Quem cadastra a igreja vira administrador.
3. Os demais (tesoureiro, operadores) são convidados por **Configurações > Convidar**.

## Limites do plano gratuito

- **Supabase Free não faz backup**. Exporte os lançamentos (Relatórios > Exportações) e o relatório mensal em PDF todo mês e guarde fora do sistema. Projetos sem uso por 7 dias são pausados; basta reativar no painel.
- Storage gratuito de 1 GB: comprovantes devem ser PDF ou fotos comprimidas (limite de cerca de 4 MB por arquivo, por causa do limite de envio da Vercel).
- Vercel Hobby: tarefas agendadas rodam no máximo uma vez por dia, o que limita a sincronização automática da Fase 3.

## Desenvolvimento

```bash
npm install
cp .env.example .env.local   # preencha com um projeto de teste, nunca com dados reais da igreja
npm run dev
```

Verificações:

```bash
npm run lint
npm run typecheck
npm test                      # funções de dinheiro e CSV
DATABASE_URL=postgres://... npm run test:db   # regras do banco num Postgres vazio
```

Os testes do banco rodam num Postgres comum: `supabase/tests/00_supabase_stub.sql` simula o mínimo de `auth` e `storage`. Eles cobrem partidas dobradas, imutabilidade, estorno, transferência, tarifa, fundos, caixa, fechamento de mês, permissões por perfil e isolamento entre igrejas.

Ao mudar o banco, crie uma migração nova em `supabase/migrations/` e regenere o arquivo único com `bash supabase/gerar-instalar.sh`.

## Segurança

- Nunca peça nem guarde senha de banco. Integrações usarão apenas APIs oficiais, com credenciais só no servidor.
- Toda regra financeira está no banco (funções e RLS), não só na tela.
- Lançamentos não são editados nem apagados: correções são feitas por estorno.
- Não use dados reais da igreja em ambientes de teste ou previews públicos.
