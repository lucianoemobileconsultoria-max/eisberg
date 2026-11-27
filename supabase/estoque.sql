-- =====================================================================
-- EISBERG - Controle de Estoque (Entradas com NF + Baixa Automática)
--
-- COMO USAR (uma única vez):
--   Supabase > SQL Editor > New query > cole TODO este arquivo > Run.
--   Link do projeto:
--   https://supabase.com/dashboard/project/wibqizlxrwiovgkynprj/sql/66105b49-93b9-49c8-b59e-af92eb40377a
--
-- É seguro rodar mais de uma vez. NÃO altera nem apaga nenhum dado
-- existente (produtos recebem estoque inicial 0; pedidos antigos já
-- concluídos não sofrem alterações retroativas).
-- =====================================================================

alter table public.produtos add column if not exists estoque numeric(10,2) not null default 0;

create table if not exists public.estoque_movimentos (
  id          bigint generated always as identity primary key,
  produto_id  bigint        not null references public.produtos(id) on delete cascade,
  tipo        text          not null check (tipo in ('entrada', 'saida_manual', 'saida_pedido')),
  quantidade  numeric(10,2) not null check (quantidade > 0 and quantidade <= 999999),
  data        date          not null default current_date,
  numero_nf   text          not null default '' check (char_length(btrim(numero_nf)) <= 60),
  pedido_id   bigint        references public.pedidos(id) on delete cascade,
  observacao  text          not null default '' check (char_length(btrim(observacao)) <= 300),
  criado_em   timestamptz   not null default now()
);
create index if not exists estoque_mov_produto_idx on public.estoque_movimentos (produto_id, data desc, id desc);
create index if not exists estoque_mov_pedido_idx  on public.estoque_movimentos (pedido_id) where pedido_id is not null;
create index if not exists estoque_mov_data_idx    on public.estoque_movimentos (data desc, id desc);

alter table public.estoque_movimentos enable row level security;
drop policy if exists estoque_mov_select on public.estoque_movimentos;
create policy estoque_mov_select on public.estoque_movimentos
  for select to authenticated using (public.is_admin());

revoke all on public.estoque_movimentos from anon, authenticated;
grant select on public.estoque_movimentos to authenticated;

create or replace function public._estoque_movimentos_atualizar_saldo()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_delta_old numeric(10,2);
  v_delta_new numeric(10,2);
begin
  if tg_op = 'INSERT' then
    v_delta_new := case when new.tipo = 'entrada' then new.quantidade else -new.quantidade end;
    update public.produtos set estoque = estoque + v_delta_new where id = new.produto_id;
    return new;
  elsif tg_op = 'DELETE' then
    v_delta_old := case when old.tipo = 'entrada' then old.quantidade else -old.quantidade end;
    update public.produtos set estoque = estoque - v_delta_old where id = old.produto_id;
    return old;
  elsif tg_op = 'UPDATE' then
    v_delta_old := case when old.tipo = 'entrada' then old.quantidade else -old.quantidade end;
    v_delta_new := case when new.tipo = 'entrada' then new.quantidade else -new.quantidade end;
    if old.produto_id = new.produto_id then
      update public.produtos set estoque = estoque + (v_delta_new - v_delta_old) where id = new.produto_id;
    else
      update public.produtos set estoque = estoque - v_delta_old where id = old.produto_id;
      update public.produtos set estoque = estoque + v_delta_new where id = new.produto_id;
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_estoque_movimentos_saldo on public.estoque_movimentos;
create trigger trg_estoque_movimentos_saldo
  after insert or update or delete on public.estoque_movimentos
  for each row execute function public._estoque_movimentos_atualizar_saldo();

create or replace function public._sincronizar_estoque_pedido(p_pedido_id bigint)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_status  text;
  v_cliente text;
begin
  if p_pedido_id is null then return; end if;

  -- Remove baixas anteriores deste pedido (o trigger de DELETE devolve o saldo automaticamente)
  delete from public.estoque_movimentos
   where pedido_id = p_pedido_id
     and tipo = 'saida_pedido';

  select status, cliente into v_status, v_cliente
    from public.pedidos
   where id = p_pedido_id;

  -- Se o pedido está concluído (entregue), registra a baixa de cada item
  if v_status = 'entregue' then
    insert into public.estoque_movimentos (produto_id, tipo, quantidade, data, numero_nf, pedido_id, observacao)
    select pi.produto_id,
           'saida_pedido',
           pi.quantidade,
           current_date,
           '',
           p_pedido_id,
           'Baixa automática - Pedido #' || p_pedido_id ||
             case when btrim(coalesce(v_cliente, '')) <> '' then ' (' || left(btrim(v_cliente), 120) || ')' else '' end
      from public.pedido_itens pi
     where pi.pedido_id = p_pedido_id
       and pi.produto_id is not null
       and pi.quantidade > 0;
  end if;
