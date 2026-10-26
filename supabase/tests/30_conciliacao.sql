-- Importação de extrato e conciliação (Fase 2).
begin;
do $$
declare
  v_org uuid; a uuid; a2 uuid; c_diz uuid; c_obras uuid; f_constr uuid;
  r jsonb; l1 uuid; l2 uuid; l3 uuid; l4 uuid; l_old uuid; v_entry uuid; v_manual uuid; v_n integer;
  v_lines jsonb := $j$[
    {"external_id": "mp:111:1000:1", "posted_date": "2020-03-02", "gross_cents": 1000, "fee_cents": 5, "net_cents": 995, "description": "Pix QR", "balance_after_cents": 10995},
    {"external_id": "mp:222:3000:1", "posted_date": "2020-03-02", "gross_cents": 3000, "fee_cents": 0, "net_cents": 3000, "description": "Pix recebido"},
    {"external_id": "mp:333:-1500:1", "posted_date": "2020-03-03", "net_cents": -1500, "description": "Pix enviado"},
    {"external_id": "mp:444:2500:1", "posted_date": "2020-03-04", "net_cents": 2500, "description": "Pix recebido"},
    {"external_id": "mp:555:700:1", "posted_date": "2020-02-28", "net_cents": 700, "description": "Antes do saldo inicial"},
    {"external_id": "mp:666:0:1", "posted_date": "2020-03-04", "net_cents": 0, "description": "Valor zero"}
  ]$j$;
