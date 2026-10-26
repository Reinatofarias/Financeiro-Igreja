-- Financeiro da Igreja · Fase 4 · contas a pagar e a receber, aprovação de despesas,
-- orçamento por categoria e conferência do fechamento mensal.
-- Uma conta a pagar/receber é só uma previsão: o lançamento no razão nasce quando ela é paga/recebida.

-- ---------------------------------------------------------------- aprovação
-- null = despesas não precisam de aprovação; 0 = todas precisam; > 0 = a partir deste valor.
alter table public.organizations
  add column approval_threshold_cents bigint check (approval_threshold_cents is null or approval_threshold_cents >= 0);
comment on column public.organizations.approval_threshold_cents is
  'Contas a pagar a partir deste valor precisam de aprovação antes do pagamento (null = sem aprovação).';

create function app.roles_approve() returns public.member_role[] language sql immutable as $$
  select array['admin', 'tesoureiro', 'aprovador']::public.member_role[] $$;

-- ---------------------------------------------------------------- contas a pagar e a receber
create table public.bills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  kind text not null check (kind in ('pagar', 'receber')),
  description text not null check (length(trim(description)) between 2 and 240),
  amount_cents bigint not null check (amount_cents > 0),
  due_date date not null,
  competence_date date not null,
  category_id uuid not null,
  financial_account_id uuid,              -- conta prevista para pagar/receber
  contact_id uuid,
  fund_id uuid,
  ministry_id uuid,
  project_id uuid,
  cost_center_id uuid,
  document_ref text,
  notes text,
  series_id uuid,                         -- contas repetidas (mensais) da mesma série
  series_no smallint,
  series_total smallint,
  status text not null default 'aberta' check (status in ('aberta', 'paga', 'cancelada')),
  approval_status text not null default 'dispensada' check (approval_status in ('dispensada', 'pendente', 'aprovada', 'recusada')),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  decision_notes text,
  paid_entry_id uuid,
  paid_date date,
  canceled_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) default auth.uid(),
  unique (organization_id, id),
  foreign key (organization_id, category_id) references public.categories (organization_id, id),
  foreign key (organization_id, financial_account_id) references public.financial_accounts (organization_id, id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id),
  foreign key (organization_id, fund_id) references public.funds (organization_id, id),
  foreign key (organization_id, ministry_id) references public.ministries (organization_id, id),
  foreign key (organization_id, project_id) references public.projects (organization_id, id),
  foreign key (organization_id, cost_center_id) references public.cost_centers (organization_id, id),
  foreign key (organization_id, paid_entry_id) references public.journal_entries (organization_id, id),
  check ((status = 'paga') = (paid_entry_id is not null)),
  check (status <> 'cancelada' or length(trim(coalesce(canceled_reason, ''))) >= 5),
  check (kind = 'pagar' or approval_status = 'dispensada')
);
create index bills_open_idx on public.bills (organization_id, kind, due_date) where status = 'aberta';
create index bills_series_idx on public.bills (series_id) where series_id is not null;
create unique index bills_paid_entry_unique on public.bills (paid_entry_id) where paid_entry_id is not null;

alter table public.bills enable row level security;
create policy bills_select on public.bills for select to authenticated using (app.is_member(organization_id));
-- Sem políticas de escrita: contas só mudam pelas funções abaixo.
create trigger audit_bills after insert or update or delete on public.bills
  for each row execute function app.audit();

