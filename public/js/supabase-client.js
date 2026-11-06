/**
 * EISBERG - Cliente do Supabase (sem dependências externas)
 *
 * Usa a REST API do PostgREST + GoTrue nativamente via fetch.
 * Compatível tanto com Node.js (>=18) quanto direto no navegador.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.eisbergSupabase = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_CONFIG = {
    url: 'https://wibqizlxrwiovgkynprj.supabase.co',
    anonKey: 'sb_publishable_ayOLQ43DrKTulXIljw6YqQ_Dt_ZUeel',
    whatsapp: '5551981777079',
  };

  function createClient(options) {
    const opts = Object.assign({}, DEFAULT_CONFIG, options || {});
    const base = opts.url.replace(/\/+$/, '');
    let token = opts.token || null;

    function setToken(t) { token = t || null; }
    function getToken() { return token; }

    function headers(extra) {
      const h = {
        'Content-Type': 'application/json',
        apikey: opts.anonKey,
      };
      if (token) {
        h.Authorization = 'Bearer ' + token;
      } else {
        h.Authorization = 'Bearer ' + opts.anonKey;
      }
      return Object.assign(h, extra || {});
    }

    async function req(path, init) {
      init = init || {};
      init.headers = headers(init.headers);
      const res = await fetch(base + path, init);
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json().catch(function () { return null; }) : null;

      if (!res.ok) {
        var msg = (data && (data.message || data.error_description || data.msg || data.error)) ||
                  ('Erro HTTP ' + res.status);
        var err = new Error(msg);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    }

    // --- Auth (GoTrue) ---
    var auth = {
      signInWithPassword: async function (email, password) {
        var data = await req('/auth/v1/token?grant_type=password', {
          method: 'POST',
          body: JSON.stringify({ email: email, password: password }),
        });
        setToken(data.access_token);
        return data;
      },
      signOut: async function () {
        try {
          if (token) await req('/auth/v1/logout', { method: 'POST' });
        } finally {
          setToken(null);
        }
      },
      getUser: async function () {
        if (!token) return null;
        return await req('/auth/v1/user', { method: 'GET' });
      },
    };

    // --- Catálogo (público) ---
    async function getCatalogo() {
      var cats = await req('/rest/v1/categorias?select=*&order=coluna.asc,ordem.asc,id.asc');
      var prods = await req('/rest/v1/produtos?select=*&order=ordem.asc,id.asc');
      var mapa = {};
      cats.forEach(function (c) {
        c.produtos = [];
        mapa[c.id] = c;
      });
      prods.forEach(function (p) {
        if (mapa[p.categoria_id]) mapa[p.categoria_id].produtos.push(p);
      });
      return cats;
    }

    // --- Pedidos ---
    async function criarPedido(dados) {
      return await req('/rest/v1/rpc/criar_pedido', {
        method: 'POST',
        body: JSON.stringify({ p_dados: dados }),
      });
    }

    async function adminSalvarPedido(id, dados) {
      return await req('/rest/v1/rpc/admin_salvar_pedido', {
        method: 'POST',
        body: JSON.stringify({ p_id: id || null, p_dados: dados }),
      });
    }

    async function adminListarPedidos(filtro) {
      filtro = filtro || {};
      var qs = ['select=*,pedido_itens(quantidade,preco)', 'order=id.desc', 'limit=500'];
      if (filtro.status) qs.push('status=eq.' + encodeURIComponent(filtro.status));
      if (filtro.q) {
        var q = filtro.q;
        var or = 'cliente.ilike.*' + encodeURIComponent(q) + '*' +
                 ',cidade.ilike.*' + encodeURIComponent(q) + '*' +
                 ',cod.ilike.*' + encodeURIComponent(q) + '*';
        if (!isNaN(Number(q))) or += ',id.eq.' + Number(q);
        qs.push('or=(' + or + ')');
      }
      var rows = await req('/rest/v1/pedidos?' + qs.join('&'));

      // Resumo de contagem por status (feito em uma passada)
      var resumo = { novo: 0, em_producao: 0, entregue: 0, cancelado: 0 };
      var resumoRows = await req('/rest/v1/pedidos?select=status');
      (resumoRows || []).forEach(function (r) {
        if (resumo[r.status] !== undefined) resumo[r.status]++;
      });

      rows.forEach(function (p) {
        var itens = p.pedido_itens || [];
        p.total_itens = itens.reduce(function (s, i) { return s + (i.quantidade || 0); }, 0);
        p.total = itens.reduce(function (s, i) { return s + (i.quantidade || 0) * (i.preco || 0); }, 0);
      });

      return {
        pedidos: rows,
        resumo: Object.keys(resumo).map(function (k) { return { status: k, n: resumo[k] }; }),
      };
    }

    async function adminGetPedido(id) {
      var rows = await req('/rest/v1/pedidos?id=eq.' + id + '&select=*,pedido_itens(*)');
      if (!rows || !rows.length) {
        var err = new Error('Pedido não encontrado');
        err.status = 404;
        throw err;
      }
      var p = rows[0];
      p.itens = p.pedido_itens || [];
      p.itens.sort(function (a, b) { return a.id - b.id; });
      delete p.pedido_itens;
      p.total = p.itens.reduce(function (s, i) { return s + (i.quantidade || 0) * (i.preco || 0); }, 0);
      return p;
    }

    async function adminAtualizarStatus(id, status) {
      var rows = await req('/rest/v1/pedidos?id=eq.' + id, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: status }),
      });
      return rows && rows[0];
    }

    // --- CRUD Categorias ---
    async function adminCriarCategoria(c) {
      var rows = await req('/rest/v1/categorias', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          nome: c.nome,
          unidade: c.unidade || '',
          coluna: Number(c.coluna) === 2 ? 2 : 1,
          ordem: Number(c.ordem) || 0,
          ativo: c.ativo !== false,
        }),
      });
      return rows && rows[0];
    }

    async function adminAtualizarCategoria(id, c) {
      var rows = await req('/rest/v1/categorias?id=eq.' + id, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          nome: c.nome,
          unidade: c.unidade || '',
          coluna: Number(c.coluna) === 2 ? 2 : 1,
          ordem: Number(c.ordem) || 0,
          ativo: c.ativo !== false,
        }),
      });
      return rows && rows[0];
    }

    // --- CRUD Produtos ---
    async function adminListarProdutos() {
      return await req(
        '/rest/v1/produtos?select=*,categorias(nome,coluna,ordem)&order=ordem.asc,id.asc'
      ).then(function (rows) {
        return rows.map(function (p) {
          p.categoria = (p.categorias && p.categorias.nome) || '';
          return p;
        });
      });
    }

    async function adminCriarProduto(p) {
      var rows = await req('/rest/v1/produtos', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          categoria_id: Number(p.categoria_id),
          nome: p.nome,
          preco: Number(p.preco) || 0,
          ordem: Number(p.ordem) || 0,
          ativo: p.ativo !== false,
        }),
      });
      return rows && rows[0];
    }

    async function adminAtualizarProduto(id, p) {
      var body = {};
      if (p.categoria_id !== undefined) body.categoria_id = Number(p.categoria_id);
      if (p.nome !== undefined) body.nome = p.nome;
      if (p.preco !== undefined) body.preco = Number(p.preco) || 0;
      if (p.ordem !== undefined) body.ordem = Number(p.ordem) || 0;
      if (p.ativo !== undefined) body.ativo = p.ativo !== false;
      var rows = await req('/rest/v1/produtos?id=eq.' + id, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(body),
      });
      return rows && rows[0];
    }

    // --- Exclusões (exigem senha de exclusão) ---
    async function excluirPedido(id, senha) {
      return await req('/rest/v1/rpc/excluir_pedido', {
        method: 'POST',
        body: JSON.stringify({ p_id: id, p_senha: senha }),
      });
    }

    async function excluirProduto(id, senha) {
      return await req('/rest/v1/rpc/excluir_produto', {
        method: 'POST',
        body: JSON.stringify({ p_id: id, p_senha: senha }),
      });
    }

    async function excluirCategoria(id, senha) {
      return await req('/rest/v1/rpc/excluir_categoria', {
        method: 'POST',
        body: JSON.stringify({ p_id: id, p_senha: senha }),
      });
    }

    return {
      config: opts,
      setToken: setToken,
      getToken: getToken,
      auth: auth,
      getCatalogo: getCatalogo,
      criarPedido: criarPedido,
      adminListarPedidos: adminListarPedidos,
      adminGetPedido: adminGetPedido,
      adminSalvarPedido: adminSalvarPedido,
      adminAtualizarStatus: adminAtualizarStatus,
      adminCriarCategoria: adminCriarCategoria,
      adminAtualizarCategoria: adminAtualizarCategoria,
      adminListarProdutos: adminListarProdutos,
      adminCriarProduto: adminCriarProduto,
      adminAtualizarProduto: adminAtualizarProduto,
      excluirPedido: excluirPedido,
      excluirProduto: excluirProduto,
      excluirCategoria: excluirCategoria,
    };
  }

  return {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    createClient: createClient,
  };
});
