-- =====================================================================
-- EISBERG - Banco de dados (Supabase / PostgreSQL)
--
-- COMO USAR: Supabase > SQL Editor > New query > cole TODO este arquivo > Run.
-- É seguro rodar mais de uma vez (não duplica tabelas nem o cardápio).
--
-- SEGURANÇA (resumo):
--   * Clientes (anônimos) só LEEM o cardápio ativo e CRIAM pedidos pela
--     função criar_pedido(), que valida tudo e usa o preço do banco.
--   * Só administradores (e-mail na tabela "admins" + login no Supabase Auth)
--     leem pedidos e alteram cardápio/pedidos.
--   * NINGUÉM exclui direto pela API: toda exclusão passa por funções que
--     exigem ser admin E a senha de exclusão (tabela app_config).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.categorias (
  id      bigint generated always as identity primary key,
  nome    text     not null check (length(trim(nome)) > 0),
  unidade text     not null default '',
  ordem   integer  not null default 0,
  coluna  smallint not null default 1 check (coluna in (1, 2)),
  ativo   boolean  not null default true
);

create table if not exists public.produtos (
  id           bigint generated always as identity primary key,
  categoria_id bigint        not null references public.categorias(id) on delete cascade,
  nome         text          not null check (length(trim(nome)) > 0),
  preco        numeric(10,2) not null default 0 check (preco >= 0),
  ordem        integer       not null default 0,
  ativo        boolean       not null default true
);
create index if not exists produtos_categoria_idx on public.produtos (categoria_id);

create table if not exists public.pedidos (
  id          bigint generated always as identity primary key,
  cliente     text not null,
  endereco    text not null default '',
  cidade      text not null default '',
  cod         text not null default '',
  data        text not null default '',
  observacoes text not null default '',
  status      text not null default 'novo'
              check (status in ('novo', 'em_producao', 'entregue', 'cancelado')),
  criado_em   timestamptz not null default now()
);
create index if not exists pedidos_status_idx on public.pedidos (status);

-- Cada item guarda uma cópia do nome/preço da época do pedido.
create table if not exists public.pedido_itens (
  id         bigint generated always as identity primary key,
  pedido_id  bigint        not null references public.pedidos(id) on delete cascade,
  produto_id bigint        references public.produtos(id) on delete set null,
  categoria  text          not null,
  produto    text          not null,
  unidade    text          not null default '',
  quantidade integer       not null check (quantidade between 1 and 9999),
  preco      numeric(10,2) not null default 0
);
create index if not exists pedido_itens_pedido_idx on public.pedido_itens (pedido_id);

-- E-mails com permissão de administrador (precisam existir em Authentication > Users).
create table if not exists public.admins (
  email text primary key
);
insert into public.admins (email)
values ('admin@admin.com')
on conflict (email) do nothing;