create function app.bill_needs_approval(p_org uuid, p_kind text, p_amount bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_kind = 'pagar' and coalesce(p_amount >= (select o.approval_threshold_cents from public.organizations o where o.id = p_org), false)
$$;

-- Cria a conta (ou a série mensal, com p_repeat > 1). Retorna quantas contas foram criadas.
create function public.create_bill(
  p_org uuid,
  p_kind text,
  p_description text,
  p_amount_cents bigint,
  p_due_date date,
  p_category_id uuid,
  p_competence_date date default null,
  p_account_id uuid default null,
  p_contact_id uuid default null,
  p_fund_id uuid default null,
  p_ministry_id uuid default null,
  p_project_id uuid default null,
  p_cost_center_id uuid default null,
  p_document_ref text default null,
  p_notes text default null,
  p_repeat integer default 1
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_series uuid;
  v_competence date := coalesce(p_competence_date, p_due_date);
  v_needs boolean;
  i integer;
begin
  perform app.require(p_org, app.roles_operate());
  if p_kind not in ('pagar', 'receber') then raise exception 'Tipo de conta inválido.'; end if;
  perform app.check_positive(p_amount_cents);
  if p_due_date is null then raise exception 'Informe o vencimento.'; end if;
  if coalesce(p_repeat, 1) not between 1 and 36 then raise exception 'Repita de 1 a 36 meses.'; end if;
  perform app.ledger_of_category(p_org, p_category_id, case when p_kind = 'pagar' then 'despesa' else 'receita' end::public.category_kind);
  if p_account_id is not null then perform app.ledger_of_account(p_org, p_account_id); end if;
  if p_kind = 'receber' and p_contact_id is not null then
    raise exception 'Fornecedor/favorecido só se aplica a contas a pagar.';
  end if;

  v_needs := app.bill_needs_approval(p_org, p_kind, p_amount_cents);
  if p_repeat > 1 then v_series := gen_random_uuid(); end if;

  for i in 0 .. coalesce(p_repeat, 1) - 1 loop
    insert into public.bills (
      organization_id, kind, description, amount_cents, due_date, competence_date, category_id,
      financial_account_id, contact_id, fund_id, ministry_id, project_id, cost_center_id,
      document_ref, notes, series_id, series_no, series_total, approval_status
    ) values (
      p_org, p_kind,
      trim(p_description) || case when p_repeat > 1 then format(' (%s/%s)', i + 1, p_repeat) else '' end,
      p_amount_cents,
      (p_due_date + make_interval(months => i))::date,
      (v_competence + make_interval(months => i))::date,
      p_category_id, p_account_id, p_contact_id, p_fund_id, p_ministry_id, p_project_id, p_cost_center_id,
      nullif(trim(p_document_ref), ''), nullif(trim(p_notes), ''),
      v_series, case when p_repeat > 1 then i + 1 end, case when p_repeat > 1 then p_repeat end,
      case when v_needs then 'pendente' else 'dispensada' end
    );
  end loop;
  return coalesce(p_repeat, 1);
end $$;

-- Ajusta descrição, valor e vencimento de uma conta em aberto. Mudar o valor pede nova aprovação.
create function public.update_bill(p_bill uuid, p_description text, p_amount_cents bigint, p_due_date date)
returns void
language plpgsql security definer set search_path = '' as $$
declare b public.bills;
begin
  select * into b from public.bills where id = p_bill for update;
  if b.id is null then raise exception 'Conta não encontrada.'; end if;
  perform app.require(b.organization_id, app.roles_operate());
  if b.status <> 'aberta' then raise exception 'Só contas em aberto podem ser alteradas.'; end if;
  perform app.check_positive(p_amount_cents);
  if p_due_date is null then raise exception 'Informe o vencimento.'; end if;
  update public.bills set
    description = trim(p_description),
    amount_cents = p_amount_cents,
    due_date = p_due_date,
    approval_status = case
      when b.kind <> 'pagar' then 'dispensada'
      when p_amount_cents = b.amount_cents and b.approval_status <> 'recusada' then b.approval_status
      when app.bill_needs_approval(b.organization_id, b.kind, p_amount_cents) then 'pendente'
      else 'dispensada' end,
    decided_by = case when p_amount_cents = b.amount_cents and b.approval_status <> 'recusada' then b.decided_by end,
    decided_at = case when p_amount_cents = b.amount_cents and b.approval_status <> 'recusada' then b.decided_at end,
    decision_notes = case when p_amount_cents = b.amount_cents and b.approval_status <> 'recusada' then b.decision_notes end
  where id = p_bill;
end $$;

-- Aprova ou recusa uma despesa. Quem cadastrou a conta não aprova a própria conta.
create function public.decide_bill(p_bill uuid, p_approve boolean, p_notes text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare b public.bills;
begin
  select * into b from public.bills where id = p_bill for update;
  if b.id is null then raise exception 'Conta não encontrada.'; end if;
  perform app.require(b.organization_id, app.roles_approve());
  if b.status <> 'aberta' or b.approval_status <> 'pendente' then
    raise exception 'Esta conta não está aguardando aprovação.';
  end if;
  if b.created_by = auth.uid() then
    raise exception 'Quem cadastrou a conta não pode aprová-la. Peça para outra pessoa.' using errcode = '42501';
  end if;
  if not p_approve and length(trim(coalesce(p_notes, ''))) < 5 then
    raise exception 'Explique o motivo da recusa (mínimo 5 caracteres).';
  end if;
  update public.bills set
    approval_status = case when p_approve then 'aprovada' else 'recusada' end,
    decided_by = auth.uid(), decided_at = now(), decision_notes = nullif(trim(p_notes), '')
  where id = p_bill;
end $$;

-- Paga/recebe: cria o lançamento (despesa ou receita) e marca a conta como paga.
create function public.pay_bill(
  p_bill uuid,
  p_account_id uuid,
  p_paid_date date,
  p_amount_cents bigint default null,
  p_fee_cents bigint default 0,
  p_payment_method_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b public.bills;
  v_amount bigint;
  v_entry uuid;
  v_session uuid;
begin
  select * into b from public.bills where id = p_bill for update;
  if b.id is null then raise exception 'Conta não encontrada.'; end if;
  perform app.require(b.organization_id, app.roles_operate());
  if b.status = 'paga' then raise exception 'Esta conta já foi paga.'; end if;
  if b.status = 'cancelada' then raise exception 'Esta conta foi cancelada.'; end if;
  if b.approval_status = 'pendente' then raise exception 'Esta despesa ainda aguarda aprovação.'; end if;
  if b.approval_status = 'recusada' then raise exception 'Esta despesa foi recusada. Ajuste ou cancele a conta.'; end if;
  if p_paid_date is null then raise exception 'Informe a data do pagamento.'; end if;
  v_amount := coalesce(p_amount_cents, b.amount_cents);
  perform app.check_positive(v_amount);
  if b.approval_status = 'aprovada' and v_amount > b.amount_cents then
    raise exception 'O valor pago passa do valor aprovado. Ajuste a conta para pedir nova aprovação.';
  end if;

  -- Pagamento em dinheiro entra no caixa aberto, como qualquer movimento do caixa físico.
  if exists (select 1 from public.financial_accounts f where f.id = p_account_id and f.organization_id = b.organization_id and f.kind = 'caixa_fisico') then
    select s.id into v_session from public.cash_sessions s where s.account_id = p_account_id and s.status = 'aberto';
    if v_session is null then raise exception 'Abra o caixa físico antes de pagar ou receber em dinheiro.'; end if;
  end if;

  if b.kind = 'pagar' then
    v_entry := public.post_expense(
      b.organization_id, p_account_id,
      jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'category_id', b.category_id, 'amount_cents', v_amount, 'fund_id', b.fund_id, 'ministry_id', b.ministry_id,
        'project_id', b.project_id, 'cost_center_id', b.cost_center_id))),
      p_paid_date, b.description, b.competence_date, b.due_date, b.contact_id, p_payment_method_id,
      b.document_ref, v_session, b.notes);
  else
    v_entry := public.post_income(
      b.organization_id, p_account_id, b.category_id, v_amount, p_paid_date, b.description, b.competence_date,
      coalesce(p_fee_cents, 0), b.fund_id, b.ministry_id, b.project_id, b.cost_center_id, null, p_payment_method_id,
      b.document_ref, v_session, null, b.notes);
  end if;

  update public.bills set status = 'paga', paid_entry_id = v_entry, paid_date = p_paid_date where id = p_bill;
  return v_entry;
end $$;

-- Cancela a conta (e, se pedido, as próximas da mesma série que ainda estão em aberto).
create function public.cancel_bill(p_bill uuid, p_reason text, p_rest_of_series boolean default false)
returns integer
language plpgsql security definer set search_path = '' as $$
declare b public.bills; v_count integer;
begin
  select * into b from public.bills where id = p_bill;
  if b.id is null then raise exception 'Conta não encontrada.'; end if;
  perform app.require(b.organization_id, app.roles_operate());
  if b.status <> 'aberta' then raise exception 'Só contas em aberto podem ser canceladas.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Explique o motivo do cancelamento (mínimo 5 caracteres).'; end if;
  perform set_config('app.audit_reason', trim(p_reason), true);
  update public.bills set status = 'cancelada', canceled_reason = trim(p_reason)
  where status = 'aberta' and (
    id = p_bill or (p_rest_of_series and b.series_id is not null and series_id = b.series_id and due_date >= b.due_date));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Estornar o lançamento do pagamento devolve a conta para "em aberto".
create function app.reopen_bill_on_reversal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'confirmado' and new.status = 'estornado' then
    update public.bills set status = 'aberta', paid_entry_id = null, paid_date = null where paid_entry_id = new.id;
  end if;
  return null;
end $$;
create trigger journal_entries_reopen_bill after update of status on public.journal_entries
  for each row execute function app.reopen_bill_on_reversal();

-- Números da visão geral: vencidas, próximos 7 dias e aguardando aprovação.
create function public.bills_summary(p_org uuid)
returns table (
  overdue_pay_cents bigint, overdue_pay_count bigint,
  week_pay_cents bigint, week_pay_count bigint,
  overdue_receive_cents bigint, week_receive_cents bigint,
  pending_approval_count bigint
)
language sql stable set search_path = '' as $$
  with t as (select app.org_today(p_org) as today)
  select
    coalesce(sum(amount_cents) filter (where kind = 'pagar' and due_date < t.today), 0)::bigint,
    count(*) filter (where kind = 'pagar' and due_date < t.today),
    coalesce(sum(amount_cents) filter (where kind = 'pagar' and due_date between t.today and t.today + 7), 0)::bigint,
    count(*) filter (where kind = 'pagar' and due_date between t.today and t.today + 7),
    coalesce(sum(amount_cents) filter (where kind = 'receber' and due_date < t.today), 0)::bigint,
    coalesce(sum(amount_cents) filter (where kind = 'receber' and due_date between t.today and t.today + 7), 0)::bigint,
    count(*) filter (where approval_status = 'pendente')
  from public.bills, t
  where organization_id = p_org and status = 'aberta'
$$;

-- ---------------------------------------------------------------- orçamento
-- Valor orçado por categoria principal e mês.
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  category_id uuid not null,
  month date not null check (extract(day from month) = 1),
  amount_cents bigint not null check (amount_cents > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) default auth.uid(),
  unique (organization_id, category_id, month),
  foreign key (organization_id, category_id) references public.categories (organization_id, id)
);
alter table public.budgets enable row level security;
create policy budgets_select on public.budgets for select to authenticated using (app.is_member(organization_id));
create trigger audit_budgets after insert or update or delete on public.budgets
  for each row execute function app.audit();

