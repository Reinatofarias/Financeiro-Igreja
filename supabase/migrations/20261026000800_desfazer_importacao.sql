-- Financeiro da Igreja · Fase 2 · 008 desfazer importação de extrato
-- Para quando o arquivo foi importado na conta errada ou era o arquivo errado.
-- Só desfaz se nenhum movimento daquela importação foi lançado, casado ou ignorado:
-- o que já foi resolvido precisa voltar para pendente antes (ou ter o lançamento estornado).
-- Movimentos que já tinham vindo numa importação anterior não pertencem a esta e ficam.

create trigger audit_statement_imports_delete after delete on public.statement_imports
  for each row execute function app.audit();

create function public.undo_statement_import(p_import uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  i public.statement_imports;
  v_resolved integer;
  v_removed integer;
begin
  select * into i from public.statement_imports where id = p_import for update;
  if i.id is null then raise exception 'Importação não encontrada.'; end if;
  perform app.require(i.organization_id, app.roles_operate());

  perform 1 from public.statement_lines where import_id = i.id for update;
  select count(*) into v_resolved from public.statement_lines where import_id = i.id and status <> 'pendente';
  if v_resolved > 0 then
    raise exception '% movimento(s) desta importação já foram lançados, casados ou ignorados. Volte-os para pendente (ou estorne os lançamentos) antes de desfazer.', v_resolved;
  end if;

  delete from public.statement_lines where import_id = i.id;
  get diagnostics v_removed = row_count;
  perform set_config('app.audit_reason', format('Importação desfeita (%s): %s movimento(s) removido(s)', i.file_name, v_removed), true);
  delete from public.statement_imports where id = i.id;
  perform set_config('app.audit_reason', '', true);
  return v_removed;
end $$;

revoke execute on function public.undo_statement_import(uuid) from public, anon;
grant execute on function public.undo_statement_import(uuid) to authenticated;