end;
$$;

create or replace function public._trg_pedidos_estoque()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform public._sincronizar_estoque_pedido(new.id);
  return new;
end;
$$;

drop trigger if exists trg_pedidos_estoque on public.pedidos;
create trigger trg_pedidos_estoque
  after update of status on public.pedidos
  for each row
  when (old.status is distinct from new.status)
  execute function public._trg_pedidos_estoque();

create or replace function public._trg_pedidos_estoque_del()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  delete from public.estoque_movimentos
   where pedido_id = old.id
     and tipo = 'saida_pedido';
  return old;
end;
$$;

drop trigger if exists trg_pedidos_estoque_del on public.pedidos;
create trigger trg_pedidos_estoque_del
  before delete on public.pedidos
  for each row execute function public._trg_pedidos_estoque_del();

create or replace function public._trg_pedido_itens_estoque()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_pid    bigint;
  v_status text;
begin
  v_pid := case when tg_op = 'DELETE' then old.pedido_id else new.pedido_id end;
  select status into v_status from public.pedidos where id = v_pid;
  if v_status = 'entregue' then
    perform public._sincronizar_estoque_pedido(v_pid);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_pedido_itens_estoque on public.pedido_itens;
create trigger trg_pedido_itens_estoque
  after insert or update or delete on public.pedido_itens
  for each row execute function public._trg_pedido_itens_estoque();

create or replace function public.admin_registrar_movimento_estoque(
  p_produto_id bigint,
  p_tipo       text,
  p_quantidade numeric,
  p_data       date default current_date,
  p_numero_nf  text default '',
  p_observacao text default ''
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_tipo text := lower(btrim(coalesce(p_tipo, 'entrada')));
  v_qtd  numeric(10,2) := round(coalesce(p_quantidade, 0), 2);
  v_data date := coalesce(p_data, current_date);
  v_nf   text := left(btrim(coalesce(p_numero_nf, '')), 60);
  v_obs  text := left(btrim(coalesce(p_observacao, '')), 300);
  v_mov  public.estoque_movimentos%rowtype;
  v_est  numeric(10,2);
begin
  if not public.is_admin() then
    raise exception 'Acesso negado';
  end if;
  if v_tipo not in ('entrada', 'saida_manual') then
    raise exception 'Tipo de movimentação inválido';
  end if;
  if v_qtd <= 0 or v_qtd > 999999 then
    raise exception 'Informe uma quantidade maior que zero';
  end if;
  if not exists (select 1 from public.produtos where id = p_produto_id) then
    raise exception 'Produto não encontrado';
  end if;

  insert into public.estoque_movimentos (produto_id, tipo, quantidade, data, numero_nf, observacao)
  values (p_produto_id, v_tipo, v_qtd, v_data, v_nf, v_obs)
  returning * into v_mov;

  select estoque into v_est from public.produtos where id = p_produto_id;

  return jsonb_build_object(
    'id', v_mov.id,
    'produto_id', v_mov.produto_id,
    'tipo', v_mov.tipo,
    'quantidade', v_mov.quantidade,
    'data', v_mov.data,
    'numero_nf', v_mov.numero_nf,
    'observacao', v_mov.observacao,
    'criado_em', v_mov.criado_em,
    'estoque_atual', v_est
  );
end;
$$;

create or replace function public.excluir_movimento_estoque(p_id bigint, p_senha text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_tipo text;
begin
  perform public._checar_exclusao(p_senha);
  select tipo into v_tipo from public.estoque_movimentos where id = p_id;
  if not found then
    raise exception 'Movimentação não encontrada';
  end if;
  if v_tipo = 'saida_pedido' then
    raise exception 'Esta baixa está vinculada a um pedido concluído. Para estornar, altere o status do pedido.';
  end if;
  delete from public.estoque_movimentos where id = p_id;
end;
$$;

revoke execute on function public._estoque_movimentos_atualizar_saldo() from public, anon, authenticated;
revoke execute on function public._sincronizar_estoque_pedido(bigint)   from public, anon, authenticated;
revoke execute on function public._trg_pedidos_estoque()                from public, anon, authenticated;
revoke execute on function public._trg_pedidos_estoque_del()            from public, anon, authenticated;
revoke execute on function public._trg_pedido_itens_estoque()           from public, anon, authenticated;

revoke execute on function public.admin_registrar_movimento_estoque(bigint, text, numeric, date, text, text) from public;
revoke execute on function public.excluir_movimento_estoque(bigint, text) from public;
grant  execute on function public.admin_registrar_movimento_estoque(bigint, text, numeric, date, text, text) to authenticated;
grant  execute on function public.excluir_movimento_estoque(bigint, text) to authenticated;
