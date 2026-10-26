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
