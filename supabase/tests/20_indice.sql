-- O índice de lançamentos respeita o RLS e mostra o valor bruto.
begin;
do $$
declare v_org uuid; a uuid; c uuid;
begin
  perform tests.new_user('idx@igreja.test');
  perform tests.new_user('idx-fora@igreja.test');
  perform tests.login('idx@igreja.test');
  v_org := public.create_organization('Igreja Índice');
  a := public.create_financial_account(v_org, 'Conta', 'banco', 'manual', '2020-01-01', 0);
  select id into c from public.categories where organization_id = v_org and name = 'Dízimos';
  perform public.post_income(v_org, a, c, 10000, '2020-01-05', 'Dízimo', p_fee_cents => 150);
  perform tests.eq((select amount_cents from public.entry_index where kind = 'receita'), 10000::bigint, 'valor do lançamento = bruto');
  perform tests.eq((select cash_effect_cents from public.entry_index where kind = 'receita'), 9850::bigint, 'efeito no caixa = líquido');
  perform tests.eq((select account_ids from public.entry_index where kind = 'receita'), array[a], 'conta indexada');
  perform tests.login('idx-fora@igreja.test');
  perform tests.eq((select count(*) from public.entry_index), 0::bigint, 'índice não vaza para quem não é membro');
  perform tests.logout();
end $$;
rollback;
