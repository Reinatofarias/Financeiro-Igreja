-- O Financeiro Proclamai é de uma igreja só.
-- Depois do primeiro cadastro, ninguém cria outra organização: novas pessoas entram pelo cadastro
-- que o administrador faz em Configurações (convite aceito no primeiro login).
-- app.multi_org = 'on' só existe para os testes automáticos (que simulam várias igrejas); a API não consegue definir isso.
create or replace function public.create_organization(p_name text, p_timezone text default 'America/Recife', p_document text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = '28000';
  end if;
  if exists (select 1 from public.memberships where user_id = auth.uid() and is_active) then
    raise exception 'Você já participa de uma organização.' using errcode = '42501';
  end if;
  -- Trava para dois primeiros cadastros ao mesmo tempo.
  perform pg_advisory_xact_lock(hashtext('create_organization'));
  if coalesce(current_setting('app.multi_org', true), '') <> 'on' and exists (select 1 from public.organizations) then
    raise exception 'A igreja já está cadastrada. Peça ao administrador para liberar seu acesso em Configurações.' using errcode = '42501';
  end if;
  insert into public.organizations (name, timezone, document, created_by)
  values (trim(p_name), coalesce(p_timezone, 'America/Recife'), nullif(regexp_replace(coalesce(p_document, ''), '\D', '', 'g'), ''), auth.uid())
  returning id into v_org;
  insert into public.memberships (organization_id, user_id, role, created_by)
  values (v_org, auth.uid(), 'admin', auth.uid());
  perform app.seed_organization(v_org);
  return v_org;
end $$;