-- Define o mesmo valor mensal de p_from_month a dezembro do ano (0 apaga).
create function public.set_budget(p_org uuid, p_category uuid, p_year integer, p_monthly_cents bigint, p_from_month integer default 1)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_parent uuid; v_found boolean; m integer;
begin
  perform app.require(p_org, app.roles_manage());
  select true, c.parent_id into v_found, v_parent from public.categories c where c.id = p_category and c.organization_id = p_org;
  if not coalesce(v_found, false) then raise exception 'Categoria não encontrada.'; end if;
  if v_parent is not null then raise exception 'O orçamento é feito pela categoria principal (as subcategorias somam nela).'; end if;
  if p_year not between 2000 and 2100 or p_from_month not between 1 and 12 then raise exception 'Período inválido.'; end if;
  if p_monthly_cents is null or p_monthly_cents < 0 then raise exception 'O valor não pode ser negativo.'; end if;
  for m in p_from_month .. 12 loop
    if p_monthly_cents = 0 then
      delete from public.budgets where organization_id = p_org and category_id = p_category and month = make_date(p_year, m, 1);
    else
      insert into public.budgets (organization_id, category_id, month, amount_cents)
      values (p_org, p_category, make_date(p_year, m, 1), p_monthly_cents)
      on conflict (organization_id, category_id, month)
      do update set amount_cents = excluded.amount_cents, updated_at = now(), updated_by = auth.uid();
    end if;
  end loop;
