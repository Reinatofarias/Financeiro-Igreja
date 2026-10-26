-- Financeiro da Igreja: instalação completa do banco.
-- Gerado por supabase/gerar-instalar.sh a partir de supabase/migrations/. Não edite à mão.
-- Supabase > SQL Editor > colar tudo > Run. Rode uma única vez, num projeto novo.

begin;

-- ====================================================================
-- migrations/20261024000100_nucleo.sql
-- ====================================================================
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

-- ====================================================================
-- migrations/20261024000200_cadastros.sql
-- ====================================================================
-- Financeiro da Igreja · Fase 1 · 002 cadastros
-- Contas financeiras, plano do razão, categorias, dimensões, contatos, doadores, formas de pagamento,
-- criação da organização e gestão de membros.

-- ---------------------------------------------------------------- contas financeiras
create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  unit_id uuid,
  name text not null check (length(trim(name)) between 2 and 80),
  kind public.account_kind not null,
  provider public.account_provider not null default 'manual',
  institution text,                 -- nome do banco/instituição
  account_hint text,                -- ex.: final 1234 (nunca o número completo)
  opening_date date not null,
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (organization_id, id),
  unique (organization_id, name),
  foreign key (organization_id, unit_id) references public.units (organization_id, id)
);
comment on table public.financial_accounts is 'Conta bancária, carteira digital, caixa físico ou outra. O saldo é sempre calculado pelas partidas.';

-- ---------------------------------------------------------------- categorias
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  parent_id uuid,
  kind public.category_kind not null,
  code text,
  name text not null check (length(trim(name)) between 2 and 80),
  system_code text,                 -- categorias usadas pelo sistema (ex.: diferença de caixa)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, system_code),
  foreign key (organization_id, parent_id) references public.categories (organization_id, id)
);
create unique index categories_name_unique on public.categories
  (organization_id, kind, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create function app.check_category_parent() returns trigger
language plpgsql set search_path = '' as $$
declare v_kind public.category_kind;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'Uma categoria não pode ser pai dela mesma.';
    end if;
    select kind into v_kind from public.categories where id = new.parent_id;
    if v_kind is distinct from new.kind then
      raise exception 'A categoria pai precisa ser do mesmo tipo (receita ou despesa).';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.kind <> old.kind then
    raise exception 'O tipo de uma categoria não pode ser alterado depois de criada.';
  end if;
  if tg_op = 'UPDATE' and old.system_code is not null and new.system_code is distinct from old.system_code then
    raise exception 'Categoria do sistema não pode perder sua função.';
  end if;
  return new;
end $$;
create trigger categories_parent before insert or update on public.categories
  for each row execute function app.check_category_parent();

-- ---------------------------------------------------------------- dimensões
create table public.ministries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  unit_id uuid,
  name text not null check (length(trim(name)) between 2 and 80),
  kind text not null default 'ministerio' check (kind in ('ministerio', 'departamento')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name),
  foreign key (organization_id, unit_id) references public.units (organization_id, id)
);

create table public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  code text,
  name text not null check (length(trim(name)) between 2 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 80),
  kind text not null default 'projeto' check (kind in ('projeto', 'campanha', 'evento')),
  starts_on date,
  ends_on date,
  goal_cents bigint check (goal_cents is null or goal_cents > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.funds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 80),
  is_restricted boolean not null default true,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);
comment on column public.funds.is_restricted is 'Recurso vinculado: o saldo do fundo não aparece como recurso livre.';

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 40),
  is_active boolean not null default true,
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  kind text not null default 'fornecedor' check (kind in ('fornecedor', 'favorecido', 'outro')),
  name text not null check (length(trim(name)) between 2 and 160),
  document text,
  pix_key text,
  email text,
  phone text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index contacts_name_idx on public.contacts (organization_id, lower(name));

-- Doadores identificados: acesso restrito, identificação sempre opcional.
create table public.donors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 160),
  document text,
  email text,
  phone text,
  consent_at timestamptz,          -- consentimento para tratamento dos dados
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

-- ---------------------------------------------------------------- razão
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  kind public.ledger_kind not null,
  name text not null,
  financial_account_id uuid unique,
  category_id uuid unique,
  system_code text,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, system_code),
  foreign key (organization_id, financial_account_id) references public.financial_accounts (organization_id, id),
  foreign key (organization_id, category_id) references public.categories (organization_id, id),
  check (
    (kind = 'ativo' and financial_account_id is not null and category_id is null) or
    (kind in ('receita', 'despesa') and category_id is not null and financial_account_id is null) or
    (kind in ('patrimonio', 'transitoria') and system_code is not null and financial_account_id is null and category_id is null)
  )
);
comment on table public.ledger_accounts is 'Plano do razão, mantido pelo sistema: 1 conta de ativo por conta financeira, 1 de resultado por categoria e as contas de sistema.';

create function app.ledger_for_financial_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ledger_accounts (organization_id, kind, name, financial_account_id)
  values (new.organization_id, 'ativo', new.name, new.id);
  return new;
end $$;
create trigger financial_accounts_ledger after insert on public.financial_accounts
  for each row execute function app.ledger_for_financial_account();

create function app.ledger_for_category() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ledger_accounts (organization_id, kind, name, category_id)
  values (new.organization_id, new.kind::text::public.ledger_kind, new.name, new.id);
  return new;
end $$;
create trigger categories_ledger after insert on public.categories
  for each row execute function app.ledger_for_category();

create function app.sync_ledger_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name then
    if tg_table_name = 'financial_accounts' then
      update public.ledger_accounts set name = new.name where financial_account_id = new.id;
    else
      update public.ledger_accounts set name = new.name where category_id = new.id;
    end if;
  end if;
  return new;
end $$;
create trigger financial_accounts_ledger_name after update of name on public.financial_accounts
  for each row execute function app.sync_ledger_name();
create trigger categories_ledger_name after update of name on public.categories
  for each row execute function app.sync_ledger_name();

-- O tipo e a data de abertura de uma conta não mudam depois de criada (o saldo inicial tem função própria).
create function app.check_financial_account_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind <> old.kind then
    raise exception 'O tipo da conta não pode ser alterado depois de criada.';
  end if;
  if new.opening_date <> old.opening_date then
    raise exception 'Use "Ajustar saldo inicial" para mudar a data de abertura.';
  end if;
  return new;
end $$;
create trigger financial_accounts_update before update on public.financial_accounts
  for each row execute function app.check_financial_account_update();

-- ---------------------------------------------------------------- auditoria e RLS
create trigger audit_financial_accounts after insert or update or delete on public.financial_accounts
  for each row execute function app.audit();
create trigger audit_categories after insert or update or delete on public.categories
  for each row execute function app.audit();
create trigger audit_ministries after insert or update or delete on public.ministries
  for each row execute function app.audit();
create trigger audit_cost_centers after insert or update or delete on public.cost_centers
  for each row execute function app.audit();
create trigger audit_projects after insert or update or delete on public.projects
  for each row execute function app.audit();
create trigger audit_funds after insert or update or delete on public.funds
  for each row execute function app.audit();
create trigger audit_payment_methods after insert or update or delete on public.payment_methods
  for each row execute function app.audit();
create trigger audit_contacts after insert or update or delete on public.contacts
  for each row execute function app.audit();
create trigger audit_donors after insert or update or delete on public.donors
  for each row execute function app.audit();

