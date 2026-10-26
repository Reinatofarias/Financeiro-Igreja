-- Financeiro da Igreja · Fase 1 · 001 núcleo
-- Organizações, unidades, perfis, vínculos, convites, funções de autorização e auditoria.
-- Regras: dinheiro sempre em centavos (bigint); toda tabela exposta tem RLS.

create schema if not exists app;
comment on schema app is 'Funções internas de autorização e regras financeiras. Não exposto pela API.';
grant usage on schema app to authenticated;

-- ---------------------------------------------------------------- tipos
create type public.member_role as enum ('admin', 'tesoureiro', 'operador', 'aprovador', 'auditor', 'lideranca');
create type public.account_kind as enum ('banco', 'carteira_digital', 'caixa_fisico', 'outra');
create type public.account_provider as enum ('mercado_pago', 'cora', 'pagbank', 'manual');
create type public.ledger_kind as enum ('ativo', 'receita', 'despesa', 'patrimonio', 'transitoria');
create type public.category_kind as enum ('receita', 'despesa');
create type public.entry_kind as enum ('saldo_inicial', 'receita', 'despesa', 'transferencia', 'ajuste', 'estorno', 'reclassificacao');
create type public.entry_status as enum ('confirmado', 'estornado');
create type public.entry_origin as enum ('manual', 'caixa', 'importacao', 'integracao', 'sistema');

-- ---------------------------------------------------------------- organizações
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  legal_name text,
  document text,                          -- CNPJ, só números
  timezone text not null default 'America/Recife',
  logo_path text,                         -- caminho no bucket privado "identidade"
  require_mfa boolean not null default true,
  is_demo boolean not null default false, -- dados demonstrativos ficam marcados
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);
comment on column public.organizations.require_mfa is 'Quando verdadeiro, admin e tesoureiro só escrevem com sessão MFA (aal2).';

create function app.check_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Fuso horário inválido: %', new.timezone using errcode = '22023';
  end if;
  return new;
end $$;

create trigger organizations_timezone before insert or update of timezone on public.organizations
  for each row execute function app.check_timezone();

create table public.units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  parent_id uuid,
  name text not null check (length(trim(name)) between 2 and 120),
  kind text not null default 'sede' check (kind in ('sede', 'congregacao', 'outra')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name),
  foreign key (organization_id, parent_id) references public.units (organization_id, id)
);

-- ---------------------------------------------------------------- pessoas
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), lower(new.email))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  unit_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (organization_id, user_id),
  foreign key (organization_id, unit_id) references public.units (organization_id, id)
);
create index memberships_user_idx on public.memberships (user_id) where is_active;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  email text not null check (email = lower(email) and email like '%_@_%'),
  role public.member_role not null,
  invited_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  revoked_at timestamptz
);
create unique index invitations_open_unique on public.invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------- autorização
-- Todas as funções abaixo leem o JWT da requisição (auth.uid / auth.jwt).

