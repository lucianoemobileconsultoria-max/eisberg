-- =====================================================================
-- EISBERG - Registro de Despesas / Gastos
--
-- COMO USAR (uma única vez):
--   Supabase > SQL Editor > New query > cole TODO este arquivo > Run.
--   Link do projeto:
--   https://supabase.com/dashboard/project/wibqizlxrwiovgkynprj/sql/66105b49-93b9-49c8-b59e-af92eb40377a
--
-- É seguro rodar mais de uma vez. NÃO altera nenhuma tabela existente
-- (pedidos, produtos, categorias, configurações).
-- =====================================================================

create table if not exists public.despesas (
  id               bigint generated always as identity primary key,
  data             date          not null default current_date,
  descricao        text          not null check (char_length(btrim(descricao)) between 1 and 200),
  valor            numeric(12,2) not null check (valor >= 0),
  forma_pagamento  text          not null default 'dinheiro'
                                 check (forma_pagamento in ('dinheiro', 'pix', 'cartao')),
  data_pagamento   date,                       -- só para cartão
  parcelas         integer       not null default 1 check (parcelas between 1 and 48),
  criado_em        timestamptz   not null default now()
);
create index if not exists despesas_data_idx on public.despesas (data desc, id desc);

alter table public.despesas enable row level security;

drop policy if exists despesas_select on public.despesas;
drop policy if exists despesas_insert on public.despesas;
drop policy if exists despesas_update on public.despesas;
create policy despesas_select on public.despesas for select using (public.is_admin());
create policy despesas_insert on public.despesas for insert with check (public.is_admin());
create policy despesas_update on public.despesas for update using (public.is_admin()) with check (public.is_admin());
-- Não existe policy de DELETE: a exclusão só ocorre pela função abaixo (exige a senha de exclusão).

create or replace function public.excluir_despesa(p_id bigint, p_senha text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public._checar_exclusao(p_senha);
  delete from public.despesas where id = p_id;
  if not found then raise exception 'Despesa não encontrada'; end if;
end;
$$;

revoke all on public.despesas from anon, authenticated;
grant select, insert, update on public.despesas to authenticated;
revoke execute on function public.excluir_despesa(bigint, text) from public;
grant  execute on function public.excluir_despesa(bigint, text) to authenticated;
