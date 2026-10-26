-- Integração com o Mercado Pago (Fase 3).
begin;
create function tests.login_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

do $$
declare
  v_org uuid; mp uuid; mp2 uuid; cora uuid; v_int uuid; r jsonb;
  v_lines jsonb := $j$[
    {"external_id": "mp:901:1000:1", "posted_date": "2020-04-02", "gross_cents": 1000, "fee_cents": 5, "net_cents": 995, "kind": "settlement"},
    {"external_id": "mp:902:3000:1", "posted_date": "2020-04-03", "gross_cents": 3000, "fee_cents": 0, "net_cents": 3000, "kind": "settlement"}
  ]$j$;
begin
  perform tests.new_user('int@igreja.test');
  perform tests.new_user('int-op@igreja.test');
  perform tests.login('int@igreja.test');
  v_org := public.create_organization('Igreja Integração');
  perform public.invite_member(v_org, 'int-op@igreja.test', 'operador');
  perform tests.login('int-op@igreja.test'); perform public.accept_my_invitations();

  perform tests.login('int@igreja.test');
  mp := public.create_financial_account(v_org, 'MP A', 'carteira_digital', 'mercado_pago', '2020-04-01', 0);
  mp2 := public.create_financial_account(v_org, 'MP B', 'carteira_digital', 'mercado_pago', '2020-04-01', 0);
  cora := public.create_financial_account(v_org, 'Cora', 'banco', 'cora', '2020-04-01', 0);

  -- ---------------------------------------------------------------- configuração
  perform tests.login('int-op@igreja.test');
  perform tests.throws(format('select public.set_integration(%L, %L, 1::smallint, true)', v_org, mp), 'permissão', 'operador não configura integração');
  perform tests.login('int@igreja.test', 'aal1');
  perform tests.throws(format('select public.set_integration(%L, %L, 1::smallint, true)', v_org, mp), 'duas etapas', 'administrador sem 2FA não configura');
  perform tests.login('int@igreja.test');
  perform tests.throws(format('select public.set_integration(%L, %L, 1::smallint, true)', v_org, cora), 'Mercado Pago', 'só Mercado Pago por enquanto');
  v_int := public.set_integration(v_org, mp, 1::smallint, true);
  perform tests.throws(format('select public.set_integration(%L, %L, 1::smallint, true)', v_org, mp2), 'outra conta', 'mesmo token não vai em duas contas');
  perform tests.eq(public.set_integration(v_org, mp, 2::smallint, true), v_int, 'trocar o número mantém a mesma integração');
  perform public.set_integration(v_org, mp, 1::smallint, true);
  perform tests.eq((select count(*) from public.audit_log where table_name = 'integrations'), 3::bigint, 'configuração vai para a auditoria');

  -- ---------------------------------------------------------------- só o servidor importa pela integração
  perform tests.throws(format('select public.integration_import(%L, %L, %L, %L)', v_int, 'r.csv', repeat('b', 64), v_lines), 'permission denied', 'usuário não chama a importação da integração');
  perform tests.throws(format('select public.import_statement(%L, %L, %L, %L, %L, %L)', v_org, mp, 'mercado_pago_api', 'x.csv', repeat('b', 64), v_lines),
    'reservada', 'usuário não finge ser a integração');
  perform tests.login_anon();
  perform tests.throws('select count(*) from public.integrations', 'permission denied', 'anônimo não vê integrações');

  perform tests.login_service();
  r := public.integration_import(v_int, 'settlement-1.csv', repeat('b', 64), v_lines);
  perform tests.eq((r ->> 'new')::integer, 2, 'integração importa os movimentos');
  r := public.integration_import(v_int, 'settlement-1.csv', repeat('b', 64), v_lines);
  perform tests.eq((r ->> 'skipped')::boolean, true, 'mesmo relatório não é importado duas vezes');
  perform public.integration_record_run(v_int, 'agendado', 'ok', '2 movimentos novos', 2, '2020-04-04T00:00:00Z');
  perform public.integration_record_run(v_int, 'agendado', 'aguardando', 'relatório pedido', 0, '2020-04-03T00:00:00Z');

  perform tests.login('int-op@igreja.test');
  perform tests.eq((select count(*) from public.statement_lines where financial_account_id = mp and status = 'pendente'), 2::bigint, 'movimentos chegam como pendentes');
  perform tests.eq((select synced_until from public.integrations where id = v_int), '2020-04-04T00:00:00Z'::timestamptz, 'período sincronizado não volta para trás');
  perform tests.eq((select last_status from public.integrations where id = v_int), 'aguardando', 'último status registrado');
  perform tests.eq((select count(*) from public.integration_runs where integration_id = v_int), 2::bigint, 'histórico de sincronizações');
  perform tests.throws(format('update public.integrations set credential_slot = 3 where id = %L', v_int), 'permission denied', 'configuração não muda pela API');

  -- Arquivo manual com o mesmo pagamento não duplica.
  r := public.import_statement(v_org, mp, 'mercado_pago_liberacoes', 'manual.csv', repeat('d', 64), v_lines);
  perform tests.eq((r ->> 'new')::integer, 0, 'arquivo manual do mesmo período não duplica');

  perform tests.login('int@igreja.test');
  perform public.set_integration(v_org, mp, 1::smallint, false);
  perform tests.login_service();
  perform tests.throws(format('select public.integration_import(%L, %L, %L, %L)', v_int, 'r2.csv', repeat('b', 64), v_lines), 'desativada', 'integração desligada não importa');
  perform tests.logout();
end $$;
rollback;
