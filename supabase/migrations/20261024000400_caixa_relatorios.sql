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
