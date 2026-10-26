-- Utilitários de teste: trocar de usuário, esperar erro, comparar valores.
create schema tests;
grant usage on schema tests to authenticated, anon;

create function tests.user_id(p_email text) returns uuid language sql stable security definer as $$
  select id from auth.users where email = p_email $$;

create function tests.new_user(p_email text) returns uuid language sql security definer as $$
  insert into auth.users (email) values (p_email) returning id $$;

-- Entra como a pessoa (papel authenticated), com aal1 ou aal2.
create function tests.login(p_email text, p_aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', tests.user_id(p_email), 'email', p_email, 'aal', p_aal, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function tests.login_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;

create function tests.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create function tests.eq(p_actual anyelement, p_expected anyelement, p_label text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FALHOU: % (esperado %, obtido %)', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok: %', p_label;
end $$;

-- Executa o SQL e exige que dê erro contendo o trecho informado.
create function tests.throws(p_sql text, p_contains text, p_label text) returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if p_contains is not null and position(lower(p_contains) in lower(v_msg)) = 0 then
      raise exception 'FALHOU: % (erro inesperado: %)', p_label, v_msg;
    end if;
    raise notice 'ok: % (bloqueado: %)', p_label, v_msg;
    return;
  end;
  raise exception 'FALHOU: % (deveria ter dado erro)', p_label;
end $$;

grant execute on all functions in schema tests to authenticated, anon;
