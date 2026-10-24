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
