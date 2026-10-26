-- Financeiro da Igreja · Fase 2 · 007 importação de extratos e conciliação
-- Cada movimento do extrato vira uma linha (statement_lines). A linha fica pendente até ser
-- casada com um lançamento existente, virar um lançamento novo ou ser ignorada com motivo.
-- Reimportar o mesmo arquivo não duplica nada: o id do movimento no banco é único por conta.

create table public.statement_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  financial_account_id uuid not null,
  source text not null check (source in ('mercado_pago_extrato', 'mercado_pago_liberacoes', 'ofx')),
  file_name text not null check (length(file_name) between 1 and 200),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  period_start date,
  period_end date,
  lines_total integer not null default 0,
  lines_new integer not null default 0,
  opening_balance_cents bigint,               -- saldo inicial informado pelo banco no arquivo, quando houver
  closing_balance_cents bigint,               -- saldo final informado pelo banco
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (organization_id, id),
  foreign key (organization_id, financial_account_id) references public.financial_accounts (organization_id, id)
);
create index statement_imports_account_idx on public.statement_imports (financial_account_id, created_at desc);

create table public.statement_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  financial_account_id uuid not null,
  import_id uuid not null,
  external_id text not null check (length(external_id) between 1 and 120),
  occurred_at timestamptz,
  posted_date date not null,                  -- data do movimento no fuso da igreja
  available_date date,                        -- liberação do dinheiro, quando o provedor informa
  description text,
  kind text,                                  -- tipo informado pelo provedor (ex.: SETTLEMENT, REFUND, CREDIT)
  payment_method text,                        -- ex.: pix, qr
  gross_cents bigint,
  fee_cents bigint not null default 0 check (fee_cents >= 0),
  net_cents bigint not null check (net_cents <> 0),
  balance_after_cents bigint,                 -- saldo informado pelo banco depois do movimento
  status text not null default 'pendente' check (status in ('pendente', 'conciliado', 'ignorado')),
  entry_id uuid,
  created_entry boolean not null default false, -- o lançamento foi criado a partir desta linha
  ignore_reason text,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (financial_account_id, external_id),
  foreign key (organization_id, financial_account_id) references public.financial_accounts (organization_id, id),
  foreign key (organization_id, import_id) references public.statement_imports (organization_id, id),
  foreign key (organization_id, entry_id) references public.journal_entries (organization_id, id),
  check ((status = 'conciliado') = (entry_id is not null)),
  check (status <> 'ignorado' or length(trim(coalesce(ignore_reason, ''))) >= 3),
  check (gross_cents is null or net_cents < 0 or gross_cents - fee_cents = net_cents)
);
create index statement_lines_pending_idx on public.statement_lines (organization_id, financial_account_id, posted_date)
  where status = 'pendente';
-- Um lançamento concilia no máximo uma linha de extrato.
create unique index statement_lines_entry_unique on public.statement_lines (entry_id) where entry_id is not null;

alter table public.statement_imports enable row level security;
alter table public.statement_lines enable row level security;
create policy statement_imports_select on public.statement_imports for select to authenticated
  using (app.is_member(organization_id));
-- A descrição do extrato traz o nome de quem fez o Pix: só quem concilia ou audita vê as linhas.
create policy statement_lines_select on public.statement_lines for select to authenticated
  using (app.can(organization_id, array['admin', 'tesoureiro', 'operador', 'auditor']::public.member_role[]));
-- Sem políticas de escrita: tudo passa pelas funções abaixo.

create trigger audit_statement_imports after insert on public.statement_imports
  for each row execute function app.audit();
create trigger audit_statement_lines after update on public.statement_lines
  for each row execute function app.audit();

-- Estornar um lançamento devolve a linha do extrato para pendente.
create function app.release_statement_line() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'confirmado' and new.status = 'estornado' then
    update public.statement_lines
       set status = 'pendente', entry_id = null, created_entry = false, resolved_at = null, resolved_by = null
     where entry_id = new.id;
  end if;
  return new;
end $$;
create trigger journal_entries_release_statement after update on public.journal_entries
  for each row execute function app.release_statement_line();

-- Efeito de um lançamento no saldo de uma conta (débito na conta do razão = entrada).
create function app.entry_effect_on_account(p_entry uuid, p_account uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.amount_cents), 0)::bigint
  from public.journal_lines l
  join public.ledger_accounts a on a.id = l.ledger_account_id
  where l.entry_id = p_entry and a.financial_account_id = p_account
$$;

