-- Financeiro da Igreja · Fase 3 · 009 integração com o Mercado Pago
-- O sistema pede ao Mercado Pago o relatório da conta (o mesmo do arquivo de liberações) e importa
-- os movimentos na conciliação, como se alguém tivesse enviado o arquivo. Nada é lançado sozinho:
-- os movimentos chegam como pendentes e alguém do financeiro decide o que fazer com cada um.
-- O token de acesso NUNCA fica no banco: fica nas variáveis de ambiente da Vercel
-- (MERCADOPAGO_ACCESS_TOKEN_1, _2...). Aqui só se guarda qual número cada conta usa.

alter table public.statement_imports drop constraint statement_imports_source_check;
alter table public.statement_imports add constraint statement_imports_source_check
  check (source in ('mercado_pago_extrato', 'mercado_pago_liberacoes', 'ofx', 'mercado_pago_api'));

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  financial_account_id uuid not null unique,
  provider public.account_provider not null check (provider = 'mercado_pago'),
  credential_slot smallint not null check (credential_slot between 1 and 4),
  enabled boolean not null default true,
  synced_until timestamptz,                  -- fim do último período pedido ao provedor
  last_run_at timestamptz,
  last_status text check (last_status in ('ok', 'aguardando', 'erro')),
  last_message text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (organization_id, id),
  unique (organization_id, credential_slot),
  foreign key (organization_id, financial_account_id) references public.financial_accounts (organization_id, id)
);

create table public.integration_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  integration_id uuid not null,
  started_at timestamptz not null default now(),
  trigger text not null check (trigger in ('agendado', 'manual')),
  status text not null check (status in ('ok', 'aguardando', 'erro')),
  message text,
  lines_new integer not null default 0,
  requested_by uuid references auth.users (id),
  foreign key (organization_id, integration_id) references public.integrations (organization_id, id) on delete cascade
);
create index integration_runs_recent_idx on public.integration_runs (integration_id, started_at desc);

alter table public.integrations enable row level security;
alter table public.integration_runs enable row level security;
create policy integrations_select on public.integrations for select to authenticated
  using (app.is_member(organization_id));
create policy integration_runs_select on public.integration_runs for select to authenticated
  using (app.is_member(organization_id));
-- Sem políticas de escrita: a configuração passa por set_integration e a sincronização
-- roda no servidor com a chave service_role.

create trigger audit_integrations after insert or update or delete on public.integrations
  for each row execute function app.audit();

-- ---------------------------------------------------------------- importação (núcleo comum)
-- Mesma regra da importação por arquivo; a checagem de quem pode importar fica em quem chama.
create function app.import_statement_core(
  p_org uuid, p_account uuid, p_source text, p_file_name text, p_file_sha256 text, p_lines jsonb,
  p_opening_balance_cents bigint, p_closing_balance_cents bigint
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

create or replace function public.import_statement(
  p_org uuid, p_account uuid, p_source text, p_file_name text, p_file_sha256 text, p_lines jsonb,
  p_opening_balance_cents bigint default null, p_closing_balance_cents bigint default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require(p_org, app.roles_operate());
  if p_source = 'mercado_pago_api' then raise exception 'Origem reservada para a integração.'; end if;
  return app.import_statement_core(p_org, p_account, p_source, p_file_name, p_file_sha256, p_lines,
    p_opening_balance_cents, p_closing_balance_cents);
end $$;

-- ---------------------------------------------------------------- configuração
create function public.set_integration(p_org uuid, p_account uuid, p_slot smallint, p_enabled boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_provider public.account_provider; v_id uuid;
begin
  perform app.require(p_org, app.roles_manage());
  select provider into v_provider from public.financial_accounts where id = p_account and organization_id = p_org;
  if v_provider is null then raise exception 'Conta financeira não encontrada.'; end if;
  if v_provider <> 'mercado_pago' then raise exception 'Por enquanto só contas do Mercado Pago têm integração.'; end if;
  if p_slot is null or p_slot not between 1 and 4 then raise exception 'Escolha o número do token (1 a 4).'; end if;
  if exists (select 1 from public.integrations where organization_id = p_org and credential_slot = p_slot and financial_account_id <> p_account) then
    raise exception 'O token % já está ligado a outra conta.', p_slot;
  end if;
  insert into public.integrations (organization_id, financial_account_id, provider, credential_slot, enabled, created_by)
  values (p_org, p_account, 'mercado_pago', p_slot, coalesce(p_enabled, true), auth.uid())
  on conflict (financial_account_id) do update set credential_slot = excluded.credential_slot, enabled = excluded.enabled
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- funções só do servidor (service_role)
create function public.integration_import(
  p_integration uuid, p_file_name text, p_file_sha256 text, p_lines jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.integrations;
begin
  select * into i from public.integrations where id = p_integration;
  if i.id is null or not i.enabled then raise exception 'Integração desativada ou inexistente.'; end if;
  -- O mesmo relatório baixado duas vezes não cria outra importação.
  if exists (select 1 from public.statement_imports
             where financial_account_id = i.financial_account_id and source = 'mercado_pago_api' and file_name = left(trim(p_file_name), 200)) then
    return jsonb_build_object('import_id', null, 'total', 0, 'new', 0, 'duplicate', 0, 'skipped', true);
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    return jsonb_build_object('import_id', null, 'total', 0, 'new', 0, 'duplicate', 0);
  end if;
  return app.import_statement_core(i.organization_id, i.financial_account_id, 'mercado_pago_api', p_file_name, p_file_sha256, p_lines, null, null);
end $$;

create function public.integration_record_run(
  p_integration uuid, p_trigger text, p_status text, p_message text, p_lines_new integer,
  p_synced_until timestamptz default null, p_requested_by uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.integrations;
begin
  select * into i from public.integrations where id = p_integration for update;
  if i.id is null then raise exception 'Integração inexistente.'; end if;
  insert into public.integration_runs (organization_id, integration_id, trigger, status, message, lines_new, requested_by)
  values (i.organization_id, i.id, p_trigger, p_status, left(p_message, 500), coalesce(p_lines_new, 0), p_requested_by);
  update public.integrations
     set last_run_at = now(), last_status = p_status, last_message = left(p_message, 500),
         synced_until = greatest(synced_until, p_synced_until)
   where id = i.id;
  -- Mantém só as últimas 60 execuções por integração.
  delete from public.integration_runs where integration_id = i.id and id not in (
    select id from public.integration_runs where integration_id = i.id order by started_at desc limit 60);
end $$;

-- ---------------------------------------------------------------- permissões
grant select on public.integrations, public.integration_runs to authenticated;
revoke all on public.integrations, public.integration_runs from anon;
revoke execute on function app.import_statement_core(uuid, uuid, text, text, text, jsonb, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.set_integration(uuid, uuid, smallint, boolean) from public, anon;
grant execute on function public.set_integration(uuid, uuid, smallint, boolean) to authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'integration_import(uuid, text, text, jsonb)',
    'integration_record_run(uuid, text, text, text, integer, timestamptz, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
grant usage on schema public to service_role;
grant select on public.integrations, public.financial_accounts, public.organizations to service_role;
-- A sincronização confere quais relatórios já entraram, para não baixar de novo.
grant select (id, financial_account_id, source, file_name) on public.statement_imports to service_role;