end $$;

-- Orçado x realizado por categoria principal (regime de competência).
create function public.budget_vs_actual(p_org uuid, p_start date, p_end date)
returns table (category_id uuid, category_name text, kind public.category_kind, budget_cents bigint, actual_cents bigint)
language sql stable set search_path = '' as $$
  with actual as (
    select category_id, total_cents, 'receita'::public.category_kind as kind
    from public.report_by_category(p_org, p_start, p_end, 'receita', 'competencia')
    union all
    select category_id, total_cents, 'despesa'::public.category_kind
    from public.report_by_category(p_org, p_start, p_end, 'despesa', 'competencia')
  ), budget as (
    select b.category_id, sum(b.amount_cents)::bigint as total_cents
    from public.budgets b
    where b.organization_id = p_org and b.month between date_trunc('month', p_start)::date and p_end
    group by b.category_id
  )
  select c.id, c.name, c.kind, coalesce(b.total_cents, 0)::bigint, coalesce(a.total_cents, 0)::bigint
  from public.categories c
  left join budget b on b.category_id = c.id
  left join actual a on a.category_id = c.id
  where c.organization_id = p_org and c.parent_id is null and (b.total_cents is not null or a.total_cents is not null)
  order by c.kind desc, coalesce(b.total_cents, 0) desc, c.name
