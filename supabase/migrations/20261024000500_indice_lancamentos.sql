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
