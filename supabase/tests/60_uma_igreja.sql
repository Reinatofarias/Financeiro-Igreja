-- Fora dos testes, só existe uma igreja: depois da primeira, quem chega sem acesso não cria outra.
do $$
begin
  perform tests.new_user('primeira@igreja.test');
  perform tests.new_user('sem-acesso@igreja.test');
  perform set_config('app.multi_org', 'off', true);
  perform tests.login('primeira@igreja.test');
  perform public.create_organization('Igreja Única');
  perform tests.login('sem-acesso@igreja.test');
  perform tests.throws($q$select public.create_organization('Igreja Duplicada')$q$, 'já está cadastrada', 'não cria segunda igreja');
  perform tests.eq((select count(*) from public.organizations where name = 'Igreja Duplicada'), 0::bigint, 'nenhuma igreja duplicada');
  raise exception 'rollback-ok';
exception when others then
  if sqlerrm <> 'rollback-ok' then raise; end if;
  raise notice 'ok: testes de igreja única (desfeitos)';
end $$;
