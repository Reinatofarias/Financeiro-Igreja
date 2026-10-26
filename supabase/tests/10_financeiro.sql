-- Testes dos riscos financeiros e de segurança da Fase 1.
-- Datas em 2020 para que "mês já encerrado" seja sempre verdade.
\set QUIET on
begin;

do $$
declare
  v_org uuid; v_org2 uuid;
  a_mpa uuid; a_mpb uuid; a_cora uuid; a_pag uuid; a_caixa uuid; a_outra uuid;
  c_dizimo uuid; c_oferta uuid; c_energia uuid; c_obras uuid;
  f_constr uuid; v_entry uuid; v_entry2 uuid; v_transit uuid; v_session uuid;
  v_inc bigint; v_exp bigint; v_n bigint; v_total bigint; v_free bigint; v_restr bigint; v_tr bigint;
  v_m_admin uuid;
begin
  -- ------------------------------------------------------------ pessoas
  perform tests.new_user('admin@igreja.test');
  perform tests.new_user('tesoureiro@igreja.test');
  perform tests.new_user('operador@igreja.test');
  perform tests.new_user('lider@igreja.test');
  perform tests.new_user('auditor@igreja.test');
  perform tests.new_user('aprovador@igreja.test');
  perform tests.new_user('outra@igreja2.test');

  -- ------------------------------------------------------------ criação da igreja e convites
  perform tests.login('admin@igreja.test');
  v_org := public.create_organization('Igreja Teste', 'America/Recife', '12.345.678/0001-90');
  perform tests.eq((select count(*) from public.categories where organization_id = v_org) > 20, true, 'plano de categorias padrão criado');
  perform tests.eq((select count(*) from public.funds where organization_id = v_org and is_restricted), 4::bigint, 'fundos vinculados padrão');
  perform tests.throws(format($q$select public.create_organization('Outra')$q$), 'já participa', 'não cria segunda organização');

  perform public.invite_member(v_org, 'Tesoureiro@Igreja.test', 'tesoureiro');
  perform public.invite_member(v_org, 'operador@igreja.test', 'operador');
  perform public.invite_member(v_org, 'lider@igreja.test', 'lideranca');
  perform public.invite_member(v_org, 'auditor@igreja.test', 'auditor');
  perform public.invite_member(v_org, 'aprovador@igreja.test', 'aprovador');
  perform tests.login('tesoureiro@igreja.test'); perform tests.eq(public.accept_my_invitations(), 1, 'tesoureiro aceita convite');
  perform tests.login('operador@igreja.test'); perform tests.eq(public.accept_my_invitations(), 1, 'operador aceita convite');
  perform tests.login('lider@igreja.test'); perform public.accept_my_invitations();
  perform tests.login('auditor@igreja.test'); perform public.accept_my_invitations();
  perform tests.login('aprovador@igreja.test'); perform public.accept_my_invitations();

  -- Ninguém altera o próprio papel; operador não convida.
  perform tests.login('admin@igreja.test');
  select id into v_m_admin from public.memberships where organization_id = v_org and user_id = tests.user_id('admin@igreja.test');
  perform tests.throws(format('select public.update_member(%L, %L, true)', v_m_admin, 'auditor'), 'próprio', 'admin não muda o próprio papel');
  perform tests.login('operador@igreja.test');
  perform tests.throws(format('select public.invite_member(%L, %L, %L)', v_org, 'x@x.test', 'admin'), 'permissão', 'operador não convida (elevação de privilégio)');
  update public.memberships set role = 'admin' where user_id = auth.uid();  -- RLS: nenhuma linha atualizável
  perform tests.eq((select role::text from public.memberships where user_id = tests.user_id('operador@igreja.test')), 'operador', 'papel do operador inalterado');

  -- ------------------------------------------------------------ MFA para perfis privilegiados
  perform tests.login('admin@igreja.test', 'aal1');
  perform tests.throws(format($q$select public.create_financial_account(%L, 'Conta X', 'banco', 'manual', '2020-01-01')$q$, v_org), 'MFA', 'admin sem MFA não escreve');

  -- ------------------------------------------------------------ contas
  perform tests.login('admin@igreja.test');
  a_mpa := public.create_financial_account(v_org, 'Mercado Pago A', 'carteira_digital', 'mercado_pago', '2020-01-01', 100000);
  a_mpb := public.create_financial_account(v_org, 'Mercado Pago B', 'carteira_digital', 'mercado_pago', '2020-01-01', 0);
  a_cora := public.create_financial_account(v_org, 'Cora', 'banco', 'cora', '2020-01-01', 250050);
  a_pag := public.create_financial_account(v_org, 'PagBank', 'banco', 'pagbank', '2020-01-01', 0);
  a_caixa := public.create_financial_account(v_org, 'Caixa da tesouraria', 'caixa_fisico', 'manual', '2020-01-01', 20000);
  perform tests.eq((select sum(balance_cents) from public.account_balances(v_org))::bigint, 370050::bigint, 'saldos iniciais somados');
  select income_cents into v_inc from public.report_totals(v_org, '2019-01-01', '2030-12-31');
  perform tests.eq(v_inc, 0::bigint, 'saldo inicial não é receita');

  select id into c_dizimo from public.categories where organization_id = v_org and name = 'Dízimos';
  select id into c_oferta from public.categories where organization_id = v_org and name = 'Ofertas';
  select id into c_energia from public.categories where organization_id = v_org and name = 'Energia elétrica';
  select id into c_obras from public.categories where organization_id = v_org and name = 'Construção e obras';
  select id into f_constr from public.funds where organization_id = v_org and name = 'Construção';

  -- ------------------------------------------------------------ precisão monetária
  perform tests.login('operador@igreja.test');
  perform public.post_income(v_org, a_mpb, c_oferta, 10, '2020-02-03', 'Oferta 0,10');
  perform public.post_income(v_org, a_mpb, c_oferta, 20, '2020-02-03', 'Oferta 0,20');
  perform tests.eq((select balance_cents from public.account_balances(v_org) where account_id = a_mpb), 30::bigint, '0,10 + 0,20 = 0,30 exatos');
  perform tests.throws(format($q$select public.post_income(%L, %L, %L, 0, '2020-02-03', 'zero')$q$, v_org, a_mpb, c_oferta), 'maior que zero', 'valor zero recusado');
  perform tests.throws(format($q$select public.post_income(%L, %L, %L, -5, '2020-02-03', 'negativo')$q$, v_org, a_mpb, c_oferta), 'maior que zero', 'valor negativo recusado');
  perform tests.throws(format($q$select public.post_income(%L, %L, %L, 100, '2020-02-03', 'categoria errada')$q$, v_org, a_mpb, c_energia), 'não é de receita', 'categoria de despesa em receita recusada');

  -- ------------------------------------------------------------ bruto, tarifa e líquido
  v_entry := public.post_income(v_org, a_mpa, c_dizimo, 150000, '2020-02-05', 'Dízimos via Pix', p_fee_cents => 99);
  perform tests.eq((select balance_cents from public.account_balances(v_org) where account_id = a_mpa), (100000 + 149901)::bigint, 'conta recebe o líquido');
  select income_cents, expense_cents into v_inc, v_exp from public.report_totals(v_org, '2020-02-01', '2020-02-29');
  perform tests.eq(v_inc, 150030::bigint, 'receita pelo bruto');
  perform tests.eq(v_exp, 99::bigint, 'tarifa como despesa separada');
  perform tests.eq((select count(*) from public.journal_lines where entry_id = v_entry), 3::bigint, 'recebimento com tarifa tem 3 partidas');

  -- ------------------------------------------------------------ transferência interna e depósito do caixa
  perform public.post_transfer(v_org, a_mpa, a_cora, 50000, '2020-02-06', 'Saque MP para Cora');
  perform public.post_transfer(v_org, a_caixa, a_cora, 15000, '2020-02-07', 'Depósito do caixa');
  select income_cents, expense_cents into v_inc, v_exp from public.report_totals(v_org, '2020-02-01', '2020-02-29');
  perform tests.eq(v_inc, 150030::bigint, 'transferência e depósito do caixa não geram receita');
  perform tests.eq(v_exp, 99::bigint, 'transferência não gera despesa');
  perform tests.eq((select balance_cents from public.account_balances(v_org) where account_id = a_cora), (250050 + 50000 + 15000)::bigint, 'Cora recebeu as transferências');
  perform tests.eq((select total_cents from public.balance_summary(v_org)), (370050 + 150030 - 99)::bigint, 'saldo consolidado não inflado');

  -- Em trânsito
  v_transit := public.post_transfer(v_org, a_cora, a_pag, 10000, '2020-02-10', 'TED Cora para PagBank', p_in_transit => true);
  select total_cents, in_transit_cents into v_total, v_tr from public.balance_summary(v_org);
  perform tests.eq(v_tr, 10000::bigint, 'transferência em trânsito identificada');
  perform tests.eq(v_total, (370050 + 150030 - 99)::bigint, 'consolidado inclui o trânsito sem duplicar');
  perform public.confirm_transfer_arrival(v_transit, '2020-02-11');
  perform tests.eq((select in_transit_cents from public.balance_summary(v_org)), 0::bigint, 'trânsito zerado após chegada');
  perform tests.eq((select balance_cents from public.account_balances(v_org) where account_id = a_pag), 10000::bigint, 'PagBank recebeu');
  perform tests.throws(format($q$select public.confirm_transfer_arrival(%L, '2020-02-12')$q$, v_transit), 'já foi confirmada', 'chegada não é confirmada duas vezes');

  -- ------------------------------------------------------------ fundos vinculados e rateio
  perform public.post_income(v_org, a_cora, c_oferta, 100000, '2020-02-12', 'Oferta para a obra', p_fund_id => f_constr);
  perform public.post_expense(v_org, a_cora,
    jsonb_build_array(
      jsonb_build_object('category_id', c_obras, 'amount_cents', 20000, 'fund_id', f_constr),
      jsonb_build_object('category_id', c_energia, 'amount_cents', 10000)),
    '2020-02-13', 'Material da obra e conta de luz');
  perform tests.eq((select balance_cents from public.fund_balances(v_org) where fund_id = f_constr), 80000::bigint, 'fundo Construção = 1000 − 200');
  select total_cents, restricted_cents, free_cents into v_total, v_restr, v_free from public.balance_summary(v_org);
  perform tests.eq(v_restr, 80000::bigint, 'vinculado separado');
  perform tests.eq(v_free, v_total - 80000, 'livre = total − vinculado');
  perform tests.throws(format($q$select public.post_expense(%L, %L, '[]'::jsonb, '2020-02-13', 'vazia')$q$, v_org, a_cora), 'ao menos uma', 'despesa sem rateio recusada');

  -- ------------------------------------------------------------ integridade das partidas
  perform tests.throws(format($q$insert into public.journal_entries (organization_id, kind, description, competence_date, cash_date) values (%L, 'ajuste', 'direto', '2020-02-01', '2020-02-01')$q$, v_org),
    'row-level security', 'inserção direta em lançamentos bloqueada');
  perform tests.logout();  -- mesmo com acesso total ao banco, a partida não muda
  perform tests.throws(format('update public.journal_lines set amount_cents = 1 where entry_id = %L', v_entry), 'imutável', 'alterar partida bloqueado');
  perform tests.throws(format('delete from public.journal_entries where id = %L', v_entry), 'não podem ser apagados', 'apagar lançamento bloqueado');
  perform tests.throws(format($q$update public.journal_entries set description = 'outra' where id = %L$q$, v_entry), 'não podem ser alterados', 'editar lançamento confirmado bloqueado');
  perform tests.login('operador@igreja.test');

  -- ------------------------------------------------------------ estorno
  perform tests.throws(format('select public.reverse_entry(%L, %L)', v_entry, 'motivo qualquer'), 'permissão', 'operador não estorna');
  perform tests.login('tesoureiro@igreja.test');
  perform tests.throws(format('select public.reverse_entry(%L, %L)', v_entry, 'x'), 'motivo', 'estorno exige motivo');
  v_entry2 := public.reverse_entry(v_entry, 'Valor lançado em duplicidade', '2020-02-20');
  perform tests.eq((select status::text from public.journal_entries where id = v_entry), 'estornado', 'original marcado como estornado');
  perform tests.eq((select count(*) from public.journal_entries where id = v_entry), 1::bigint, 'original preservado');
  select income_cents, expense_cents into v_inc, v_exp from public.report_totals(v_org, '2020-02-01', '2020-02-29');
  perform tests.eq(v_inc, (150030 - 150000 + 100000)::bigint, 'estorno anula a receita no período');
  perform tests.eq(v_exp, (99 - 99 + 30000)::bigint, 'estorno anula a tarifa');
  perform tests.throws(format('select public.reverse_entry(%L, %L)', v_entry, 'de novo por engano'), 'já foi estornado', 'não estorna duas vezes');
  perform tests.throws(format('select public.reverse_entry(%L, %L)', v_entry2, 'estorno do estorno'), 'não pode ser estornado', 'estorno não é estornado');

  -- ------------------------------------------------------------ período fechado
  perform public.close_period(v_org, '2020-02-01');
  perform tests.login('operador@igreja.test');
  perform tests.throws(format($q$select public.post_income(%L, %L, %L, 100, '2020-02-28', 'atrasado')$q$, v_org, a_mpb, c_oferta), 'fechado', 'lançamento em mês fechado bloqueado');
  perform tests.throws(format($q$select public.post_income(%L, %L, %L, 100, '2020-03-02', 'competência fechada', p_competence_date => '2020-02-28')$q$, v_org, a_mpb, c_oferta), 'fechado', 'competência em mês fechado bloqueada');
  perform public.post_income(v_org, a_mpb, c_oferta, 100, '2020-03-02', 'Março aberto');
  perform tests.login('tesoureiro@igreja.test');
  perform tests.throws(format($q$select public.reopen_period(%L, '2020-02-01', 'curto')$q$, v_org), 'motivo', 'reabertura exige justificativa');
  perform public.reopen_period(v_org, '2020-02-01', 'Extrato do PagBank chegou com atraso');
  perform tests.eq((select count(*) from public.audit_log where table_name = 'accounting_periods' and reason like 'Extrato%'), 1::bigint, 'reabertura auditada com motivo');

  -- ------------------------------------------------------------ caixa físico
  perform tests.login('operador@igreja.test');
  perform tests.throws(format('select public.open_cash_session(%L, 0)', a_cora), 'caixa físico', 'só caixa físico abre sessão');
  perform tests.throws(format('select public.open_cash_session(%L, 4000)', a_caixa), 'diferença', 'abertura com diferença exige motivo');
  v_session := public.open_cash_session(a_caixa, 5000);  -- 200,00 − 150,00 depositados = 50,00
  perform public.post_income(v_org, a_caixa, c_oferta, 12000, '2020-03-01', 'Oferta do culto', p_cash_session_id => v_session);
  perform tests.throws(format('select public.close_cash_session(%L, 16000)', v_session), 'diferença', 'fechamento com diferença exige motivo');
  perform tests.eq(public.close_cash_session(v_session, 16000, null, 'Troco dado errado'), -1000::bigint, 'falta de 10,00 registrada');
  perform tests.eq((select balance_cents from public.account_balances(v_org) where account_id = a_caixa), 16000::bigint, 'saldo do caixa igual ao contado');
  perform tests.throws(format('select public.verify_cash_session(%L)', v_session), 'permissão', 'operador não confere');
  perform tests.login('aprovador@igreja.test');
  perform public.verify_cash_session(v_session, 'Conferido com o envelope');
  perform tests.eq((select status from public.cash_sessions where id = v_session), 'conferido', 'caixa conferido por outra pessoa');

  -- ------------------------------------------------------------ consistência dos relatórios
  perform tests.login('lider@igreja.test');
  select income_cents, expense_cents into v_inc, v_exp from public.report_totals(v_org, '2020-01-01', '2030-12-31');
  perform tests.eq((select sum(income_cents) from public.report_monthly(v_org, '2020-01-01', '2030-12-31'))::bigint, v_inc, 'mensal soma o total de receitas');
  perform tests.eq((select sum(expense_cents) from public.report_monthly(v_org, '2020-01-01', '2030-12-31'))::bigint, v_exp, 'mensal soma o total de despesas');
  perform tests.eq((select sum(total_cents) from public.report_by_category(v_org, '2020-01-01', '2030-12-31', 'receita'))::bigint, v_inc, 'por categoria soma o total');
  perform tests.eq((select sum(total_cents) from public.report_by_category(v_org, '2020-01-01', '2030-12-31', 'despesa', p_rollup => false))::bigint, v_exp, 'por subcategoria soma o total');
  perform tests.eq(
    (select sum(balance_cents) from public.account_balances(v_org))::bigint,
    (370050 + v_inc - v_exp)::bigint, 'saldo final = saldo inicial + receitas − despesas');
  perform tests.eq((select sum(amount_cents) from public.journal_lines where organization_id = v_org)::bigint, 0::bigint, 'razão inteiro equilibrado');

  -- ------------------------------------------------------------ perfis
  perform tests.throws(format($q$select public.post_income(%L, %L, %L, 100, '2020-03-03', 'liderança')$q$, v_org, a_mpb, c_oferta), 'permissão', 'liderança não lança');
  perform tests.eq((select count(*) from public.donors), 0::bigint, 'liderança não vê doadores');
  perform tests.eq((select count(*) from public.audit_log), 0::bigint, 'liderança não vê auditoria');
  perform tests.login('tesoureiro@igreja.test');
  insert into public.donors (organization_id, name, document) values (v_org, 'Fulano de Tal', '12345678900');
  perform tests.login('operador@igreja.test');
  perform tests.eq((select count(*) from public.donors), 0::bigint, 'operador não vê doadores');
  perform tests.login('tesoureiro@igreja.test', 'aal1');
  perform tests.eq((select count(*) from public.donors), 0::bigint, 'tesoureiro sem 2FA não vê doadores');
  perform tests.eq((select count(*) from public.audit_log), 0::bigint, 'tesoureiro sem 2FA não vê auditoria');
  perform tests.login('auditor@igreja.test');
  perform tests.eq((select count(*) from public.donors), 1::bigint, 'auditor lê doadores');
  perform tests.eq((select count(*) from public.audit_log where table_name = 'donors' and new_data ? 'document'), 0::bigint, 'CPF não vai para a auditoria');
  perform tests.logout();
  perform tests.throws($q$update public.audit_log set action = 'x'$q$, 'imutável', 'auditoria imutável');
  perform tests.login('auditor@igreja.test');

  -- ------------------------------------------------------------ isolamento entre organizações
  perform tests.login('outra@igreja2.test');
  v_org2 := public.create_organization('Outra Igreja');
  a_outra := public.create_financial_account(v_org2, 'Conta da outra', 'banco', 'manual', '2020-01-01', 1000);
  perform tests.eq((select count(*) from public.journal_entries where organization_id = v_org), 0::bigint, 'outra igreja não vê lançamentos');
  perform tests.eq((select count(*) from public.financial_accounts where organization_id = v_org), 0::bigint, 'outra igreja não vê contas');
  perform tests.eq((select count(*) from public.account_balances(v_org)), 0::bigint, 'relatório não vaza entre igrejas');
  perform tests.throws(format($q$select public.post_income(%L, %L, %L, 100, '2020-03-03', 'invasão')$q$, v_org, a_mpb, c_oferta), 'permissão', 'não lança em outra igreja');
  perform tests.throws(format($q$select public.post_income(%L, %L, %L, 100, '2020-03-03', 'mistura')$q$, v_org2, a_mpb, c_oferta), 'não encontrada', 'não usa conta de outra igreja');
  perform tests.throws(format($q$select public.post_transfer(%L, %L, %L, 100, '2020-03-03')$q$, v_org2, a_outra, a_mpb), 'não encontrada', 'não transfere para conta de outra igreja');

  -- ------------------------------------------------------------ anônimo
  perform tests.login_anon();
  perform tests.throws('select count(*) from public.journal_entries', 'permission denied', 'anônimo não lê lançamentos');
  perform tests.throws(format($q$select public.post_income(%L, %L, %L, 100, '2020-03-03', 'anon')$q$, v_org, a_mpb, c_oferta), 'permission denied', 'anônimo não executa funções');

  perform tests.logout();
  raise notice 'Todos os testes financeiros passaram.';
end $$;

-- Lançamento desequilibrado é recusado pelo banco mesmo para quem tem acesso total.
do $$
declare v_org uuid; v_la uuid; v_e uuid;
begin
  select id into v_org from public.organizations where name = 'Igreja Teste';
  select id into v_la from public.ledger_accounts where organization_id = v_org and kind = 'ativo' limit 1;
  insert into public.journal_entries (organization_id, kind, description, competence_date, cash_date)
  values (v_org, 'ajuste', 'Desequilibrado', '2020-03-05', '2020-03-05') returning id into v_e;
  insert into public.journal_lines (organization_id, entry_id, line_no, ledger_account_id, amount_cents)
  values (v_org, v_e, 1, v_la, 100), (v_org, v_e, 2, v_la, -99);
  begin
    set constraints all immediate;
    raise exception 'FALHOU: lançamento desequilibrado aceito';
  exception when check_violation then
    raise notice 'ok: lançamento desequilibrado recusado';
  end;
end $$;

rollback;