-- ---------------------------------------------------------------- importação
-- p_lines: [{external_id, occurred_at?, posted_date, available_date?, description?, kind?, payment_method?,
--            gross_cents?, fee_cents?, net_cents}]
create function public.import_statement(
  p_org uuid, p_account uuid, p_source text, p_file_name text, p_file_sha256 text, p_lines jsonb,
  p_opening_balance_cents bigint default null, p_closing_balance_cents bigint default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_import uuid;
  v_line jsonb;
  v_total integer := 0;
  v_new integer := 0;
  v_rows integer;
  v_net bigint;
  v_fee bigint;
  v_gross bigint;
begin
  perform app.require(p_org, app.roles_operate());
  perform app.ledger_of_account(p_org, p_account);
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'O arquivo não tem movimentos para importar.';
  end if;
  if jsonb_array_length(p_lines) > 5000 then
    raise exception 'Arquivo grande demais (máximo de 5.000 movimentos por vez). Exporte um período menor.';
  end if;

  insert into public.statement_imports (organization_id, financial_account_id, source, file_name, file_sha256,
    opening_balance_cents, closing_balance_cents, created_by)
  values (p_org, p_account, p_source, left(trim(p_file_name), 200), lower(p_file_sha256),
    p_opening_balance_cents, p_closing_balance_cents, auth.uid())
  returning id into v_import;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_total := v_total + 1;
    v_net := (v_line ->> 'net_cents')::bigint;
    v_fee := coalesce((v_line ->> 'fee_cents')::bigint, 0);
    v_gross := (v_line ->> 'gross_cents')::bigint;
    if v_net is null or v_net = 0 then continue; end if;   -- movimentos de valor zero não afetam saldo
    if v_net > 0 and v_gross is not null and v_gross - v_fee <> v_net then
      raise exception 'Movimento % com valores inconsistentes (bruto − tarifa ≠ líquido).', v_line ->> 'external_id';
    end if;
    insert into public.statement_lines (
      organization_id, financial_account_id, import_id, external_id, occurred_at, posted_date, available_date,
      description, kind, payment_method, gross_cents, fee_cents, net_cents, balance_after_cents
    ) values (
      p_org, p_account, v_import, v_line ->> 'external_id', (v_line ->> 'occurred_at')::timestamptz,
      (v_line ->> 'posted_date')::date, (v_line ->> 'available_date')::date,
      left(nullif(trim(v_line ->> 'description'), ''), 240), left(v_line ->> 'kind', 40), left(v_line ->> 'payment_method', 40),
      case when v_net > 0 then v_gross end, case when v_net > 0 then v_fee else 0 end, v_net,
      (v_line ->> 'balance_after_cents')::bigint
    ) on conflict (financial_account_id, external_id) do nothing;
    get diagnostics v_rows = row_count;
    v_new := v_new + v_rows;
  end loop;

  update public.statement_imports
     set lines_total = v_total, lines_new = v_new,
         period_start = (select min((x ->> 'posted_date')::date) from jsonb_array_elements(p_lines) x),
         period_end = (select max((x ->> 'posted_date')::date) from jsonb_array_elements(p_lines) x)
   where id = v_import;

  return jsonb_build_object('import_id', v_import, 'total', v_total, 'new', v_new, 'duplicate', v_total - v_new);
end $$;

-- ---------------------------------------------------------------- conciliação
create function app.lock_pending_line(p_line uuid) returns public.statement_lines
language plpgsql security definer set search_path = '' as $$
declare s public.statement_lines;
begin
  select * into s from public.statement_lines where id = p_line for update;
  if s.id is null then raise exception 'Movimento do extrato não encontrado.'; end if;
  perform app.require(s.organization_id, app.roles_operate());
  if s.status <> 'pendente' then raise exception 'Este movimento já foi resolvido.'; end if;
  return s;
end $$;

-- Casa a linha com um lançamento que já existe (ex.: lançado à mão antes da importação).
create function public.reconcile_statement_line(p_line uuid, p_entry uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.statement_lines;
  e public.journal_entries;
begin
  s := app.lock_pending_line(p_line);
  select * into e from public.journal_entries where id = p_entry and organization_id = s.organization_id;
  if e.id is null then raise exception 'Lançamento não encontrado.'; end if;
  if e.status <> 'confirmado' then raise exception 'Só é possível conciliar lançamentos confirmados.'; end if;
  if e.kind = 'estorno' then raise exception 'Estornos não são conciliados com o extrato.'; end if;
  if app.entry_effect_on_account(e.id, s.financial_account_id) <> s.net_cents then
    raise exception 'O valor do lançamento nesta conta não bate com o do extrato.';
  end if;
  if exists (select 1 from public.statement_lines where entry_id = e.id) then
    raise exception 'Este lançamento já está conciliado com outro movimento.';
  end if;
  update public.statement_lines
     set status = 'conciliado', entry_id = e.id, created_entry = false, resolved_at = now(), resolved_by = auth.uid()
   where id = s.id;
end $$;

-- Cria lançamentos a partir das linhas pendentes, todas com a mesma classificação.
-- Entradas viram receita (bruto, com a tarifa separada); saídas viram despesa.
create function public.post_statement_lines(
  p_org uuid, p_line_ids uuid[], p_category_id uuid, p_description text,
  p_fund_id uuid default null, p_ministry_id uuid default null, p_project_id uuid default null,
  p_payment_method_id uuid default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  s public.statement_lines;
  v_kind public.category_kind;
  v_opening date;
  v_dims jsonb;
  v_lines jsonb;
  v_entry uuid;
  v_gross bigint;
  v_count integer := 0;
begin
  perform app.require(p_org, app.roles_operate());
  if p_line_ids is null or cardinality(p_line_ids) = 0 then raise exception 'Selecione ao menos um movimento.'; end if;
  if length(trim(coalesce(p_description, ''))) < 2 then raise exception 'Informe a descrição.'; end if;
  select kind into v_kind from public.categories where id = p_category_id and organization_id = p_org;
  if v_kind is null then raise exception 'Categoria não encontrada.'; end if;
  v_dims := jsonb_strip_nulls(jsonb_build_object('fund_id', p_fund_id, 'ministry_id', p_ministry_id, 'project_id', p_project_id));

  foreach v_id in array p_line_ids loop
    s := app.lock_pending_line(v_id);
    if s.organization_id <> p_org then raise exception 'Movimento de outra organização.'; end if;
    if (s.net_cents > 0) <> (v_kind = 'receita') then
      raise exception 'O movimento de % é % e a categoria é de %. Selecione só entradas ou só saídas.',
        to_char(s.posted_date, 'DD/MM/YYYY'), case when s.net_cents > 0 then 'uma entrada' else 'uma saída' end, v_kind;
    end if;
    select opening_date into v_opening from public.financial_accounts where id = s.financial_account_id;
    if s.posted_date < v_opening then
      raise exception 'O movimento de % é anterior ao saldo inicial da conta (%). Ignore-o: ele já está no saldo inicial.',
        to_char(s.posted_date, 'DD/MM/YYYY'), to_char(v_opening, 'DD/MM/YYYY');
    end if;

    if s.net_cents > 0 then
      v_gross := coalesce(s.gross_cents, s.net_cents);
      v_lines := jsonb_build_array(
        jsonb_build_object('ledger_account_id', app.ledger_of_account(p_org, s.financial_account_id), 'amount_cents', s.net_cents),
        jsonb_build_object('ledger_account_id', app.ledger_of_category(p_org, p_category_id, 'receita'), 'amount_cents', -v_gross) || v_dims);
      if s.fee_cents > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'ledger_account_id', app.ledger_of_category(p_org, app.category_system(p_org, 'tarifas'), 'despesa'),
          'amount_cents', s.fee_cents, 'memo', 'Tarifa do recebimento') || (v_dims - 'fund_id'));
      end if;
    else
      v_lines := jsonb_build_array(
        jsonb_build_object('ledger_account_id', app.ledger_of_account(p_org, s.financial_account_id), 'amount_cents', s.net_cents),
        jsonb_build_object('ledger_account_id', app.ledger_of_category(p_org, p_category_id, 'despesa'), 'amount_cents', -s.net_cents) || v_dims);
    end if;

    v_entry := app.insert_entry(p_org, jsonb_build_object(
      'kind', case when s.net_cents > 0 then 'receita' else 'despesa' end,
      'description', trim(p_description),
      'competence_date', s.posted_date, 'cash_date', s.posted_date,
      'available_date', case when s.available_date >= s.posted_date then s.available_date end,
      'origin', 'importacao', 'payment_method_id', p_payment_method_id,
      'document_ref', left(s.external_id, 80)), v_lines);

    update public.statement_lines
       set status = 'conciliado', entry_id = v_entry, created_entry = true, resolved_at = now(), resolved_by = auth.uid()
     where id = s.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create function public.ignore_statement_lines(p_line_ids uuid[], p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_count integer := 0;
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Informe o motivo (ao menos 3 letras).'; end if;
  foreach v_id in array coalesce(p_line_ids, '{}') loop
    perform app.lock_pending_line(v_id);
    update public.statement_lines
       set status = 'ignorado', ignore_reason = left(trim(p_reason), 240), resolved_at = now(), resolved_by = auth.uid()
     where id = v_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Desfaz um "ignorar" ou uma conciliação com lançamento já existente.
-- Linha que gerou o próprio lançamento volta a pendente só pelo estorno desse lançamento.
create function public.reopen_statement_line(p_line uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.statement_lines;
begin
  select * into s from public.statement_lines where id = p_line for update;
  if s.id is null then raise exception 'Movimento do extrato não encontrado.'; end if;
  perform app.require(s.organization_id, app.roles_manage());
  if s.status = 'pendente' then return; end if;
  if s.created_entry then
    raise exception 'Este movimento gerou o lançamento. Para desfazer, estorne o lançamento.';
  end if;
  update public.statement_lines
     set status = 'pendente', entry_id = null, ignore_reason = null, resolved_at = null, resolved_by = null
   where id = s.id;
end $$;

-- Lançamentos que podem corresponder à linha: mesma conta, mesmo valor, até 5 dias de distância, ainda sem conciliação.
create function public.statement_match_candidates(p_line uuid)
returns table (entry_id uuid, number bigint, cash_date date, description text, kind public.entry_kind, days_apart integer)
language sql stable security invoker set search_path = '' as $$
  select e.id, e.number, e.cash_date, e.description, e.kind, abs(e.cash_date - s.posted_date)
  from public.statement_lines s
  join public.journal_entries e on e.organization_id = s.organization_id
  where s.id = p_line
    and e.status = 'confirmado' and e.kind not in ('estorno', 'saldo_inicial')
    and e.cash_date between s.posted_date - 5 and s.posted_date + 5
    and not exists (select 1 from public.statement_lines o where o.entry_id = e.id)
    and app.entry_effect_on_account(e.id, s.financial_account_id) = s.net_cents
  order by abs(e.cash_date - s.posted_date), e.number
  limit 10
$$;

-- Sugestões para todas as linhas pendentes de uma conta (até 3 por linha), numa consulta só.
create function public.statement_match_candidates_for_account(p_account uuid)
returns table (line_id uuid, entry_id uuid, number bigint, cash_date date, description text, days_apart integer)
language sql stable security invoker set search_path = '' as $$
  select x.line_id, x.entry_id, x.number, x.cash_date, x.description, x.days_apart
  from (
    select s.id as line_id, e.id as entry_id, e.number, e.cash_date, e.description,
      abs(e.cash_date - s.posted_date) as days_apart,
      row_number() over (partition by s.id order by abs(e.cash_date - s.posted_date), e.number) as rn
    from public.statement_lines s
    join public.journal_lines jl on jl.organization_id = s.organization_id and jl.amount_cents = s.net_cents
    join public.ledger_accounts la on la.id = jl.ledger_account_id and la.financial_account_id = s.financial_account_id
    join public.journal_entries e on e.id = jl.entry_id
    where s.financial_account_id = p_account and s.status = 'pendente'
      and e.status = 'confirmado' and e.kind not in ('estorno', 'saldo_inicial')
      and e.cash_date between s.posted_date - 5 and s.posted_date + 5
      and not exists (select 1 from public.statement_lines o where o.entry_id = e.id)
      and app.entry_effect_on_account(e.id, s.financial_account_id) = s.net_cents
  ) x
  where x.rn <= 3
$$;

-- Resumo por conta para a tela de conciliação e o painel.
create function public.reconciliation_summary(p_org uuid)
returns table (financial_account_id uuid, pending integer, pending_in_cents bigint, pending_out_cents bigint,
               reconciled integer, ignored integer, last_line_date date, last_import_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select a.id,
    count(*) filter (where s.status = 'pendente')::integer,
    coalesce(sum(s.net_cents) filter (where s.status = 'pendente' and s.net_cents > 0), 0)::bigint,
    coalesce(-sum(s.net_cents) filter (where s.status = 'pendente' and s.net_cents < 0), 0)::bigint,
    count(*) filter (where s.status = 'conciliado')::integer,
    count(*) filter (where s.status = 'ignorado')::integer,
    max(s.posted_date),
    (select max(i.created_at) from public.statement_imports i where i.financial_account_id = a.id)
  from public.financial_accounts a
  left join public.statement_lines s on s.financial_account_id = a.id
  where a.organization_id = p_org
  group by a.id
$$;

-- ---------------------------------------------------------------- permissões
grant select on public.statement_imports, public.statement_lines to authenticated;
revoke all on public.statement_imports, public.statement_lines from anon;
grant execute on all functions in schema app to authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'import_statement(uuid, uuid, text, text, text, jsonb, bigint, bigint)',
    'reconcile_statement_line(uuid, uuid)',
    'post_statement_lines(uuid, uuid[], uuid, text, uuid, uuid, uuid, uuid)',
    'ignore_statement_lines(uuid[], text)',
    'reopen_statement_line(uuid)',
    'statement_match_candidates(uuid)',
    'statement_match_candidates_for_account(uuid)',
    'reconciliation_summary(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