do $$
declare t text;
begin
  -- Cadastros comuns: membros leem; admin e tesoureiro (com MFA) criam e editam. Ninguém apaga: desative.
  foreach t in array array['financial_accounts', 'categories', 'ministries', 'cost_centers', 'projects', 'funds', 'payment_methods']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.is_member(organization_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.can(organization_id, app.roles_manage()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.can(organization_id, app.roles_manage())) with check (app.can(organization_id, app.roles_manage()))', t || '_update', t);
  end loop;
end $$;

-- Contatos (fornecedores/favorecidos): operadores também cadastram ao lançar despesa.
alter table public.contacts enable row level security;
create policy contacts_select on public.contacts for select to authenticated
  using (app.is_member(organization_id));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (app.can(organization_id, app.roles_operate()));
create policy contacts_update on public.contacts for update to authenticated
  using (app.can(organization_id, app.roles_operate()))
  with check (app.can(organization_id, app.roles_operate()));

-- Doadores: só admin e tesoureiro escrevem; auditor lê. Liderança e operador não veem.
alter table public.donors enable row level security;
create policy donors_select on public.donors for select to authenticated
  using (app.can(organization_id, app.roles_sensitive_read()));
create policy donors_insert on public.donors for insert to authenticated
  with check (app.can(organization_id, app.roles_manage()));
create policy donors_update on public.donors for update to authenticated
  using (app.can(organization_id, app.roles_manage()))
  with check (app.can(organization_id, app.roles_manage()));

alter table public.ledger_accounts enable row level security;
create policy ledger_accounts_select on public.ledger_accounts for select to authenticated
  using (app.is_member(organization_id));

-- ---------------------------------------------------------------- criação da organização
create function app.seed_organization(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_parent uuid;
  r record;
begin
  insert into public.units (organization_id, name, kind) values (p_org, 'Sede', 'sede');

  insert into public.ledger_accounts (organization_id, kind, name, system_code) values
    (p_org, 'patrimonio', 'Saldos iniciais e patrimônio', 'saldos_iniciais'),
    (p_org, 'transitoria', 'Transferências em trânsito', 'transferencias_transito');

  insert into public.payment_methods (organization_id, name)
  select p_org, unnest(array['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Boleto', 'Transferência (TED)', 'Cheque', 'Débito automático']);

  -- Plano de categorias padrão de igreja (editável).
  for r in select * from (values
    ('receita', 'Dízimos', null), ('receita', 'Ofertas', null), ('receita', 'Doações', null),
    ('receita', 'Campanhas', null), ('receita', 'Eventos', null), ('receita', 'Rendimentos financeiros', null),
    ('receita', 'Outras receitas', null), ('receita', 'Sobra de caixa', 'sobra_caixa'),
    ('despesa', 'Pessoal e ajudas de custo', null), ('despesa', 'Ocupação e manutenção', null),
    ('despesa', 'Ministérios', null), ('despesa', 'Missões', null), ('despesa', 'Ação social', null),
    ('despesa', 'Eventos', null), ('despesa', 'Materiais e suprimentos', null), ('despesa', 'Construção e obras', null),
    ('despesa', 'Tarifas bancárias', 'tarifas'), ('despesa', 'Impostos e taxas', null),
    ('despesa', 'Outras despesas', null), ('despesa', 'Falta de caixa', 'falta_caixa')
  ) as c(kind, name, system_code)
  loop
    insert into public.categories (organization_id, kind, name, system_code)
    values (p_org, r.kind::public.category_kind, r.name, r.system_code);
  end loop;

  select id into v_parent from public.categories where organization_id = p_org and kind = 'despesa' and name = 'Pessoal e ajudas de custo';
  insert into public.categories (organization_id, kind, parent_id, name)
  select p_org, 'despesa', v_parent, unnest(array['Prebenda pastoral', 'Ajuda de custo', 'Encargos']);

  select id into v_parent from public.categories where organization_id = p_org and kind = 'despesa' and name = 'Ocupação e manutenção';
  insert into public.categories (organization_id, kind, parent_id, name)
  select p_org, 'despesa', v_parent, unnest(array['Aluguel', 'Energia elétrica', 'Água', 'Internet e telefone', 'Manutenção e reparos', 'Limpeza']);

  insert into public.funds (organization_id, name, is_restricted, description) values
    (p_org, 'Construção', true, 'Recursos destinados à obra e construção.'),
    (p_org, 'Missões', true, 'Recursos destinados a missões.'),
    (p_org, 'Ação social', true, 'Recursos destinados à assistência social.'),
    (p_org, 'Manutenção da igreja', true, 'Reserva para manutenção do templo.');
end $$;

create function public.create_organization(p_name text, p_timezone text default 'America/Recife', p_document text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = '28000';
  end if;
  -- Uma pessoa sem vínculo pode criar a igreja e vira administradora. Quem já participa de uma não cria outra por aqui.
  if exists (select 1 from public.memberships where user_id = auth.uid() and is_active) then
    raise exception 'Você já participa de uma organização.' using errcode = '42501';
  end if;
  insert into public.organizations (name, timezone, document, created_by)
  values (trim(p_name), coalesce(p_timezone, 'America/Recife'), nullif(regexp_replace(coalesce(p_document, ''), '\D', '', 'g'), ''), auth.uid())
  returning id into v_org;
  insert into public.memberships (organization_id, user_id, role, created_by)
  values (v_org, auth.uid(), 'admin', auth.uid());
  perform app.seed_organization(v_org);
  return v_org;
end $$;

-- ---------------------------------------------------------------- membros e convites
create function public.invite_member(p_org uuid, p_email text, p_role public.member_role)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_email text := lower(trim(p_email));
begin
  perform app.require(p_org, array['admin']::public.member_role[]);
  if exists (
    select 1 from public.memberships m join auth.users u on u.id = m.user_id
    where m.organization_id = p_org and lower(u.email) = v_email and m.is_active
  ) then
    raise exception 'Esta pessoa já faz parte da organização.';
  end if;
  update public.invitations set revoked_at = now()
  where organization_id = p_org and email = v_email and accepted_at is null and revoked_at is null;
  insert into public.invitations (organization_id, email, role, invited_by)
  values (p_org, v_email, p_role, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.invitations where id = p_invitation;
  if v_org is null then raise exception 'Convite não encontrado.'; end if;
  perform app.require(v_org, array['admin']::public.member_role[]);
  update public.invitations set revoked_at = now() where id = p_invitation and accepted_at is null;
end $$;

-- Aceita convites válidos para o e-mail confirmado de quem está logado.
create function public.accept_my_invitations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_count integer := 0;
  r record;
begin
  select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  for r in
    select * from public.invitations
    where email = v_email and accepted_at is null and revoked_at is null and expires_at > now()
    for update
  loop
    insert into public.memberships (organization_id, user_id, role, created_by)
    values (r.organization_id, auth.uid(), r.role, r.invited_by)
    on conflict (organization_id, user_id) do update set role = excluded.role, is_active = true;
    update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create function public.update_member(p_membership uuid, p_role public.member_role, p_active boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare m public.memberships;
begin
  select * into m from public.memberships where id = p_membership for update;
  if m.id is null then raise exception 'Vínculo não encontrado.'; end if;
  perform app.require(m.organization_id, array['admin']::public.member_role[]);
  if m.user_id = auth.uid() then
    raise exception 'Você não pode alterar o seu próprio perfil de acesso.' using errcode = '42501';
  end if;
  update public.memberships set role = p_role, is_active = p_active where id = p_membership;
  if not exists (
    select 1 from public.memberships where organization_id = m.organization_id and role = 'admin' and is_active
  ) then
    raise exception 'A organização precisa de pelo menos um administrador ativo.';
  end if;
end $$;

grant execute on all functions in schema app to authenticated;
revoke execute on function public.create_organization(text, text, text) from public, anon;
revoke execute on function public.invite_member(uuid, text, public.member_role) from public, anon;
revoke execute on function public.revoke_invitation(uuid) from public, anon;
revoke execute on function public.accept_my_invitations() from public, anon;
revoke execute on function public.update_member(uuid, public.member_role, boolean) from public, anon;
grant execute on function public.create_organization(text, text, text) to authenticated;
grant execute on function public.invite_member(uuid, text, public.member_role) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.accept_my_invitations() to authenticated;
grant execute on function public.update_member(uuid, public.member_role, boolean) to authenticated;

-- ====================================================================
-- migrations/20261024000300_razao.sql
-- ====================================================================
-- Financeiro da Igreja · Fase 1 · 003 razão de partidas dobradas
-- Lançamentos, partidas, períodos, estorno, saldo inicial, receitas, despesas, transferências e comprovantes.
-- Convenção: amount_cents > 0 é débito, < 0 é crédito. Toda partida de um lançamento soma zero.

create table public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  month date not null check (extract(day from month) = 1),
  status text not null default 'aberto' check (status in ('aberto', 'fechado')),
  closed_at timestamptz,
  closed_by uuid references auth.users (id),
  reopened_at timestamptz,
  reopened_by uuid references auth.users (id),
  reopen_reason text,
  unique (organization_id, month)
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  number bigint generated always as identity,
  kind public.entry_kind not null,
  status public.entry_status not null default 'confirmado',
  description text not null check (length(trim(description)) between 2 and 240),
  competence_date date not null,          -- competência
  cash_date date not null,                -- pagamento/recebimento (regime de caixa)
  due_date date,                          -- vencimento, quando houver
  available_date date,                    -- disponibilidade do dinheiro (ex.: liberação do provedor)
  origin public.entry_origin not null default 'manual',
  origin_ref text,                        -- id externo (movimento importado, webhook...) — Fase 2/3
  contact_id uuid,
  donor_id uuid,
  payment_method_id uuid,
  document_ref text,                      -- nº da nota, recibo, comprovante
  cash_session_id uuid,
  transfer_group_id uuid,                 -- agrupa as pernas de uma transferência em trânsito
  counterpart_account_id uuid,            -- conta de destino de uma transferência em trânsito
  reverses_entry_id uuid unique,
  reversal_reason text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (organization_id, id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id),
  foreign key (organization_id, donor_id) references public.donors (organization_id, id),
  foreign key (organization_id, payment_method_id) references public.payment_methods (organization_id, id),
  foreign key (organization_id, reverses_entry_id) references public.journal_entries (organization_id, id),
  constraint journal_entries_counterpart_fk foreign key (organization_id, counterpart_account_id) references public.financial_accounts (organization_id, id),
  check ((kind = 'estorno') = (reverses_entry_id is not null)),
  check (available_date is null or available_date >= cash_date)
);
create index journal_entries_cash_idx on public.journal_entries (organization_id, cash_date);
create index journal_entries_competence_idx on public.journal_entries (organization_id, competence_date);
create index journal_entries_transfer_idx on public.journal_entries (transfer_group_id) where transfer_group_id is not null;
create index journal_entries_session_idx on public.journal_entries (cash_session_id) where cash_session_id is not null;
create unique index journal_entries_origin_unique on public.journal_entries (organization_id, origin, origin_ref)
  where origin_ref is not null;

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  entry_id uuid not null,
  line_no smallint not null,
  ledger_account_id uuid not null,
  amount_cents bigint not null check (amount_cents <> 0),
  unit_id uuid,
  ministry_id uuid,
  cost_center_id uuid,
  project_id uuid,
  fund_id uuid,
  memo text,
  unique (entry_id, line_no),
  foreign key (organization_id, entry_id) references public.journal_entries (organization_id, id),
  foreign key (organization_id, ledger_account_id) references public.ledger_accounts (organization_id, id),
  foreign key (organization_id, unit_id) references public.units (organization_id, id),
  foreign key (organization_id, ministry_id) references public.ministries (organization_id, id),
  foreign key (organization_id, cost_center_id) references public.cost_centers (organization_id, id),
  foreign key (organization_id, project_id) references public.projects (organization_id, id),
  foreign key (organization_id, fund_id) references public.funds (organization_id, id)
);
create index journal_lines_entry_idx on public.journal_lines (entry_id);
create index journal_lines_ledger_idx on public.journal_lines (ledger_account_id);
create index journal_lines_fund_idx on public.journal_lines (fund_id) where fund_id is not null;

-- ---------------------------------------------------------------- invariantes
-- Soma zero e ao menos duas partidas, verificado no fim da transação.
create function app.check_entry_balanced() returns trigger
language plpgsql set search_path = '' as $$
declare v_sum numeric; v_count integer;
begin
  select coalesce(sum(amount_cents), 0), count(*) into v_sum, v_count
  from public.journal_lines where entry_id = new.entry_id;
  if v_count < 2 or v_sum <> 0 then
    raise exception 'Lançamento desequilibrado (partidas: %, soma: %).', v_count, v_sum using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger journal_lines_balanced after insert on public.journal_lines
  deferrable initially deferred for each row execute function app.check_entry_balanced();

-- Todo lançamento precisa ter partidas (um cabeçalho vazio é recusado no fim da transação).
create function app.check_entry_has_lines() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.journal_lines where entry_id = new.id) then
    raise exception 'Lançamento sem partidas.' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger journal_entries_has_lines after insert on public.journal_entries
  deferrable initially deferred for each row execute function app.check_entry_has_lines();

-- Partidas nunca mudam.
create trigger journal_lines_immutable before update or delete on public.journal_lines
  for each row execute function app.forbid_change();

-- Lançamentos não são apagados; a única mudança permitida é confirmado → estornado.
create function app.guard_entry_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Lançamentos não podem ser apagados. Use estorno.' using errcode = '42501';
  end if;
  if old.status = 'confirmado' and new.status = 'estornado'
     and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
    return new;
  end if;
  raise exception 'Lançamentos confirmados não podem ser alterados. Estorne e lance novamente.' using errcode = '42501';
end $$;
create trigger journal_entries_guard before update or delete on public.journal_entries
  for each row execute function app.guard_entry_update();

create function app.is_period_closed(p_org uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.accounting_periods
    where organization_id = p_org and month = date_trunc('month', p_date)::date and status = 'fechado'
  )
$$;

-- Nenhum lançamento entra em mês fechado, seja pela data de caixa ou de competência.
create function app.check_period_open() returns trigger
language plpgsql set search_path = '' as $$
begin
  if app.is_period_closed(new.organization_id, new.cash_date)
     or app.is_period_closed(new.organization_id, new.competence_date) then
    raise exception 'O mês de % está fechado. Reabra o período com justificativa ou use uma data em mês aberto.',
      to_char(least(new.cash_date, new.competence_date), 'MM/YYYY') using errcode = '42501';
  end if;
  return new;
end $$;
create trigger journal_entries_period before insert on public.journal_entries
  for each row execute function app.check_period_open();

create trigger audit_journal_entries after insert or update on public.journal_entries
  for each row execute function app.audit();
create trigger audit_accounting_periods after insert or update on public.accounting_periods
  for each row execute function app.audit();

alter table public.accounting_periods enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
create policy accounting_periods_select on public.accounting_periods for select to authenticated
  using (app.is_member(organization_id));
create policy journal_entries_select on public.journal_entries for select to authenticated
  using (app.is_member(organization_id));
create policy journal_lines_select on public.journal_lines for select to authenticated
  using (app.is_member(organization_id));
-- Sem políticas de escrita: lançamentos só entram pelas funções abaixo.

-- ---------------------------------------------------------------- funções internas
create function app.ledger_of_account(p_org uuid, p_account uuid, p_require_active boolean default true) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v_active boolean;
begin
  select l.id, f.is_active into v_id, v_active
  from public.financial_accounts f join public.ledger_accounts l on l.financial_account_id = f.id
  where f.id = p_account and f.organization_id = p_org;
  if v_id is null then raise exception 'Conta financeira não encontrada.'; end if;
  if p_require_active and not v_active then raise exception 'A conta está desativada.'; end if;
  return v_id;
end $$;

create function app.ledger_of_category(p_org uuid, p_category uuid, p_kind public.category_kind) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v_kind public.category_kind; v_active boolean;
begin
  select l.id, c.kind, c.is_active into v_id, v_kind, v_active
  from public.categories c join public.ledger_accounts l on l.category_id = c.id
  where c.id = p_category and c.organization_id = p_org;
  if v_id is null then raise exception 'Categoria não encontrada.'; end if;
  if v_kind <> p_kind then raise exception 'A categoria escolhida não é de %.', p_kind; end if;
  if not v_active then raise exception 'A categoria está desativada.'; end if;
  return v_id;
end $$;

create function app.ledger_system(p_org uuid, p_code text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.ledger_accounts where organization_id = p_org and system_code = p_code
$$;

create function app.category_system(p_org uuid, p_code text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.categories where organization_id = p_org and system_code = p_code
$$;

-- Insere o cabeçalho e as partidas. p_lines: [{ledger_account_id, amount_cents, fund_id, ministry_id, project_id, cost_center_id, unit_id, memo}]
create function app.insert_entry(p_org uuid, p_header jsonb, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_line jsonb;
  v_no smallint := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'Lançamento precisa de ao menos duas partidas.';
  end if;
  insert into public.journal_entries (
    organization_id, kind, description, competence_date, cash_date, due_date, available_date, origin, origin_ref,
    contact_id, donor_id, payment_method_id, document_ref, cash_session_id, transfer_group_id, counterpart_account_id,
    reverses_entry_id, reversal_reason, notes, created_by
  ) values (
    p_org, (p_header ->> 'kind')::public.entry_kind, trim(p_header ->> 'description'),
    (p_header ->> 'competence_date')::date, (p_header ->> 'cash_date')::date,
    (p_header ->> 'due_date')::date, (p_header ->> 'available_date')::date,
    coalesce((p_header ->> 'origin')::public.entry_origin, 'manual'), p_header ->> 'origin_ref',
    (p_header ->> 'contact_id')::uuid, (p_header ->> 'donor_id')::uuid, (p_header ->> 'payment_method_id')::uuid,
    nullif(trim(p_header ->> 'document_ref'), ''), (p_header ->> 'cash_session_id')::uuid,
    (p_header ->> 'transfer_group_id')::uuid, (p_header ->> 'counterpart_account_id')::uuid,
    (p_header ->> 'reverses_entry_id')::uuid,
    p_header ->> 'reversal_reason', nullif(trim(p_header ->> 'notes'), ''), auth.uid()
  ) returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_no := v_no + 1;
    insert into public.journal_lines (
      organization_id, entry_id, line_no, ledger_account_id, amount_cents,
      unit_id, ministry_id, cost_center_id, project_id, fund_id, memo
    ) values (
      p_org, v_id, v_no, (v_line ->> 'ledger_account_id')::uuid, (v_line ->> 'amount_cents')::bigint,
      (v_line ->> 'unit_id')::uuid, (v_line ->> 'ministry_id')::uuid, (v_line ->> 'cost_center_id')::uuid,
      (v_line ->> 'project_id')::uuid, (v_line ->> 'fund_id')::uuid, nullif(trim(v_line ->> 'memo'), '')
    );
  end loop;
  return v_id;
end $$;

create function app.check_positive(p_cents bigint, p_label text default 'valor') returns void
language plpgsql immutable as $$
begin
  if p_cents is null or p_cents <= 0 then
    raise exception 'O % precisa ser maior que zero.', p_label using errcode = '22023';
  end if;
end $$;

-- Valida que o caixa físico está aberto e é da conta usada.
create function app.check_cash_session(p_org uuid, p_session uuid, p_account uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_session is null then return; end if;
  if not exists (
    select 1 from public.cash_sessions
    where id = p_session and organization_id = p_org and account_id = p_account and status = 'aberto'
  ) then
    raise exception 'O caixa informado não está aberto para esta conta.';
  end if;
end $$;

-- ---------------------------------------------------------------- caixa físico (tabela usada pelas funções)
create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  account_id uuid not null,
  status text not null default 'aberto' check (status in ('aberto', 'fechado', 'conferido')),
  opened_at timestamptz not null default now(),
  opened_by uuid not null references auth.users (id),
  opening_expected_cents bigint not null,
  opening_counted_cents bigint not null check (opening_counted_cents >= 0),
  opening_reason text,
  closed_at timestamptz,
  closed_by uuid references auth.users (id),
  closing_expected_cents bigint,
  closing_counted_cents bigint check (closing_counted_cents >= 0),
  closing_count_details jsonb,           -- contagem por cédula/moeda, opcional
  difference_cents bigint,
  difference_reason text,
  adjustment_entry_id uuid,
  verified_at timestamptz,
  verified_by uuid references auth.users (id),
  verification_notes text,
  unique (organization_id, id),
  foreign key (organization_id, account_id) references public.financial_accounts (organization_id, id),
  foreign key (organization_id, adjustment_entry_id) references public.journal_entries (organization_id, id),
  check (verified_by is null or verified_by <> closed_by)
);
create unique index cash_sessions_one_open on public.cash_sessions (account_id) where status = 'aberto';

alter table public.journal_entries
  add constraint journal_entries_cash_session_fk foreign key (organization_id, cash_session_id)
  references public.cash_sessions (organization_id, id);

alter table public.cash_sessions enable row level security;
create policy cash_sessions_select on public.cash_sessions for select to authenticated
  using (app.is_member(organization_id));
create trigger audit_cash_sessions after insert or update on public.cash_sessions
  for each row execute function app.audit();

-- ---------------------------------------------------------------- saldo inicial
-- Lança (ou substitui, por estorno) o saldo inicial de uma conta contra "Saldos iniciais".
create function public.set_opening_balance(p_account uuid, p_amount_cents bigint, p_date date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_ledger uuid;
  v_prev uuid;
  v_id uuid;
begin
  select organization_id into v_org from public.financial_accounts where id = p_account;
  if v_org is null then raise exception 'Conta financeira não encontrada.'; end if;
  perform app.require(v_org, app.roles_manage());
  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'Saldo inicial não pode ser negativo. Para conta devedora, registre um ajuste.';
  end if;
  v_ledger := app.ledger_of_account(v_org, p_account, false);

  -- Saldo inicial anterior ainda válido é estornado (histórico preservado).
  select e.id into v_prev from public.journal_entries e
  join public.journal_lines l on l.entry_id = e.id and l.ledger_account_id = v_ledger
  where e.organization_id = v_org and e.kind = 'saldo_inicial' and e.status = 'confirmado'
  limit 1;
  if v_prev is not null then
    perform public.reverse_entry(v_prev, 'Saldo inicial substituído',
      (select cash_date from public.journal_entries where id = v_prev));
  end if;

  perform set_config('app.opening_date_change', 'on', true);
  update public.financial_accounts set opening_date = p_date where id = p_account and opening_date <> p_date;
  perform set_config('app.opening_date_change', '', true);
  if p_amount_cents = 0 then return null; end if;

  v_id := app.insert_entry(v_org,
    jsonb_build_object('kind', 'saldo_inicial', 'description', 'Saldo inicial',
      'competence_date', p_date, 'cash_date', p_date, 'origin', 'sistema'),
    jsonb_build_array(
      jsonb_build_object('ledger_account_id', v_ledger, 'amount_cents', p_amount_cents),
      jsonb_build_object('ledger_account_id', app.ledger_system(v_org, 'saldos_iniciais'), 'amount_cents', -p_amount_cents)
    ));
  return v_id;
end $$;

-- A data de abertura só muda por set_opening_balance.
create or replace function app.check_financial_account_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind <> old.kind then
    raise exception 'O tipo da conta não pode ser alterado depois de criada.';
  end if;
  if new.opening_date <> old.opening_date and coalesce(current_setting('app.opening_date_change', true), '') <> 'on' then
    raise exception 'Use "Ajustar saldo inicial" para mudar a data de abertura.';
  end if;
  return new;
end $$;

-- Cria a conta e já lança o saldo inicial, numa única transação.
create function public.create_financial_account(
  p_org uuid, p_name text, p_kind public.account_kind, p_provider public.account_provider,
  p_opening_date date, p_opening_cents bigint default 0,
  p_institution text default null, p_account_hint text default null, p_color text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.require(p_org, app.roles_manage());
  insert into public.financial_accounts (organization_id, name, kind, provider, opening_date, institution, account_hint, color, created_by)
  values (p_org, trim(p_name), p_kind, coalesce(p_provider, 'manual'), p_opening_date,
          nullif(trim(p_institution), ''), nullif(trim(p_account_hint), ''), p_color, auth.uid())
  returning id into v_id;
  if coalesce(p_opening_cents, 0) > 0 then
    perform public.set_opening_balance(v_id, p_opening_cents, p_opening_date);
  end if;
  return v_id;
end $$;

-- Saldo inicial de um fundo: reclassifica parte do patrimônio inicial como recurso vinculado.
create function public.set_fund_opening_balance(p_fund uuid, p_amount_cents bigint, p_date date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_equity uuid;
begin
  select organization_id into v_org from public.funds where id = p_fund;
  if v_org is null then raise exception 'Fundo não encontrado.'; end if;
  perform app.require(v_org, app.roles_manage());
  perform app.check_positive(p_amount_cents);
  v_equity := app.ledger_system(v_org, 'saldos_iniciais');
  return app.insert_entry(v_org,
    jsonb_build_object('kind', 'reclassificacao', 'description', 'Saldo inicial do fundo',
      'competence_date', p_date, 'cash_date', p_date, 'origin', 'sistema'),
    jsonb_build_array(
      jsonb_build_object('ledger_account_id', v_equity, 'amount_cents', p_amount_cents),
      jsonb_build_object('ledger_account_id', v_equity, 'amount_cents', -p_amount_cents, 'fund_id', p_fund)
    ));
end $$;

-- ---------------------------------------------------------------- receitas
-- Recebimento: débito na conta pelo líquido, débito em tarifa (se houver) e crédito na receita pelo bruto.
create function public.post_income(
  p_org uuid,
  p_account_id uuid,
  p_category_id uuid,
  p_gross_cents bigint,
  p_cash_date date,
  p_description text,
  p_competence_date date default null,
  p_fee_cents bigint default 0,
  p_fund_id uuid default null,
  p_ministry_id uuid default null,
  p_project_id uuid default null,
  p_cost_center_id uuid default null,
  p_donor_id uuid default null,
  p_payment_method_id uuid default null,
  p_document_ref text default null,
  p_cash_session_id uuid default null,
  p_available_date date default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_dims jsonb;
  v_lines jsonb;
  v_fee bigint := coalesce(p_fee_cents, 0);
begin
  perform app.require(p_org, app.roles_operate());
  perform app.check_positive(p_gross_cents);
  if v_fee < 0 or v_fee >= p_gross_cents then
    raise exception 'A tarifa precisa ser menor que o valor bruto.';
  end if;
  if p_donor_id is not null and not app.has_role(p_org, app.roles_manage()) then
    raise exception 'Somente administrador ou tesoureiro vinculam doadores identificados.' using errcode = '42501';
  end if;
  perform app.check_cash_session(p_org, p_cash_session_id, p_account_id);

  v_dims := jsonb_strip_nulls(jsonb_build_object('fund_id', p_fund_id, 'ministry_id', p_ministry_id,
    'project_id', p_project_id, 'cost_center_id', p_cost_center_id));
  v_lines := jsonb_build_array(
    jsonb_build_object('ledger_account_id', app.ledger_of_account(p_org, p_account_id), 'amount_cents', p_gross_cents - v_fee),
    jsonb_build_object('ledger_account_id', app.ledger_of_category(p_org, p_category_id, 'receita'), 'amount_cents', -p_gross_cents) || v_dims
  );
  if v_fee > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'ledger_account_id', app.ledger_of_category(p_org, app.category_system(p_org, 'tarifas'), 'despesa'),
      'amount_cents', v_fee, 'memo', 'Tarifa do recebimento') || (v_dims - 'fund_id'));
  end if;

  return app.insert_entry(p_org, jsonb_build_object(
    'kind', 'receita', 'description', p_description,
    'competence_date', coalesce(p_competence_date, p_cash_date), 'cash_date', p_cash_date,
    'available_date', p_available_date,
    'origin', case when p_cash_session_id is null then 'manual' else 'caixa' end,
    'donor_id', p_donor_id, 'payment_method_id', p_payment_method_id, 'document_ref', p_document_ref,
    'cash_session_id', p_cash_session_id, 'notes', p_notes), v_lines);
end $$;

-- ---------------------------------------------------------------- despesas (com rateio)
-- p_splits: [{category_id, amount_cents, fund_id?, ministry_id?, project_id?, cost_center_id?, memo?}]
create function public.post_expense(
  p_org uuid,
  p_account_id uuid,
  p_splits jsonb,
  p_cash_date date,
  p_description text,
  p_competence_date date default null,
  p_due_date date default null,
  p_contact_id uuid default null,
  p_payment_method_id uuid default null,
  p_document_ref text default null,
  p_cash_session_id uuid default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_total bigint := 0;
  v_lines jsonb := '[]'::jsonb;
  s jsonb;
  v_amount bigint;
begin
  perform app.require(p_org, app.roles_operate());
  if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then
    raise exception 'Informe ao menos uma categoria.';
  end if;
  perform app.check_cash_session(p_org, p_cash_session_id, p_account_id);

  for s in select * from jsonb_array_elements(p_splits) loop
    v_amount := (s ->> 'amount_cents')::bigint;
    perform app.check_positive(v_amount, 'valor de cada rateio');
    v_total := v_total + v_amount;
    v_lines := v_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'ledger_account_id', app.ledger_of_category(p_org, (s ->> 'category_id')::uuid, 'despesa'),
      'amount_cents', v_amount,
      'fund_id', s ->> 'fund_id', 'ministry_id', s ->> 'ministry_id',
      'project_id', s ->> 'project_id', 'cost_center_id', s ->> 'cost_center_id', 'memo', s ->> 'memo')));
  end loop;

  v_lines := jsonb_build_array(jsonb_build_object(
    'ledger_account_id', app.ledger_of_account(p_org, p_account_id), 'amount_cents', -v_total)) || v_lines;

  return app.insert_entry(p_org, jsonb_build_object(
    'kind', 'despesa', 'description', p_description,
    'competence_date', coalesce(p_competence_date, p_cash_date), 'cash_date', p_cash_date, 'due_date', p_due_date,
    'origin', case when p_cash_session_id is null then 'manual' else 'caixa' end,
    'contact_id', p_contact_id, 'payment_method_id', p_payment_method_id, 'document_ref', p_document_ref,
    'cash_session_id', p_cash_session_id, 'notes', p_notes), v_lines);
end $$;

-- ---------------------------------------------------------------- transferências
-- Entre contas da igreja: só movimenta ativo, nunca receita ou despesa.
-- Sem data de chegada (ou mesma data): um lançamento. Com data posterior: fica em trânsito até confirmar.
create function public.post_transfer(
  p_org uuid,
  p_from_account uuid,
  p_to_account uuid,
  p_amount_cents bigint,
  p_sent_date date,
  p_description text default null,
  p_in_transit boolean default false,
  p_fee_cents bigint default 0,
  p_cash_session_id uuid default null,
  p_document_ref text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_from uuid;
  v_to uuid;
  v_fee bigint := coalesce(p_fee_cents, 0);
  v_lines jsonb;
  v_group uuid := gen_random_uuid();
  v_desc text;
begin
  perform app.require(p_org, app.roles_operate());
  perform app.check_positive(p_amount_cents);
  if v_fee < 0 then raise exception 'Tarifa inválida.'; end if;
  if p_from_account = p_to_account then raise exception 'Escolha contas diferentes.'; end if;
  perform app.check_cash_session(p_org, p_cash_session_id, p_from_account);
  v_from := app.ledger_of_account(p_org, p_from_account);
  v_to := app.ledger_of_account(p_org, p_to_account);
  v_desc := coalesce(nullif(trim(p_description), ''), 'Transferência entre contas');

  v_lines := jsonb_build_array(
    jsonb_build_object('ledger_account_id', v_from, 'amount_cents', -(p_amount_cents + v_fee)),
    jsonb_build_object('ledger_account_id',
      case when p_in_transit then app.ledger_system(p_org, 'transferencias_transito') else v_to end,
      'amount_cents', p_amount_cents)
  );
  if v_fee > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'ledger_account_id', app.ledger_of_category(p_org, app.category_system(p_org, 'tarifas'), 'despesa'),
      'amount_cents', v_fee, 'memo', 'Tarifa da transferência'));
  end if;

  return app.insert_entry(p_org, jsonb_build_object(
    'kind', 'transferencia', 'description', v_desc,
    'competence_date', p_sent_date, 'cash_date', p_sent_date,
    'origin', case when p_cash_session_id is null then 'manual' else 'caixa' end,
    'cash_session_id', p_cash_session_id, 'document_ref', p_document_ref,
    'transfer_group_id', case when p_in_transit then v_group end,
    'counterpart_account_id', case when p_in_transit then p_to_account end), v_lines);
end $$;

-- Confirma a chegada de uma transferência em trânsito.
create function public.confirm_transfer_arrival(p_entry_id uuid, p_received_date date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  e public.journal_entries;
  v_transit uuid;
  v_amount bigint;
  v_to uuid;
begin
  select * into e from public.journal_entries where id = p_entry_id;
  if e.id is null or e.transfer_group_id is null then raise exception 'Transferência em trânsito não encontrada.'; end if;
  perform app.require(e.organization_id, app.roles_operate());
  if e.status <> 'confirmado' then raise exception 'Esta transferência foi estornada.'; end if;
  if e.counterpart_account_id is null then raise exception 'Este lançamento não é o envio de uma transferência em trânsito.'; end if;
  if exists (select 1 from public.journal_entries where transfer_group_id = e.transfer_group_id and id <> e.id and kind = 'transferencia' and status = 'confirmado') then
    raise exception 'A chegada desta transferência já foi confirmada.';
  end if;
  if p_received_date < e.cash_date then raise exception 'A chegada não pode ser antes do envio.'; end if;
  v_transit := app.ledger_system(e.organization_id, 'transferencias_transito');
  select amount_cents into v_amount from public.journal_lines where entry_id = e.id and ledger_account_id = v_transit;
  v_to := app.ledger_of_account(e.organization_id, e.counterpart_account_id);

  return app.insert_entry(e.organization_id, jsonb_build_object(
    'kind', 'transferencia', 'description', e.description || ' (chegada)',
    'competence_date', p_received_date, 'cash_date', p_received_date, 'origin', 'manual',
    'transfer_group_id', e.transfer_group_id),
    jsonb_build_array(
      jsonb_build_object('ledger_account_id', v_to, 'amount_cents', v_amount),
      jsonb_build_object('ledger_account_id', v_transit, 'amount_cents', -v_amount)));
end $$;

-- ---------------------------------------------------------------- estorno
create function public.reverse_entry(p_entry_id uuid, p_reason text, p_date date default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  e public.journal_entries;
  v_date date;
  v_lines jsonb;
  v_id uuid;
begin
  select * into e from public.journal_entries where id = p_entry_id for update;
  if e.id is null then raise exception 'Lançamento não encontrado.'; end if;
  perform app.require(e.organization_id, app.roles_manage());
  if e.status = 'estornado' then raise exception 'Este lançamento já foi estornado.'; end if;
  if e.kind = 'estorno' then raise exception 'Um estorno não pode ser estornado. Faça um novo lançamento.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Explique o motivo do estorno (mínimo 5 caracteres).'; end if;
  -- Transferência em trânsito já recebida: estorne primeiro a chegada.
  if e.transfer_group_id is not null and exists (
    select 1 from public.journal_entries x
    where x.transfer_group_id = e.transfer_group_id and x.id <> e.id and x.kind = 'transferencia'
      and x.status = 'confirmado' and x.created_at > e.created_at
  ) then
    raise exception 'Estorne primeiro a confirmação de chegada desta transferência.';
  end if;

  v_date := coalesce(p_date, app.org_today(e.organization_id));
  if v_date < e.cash_date then raise exception 'O estorno não pode ter data anterior ao lançamento.'; end if;

  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'ledger_account_id', l.ledger_account_id, 'amount_cents', -l.amount_cents,
    'unit_id', l.unit_id, 'ministry_id', l.ministry_id, 'cost_center_id', l.cost_center_id,
    'project_id', l.project_id, 'fund_id', l.fund_id, 'memo', l.memo)) order by l.line_no)
  into v_lines from public.journal_lines l where l.entry_id = e.id;

  perform set_config('app.audit_reason', trim(p_reason), true);
  update public.journal_entries set status = 'estornado' where id = e.id;
  v_id := app.insert_entry(e.organization_id, jsonb_build_object(
    'kind', 'estorno', 'description', 'Estorno: ' || left(e.description, 200),
    'competence_date', v_date, 'cash_date', v_date, 'origin', 'manual',
    'reverses_entry_id', e.id, 'reversal_reason', trim(p_reason),
    'cash_session_id', case when exists (select 1 from public.cash_sessions s where s.id = e.cash_session_id and s.status = 'aberto') then e.cash_session_id end,
    'transfer_group_id', e.transfer_group_id), v_lines);
  return v_id;
end $$;

-- ---------------------------------------------------------------- períodos
create function public.close_period(p_org uuid, p_month date) returns void
language plpgsql security definer set search_path = '' as $$
declare v_month date := date_trunc('month', p_month)::date;
begin
  perform app.require(p_org, app.roles_manage());
  if v_month >= date_trunc('month', app.org_today(p_org))::date then
    raise exception 'Só é possível fechar meses que já terminaram.';
  end if;
  if exists (select 1 from public.cash_sessions s where s.organization_id = p_org and s.status = 'aberto'
             and s.opened_at < (v_month + interval '1 month')) then
    raise exception 'Feche os caixas abertos antes de fechar o mês.';
  end if;
  insert into public.accounting_periods (organization_id, month, status, closed_at, closed_by)
  values (p_org, v_month, 'fechado', now(), auth.uid())
  on conflict (organization_id, month) do update set status = 'fechado', closed_at = now(), closed_by = auth.uid();
end $$;

create function public.reopen_period(p_org uuid, p_month date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require(p_org, app.roles_manage());
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Explique o motivo da reabertura (mínimo 10 caracteres).';
  end if;
  perform set_config('app.audit_reason', trim(p_reason), true);
  update public.accounting_periods
  set status = 'aberto', reopened_at = now(), reopened_by = auth.uid(), reopen_reason = trim(p_reason)
  where organization_id = p_org and month = date_trunc('month', p_month)::date and status = 'fechado';
  if not found then raise exception 'Este mês não está fechado.'; end if;
end $$;

-- ---------------------------------------------------------------- comprovantes
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  entry_id uuid not null,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text,
  uploaded_by uuid not null default auth.uid() references auth.users (id),
  uploaded_at timestamptz not null default now(),
  foreign key (organization_id, entry_id) references public.journal_entries (organization_id, id),
  check (storage_path like organization_id::text || '/%')
);
create index attachments_entry_idx on public.attachments (entry_id);
alter table public.attachments enable row level security;
create policy attachments_select on public.attachments for select to authenticated
  using (app.is_member(organization_id));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (app.can(organization_id, app.roles_operate()) and uploaded_by = auth.uid());
create trigger attachments_immutable before update or delete on public.attachments
  for each row execute function app.forbid_change();
create trigger audit_attachments after insert on public.attachments
  for each row execute function app.audit();

-- ---------------------------------------------------------------- permissões de execução
grant execute on all functions in schema app to authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'set_opening_balance(uuid, bigint, date)',
    'create_financial_account(uuid, text, public.account_kind, public.account_provider, date, bigint, text, text, text)',
    'set_fund_opening_balance(uuid, bigint, date)',
    'post_income(uuid, uuid, uuid, bigint, date, text, date, bigint, uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, date, text)',
    'post_expense(uuid, uuid, jsonb, date, text, date, date, uuid, uuid, text, uuid, text)',
    'post_transfer(uuid, uuid, uuid, bigint, date, text, boolean, bigint, uuid, text)',
    'confirm_transfer_arrival(uuid, date)',
    'reverse_entry(uuid, text, date)',
    'close_period(uuid, date)',
    'reopen_period(uuid, date, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ====================================================================
-- migrations/20261024000400_caixa_relatorios.sql
-- ====================================================================
-- Financeiro da Igreja · Fase 1 · 004 caixa físico, saldos, relatórios e armazenamento
-- Fórmulas dos indicadores estão documentadas em docs/INDICADORES.md.

-- ---------------------------------------------------------------- saldo calculado
create function app.ledger_balance(p_ledger uuid, p_as_of date default null) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.amount_cents), 0)::bigint
  from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
  where l.ledger_account_id = p_ledger and (p_as_of is null or e.cash_date <= p_as_of)
$$;

-- ---------------------------------------------------------------- caixa físico
create function app.post_cash_difference(p_session public.cash_sessions, p_diff bigint, p_reason text, p_label text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := p_session.organization_id;
  v_asset uuid := app.ledger_of_account(v_org, p_session.account_id);
  v_today date := app.org_today(v_org);
  v_result uuid;
begin
  if p_diff = 0 then return null; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Houve diferença de % na contagem. Explique o motivo (mínimo 5 caracteres).',
      replace(to_char(abs(p_diff) / 100.0, 'FM999999990.00'), '.', ',');
  end if;
  v_result := case when p_diff > 0
    then app.ledger_of_category(v_org, app.category_system(v_org, 'sobra_caixa'), 'receita')
    else app.ledger_of_category(v_org, app.category_system(v_org, 'falta_caixa'), 'despesa') end;
  return app.insert_entry(v_org, jsonb_build_object(
      'kind', 'ajuste', 'description', p_label || ': ' || left(trim(p_reason), 180),
      'competence_date', v_today, 'cash_date', v_today, 'origin', 'caixa', 'cash_session_id', p_session.id),
    jsonb_build_array(
      jsonb_build_object('ledger_account_id', v_asset, 'amount_cents', p_diff),
      jsonb_build_object('ledger_account_id', v_result, 'amount_cents', -p_diff)));
end $$;

create function public.open_cash_session(p_account uuid, p_counted_cents bigint, p_reason text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_kind public.account_kind;
  v_expected bigint;
  s public.cash_sessions;
begin
  select organization_id, kind into v_org, v_kind from public.financial_accounts where id = p_account and is_active;
  if v_org is null then raise exception 'Conta não encontrada ou desativada.'; end if;
  perform app.require(v_org, app.roles_operate());
  if v_kind <> 'caixa_fisico' then raise exception 'Somente contas do tipo caixa físico têm abertura e fechamento.'; end if;
  if p_counted_cents is null or p_counted_cents < 0 then raise exception 'Informe o valor contado.'; end if;
  if exists (select 1 from public.cash_sessions where account_id = p_account and status = 'aberto') then
    raise exception 'Este caixa já está aberto.';
  end if;
  v_expected := app.ledger_balance(app.ledger_of_account(v_org, p_account));

  insert into public.cash_sessions (organization_id, account_id, opened_by, opening_expected_cents, opening_counted_cents, opening_reason)
  values (v_org, p_account, auth.uid(), v_expected, p_counted_cents, nullif(trim(p_reason), ''))
  returning * into s;
  perform app.post_cash_difference(s, p_counted_cents - v_expected, p_reason, 'Diferença na abertura do caixa');
  return s.id;
end $$;

create function public.close_cash_session(p_session uuid, p_counted_cents bigint, p_count_details jsonb default null, p_reason text default null)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  s public.cash_sessions;
  v_expected bigint;
  v_diff bigint;
  v_adj uuid;
begin
  select * into s from public.cash_sessions where id = p_session for update;
  if s.id is null then raise exception 'Caixa não encontrado.'; end if;
  perform app.require(s.organization_id, app.roles_operate());
  if s.status <> 'aberto' then raise exception 'Este caixa já foi fechado.'; end if;
  if p_counted_cents is null or p_counted_cents < 0 then raise exception 'Informe o valor contado.'; end if;

  v_expected := app.ledger_balance(app.ledger_of_account(s.organization_id, s.account_id, false));
  v_diff := p_counted_cents - v_expected;
  v_adj := app.post_cash_difference(s, v_diff, p_reason, 'Diferença no fechamento do caixa');

  update public.cash_sessions set
    status = 'fechado', closed_at = now(), closed_by = auth.uid(),
    closing_expected_cents = v_expected, closing_counted_cents = p_counted_cents,
    closing_count_details = p_count_details, difference_cents = v_diff,
    difference_reason = nullif(trim(p_reason), ''), adjustment_entry_id = v_adj
  where id = s.id;
  return v_diff;
end $$;

-- Conferência por outra pessoa (segregação de funções).
create function public.verify_cash_session(p_session uuid, p_notes text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.cash_sessions;
begin
  select * into s from public.cash_sessions where id = p_session for update;
  if s.id is null then raise exception 'Caixa não encontrado.'; end if;
  perform app.require(s.organization_id, array['admin', 'tesoureiro', 'aprovador']::public.member_role[]);
  if s.status <> 'fechado' then raise exception 'Só é possível conferir um caixa fechado e ainda não conferido.'; end if;
  if s.closed_by = auth.uid() or s.opened_by = auth.uid() then
    raise exception 'A conferência precisa ser feita por outra pessoa, não por quem abriu ou fechou o caixa.' using errcode = '42501';
  end if;
  update public.cash_sessions set status = 'conferido', verified_at = now(), verified_by = auth.uid(),
    verification_notes = nullif(trim(p_notes), '')
  where id = s.id;
end $$;

-- ---------------------------------------------------------------- relatórios
-- Todas as funções de relatório são SECURITY INVOKER: o RLS das tabelas vale para quem consulta.

create function public.account_balances(p_org uuid, p_as_of date default null)
returns table (
  account_id uuid, name text, kind public.account_kind, provider public.account_provider,
  is_active boolean, color text, balance_cents bigint, last_movement date, balance_source text
)
language sql stable set search_path = '' as $$
  select f.id, f.name, f.kind, f.provider, f.is_active, f.color,
    coalesce(sum(l.amount_cents) filter (where p_as_of is null or e.cash_date <= p_as_of), 0)::bigint,
    max(e.cash_date) filter (where p_as_of is null or e.cash_date <= p_as_of),
    'calculado'::text
  from public.financial_accounts f
  join public.ledger_accounts la on la.financial_account_id = f.id
  left join public.journal_lines l on l.ledger_account_id = la.id
  left join public.journal_entries e on e.id = l.entry_id
  where f.organization_id = p_org
  group by f.id
  order by f.is_active desc, f.kind, f.name
$$;

-- Saldo de cada fundo = créditos − débitos das partidas de resultado e patrimônio marcadas com o fundo.
create function public.fund_balances(p_org uuid, p_as_of date default null)
returns table (fund_id uuid, name text, is_restricted boolean, balance_cents bigint)
language sql stable set search_path = '' as $$
  select f.id, f.name, f.is_restricted,
    coalesce(-sum(l.amount_cents) filter (where p_as_of is null or e.cash_date <= p_as_of), 0)::bigint
  from public.funds f
  left join public.journal_lines l on l.fund_id = f.id
  left join public.journal_entries e on e.id = l.entry_id
  where f.organization_id = p_org
  group by f.id
  order by f.is_restricted desc, f.name
$$;

-- Total, vinculado, livre e em trânsito numa data.
create function public.balance_summary(p_org uuid, p_as_of date default null)
returns table (total_cents bigint, restricted_cents bigint, free_cents bigint, in_transit_cents bigint, as_of date)
language sql stable set search_path = '' as $$
  with accounts as (
    select coalesce(sum(balance_cents), 0)::bigint as total from public.account_balances(p_org, p_as_of)
  ), restricted as (
    select coalesce(sum(greatest(balance_cents, 0)), 0)::bigint as total
    from public.fund_balances(p_org, p_as_of) where is_restricted
  ), transit as (
    select coalesce(sum(l.amount_cents), 0)::bigint as total
    from public.journal_lines l
    join public.ledger_accounts la on la.id = l.ledger_account_id and la.system_code = 'transferencias_transito'
    join public.journal_entries e on e.id = l.entry_id
    where l.organization_id = p_org and (p_as_of is null or e.cash_date <= p_as_of)
  )
  select a.total + t.total, r.total, a.total + t.total - r.total, t.total,
         coalesce(p_as_of, (select app.org_today(p_org)))
  from accounts a, restricted r, transit t
$$;

-- Partidas de receita e despesa no período, com os filtros do dashboard.
-- valor positivo = receita recebida / despesa paga; estornos entram com sinal invertido.
create function app.result_lines(
  p_org uuid, p_start date, p_end date, p_basis text default 'caixa',
  p_account uuid default null, p_fund uuid default null, p_ministry uuid default null,
  p_project uuid default null, p_category uuid default null, p_unit uuid default null
) returns table (
  entry_id uuid, ref_date date, kind public.ledger_kind, category_id uuid, value_cents bigint,
  fund_id uuid, ministry_id uuid, project_id uuid
)
language sql stable set search_path = '' as $$
  with recursive cats as (
    select c.id from public.categories c where c.id = p_category
    union all
    select c.id from public.categories c join cats on c.parent_id = cats.id
  )
  select e.id,
    case when p_basis = 'competencia' then e.competence_date else e.cash_date end,
    la.kind, la.category_id,
    (case when la.kind = 'receita' then -l.amount_cents else l.amount_cents end)::bigint,
    l.fund_id, l.ministry_id, l.project_id
  from public.journal_lines l
  join public.journal_entries e on e.id = l.entry_id
  join public.ledger_accounts la on la.id = l.ledger_account_id
  where l.organization_id = p_org
    and la.kind in ('receita', 'despesa')
    and (case when p_basis = 'competencia' then e.competence_date else e.cash_date end) between p_start and p_end
    and (p_fund is null or l.fund_id = p_fund)
    and (p_ministry is null or l.ministry_id = p_ministry)
    and (p_project is null or l.project_id = p_project)
    and (p_unit is null or l.unit_id = p_unit)
    and (p_category is null or la.category_id in (select id from cats))
    and (p_account is null or exists (
      select 1 from public.journal_lines a join public.ledger_accounts fa on fa.id = a.ledger_account_id
      where a.entry_id = e.id and fa.financial_account_id = p_account))
$$;

create function public.report_totals(
  p_org uuid, p_start date, p_end date, p_basis text default 'caixa',
  p_account uuid default null, p_fund uuid default null, p_ministry uuid default null,
  p_project uuid default null, p_category uuid default null, p_unit uuid default null
) returns table (income_cents bigint, expense_cents bigint, result_cents bigint, entries_count bigint)
language sql stable set search_path = '' as $$
  select
    coalesce(sum(value_cents) filter (where kind = 'receita'), 0)::bigint,
    coalesce(sum(value_cents) filter (where kind = 'despesa'), 0)::bigint,
    (coalesce(sum(value_cents) filter (where kind = 'receita'), 0) - coalesce(sum(value_cents) filter (where kind = 'despesa'), 0))::bigint,
    count(distinct entry_id)
  from app.result_lines(p_org, p_start, p_end, p_basis, p_account, p_fund, p_ministry, p_project, p_category, p_unit)
$$;

create function public.report_monthly(
  p_org uuid, p_start date, p_end date, p_basis text default 'caixa',
  p_account uuid default null, p_fund uuid default null, p_ministry uuid default null,
  p_project uuid default null, p_category uuid default null, p_unit uuid default null
) returns table (month date, income_cents bigint, expense_cents bigint, result_cents bigint)
language sql stable set search_path = '' as $$
  with months as (
    select generate_series(date_trunc('month', p_start), date_trunc('month', p_end), interval '1 month')::date as month
  ), totals as (
    select date_trunc('month', ref_date)::date as month,
      sum(value_cents) filter (where kind = 'receita') as income,
      sum(value_cents) filter (where kind = 'despesa') as expense
    from app.result_lines(p_org, p_start, p_end, p_basis, p_account, p_fund, p_ministry, p_project, p_category, p_unit)
    group by 1
  )
  select m.month, coalesce(t.income, 0)::bigint, coalesce(t.expense, 0)::bigint,
    (coalesce(t.income, 0) - coalesce(t.expense, 0))::bigint
  from months m left join totals t using (month)
  order by m.month
$$;

-- Totais por categoria, agrupando subcategorias na categoria principal quando p_rollup.
create function public.report_by_category(
  p_org uuid, p_start date, p_end date, p_kind public.category_kind, p_basis text default 'caixa',
  p_account uuid default null, p_fund uuid default null, p_ministry uuid default null,
  p_project uuid default null, p_unit uuid default null, p_rollup boolean default true
) returns table (category_id uuid, category_name text, parent_name text, total_cents bigint)
language sql stable set search_path = '' as $$
  select
    case when p_rollup then coalesce(c.parent_id, c.id) else c.id end,
    case when p_rollup then coalesce(p.name, c.name) else c.name end,
    case when p_rollup then null else p.name end,
    sum(r.value_cents)::bigint
  from app.result_lines(p_org, p_start, p_end, p_basis, p_account, p_fund, p_ministry, p_project, null, p_unit) r
  join public.categories c on c.id = r.category_id
  left join public.categories p on p.id = c.parent_id
  where r.kind = p_kind::text::public.ledger_kind
  group by 1, 2, 3
  having sum(r.value_cents) <> 0
  order by 4 desc
$$;

-- Extrato de uma conta com saldo acumulado.
create function public.account_statement(p_account uuid, p_start date, p_end date)
returns table (
  entry_id uuid, number bigint, cash_date date, kind public.entry_kind, status public.entry_status,
  description text, amount_cents bigint, balance_cents bigint
)
language sql stable set search_path = '' as $$
  with la as (
    select id from public.ledger_accounts where financial_account_id = p_account
  ), moves as (
    select e.id, e.number, e.cash_date, e.kind, e.status, e.description, e.created_at, l.amount_cents
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
    where l.ledger_account_id = (select id from la)
  ), opening as (
    select coalesce(sum(amount_cents), 0) as v from moves where cash_date < p_start
  )
  select m.id, m.number, m.cash_date, m.kind, m.status, m.description, m.amount_cents,
    ((select v from opening) + sum(m.amount_cents) over (order by m.cash_date, m.number rows between unbounded preceding and current row))::bigint
  from moves m
  where m.cash_date between p_start and p_end
  order by m.cash_date, m.number
$$;

grant execute on all functions in schema app to authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'open_cash_session(uuid, bigint, text)',
    'close_cash_session(uuid, bigint, jsonb, text)',
    'verify_cash_session(uuid, text)',
    'account_balances(uuid, date)',
    'fund_balances(uuid, date)',
    'balance_summary(uuid, date)',
    'report_totals(uuid, date, date, text, uuid, uuid, uuid, uuid, uuid, uuid)',
    'report_monthly(uuid, date, date, text, uuid, uuid, uuid, uuid, uuid, uuid)',
    'report_by_category(uuid, date, date, public.category_kind, text, uuid, uuid, uuid, uuid, uuid, boolean)',
    'account_statement(uuid, date, date)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- armazenamento privado
create function app.try_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;
grant execute on function app.try_uuid(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprovantes', 'comprovantes', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('identidade', 'identidade', false, 2097152, array['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
on conflict (id) do update set public = false;

-- Caminho: {organization_id}/{entry_id}/{arquivo}. Leitura só por membros; envio por quem lança. Ninguém altera ou apaga.
create policy comprovantes_select on storage.objects for select to authenticated
  using (bucket_id = 'comprovantes' and app.is_member(app.try_uuid((storage.foldername(name))[1])));
create policy comprovantes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'comprovantes' and app.can(app.try_uuid((storage.foldername(name))[1]), app.roles_operate()));

create policy identidade_select on storage.objects for select to authenticated
  using (bucket_id = 'identidade' and app.is_member(app.try_uuid((storage.foldername(name))[1])));
create policy identidade_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'identidade' and app.can(app.try_uuid((storage.foldername(name))[1]), array['admin']::public.member_role[]));

-- ====================================================================
-- migrations/20261024000500_indice_lancamentos.sql
-- ====================================================================
-- Financeiro da Igreja · Fase 1 · 005 índice de lançamentos para busca e filtros
-- View com RLS do chamador (security_invoker): cada pessoa só vê a própria organização.

create view public.entry_index with (security_invoker = true) as
select
  e.id, e.organization_id, e.number, e.kind, e.status, e.description,
  e.cash_date, e.competence_date, e.due_date, e.origin, e.document_ref,
  e.cash_session_id, e.transfer_group_id, e.counterpart_account_id, e.reverses_entry_id, e.created_at, e.created_by,
  (sum(abs(l.amount_cents)) / 2)::bigint as amount_cents,
  coalesce(sum(l.amount_cents) filter (where la.kind = 'ativo'), 0)::bigint as cash_effect_cents,
  coalesce(array_agg(distinct la.financial_account_id) filter (where la.financial_account_id is not null), '{}') as account_ids,
  coalesce(array_agg(distinct la.category_id) filter (where la.category_id is not null), '{}') as category_ids,
  coalesce(array_agg(distinct l.fund_id) filter (where l.fund_id is not null), '{}') as fund_ids,
  coalesce(array_agg(distinct l.ministry_id) filter (where l.ministry_id is not null), '{}') as ministry_ids,
  coalesce(array_agg(distinct l.project_id) filter (where l.project_id is not null), '{}') as project_ids,
  string_agg(distinct la.name, ', ') filter (where la.kind = 'ativo') as account_names,
  string_agg(distinct la.name, ', ') filter (where la.kind in ('receita', 'despesa')) as category_names,
  bool_or(la.kind = 'transitoria') as touches_transit
from public.journal_entries e
join public.journal_lines l on l.entry_id = e.id
join public.ledger_accounts la on la.id = l.ledger_account_id
group by e.id;

comment on view public.entry_index is 'Um registro por lançamento, com valor (metade da soma absoluta das partidas = valor bruto), efeito no caixa e dimensões para filtro.';

revoke all on public.entry_index from anon;
grant select on public.entry_index to authenticated;

-- ====================================================================
-- migrations/20261024000600_permissoes_explicitas.sql
-- ====================================================================
-- Permissões explícitas para os papéis da API.
-- Não dependemos dos privilégios padrão do Supabase (que mudam entre projetos novos e antigos):
-- quem entra sem login (anon) não tem acesso a nada; quem está logado (authenticated) passa
-- sempre pelas políticas de RLS e pelas checagens de perfil dentro das funções.

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Colunas que ninguém altera direto pela API (só pelas funções).
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

commit;