begin
  perform tests.new_user('conc@igreja.test');
  perform tests.new_user('conc-op@igreja.test');
  perform tests.new_user('conc-lider@igreja.test');
  perform tests.new_user('conc-fora@igreja.test');
  perform tests.login('conc@igreja.test');
  v_org := public.create_organization('Igreja Conciliação');
  perform public.invite_member(v_org, 'conc-op@igreja.test', 'operador');
  perform public.invite_member(v_org, 'conc-lider@igreja.test', 'lideranca');
  perform tests.login('conc-op@igreja.test'); perform public.accept_my_invitations();
  perform tests.login('conc-lider@igreja.test'); perform public.accept_my_invitations();

  perform tests.login('conc@igreja.test');
  a := public.create_financial_account(v_org, 'Mercado Pago', 'carteira_digital', 'mercado_pago', '2020-03-01', 10000);
  a2 := public.create_financial_account(v_org, 'Cora', 'banco', 'cora', '2020-03-01', 0);
  select id into c_diz from public.categories where organization_id = v_org and name = 'Dízimos';
  select id into c_obras from public.categories where organization_id = v_org and name = 'Construção e obras';
  select id into f_constr from public.funds where organization_id = v_org and name = 'Construção';

  -- ---------------------------------------------------------------- importação
  perform tests.login('conc-lider@igreja.test');
  perform tests.throws(format('select public.import_statement(%L, %L, %L, %L, %L, %L)', v_org, a, 'mercado_pago_extrato', 'x.csv', repeat('a', 64), v_lines),
    'permissão', 'liderança não importa extrato');

  perform tests.login('conc-op@igreja.test');
  r := public.import_statement(v_org, a, 'mercado_pago_extrato', 'maio.csv', repeat('a', 64), v_lines, 10000, 16695);
  perform tests.eq((r ->> 'new')::int, 5, 'importa 5 movimentos (valor zero fica de fora)');
  r := public.import_statement(v_org, a, 'mercado_pago_extrato', 'maio.csv', repeat('a', 64), v_lines);
  perform tests.eq((r ->> 'new')::int, 0, 'reimportar o mesmo arquivo não duplica');
  perform tests.eq((r ->> 'duplicate')::int, 6, 'duplicados contados');
  perform tests.eq((select count(*) from public.statement_lines where financial_account_id = a), 5::bigint, 'cinco linhas no extrato');
  perform tests.eq((select closing_balance_cents from public.statement_imports where file_name = 'maio.csv' order by created_at limit 1), 16695::bigint, 'saldo final do banco guardado');
  perform tests.throws(format($q$select public.import_statement(%L, %L, 'ofx', 'x.ofx', %L, '[{"external_id":"z","posted_date":"2020-03-02","gross_cents":100,"fee_cents":10,"net_cents":95}]')$q$, v_org, a, repeat('b', 64)),
    'inconsistentes', 'bruto − tarifa precisa bater com o líquido');

  select id into l1 from public.statement_lines where external_id = 'mp:111:1000:1';
  select id into l2 from public.statement_lines where external_id = 'mp:222:3000:1';
  select id into l3 from public.statement_lines where external_id = 'mp:333:-1500:1';
  select id into l4 from public.statement_lines where external_id = 'mp:444:2500:1';
  select id into l_old from public.statement_lines where external_id = 'mp:555:700:1';

  -- ---------------------------------------------------------------- privacidade
  perform tests.login('conc-lider@igreja.test');
  perform tests.eq((select count(*) from public.statement_lines), 0::bigint, 'liderança não vê as linhas (nomes de quem fez Pix)');
  perform tests.login('conc-fora@igreja.test');
  perform tests.eq((select count(*) from public.statement_lines), 0::bigint, 'quem é de fora não vê nada');
  perform tests.eq((select count(*) from public.statement_imports), 0::bigint, 'nem as importações');

  -- ---------------------------------------------------------------- criar lançamentos a partir do extrato
  perform tests.login('conc-op@igreja.test');
  v_n := public.post_statement_lines(v_org, array[l1, l2], c_diz, 'Dízimos e ofertas via Pix');
  perform tests.eq(v_n, 2, 'duas receitas criadas');
  perform tests.eq((select status from public.statement_lines where id = l1), 'conciliado', 'linha conciliada');
  select entry_id into v_entry from public.statement_lines where id = l1;
  perform tests.eq((select origin::text from public.journal_entries where id = v_entry), 'importacao', 'origem = importação');
  perform tests.eq(app.entry_effect_on_account(v_entry, a), 995::bigint, 'conta recebe o líquido');
  perform tests.eq((select -sum(amount_cents) from public.journal_lines jl join public.ledger_accounts la on la.id = jl.ledger_account_id
                     where jl.entry_id = v_entry and la.category_id = c_diz)::bigint, 1000::bigint, 'receita pelo bruto');
  perform tests.throws(format('select public.post_statement_lines(%L, array[%L]::uuid[], %L, %L)', v_org, l1, c_diz, 'de novo'),
    'já foi resolvido', 'não lança a mesma linha duas vezes');
  perform tests.throws(format('select public.post_statement_lines(%L, array[%L]::uuid[], %L, %L)', v_org, l3, c_diz, 'saída como receita'),
    'saída', 'saída não vira receita');
  perform tests.throws(format('select public.post_statement_lines(%L, array[%L]::uuid[], %L, %L)', v_org, l_old, c_diz, 'antiga'),
    'anterior ao saldo inicial', 'movimento anterior ao saldo inicial é recusado');

  v_n := public.post_statement_lines(v_org, array[l3], c_obras, 'Material de obra', p_fund_id => f_constr);
  perform tests.eq((select -sum(amount_cents) from public.journal_lines where fund_id = f_constr)::bigint, -1500::bigint, 'despesa marcada no fundo');

  -- ---------------------------------------------------------------- casar com lançamento já existente
  v_manual := public.post_income(v_org, a, c_diz, 2500, '2020-03-05', 'Oferta lançada à mão');
  perform tests.eq((select count(*) from public.statement_match_candidates(l4)), 1::bigint, 'sugere o lançamento de mesmo valor');
  perform tests.eq((select entry_id from public.statement_match_candidates_for_account(a) where line_id = l4), v_manual, 'sugestão por conta encontra o mesmo lançamento');
  perform tests.throws(format('select public.reconcile_statement_line(%L, %L)', l2, v_manual), 'já foi resolvido', 'linha já conciliada não casa de novo');
  perform public.reconcile_statement_line(l4, v_manual);
  perform tests.eq((select entry_id from public.statement_lines where id = l4), v_manual, 'linha casada com o lançamento manual');
  perform tests.eq((select count(*) from public.statement_match_candidates(l4)), 0::bigint, 'lançamento casado sai das sugestões');

  -- valor diferente é recusado
  v_manual := public.post_income(v_org, a2, c_diz, 2500, '2020-03-05', 'Outra conta');
  perform tests.login('conc@igreja.test');
  perform public.reopen_statement_line(l4);
  perform tests.login('conc-op@igreja.test');
  perform tests.throws(format('select public.reconcile_statement_line(%L, %L)', l4, v_manual), 'não bate', 'lançamento de outra conta não concilia');

  -- ---------------------------------------------------------------- ignorar e reabrir
  perform tests.throws(format('select public.ignore_statement_lines(array[%L]::uuid[], %L)', l_old, 'x'), 'motivo', 'ignorar exige motivo');
  perform tests.eq(public.ignore_statement_lines(array[l_old], 'Já está no saldo inicial'), 1, 'linha antiga ignorada');
  perform tests.throws(format('select public.reopen_statement_line(%L)', l_old), 'permissão', 'operador não reabre');

  -- ---------------------------------------------------------------- estorno devolve a linha para pendente
  perform tests.login('conc@igreja.test');
  perform tests.throws(format('select public.reopen_statement_line(%L)', l1), 'estorne', 'linha que gerou lançamento só volta pelo estorno');
  perform public.reverse_entry(v_entry, 'Classificação errada no teste');
  perform tests.eq((select status from public.statement_lines where id = l1), 'pendente', 'estorno devolve a linha para pendente');
  v_n := public.post_statement_lines(v_org, array[l1], c_diz, 'Dízimo reclassificado');
  perform tests.eq(v_n, 1, 'linha pode ser lançada de novo depois do estorno');

  -- ---------------------------------------------------------------- resumo
  perform tests.eq((select pending from public.reconciliation_summary(v_org) where financial_account_id = a), 1, 'uma pendente (a casada reaberta)');
  perform tests.eq((select ignored from public.reconciliation_summary(v_org) where financial_account_id = a), 1, 'uma ignorada');
  perform tests.eq((select sum(amount_cents) from public.journal_lines where organization_id = v_org)::bigint, 0::bigint, 'razão continua equilibrado');

  -- ---------------------------------------------------------------- linhas não são editadas pela API
  -- ---------------------------------------------------------------- desfazer importação
  perform tests.login('conc-op@igreja.test');
  r := public.import_statement(v_org, a2, 'ofx', 'errado.ofx', repeat('c', 64),
    '[{"external_id": "ofx:z1:1", "posted_date": "2020-03-05", "net_cents": 100}, {"external_id": "ofx:z2:1", "posted_date": "2020-03-05", "net_cents": -40}]'::jsonb);
  perform tests.login('conc-lider@igreja.test');
  perform tests.throws(format('select public.undo_statement_import(%L)', r ->> 'import_id'), 'permissão', 'liderança não desfaz importação');
  perform tests.login('conc-op@igreja.test');
  perform tests.eq(public.undo_statement_import((r ->> 'import_id')::uuid), 2, 'importação errada desfeita');
  perform tests.eq((select count(*) from public.statement_lines where financial_account_id = a2), 0::bigint, 'movimentos removidos');
  perform tests.eq((select count(*) from public.statement_imports where id = (r ->> 'import_id')::uuid), 0::bigint, 'importação removida');
  perform tests.login('conc@igreja.test');
  perform tests.eq((select count(*) from public.audit_log where table_name = 'statement_imports' and action = 'delete' and reason like 'Importação desfeita%'), 1::bigint, 'fica na auditoria');
  perform tests.login('conc-op@igreja.test');
  r := public.import_statement(v_org, a2, 'ofx', 'errado.ofx', repeat('c', 64),
    '[{"external_id": "ofx:z1:1", "posted_date": "2020-03-05", "net_cents": 100}]'::jsonb);
  perform tests.eq((r ->> 'new')::integer, 1, 'depois de desfazer, pode importar de novo');
  perform tests.throws(format('select public.undo_statement_import(%L)', (select import_id from public.statement_lines where id = l2)),
    'já foram lançados', 'não desfaz importação com movimentos resolvidos');

  perform tests.login('conc@igreja.test');
  perform tests.throws(format('update public.statement_lines set net_cents = 1 where id = %L', l2), 'permission denied', 'valor importado não muda pela API');
  perform tests.logout();
end $$;
rollback;