-- Configurações internas (nunca expostas pela API).
create table if not exists public.app_config (
  chave text primary key,
  valor text not null
);
insert into public.app_config (chave, valor)
values 
  ('senha_exclusao', '789512'),
  ('nome_empresa', 'EISBERG'),
  ('telefone_empresa', '(51) 98177.7079'),
  ('whatsapp_empresa', '5551981777079')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- 2) Funções auxiliares
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select (
    auth.role() = 'authenticated'
    and (
      not exists (select 1 from public.admins)
      or exists (
        select 1 from public.admins a
         where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
    )
  );
$$;

-- Pedido completo (com itens e total) em JSON.
create or replace function public._pedido_json(p_id bigint)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select to_jsonb(p) || jsonb_build_object(
           'itens', coalesce((select jsonb_agg(to_jsonb(i) order by i.id)
                                from public.pedido_itens i where i.pedido_id = p.id), '[]'::jsonb),
           'total', coalesce((select sum(i.quantidade * i.preco)
                                from public.pedido_itens i where i.pedido_id = p.id), 0))
    from public.pedidos p
   where p.id = p_id;
$$;

-- Cria (p_id nulo) ou atualiza um pedido, substituindo os itens.
-- p_cliente_final = true  => pedido vindo do app: status 'novo', só produtos
--                            ativos e COM preço; preço sempre lido do banco.
create or replace function public._gravar_pedido(p_id bigint, p_dados jsonb, p_cliente_final boolean)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  v_id       bigint := p_id;
  v_cliente  text   := left(trim(coalesce(p_dados ->> 'cliente', '')), 120);
  v_endereco text   := left(trim(coalesce(p_dados ->> 'endereco', '')), 200);
  v_cidade   text   := left(trim(coalesce(p_dados ->> 'cidade', '')), 80);
  v_status   text   := coalesce(p_dados ->> 'status', 'novo');
  v_item     jsonb;
  v_prod     record;
  v_qtd      integer;
  v_n        integer := 0;
begin
  if v_cliente = '' then
    raise exception 'Por favor, preencha o campo Cliente';
  end if;
  if p_cliente_final and v_endereco = '' then
    raise exception 'Por favor, preencha o campo Endereço';
  end if;
  if p_cliente_final and v_cidade = '' then
    raise exception 'Por favor, preencha o campo Cidade';
  end if;
  if jsonb_typeof(p_dados -> 'itens') is distinct from 'array' then
    raise exception 'Itens inválidos';
  end if;
  if p_cliente_final or v_status not in ('novo', 'em_producao', 'entregue', 'cancelado') then
    v_status := 'novo';
  end if;

  if v_id is null then
    insert into public.pedidos (cliente, endereco, cidade, cod, data, observacoes, status)
    values (v_cliente,
            v_endereco,
            v_cidade,
            '',
            left(trim(coalesce(p_dados ->> 'data', '')), 20),
            left(trim(coalesce(p_dados ->> 'observacoes', '')), 2000),
            v_status)
    returning id into v_id;

    update public.pedidos set cod = v_id::text where id = v_id;
  else
    update public.pedidos
       set cliente     = v_cliente,
           endereco    = v_endereco,
           cidade      = v_cidade,
           cod         = left(trim(coalesce(p_dados ->> 'cod', '')), 30),
           data        = left(trim(coalesce(p_dados ->> 'data', '')), 20),
           observacoes = left(trim(coalesce(p_dados ->> 'observacoes', '')), 2000),
           status      = v_status
     where id = v_id;
    if not found then
      raise exception 'Pedido não encontrado';
    end if;
    delete from public.pedido_itens where pedido_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_dados -> 'itens') loop
    v_qtd := trunc(coalesce(nullif(v_item ->> 'quantidade', '')::numeric, 0));
    continue when v_qtd <= 0;
    if v_qtd > 9999 then
      raise exception 'Quantidade inválida';
    end if;

    select p.id, p.nome, p.preco, p.ativo, c.nome as categoria, c.unidade
      into v_prod
      from public.produtos p
      join public.categorias c on c.id = p.categoria_id
     where p.id = (v_item ->> 'produto_id')::bigint;
    if not found then
      raise exception 'Produto inexistente';
    end if;
    if p_cliente_final and (not v_prod.ativo or v_prod.preco <= 0) then
      raise exception '"%" está indisponível (sem preço)', v_prod.nome;
    end if;

    insert into public.pedido_itens (pedido_id, produto_id, categoria, produto, unidade, quantidade, preco)
    values (v_id, v_prod.id, v_prod.categoria, v_prod.nome, v_prod.unidade, v_qtd, v_prod.preco);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'Adicione ao menos um item ao pedido';
  end if;
  return v_id;
end;
$$;

