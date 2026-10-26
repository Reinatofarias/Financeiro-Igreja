-- Contas a pagar/receber, aprovação, orçamento e conferência do fechamento (Fase 4).
begin;
do $$
declare
  v_org uuid; a uuid; c_energia uuid; c_ocup uuid; c_diz uuid; c_obras uuid;
  b1 uuid; b2 uuid; b3 uuid; v_entry uuid; v_n integer; r record;
begin
  perform tests.new_user('f4@igreja.test');
  perform tests.new_user('f4-op@igreja.test');
  perform tests.new_user('f4-aprov@igreja.test');
  perform tests.new_user('f4-lider@igreja.test');
  perform tests.new_user('f4-fora@igreja.test');
  perform tests.login('f4@igreja.test');
  v_org := public.create_organization('Igreja Fase 4');
  perform public.invite_member(v_org, 'f4-op@igreja.test', 'operador');
  perform public.invite_member(v_org, 'f4-aprov@igreja.test', 'aprovador');
  perform public.invite_member(v_org, 'f4-lider@igreja.test', 'lideranca');
  perform tests.login('f4-op@igreja.test'); perform public.accept_my_invitations();
  perform tests.login('f4-aprov@igreja.test'); perform public.accept_my_invitations();
  perform tests.login('f4-lider@igreja.test'); perform public.accept_my_invitations();

  perform tests.login('f4@igreja.test');
  a := public.create_financial_account(v_org, 'Cora', 'banco', 'cora', '2020-01-01', 100000);
  select id into c_energia from public.categories where organization_id = v_org and name = 'Energia elétrica';
  select id into c_ocup from public.categories where organization_id = v_org and name = 'Ocupação e manutenção';
  select id into c_diz from public.categories where organization_id = v_org and name = 'Dízimos';
  select id into c_obras from public.categories where organization_id = v_org and name = 'Construção e obras';

  -- ---------------------------------------------------------------- cadastro
  perform tests.login('f4-lider@igreja.test');
  perform tests.throws(format('select public.create_bill(%L, %L, %L, 100, %L, %L)', v_org, 'pagar', 'Energia', '2020-02-10', c_energia),
    'permissão', 'liderança não cadastra conta');

  perform tests.login('f4-op@igreja.test');
  perform tests.throws(format('select public.create_bill(%L, %L, %L, 100, %L, %L)', v_org, 'pagar', 'Energia', '2020-02-10', c_diz),
    'não é de despesa', 'conta a pagar exige categoria de despesa');
  perform tests.throws(format('select public.create_bill(%L, %L, %L, 0, %L, %L)', v_org, 'pagar', 'Energia', '2020-02-10', c_energia),
    'maior que zero', 'valor positivo');
  v_n := public.create_bill(v_org, 'pagar', 'Energia', 25000, '2020-01-31', c_energia, p_account_id => a, p_repeat => 3);
  perform tests.eq(v_n, 3, 'série de 3 meses');
  perform tests.eq((select array_agg(due_date order by due_date) from public.bills where organization_id = v_org and description like 'Energia%'),
    array['2020-01-31', '2020-02-29', '2020-03-31']::date[], 'vencimentos mensais sem escorregar o dia');
  perform tests.eq((select description from public.bills where organization_id = v_org and series_no = 2), 'Energia (2/3)', 'parcela numerada');
  perform tests.eq((select count(*) from public.bills where organization_id = v_org and approval_status = 'dispensada'), 3::bigint,
    'sem limite configurado, não precisa de aprovação');

  -- ---------------------------------------------------------------- pagamento
  select id into b1 from public.bills where organization_id = v_org and series_no = 1;
  v_entry := public.pay_bill(b1, a, '2020-02-03');
  perform tests.eq((select status from public.bills where id = b1), 'paga', 'conta paga');
  perform tests.eq((select kind::text from public.journal_entries where id = v_entry), 'despesa', 'pagamento vira despesa');
  perform tests.eq((select due_date from public.journal_entries where id = v_entry), '2020-01-31'::date, 'vencimento vai para o lançamento');
  perform tests.eq((select competence_date from public.journal_entries where id = v_entry), '2020-01-31'::date, 'competência da conta');
  perform tests.eq(app.entry_effect_on_account(v_entry, a), -25000::bigint, 'sai da conta');
  perform tests.throws(format('select public.pay_bill(%L, %L, %L)', b1, a, '2020-02-03'), 'já foi paga', 'não paga duas vezes');

  perform tests.login('f4@igreja.test');
  perform public.reverse_entry(v_entry, 'Pago na conta errada');
  perform tests.eq((select status from public.bills where id = b1), 'aberta', 'estornar o pagamento reabre a conta');
  perform tests.eq((select paid_entry_id from public.bills where id = b1), null::uuid, 'sem lançamento vinculado');

  -- ---------------------------------------------------------------- contas a receber
  perform tests.login('f4-op@igreja.test');
  perform public.create_bill(v_org, 'receber', 'Aluguel do salão', 30000, '2020-02-15', c_diz);
  select id into b2 from public.bills where organization_id = v_org and kind = 'receber';
  v_entry := public.pay_bill(b2, a, '2020-02-16', 30000, 150);
  perform tests.eq(app.entry_effect_on_account(v_entry, a), 29850::bigint, 'recebimento entra pelo líquido');
  perform tests.eq((select kind::text from public.journal_entries where id = v_entry), 'receita', 'recebimento vira receita');

  -- ---------------------------------------------------------------- aprovação
  perform tests.logout();
  update public.organizations set approval_threshold_cents = 50000 where id = v_org;
  perform tests.login('f4-op@igreja.test');
  perform public.create_bill(v_org, 'pagar', 'Telhado', 80000, '2020-03-10', c_obras);
  perform public.create_bill(v_org, 'pagar', 'Lâmpadas', 4000, '2020-03-10', c_obras);
  select id into b3 from public.bills where organization_id = v_org and description = 'Telhado';
  perform tests.eq((select approval_status from public.bills where id = b3), 'pendente', 'acima do limite precisa de aprovação');
  perform tests.eq((select approval_status from public.bills where description = 'Lâmpadas' and organization_id = v_org), 'dispensada', 'abaixo do limite, não');
  perform tests.throws(format('select public.pay_bill(%L, %L, %L)', b3, a, '2020-03-10'), 'aguarda aprovação', 'não paga sem aprovação');
  perform tests.throws(format('select public.decide_bill(%L, true)', b3), 'permissão', 'operador não aprova');

  perform tests.login('f4-aprov@igreja.test');
  perform tests.throws(format('select public.decide_bill(%L, false, %L)', b3, 'não'), 'motivo', 'recusa exige motivo');
  perform public.decide_bill(b3, false, 'Fazer mais um orçamento');
  perform tests.eq((select approval_status from public.bills where id = b3), 'recusada', 'recusada');
  perform tests.throws(format('select public.pay_bill(%L, %L, %L)', b3, a, '2020-03-10'), 'permissão', 'aprovador não paga');

  perform tests.login('f4-op@igreja.test');
  perform tests.throws(format('select public.pay_bill(%L, %L, %L)', b3, a, '2020-03-10'), 'recusada', 'recusada não é paga');
  perform public.update_bill(b3, 'Telhado (novo orçamento)', 70000, '2020-03-12');
  perform tests.eq((select approval_status from public.bills where id = b3), 'pendente', 'ajuste volta para aprovação');

  perform tests.login('f4@igreja.test');
  perform public.create_bill(v_org, 'pagar', 'Som novo', 90000, '2020-03-20', c_obras);
  perform tests.throws(format('select public.decide_bill(%L, true)', (select id from public.bills where description = 'Som novo' and organization_id = v_org)),
    'não pode aprová-la', 'quem cadastrou não aprova');
  perform public.decide_bill(b3, true, 'Ok, conforme orçamento');
  perform tests.eq((select decided_by from public.bills where id = b3), tests.user_id('f4@igreja.test'), 'registra quem aprovou');

  perform tests.login('f4-op@igreja.test');
  perform tests.throws(format('select public.pay_bill(%L, %L, %L, 75000)', b3, a, '2020-03-12'), 'valor aprovado', 'não paga acima do aprovado');
  v_entry := public.pay_bill(b3, a, '2020-03-12');
  perform tests.eq(app.entry_effect_on_account(v_entry, a), -70000::bigint, 'paga o valor aprovado');

  -- ---------------------------------------------------------------- cancelamento
  select id into b1 from public.bills where organization_id = v_org and series_no = 2;
  perform tests.throws(format('select public.cancel_bill(%L, %L)', b1, 'x'), 'motivo', 'cancelar exige motivo');
  v_n := public.cancel_bill(b1, 'Contrato encerrado', true);
  perform tests.eq(v_n, 2, 'cancela esta e as próximas da série');
  perform tests.eq((select status from public.bills where organization_id = v_org and series_no = 1), 'aberta', 'a anterior continua em aberto');

  -- ---------------------------------------------------------------- escrita direta bloqueada
  perform tests.throws(format('update public.bills set amount_cents = 1 where id = %L', b3), null, 'sem update direto na tabela');
  perform tests.throws(format('insert into public.bills (organization_id, kind, description, amount_cents, due_date, competence_date, category_id) values (%L, %L, %L, 1, now(), now(), %L)', v_org, 'pagar', 'xx', c_obras),
    null, 'sem insert direto na tabela');

  -- ---------------------------------------------------------------- resumo
  perform tests.eq((select overdue_pay_count from public.bills_summary(v_org)), 3::bigint, 'contas vencidas (energia 1/3, lâmpadas e som novo)');
  perform tests.eq((select pending_approval_count from public.bills_summary(v_org)), 1::bigint, 'uma aguardando aprovação');
  perform tests.login('f4-fora@igreja.test');
  perform tests.eq((select count(*) from public.bills), 0::bigint, 'quem é de fora não vê contas');

  -- ---------------------------------------------------------------- orçamento
  perform tests.login('f4-op@igreja.test');
  perform tests.throws(format('select public.set_budget(%L, %L, 2020, 30000)', v_org, c_ocup), 'permissão', 'operador não define orçamento');
  perform tests.login('f4@igreja.test');
  perform tests.throws(format('select public.set_budget(%L, %L, 2020, 30000)', v_org, c_energia), 'categoria principal', 'orçamento só na categoria principal');
  perform public.set_budget(v_org, c_ocup, 2020, 30000);
  perform public.set_budget(v_org, c_obras, 2020, 50000, 3);
  perform tests.eq((select count(*) from public.budgets where organization_id = v_org), 22::bigint, '12 meses + 10 meses');
  perform public.set_budget(v_org, c_obras, 2020, 0, 6);
  perform tests.eq((select count(*) from public.budgets where organization_id = v_org and category_id = c_obras), 3::bigint, 'zero apaga dali em diante');

  select * into r from public.budget_vs_actual(v_org, '2020-03-01', '2020-03-31') where category_id = c_obras;
  perform tests.eq(r.budget_cents, 50000::bigint, 'orçado de março');
  perform tests.eq(r.actual_cents, 70000::bigint, 'realizado de março (telhado)');
  select * into r from public.budget_vs_actual(v_org, '2020-01-01', '2020-03-31') where category_id = c_ocup;
  perform tests.eq(r.budget_cents, 90000::bigint, 'orçado do trimestre');
  perform tests.eq(r.actual_cents, 25000::bigint, 'realizado do trimestre (o estorno entra na data em que foi feito)');

  -- ---------------------------------------------------------------- fechamento
  perform tests.eq((select pending from public.period_checklist(v_org, '2020-01-01') where item = 'contas_em_aberto'), 1::bigint,
    'checklist aponta a conta em aberto de janeiro');
  perform tests.eq((select pending from public.period_checklist(v_org, '2020-03-01') where item = 'aguardando_aprovacao'), 1::bigint,
    'checklist aponta despesa aguardando aprovação');
  perform tests.login('f4-fora@igreja.test');
  perform tests.throws(format('select * from public.period_checklist(%L, %L)', v_org, '2020-01-01'), 'permissão', 'checklist só para membros');

  perform tests.login('f4@igreja.test');
  perform public.close_period(v_org, '2020-01-01');
  select id into b1 from public.bills where organization_id = v_org and series_no = 1;
  perform tests.throws(format('select public.pay_bill(%L, %L, %L)', b1, a, '2020-02-05'), 'fechado', 'competência em mês fechado bloqueia o pagamento');
end $$;
rollback;
