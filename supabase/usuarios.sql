-- =====================================================================
-- EISBERG - Cadastro de Usuários do App (login e senha)
--
-- COMO USAR (uma única vez):
--   Supabase > SQL Editor > New query > cole TODO este arquivo > Run.
--   Link do projeto:
--   https://supabase.com/dashboard/project/wibqizlxrwiovgkynprj/sql/66105b49-93b9-49c8-b59e-af92eb40377a
--
-- É seguro rodar mais de uma vez. NÃO altera nenhuma tabela existente
-- (pedidos, produtos, categorias, despesas, configurações).
-- =====================================================================

create extension if not exists pgcrypto;

create table if not exists public.usuarios (
  id            bigint generated always as identity primary key,
  nome          text        not null default '' check (char_length(btrim(nome)) <= 120),
  login         text        not null check (char_length(btrim(login)) between 2 and 120 and btrim(login) !~ '\s'),
  senha_hash    text        not null,
  ativo         boolean     not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists usuarios_login_lower_uidx on public.usuarios (lower(btrim(login)));
create index if not exists usuarios_ativo_idx on public.usuarios (ativo, id desc);

alter table public.usuarios enable row level security;
revoke all on public.usuarios from anon, authenticated;

create or replace function public.admin_listar_usuarios()
returns table (
  id            bigint,
  nome          text,
  login         text,
  ativo         boolean,
  criado_em     timestamptz,
  atualizado_em timestamptz
)
language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado';
  end if;
  return query
    select u.id, u.nome, u.login, u.ativo, u.criado_em, u.atualizado_em
      from public.usuarios u
     order by u.id desc;
end;
$$;

create or replace function public.admin_salvar_usuario(
  p_id    bigint,
  p_nome  text,
  p_login text,
  p_senha text,
  p_ativo boolean default true
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_nome  text := btrim(coalesce(p_nome, ''));
  v_login text := lower(btrim(coalesce(p_login, '')));
  v_senha text := coalesce(p_senha, '');
  v_ativo boolean := coalesce(p_ativo, true);
  v_row   public.usuarios%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado';
  end if;
  if char_length(v_nome) > 120 then
    raise exception 'O nome deve ter no máximo 120 caracteres';
  end if;
  if char_length(v_login) < 2 or char_length(v_login) > 120 or v_login ~ '\s' then
    raise exception 'Informe um login válido (mínimo 2 caracteres, sem espaços)';
  end if;
  if exists (
    select 1 from public.usuarios
     where lower(btrim(login)) = v_login
       and (p_id is null or id <> p_id)
  ) then
    raise exception 'Já existe um usuário cadastrado com este login';
  end if;

  if p_id is null then
    if char_length(v_senha) < 4 then
      raise exception 'Informe uma senha com pelo menos 4 caracteres';
    end if;
    insert into public.usuarios (nome, login, senha_hash, ativo)
    values (v_nome, v_login, crypt(v_senha, gen_salt('bf')), v_ativo)
    returning * into v_row;
  else
    if char_length(v_senha) > 0 then
      if char_length(v_senha) < 4 then
        raise exception 'A nova senha deve ter pelo menos 4 caracteres';
      end if;
      update public.usuarios
         set nome = v_nome,
             login = v_login,
             senha_hash = crypt(v_senha, gen_salt('bf')),
             ativo = v_ativo,
             atualizado_em = now()
       where id = p_id
      returning * into v_row;
    else
      update public.usuarios
         set nome = v_nome,
             login = v_login,
             ativo = v_ativo,
             atualizado_em = now()
       where id = p_id
      returning * into v_row;
    end if;
    if v_row.id is null then
      raise exception 'Usuário não encontrado';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'nome', v_row.nome,
    'login', v_row.login,
    'ativo', v_row.ativo,
    'criado_em', v_row.criado_em,
    'atualizado_em', v_row.atualizado_em
  );
end;
$$;

create or replace function public.excluir_usuario(p_id bigint, p_senha text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public._checar_exclusao(p_senha);
  delete from public.usuarios where id = p_id;
  if not found then
    raise exception 'Usuário não encontrado';
  end if;
end;
$$;

create or replace function public.login_usuario(p_login text, p_senha text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_login text := lower(btrim(coalesce(p_login, '')));
  v_row   public.usuarios%rowtype;
begin
  if v_login = '' or coalesce(p_senha, '') = '' then
    raise exception 'Informe seu login e sua senha';
  end if;

  select * into v_row
    from public.usuarios
   where lower(btrim(login)) = v_login
      or (position('@' in v_login) = 0 and lower(btrim(login)) = v_login || '@eisberg.com')
   limit 1;

  if v_row.id is null or v_row.senha_hash <> crypt(p_senha, v_row.senha_hash) then
    perform pg_sleep(0.5);
    raise exception 'Login ou senha incorretos';
  end if;

  if not v_row.ativo then
    raise exception 'Usuário desativado. Contate o administrador.';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'nome', v_row.nome,
    'login', v_row.login,
    'ativo', v_row.ativo
  );
end;
$$;

create or replace function public.validar_usuario_ativo(p_id bigint, p_login text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.usuarios
     where id = p_id
       and lower(btrim(login)) = lower(btrim(coalesce(p_login, '')))
       and ativo = true
  );
$$;

revoke execute on function public.admin_listar_usuarios() from public;
revoke execute on function public.admin_salvar_usuario(bigint, text, text, text, boolean) from public;
revoke execute on function public.excluir_usuario(bigint, text) from public;
revoke execute on function public.login_usuario(text, text) from public;
revoke execute on function public.validar_usuario_ativo(bigint, text) from public;

grant execute on function public.admin_listar_usuarios() to authenticated;
grant execute on function public.admin_salvar_usuario(bigint, text, text, text, boolean) to authenticated;
grant execute on function public.excluir_usuario(bigint, text) to authenticated;
grant execute on function public.login_usuario(text, text) to anon, authenticated;
grant execute on function public.validar_usuario_ativo(bigint, text) to anon, authenticated;