create function app.current_role_in(p_org uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m
  where m.organization_id = p_org and m.user_id = auth.uid() and m.is_active
$$;

create function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.current_role_in(p_org) is not null
$$;

create function app.has_role(p_org uuid, p_roles public.member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.current_role_in(p_org) = any (p_roles), false)
$$;

-- MFA: perfis privilegiados (admin, tesoureiro) precisam de aal2 quando a organização exige.
create function app.mfa_satisfied(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when app.current_role_in(p_org) not in ('admin', 'tesoureiro') then true
    when not (select o.require_mfa from public.organizations o where o.id = p_org) then true
    else coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  end
$$;

-- Pode escrever com um dos papéis informados (inclui checagem de MFA).
create function app.can(p_org uuid, p_roles public.member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role(p_org, p_roles) and app.mfa_satisfied(p_org)
$$;

-- Versão que interrompe com mensagem clara, usada dentro das funções financeiras.
create function app.require(p_org uuid, p_roles public.member_role[]) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = '28000';
  end if;
  if not app.has_role(p_org, p_roles) then
    raise exception 'Seu perfil não tem permissão para esta ação.' using errcode = '42501';
  end if;
  if not app.mfa_satisfied(p_org) then
    raise exception 'Esta ação exige verificação em duas etapas (MFA).' using errcode = '42501';
  end if;
end $$;

create function app.org_today(p_org uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone o.timezone)::date from public.organizations o where o.id = p_org
$$;

-- Papéis que escrevem lançamentos e os que administram cadastros.
create function app.roles_operate() returns public.member_role[] language sql immutable as $$
  select array['admin', 'tesoureiro', 'operador']::public.member_role[] $$;
create function app.roles_manage() returns public.member_role[] language sql immutable as $$
  select array['admin', 'tesoureiro']::public.member_role[] $$;
create function app.roles_sensitive_read() returns public.member_role[] language sql immutable as $$
  select array['admin', 'tesoureiro', 'auditor']::public.member_role[] $$;

-- ---------------------------------------------------------------- auditoria
create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete restrict,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  reason text
);
create index audit_log_org_idx on public.audit_log (organization_id, occurred_at desc);
create index audit_log_record_idx on public.audit_log (record_id);

-- Campos sensíveis nunca vão para a auditoria.
create function app.redact(p_table text, p_row jsonb) returns jsonb
language sql immutable as $$
  select case
    when p_row is null then null
    when p_table in ('donors', 'contacts') then p_row - 'document' - 'pix_key' - 'phone' - 'email'
    else p_row
  end
$$;

create function app.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_org uuid;
begin
  v_org := coalesce((v_new ->> 'organization_id')::uuid, (v_old ->> 'organization_id')::uuid);
  if tg_table_name = 'organizations' then
    v_org := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
  end if;
  insert into public.audit_log (organization_id, actor_id, action, table_name, record_id, old_data, new_data, reason)
  values (
    v_org, auth.uid(), lower(tg_op), tg_table_name,
    coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid),
    app.redact(tg_table_name, v_old), app.redact(tg_table_name, v_new),
    nullif(current_setting('app.audit_reason', true), '')
  );
  return coalesce(new, old);
end $$;

create function app.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Registro imutável: % não permite %.', tg_table_name, lower(tg_op) using errcode = '42501';
end $$;

create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function app.forbid_change();

create trigger audit_organizations after insert or update or delete on public.organizations
  for each row execute function app.audit();
create trigger audit_units after insert or update or delete on public.units
  for each row execute function app.audit();
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function app.audit();
create trigger audit_invitations after insert or update or delete on public.invitations
  for each row execute function app.audit();

-- ---------------------------------------------------------------- RLS
alter table public.organizations enable row level security;
alter table public.units enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_log enable row level security;

create policy organizations_select on public.organizations for select to authenticated
  using (app.is_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (app.can(id, array['admin']::public.member_role[]))
  with check (app.can(id, array['admin']::public.member_role[]));

create policy units_select on public.units for select to authenticated
  using (app.is_member(organization_id));
create policy units_insert on public.units for insert to authenticated
  with check (app.can(organization_id, app.roles_manage()));
create policy units_update on public.units for update to authenticated
  using (app.can(organization_id, app.roles_manage()))
  with check (app.can(organization_id, app.roles_manage()));

-- Perfil: a própria pessoa, ou quem divide uma organização com ela.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid() or exists (
      select 1 from public.memberships mine
      join public.memberships theirs on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid() and mine.is_active and theirs.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Vínculos: visíveis aos membros; alteração só pelas funções (ninguém edita o próprio papel).
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or app.is_member(organization_id));

create policy invitations_select on public.invitations for select to authenticated
  using (app.has_role(organization_id, array['admin']::public.member_role[]));

create policy audit_log_select on public.audit_log for select to authenticated
  using (app.can(organization_id, app.roles_sensitive_read()));

-- e-mail só pode ser alterado pela própria pessoa e não muda o vínculo
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Defesa em profundidade: o papel anônimo não lê nenhuma tabela do sistema.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
revoke execute on all functions in schema app from public, anon;
alter default privileges in schema app revoke execute on functions from public, anon;
grant execute on all functions in schema app to authenticated;