$$;

-- ---------------------------------------------------------------- fechamento
-- O que falta conferir antes de fechar o mês. Só contagens: nada de nomes de quem pagou.
create function public.period_checklist(p_org uuid, p_month date)
returns table (item text, pending bigint, blocking boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_start date := date_trunc('month', p_month)::date; v_end date;
begin
  if not app.is_member(p_org) then raise exception 'Seu perfil não tem permissão para esta ação.' using errcode = '42501'; end if;
  v_end := (v_start + interval '1 month - 1 day')::date;
  return query
    select 'caixas_abertos', count(*), true from public.cash_sessions s
      where s.organization_id = p_org and s.status = 'aberto' and s.opened_at < (v_end + 1)
    union all
    select 'extrato_pendente', count(*), false from public.statement_lines l
      where l.organization_id = p_org and l.status = 'pendente' and l.posted_date between v_start and v_end
    union all
    select 'contas_em_aberto', count(*), false from public.bills b
      where b.organization_id = p_org and b.status = 'aberta' and b.due_date between v_start and v_end
    union all
    select 'aguardando_aprovacao', count(*), false from public.bills b
      where b.organization_id = p_org and b.status = 'aberta' and b.approval_status = 'pendente' and b.due_date <= v_end
    union all
    select 'transferencias_em_transito', count(*), false from public.journal_entries e
      where e.organization_id = p_org and e.status = 'confirmado' and e.kind = 'transferencia'
        and e.counterpart_account_id is not null and e.cash_date <= v_end
        and not exists (select 1 from public.journal_entries r where r.transfer_group_id = e.transfer_group_id and r.id <> e.id
                        and r.kind = 'transferencia' and r.status = 'confirmado');
end $$;

-- ---------------------------------------------------------------- permissões
revoke all on public.bills, public.budgets from anon;
revoke insert, update, delete on public.bills, public.budgets from authenticated;
grant select on public.bills, public.budgets to authenticated;
grant execute on function app.roles_approve() to authenticated;
grant execute on function app.bill_needs_approval(uuid, text, bigint) to authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'create_bill(uuid, text, text, bigint, date, uuid, date, uuid, uuid, uuid, uuid, uuid, uuid, text, text, integer)',
    'update_bill(uuid, text, bigint, date)',
    'decide_bill(uuid, boolean, text)',
    'pay_bill(uuid, uuid, date, bigint, bigint, uuid)',
    'cancel_bill(uuid, text, boolean)',
    'bills_summary(uuid)',
    'set_budget(uuid, uuid, integer, bigint, integer)',
    'budget_vs_actual(uuid, date, date)',
    'period_checklist(uuid, date)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
