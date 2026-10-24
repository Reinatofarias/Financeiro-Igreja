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