-- Confere admin + senha de exclusão (com atraso para dificultar tentativas).
create or replace function public._checar_exclusao(p_senha text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado';
  end if;
  if coalesce(p_senha, '') <> coalesce((select valor from public.app_config where chave = 'senha_exclusao'), '') then
    perform pg_sleep(1);
    raise exception 'Senha de exclusão incorreta';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Funções públicas (RPC)
-- ---------------------------------------------------------------------
-- App do cliente: ENVIAR PEDIDO
create or replace function public.proximo_codigo()
returns bigint
language sql stable security definer
set search_path = public
as $$
  select coalesce(max(id), 0) + 1 from public.pedidos;
$$;

create or replace function public.criar_pedido(p_dados jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_id bigint;
begin
  v_id := public._gravar_pedido(null, p_dados, true);
  return public._pedido_json(v_id);
end;
$$;

-- Admin: criar (p_id nulo) ou editar pedido
create or replace function public.admin_salvar_pedido(p_id bigint, p_dados jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_id bigint;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado';
  end if;
  v_id := public._gravar_pedido(p_id, p_dados, false);
  return public._pedido_json(v_id);
end;
$$;

-- Admin: exclusões (exigem senha de exclusão)
create or replace function public.excluir_pedido(p_id bigint, p_senha text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public._checar_exclusao(p_senha);
  delete from public.pedidos where id = p_id;
  if not found then raise exception 'Pedido não encontrado'; end if;
end;
$$;

create or replace function public.excluir_produto(p_id bigint, p_senha text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public._checar_exclusao(p_senha);
  delete from public.produtos where id = p_id;
  if not found then raise exception 'Produto não encontrado'; end if;
end;
$$;

create or replace function public.excluir_categoria(p_id bigint, p_senha text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public._checar_exclusao(p_senha);
  delete from public.categorias where id = p_id;
  if not found then raise exception 'Categoria não encontrada'; end if;
end;
$$;

-- Configurações da Empresa (Nome, Telefone exibido e WhatsApp dos pedidos)
create or replace function public.obter_config()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'nome_empresa', coalesce((select valor from public.app_config where chave = 'nome_empresa'), 'EISBERG'),
    'telefone_empresa', coalesce((select valor from public.app_config where chave = 'telefone_empresa'), '(51) 98177.7079'),
    'whatsapp_empresa', coalesce((select valor from public.app_config where chave = 'whatsapp_empresa'), '5551981777079')
  );
$$;

create or replace function public.salvar_config(p_nome text, p_telefone text, p_whatsapp text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_wa text;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado';
  end if;

  v_wa := regexp_replace(coalesce(p_whatsapp, p_telefone, ''), '\D', '', 'g');
  if v_wa <> '' and length(v_wa) in (10, 11) and not v_wa ~ '^55' then
    v_wa := '55' || v_wa;
  end if;

  insert into public.app_config (chave, valor) values ('nome_empresa', coalesce(nullif(trim(p_nome), ''), 'EISBERG'))
    on conflict (chave) do update set valor = excluded.valor;

  insert into public.app_config (chave, valor) values ('telefone_empresa', coalesce(nullif(trim(p_telefone), ''), '(51) 98177.7079'))
    on conflict (chave) do update set valor = excluded.valor;

  insert into public.app_config (chave, valor) values ('whatsapp_empresa', coalesce(nullif(trim(v_wa), ''), '5551981777079'))
    on conflict (chave) do update set valor = excluded.valor;

  return public.obter_config();
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Row Level Security
-- ---------------------------------------------------------------------
alter table public.categorias    enable row level security;
alter table public.produtos      enable row level security;
alter table public.pedidos       enable row level security;
alter table public.pedido_itens  enable row level security;
alter table public.admins        enable row level security;
alter table public.app_config    enable row level security;

drop policy if exists categorias_select on public.categorias;
drop policy if exists categorias_insert on public.categorias;
drop policy if exists categorias_update on public.categorias;
create policy categorias_select on public.categorias for select using (ativo or public.is_admin());
create policy categorias_insert on public.categorias for insert with check (public.is_admin());
create policy categorias_update on public.categorias for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists produtos_select on public.produtos;
drop policy if exists produtos_insert on public.produtos;
drop policy if exists produtos_update on public.produtos;
create policy produtos_select on public.produtos for select using (ativo or public.is_admin());
create policy produtos_insert on public.produtos for insert with check (public.is_admin());
create policy produtos_update on public.produtos for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists pedidos_select on public.pedidos;
drop policy if exists pedidos_update on public.pedidos;
create policy pedidos_select on public.pedidos for select using (public.is_admin());
create policy pedidos_update on public.pedidos for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists pedido_itens_select on public.pedido_itens;
create policy pedido_itens_select on public.pedido_itens for select using (public.is_admin());

-- admins e app_config: sem nenhuma policy = invisíveis pela API.
-- Não existe policy de DELETE em nenhuma tabela (exclusão só pelas funções).

-- ---------------------------------------------------------------------
-- 5) Permissões
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

revoke all on public.categorias, public.produtos, public.pedidos,
              public.pedido_itens, public.admins, public.app_config from anon, authenticated;

grant select on public.categorias, public.produtos to anon, authenticated;
grant insert, update on public.categorias, public.produtos to authenticated;
grant select, update on public.pedidos to authenticated;
grant select on public.pedido_itens to authenticated;

-- Funções internas: ninguém chama pela API.
revoke execute on function public._pedido_json(bigint)                    from public, anon, authenticated;
revoke execute on function public._gravar_pedido(bigint, jsonb, boolean)  from public, anon, authenticated;
revoke execute on function public._checar_exclusao(text)                  from public, anon, authenticated;

-- Funções públicas
revoke execute on function public.proximo_codigo()                 from public;
revoke execute on function public.criar_pedido(jsonb)              from public;
revoke execute on function public.admin_salvar_pedido(bigint, jsonb) from public;
revoke execute on function public.excluir_pedido(bigint, text)     from public;
revoke execute on function public.excluir_produto(bigint, text)    from public;
revoke execute on function public.excluir_categoria(bigint, text)  from public;
revoke execute on function public.obter_config()                   from public;
revoke execute on function public.salvar_config(text, text, text)  from public;
grant  execute on function public.is_admin()                       to anon, authenticated;
grant  execute on function public.proximo_codigo()                 to anon, authenticated;
grant  execute on function public.obter_config()                   to anon, authenticated;
grant  execute on function public.criar_pedido(jsonb)              to anon, authenticated;
grant  execute on function public.salvar_config(text, text, text)  to authenticated;
grant  execute on function public.admin_salvar_pedido(bigint, jsonb) to authenticated;
grant  execute on function public.excluir_pedido(bigint, text)     to authenticated;
grant  execute on function public.excluir_produto(bigint, text)    to authenticated;
grant  execute on function public.excluir_categoria(bigint, text)  to authenticated;

-- ---------------------------------------------------------------------
-- 6) Cardápio inicial (idêntico ao formulário de referência)
--    Só carrega se a tabela de categorias estiver vazia.
-- ---------------------------------------------------------------------
do $$
declare
  v_cat   jsonb;
  v_prod  jsonb;
  v_cid   bigint;
  v_i     integer := 0;
  v_j     integer;
  v_cardapio jsonb := $json$[
    {"nome":"POTES 2 LITROS","unidade":"UND","coluna":1,"produtos":[["Cassata",1],["Napolitano",2],["Abacaxi Francês",3.5],["Casadinho",1],["Banana Split",5],["Creme",7]]},
    {"nome":"CLÁSSICOS","unidade":"UND","coluna":1,"produtos":[["Prime Black",0],["Prime White",0],["Prime Trufa",0],["Skimo c/ 20",0],["Brigadeiro c/ 20",0],["Superkito c/ 20",0],["Sonho de Bombom c/ 20",0],["Super Barrita c/ 24",0]]},
    {"nome":"SUNDAE C/ 6 - 80g","unidade":"CX.","coluna":1,"produtos":[["Napolitano",0]]},
    {"nome":"COPÃO C/ 12","unidade":"","coluna":1,"produtos":[["Chyky 100g",0]]},
    {"nome":"PICOLÉ C/ 30","unidade":"CX.","coluna":2,"produtos":[["Abacaxi",0],["Limão",0],["Uva",0]]},
    {"nome":"PICOLÉ C/ 30","unidade":"CX.","coluna":2,"produtos":[["Coco",0],["Chocolate",0],["Leite Condensado",0],["Morango",0]]},
    {"nome":"DIVERSOS","unidade":"","coluna":2,"produtos":[["Cartaz",0],["Tabela de Preços",0],["Gelo 3Kg",0]]},
    {"nome":"AÇAÍ 160g C/ 8","unidade":"","coluna":2,"produtos":[["Banana",0],["Morango",0]]},
    {"nome":"POP ICE","unidade":"","coluna":2,"produtos":[["Morango",0],["Creme",0],["Chocolate",0]]}
  ]$json$;
begin
  if exists (select 1 from public.categorias) then
    return;
  end if;
  for v_cat in select * from jsonb_array_elements(v_cardapio) loop
    v_i := v_i + 1;
    insert into public.categorias (nome, unidade, coluna, ordem)
    values (v_cat ->> 'nome', v_cat ->> 'unidade', (v_cat ->> 'coluna')::smallint, v_i)
    returning id into v_cid;
    v_j := 0;
    for v_prod in select * from jsonb_array_elements(v_cat -> 'produtos') loop
      v_j := v_j + 1;
      insert into public.produtos (categoria_id, nome, preco, ordem)
      values (v_cid, v_prod ->> 0, (v_prod ->> 1)::numeric, v_j);
    end loop;
  end loop;
end $$;

-- =====================================================================
-- PRÓXIMO PASSO (uma vez só): cadastre o administrador
--   1. Supabase > Authentication > Users > Add user (e-mail + senha, marque
--      "Auto Confirm User").
--   2. Rode no SQL Editor, trocando pelo SEU e-mail:
--
--        insert into public.admins (email) values ('seu@email.com');
--
-- Para trocar a senha de exclusão:
--        update public.app_config set valor = 'NOVA_SENHA' where chave = 'senha_exclusao';
-- =====================================================================

