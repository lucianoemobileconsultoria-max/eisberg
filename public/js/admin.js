'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const STATUS = { novo: 'Novo', em_producao: 'Em produção', entregue: 'Entregue', cancelado: 'Cancelado' };

  const savedToken = sessionStorage.getItem('eisberg_sb_token') || '';
  const client = window.eisbergSupabase ? window.eisbergSupabase.createClient({ token: savedToken }) : null;

  let tab = 'pedidos';
  let filtro = { status: '', q: '', periodo: 'todos', dataInicio: '', dataFim: '' };
  let paginacaoPedidos = { pagina: 1, limite: 20 };
  let refocarBusca = false;

  /* ---------------- Helpers ---------------- */
  function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'value') e.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled') e[k] = !!v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) if (c != null && c !== false) e.append(c);
    return e;
  }

  function toast(msg, err) {
    const t = el('div', { class: 'toast' + (err ? ' err' : '') }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 3000);
  }

  async function guard(fn) {
    try {
      return await fn();
    } catch (e) {
      if (e.status === 401 || (e.message && e.message.includes('JWT'))) {
        sair(true);
      } else {
        toast(e.message || 'Erro na operação', true);
      }
    }
  }

  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtData = (s) => (s ? String(s).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1').slice(0, 16) : '');

  function openModal(title, content, wide) {
    closeModal();
    const box = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
      el('div', { class: 'modal-head' }, el('h2', {}, title), el('button', { class: 'x no-print', 'aria-label': 'Fechar', onclick: closeModal }, '×')),
      content);
    const ov = el('div', { class: 'overlay' }, box);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeModal(); });
    $('modal-root').append(ov);
  }
  function closeModal() { $('modal-root').replaceChildren(); }

  /**
   * Modal moderno de confirmação com senha de exclusão (789512).
   */
  function pedirSenha({ titulo, mensagem, executar }) {
    const antigo = document.getElementById('pw-overlay');
    if (antigo) antigo.remove();

    const input = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '30', placeholder: '••••••', 'aria-label': 'Senha de exclusão' });
    const erro = el('p', { class: 'pw-error', role: 'alert', hidden: '' });
    const btnOk = el('button', { type: 'submit', class: 'btn pw-danger' }, '🗑 Excluir');
    const btnCancel = el('button', { type: 'button', class: 'btn secondary' }, 'Cancelar');
    const form = el('form', { class: 'pw-card', autocomplete: 'off' },
      el('div', { class: 'pw-icon', 'aria-hidden': 'true' }, '🔒'),
      el('h3', {}, titulo),
      el('p', { class: 'pw-msg' }, mensagem),
      el('div', { class: 'pw-field' }, el('label', {}, 'Digite a senha para confirmar'), input),
      erro,
      el('div', { class: 'pw-actions' }, btnCancel, btnOk));
    const ov = el('div', { class: 'pw-overlay', id: 'pw-overlay' }, form);

    const fechar = () => { document.removeEventListener('keydown', onKey); ov.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') fechar(); };
    document.addEventListener('keydown', onKey);
    btnCancel.addEventListener('click', fechar);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) fechar(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value) { input.focus(); return; }
      erro.hidden = true;
      btnOk.disabled = true;
      btnOk.textContent = 'Excluindo…';
      try {
        await executar(input.value);
        fechar();
      } catch (err) {
        erro.textContent = err.message || 'Senha incorreta';
        erro.hidden = false;
        input.value = '';
        form.classList.remove('shake');
        void form.offsetWidth;
        form.classList.add('shake');
        input.focus();
        btnOk.disabled = false;
        btnOk.textContent = '🗑 Excluir';
      }
    });

    document.body.append(ov);
    input.focus();
  }

  function group(label, input) { return el('div', { class: 'form-group' }, el('label', {}, label), input); }

  /* ---------------- Exportação / Backup ---------------- */
  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  async function exportarDadosSistema() {
    const btn = $('btn-exportar');
    const txtOriginal = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '📦 Exportando...';
    }
    try {
      toast('Gerando arquivo de backup completo...');
      const backup = await client.adminExportarTudo();
      const pad = (n) => String(n).padStart(2, '0');
      const d = new Date();
      const filename = `eisberg-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}.json`;
      downloadJson(backup, filename);
      toast(`Backup baixado! (${backup.resumo.total_categorias} categorias, ${backup.resumo.total_produtos} produtos, ${backup.resumo.total_pedidos} pedidos)`);

      openModal('📦 Backup do Sistema Exportado com Sucesso', el('div', { style: 'line-height:1.6' },
        el('p', { style: 'font-size:15px;color:var(--ok);font-weight:700;margin:0 0 10px' }, '✅ Todos os dados do sistema foram exportados com segurança!'),
        el('p', { style: 'font-size:13.5px;color:#333;margin:0 0 12px' }, 'O arquivo foi salvo no seu computador/celular: ', el('code', { style: 'background:#f0f0f0;padding:2px 6px;border-radius:4px;color:#d9141e;font-weight:700' }, filename)),
        el('div', { style: 'background:#f8f9fa;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:16px' },
          el('b', { style: 'font-size:14px;color:#111' }, 'Conteúdo incluído neste arquivo:'),
          el('ul', { style: 'margin:8px 0 0 18px;padding:0;font-size:13.5px;color:#444' },
            el('li', {}, `${backup.resumo.total_categorias} Categorias`),
            el('li', {}, `${backup.resumo.total_produtos} Produtos cadastrados (preços, unidades e status)`),
            el('li', {}, `${backup.resumo.total_pedidos} Pedidos completos (com todos os itens)`),
            backup.resumo.total_despesas ? el('li', {}, `${backup.resumo.total_despesas} Despesas registradas`) : null,
            backup.resumo.total_usuarios ? el('li', {}, `${backup.resumo.total_usuarios} Usuários cadastrados`) : null,
            el('li', {}, `Configurações da empresa (${backup.configuracoes.nome_empresa || 'EISBERG'}, telefone e WhatsApp)`)
          )
        ),
        el('div', { class: 'actions' },
          el('button', { class: 'btn', onclick: closeModal }, 'OK, Entendido')
        )
      ));
    } catch (err) {
      if (err && (err.status === 401 || /jwt/i.test(err.message || ''))) {
        sair(true);
      } else {
        toast((err && err.message) || 'Erro ao exportar dados', true);
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = txtOriginal;
      }
    }
  }

  /* ---------------- Login / Sessão ---------------- */
  function estaLogado() {
    return !!(client && client.getToken());
  }

  async function atualizarMarcaAdmin() {
    if (!client || !client.getConfig) return;
    try {
      const cfg = await client.getConfig();
      if (cfg && cfg.nome_empresa) {
        const adminName = $('admin-brand-name');
        if (adminName) adminName.textContent = cfg.nome_empresa;
        const loginName = $('login-brand-name');
        if (loginName) loginName.textContent = cfg.nome_empresa;
      }
    } catch (_) { }
  }

  async function mostrar() {
    atualizarMarcaAdmin();
    let logado = estaLogado();
    if (logado) {
      try {
        const u = await client.auth.getUser();
        if (!u || !u.email || u.email.toLowerCase() !== 'admin@admin.com') {
          sessionStorage.removeItem('eisberg_sb_token');
          if (client) client.setToken(null);
          logado = false;
        }
      } catch (_) {
        sessionStorage.removeItem('eisberg_sb_token');
        if (client) client.setToken(null);
        logado = false;
      }
    }
    $('login').hidden = logado;
    $('panel').hidden = !logado;
    if (logado) carregar();
  }

  async function sair(expirou) {
    if (client) {
      try { await client.auth.signOut(); } catch (_) { }
    }
    sessionStorage.removeItem('eisberg_sb_token');
    invalidarPedidosCache();
    despesasCache = { rows: null, t: 0 };
    usuariosCache = { rows: null, t: 0 };
    mapaUI.completo = false;
    mostrar();
    if (expirou) toast('Sessão expirada. Entre novamente.', true);
  }

  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('login-error');
    err.hidden = true;
    try {
      if (!client) throw new Error('Cliente Supabase não inicializado');
      const loginRaw = $('email').value.trim().toLowerCase();
      const senha = $('senha').value;

      // O painel admin só deve aceitar "admin@admin.com" (ou "admin") com senha "admin123"
      const isLoginAdmin = (loginRaw === 'admin@admin.com' || loginRaw === 'admin');
      if (!isLoginAdmin) {
        throw new Error('Acesso negado: o painel administrativo aceita exclusivamente o usuário admin@admin.com');
      }
      if (senha !== 'admin123') {
        throw new Error('Senha incorreta para o administrador.');
      }

      // Autentica no Supabase para obter o token de administrador
      let res;
      try {
        res = await client.auth.signInWithPassword('admin@admin.com', 'admin123');
      } catch (authErr) {
        console.warn('Erro ao autenticar no Supabase Auth:', authErr);
        throw new Error(
          authErr.message === 'Invalid login credentials'
            ? 'Usuário "admin@admin.com" não localizado com a senha "admin123" no Supabase Authentication. Cadastre-o em Authentication > Users.'
            : (authErr.message || 'Falha ao autenticar no Supabase')
        );
      }

      sessionStorage.setItem('eisberg_sb_token', res.access_token);
      $('senha').value = '';
      mostrar();
    } catch (e) {
      err.textContent = e.message || 'Falha ao autenticar';
      err.hidden = false;
    }
  });

  $('logout').addEventListener('click', () => sair(false));

  const btnExp = $('btn-exportar');
  if (btnExp) {
    btnExp.addEventListener('click', exportarDadosSistema);
  }

  $('tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    [...$('tabs').children].forEach((x) => x.classList.toggle('active', x === b));
    carregar();
  });

  function carregar() {
    return guard(() => ({
      pedidos: viewPedidos,
      dashboard: viewDashboard,
      produtos: viewProdutos,
      categorias: viewCategorias,
      mapa: viewMapa,
      despesas: viewDespesas,
      usuarios: viewUsuarios,
      empresa: viewEmpresa,
    }[tab]()));
  }

  /* =================================================================
     MAPA - Leaflet + OpenStreetMap (tiles) + Nominatim (geocodificação)
     Tudo 100% gratuito, sem chave de API.
     ================================================================= */
  const MAPA_GEO_KEY = 'eisberg_geocache_v1';
  const MAPA_CORES = { novo: '#d9141e', em_producao: '#f59e0b', entregue: '#16a34a', cancelado: '#6b7280' };
  const MAPA_PRIORIDADE = ['novo', 'em_producao', 'entregue', 'cancelado'];
  let mapaFiltro = { status: '', periodo: 'todos' };
  let mapaRun = 0;
  let leafletPromise = null;

  function mapaCarregarLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = () => resolve();
      s.onerror = () => { leafletPromise = null; reject(new Error('Não foi possível carregar o mapa. Verifique a internet.')); };
      document.head.appendChild(s);
    });
    return leafletPromise;
  }

  // ---- Cache de pedidos em memória (evita buscar no banco a cada clique) ----
  const PEDIDOS_TTL_MS = 60000;
  const PEDIDOS_LIMITE_API = 500;
  let pedidosCache = { rows: null, t: 0, promise: null };

  function invalidarPedidosCache() {
    pedidosCache = { rows: null, t: 0, promise: null };
  }

  function obterPedidos(forcar) {
    if (forcar) invalidarPedidosCache();
    const c = pedidosCache;
    if (c.rows && Date.now() - c.t < PEDIDOS_TTL_MS) return Promise.resolve(c.rows);
    if (c.promise) return c.promise;
    c.promise = client.adminListarPedidos({ resumo: false })
      .then((r) => {
        if (pedidosCache === c) { c.rows = r.pedidos; c.t = Date.now(); c.promise = null; }
        return r.pedidos;
      })
      .catch((e) => {
        if (pedidosCache === c) c.promise = null;
        throw e;
      });
    return c.promise;
  }

  const semAcento = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function pedidoCasaBusca(p, q) {
    const n = semAcento(q).trim();
    if (!n) return true;
    if (String(p.id) === n) return true;
    return [p.cliente, p.cidade, p.cod, p.endereco].some((v) => semAcento(v).includes(n));
  }

  // ---- Geocodificação com cache persistente (localStorage) + memória ----
  const MAPA_MISS_TTL = 7 * 24 * 3600 * 1000;
  let mapaGeoMem = null;
  let mapaSalvarTimer = null;

  function mapaGeo() {
    if (!mapaGeoMem) {
      try { mapaGeoMem = JSON.parse(localStorage.getItem(MAPA_GEO_KEY)) || {}; } catch (_) { mapaGeoMem = {}; }
    }
    return mapaGeoMem;
  }
  function mapaSalvarGeo(agora) {
    clearTimeout(mapaSalvarTimer);
    const gravar = () => { try { localStorage.setItem(MAPA_GEO_KEY, JSON.stringify(mapaGeo())); } catch (_) { } };
    if (agora) gravar(); else mapaSalvarTimer = setTimeout(gravar, 400);
  }
  // undefined = nunca consultado | null = não encontrado | {lat,lng,approx} = ok
  function mapaDoCache(key) {
    const c = mapaGeo()[key];
    if (c === undefined) return undefined;
    if (c.miss) return (Date.now() - (c.t || 0) > MAPA_MISS_TTL) ? undefined : null;
    return c;
  }
  const mapaNorm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
  const mapaEsperar = (ms) => new Promise((r) => setTimeout(r, ms));

  async function mapaNominatim(q) {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&accept-language=pt-BR&q=' + encodeURIComponent(q);
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('Geocodificação falhou (' + r.status + ')');
    const j = await r.json();
    return j && j[0] ? { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) } : null;
  }

  // Consulta a internet apenas para o que ainda não está no cache.
  async function mapaGeocodificar(endereco, cidade, key) {
    let achou = null;
    if (endereco) {
      achou = await mapaNominatim([endereco, cidade, 'Brasil'].filter(Boolean).join(', '));
      if (achou) achou.approx = false;
    }
    if (!achou && cidade) {
      const keyCidade = '|' + cidade.toLowerCase();
      const cc = mapaDoCache(keyCidade);
      if (cc !== undefined) {
        achou = cc; // reaproveita a posição da cidade (sem nova consulta)
      } else {
        if (endereco) await mapaEsperar(1100);
        const r = await mapaNominatim(cidade + ', Brasil');
        achou = r ? { lat: r.lat, lng: r.lng, approx: true } : null;
        mapaGeo()[keyCidade] = achou || { miss: true, t: Date.now() };
      }
    }
    mapaGeo()[key] = achou || { miss: true, t: Date.now() };
    mapaSalvarGeo(false);
    return achou;
  }

  // Estado persistente do mapa: o mapa NÃO é recriado ao voltar para a aba.
  const mapaUI = { map: null, canvas: null, layer: null, sig: null, completo: false, resumo: '' };

  async function viewMapa(forcar) {
    const run = ++mapaRun;

    const statusTxt = el('span', { class: 'mapa-status' }, mapaUI.resumo || 'Carregando pedidos...');
    const selStatus = el('select', { onchange: (e) => { mapaFiltro.status = e.target.value; viewMapa(); } },
      el('option', { value: '', selected: !mapaFiltro.status }, 'Todos os status'),
      Object.entries(STATUS).map(([k, v]) => el('option', { value: k, selected: mapaFiltro.status === k }, v)));
    const periodos = [
      ['todos', 'Todo o histórico'], ['hoje', 'Hoje'], ['ontem', 'Ontem'], ['semana_atual', 'Esta semana'],
      ['semana_passada', 'Semana passada'], ['mes_atual', 'Este mês'], ['mes_passado', 'Mês passado'], ['30dias', 'Últimos 30 dias'],
    ];
    const selPer = el('select', { onchange: (e) => { mapaFiltro.periodo = e.target.value; viewMapa(); } },
      periodos.map(([k, v]) => el('option', { value: k, selected: mapaFiltro.periodo === k }, '📅 ' + v)));
    const legenda = el('div', { class: 'mapa-legenda' },
      Object.entries(STATUS).map(([k, v]) => el('span', {}, el('i', { style: 'background:' + MAPA_CORES[k] }), v)));
    if (!mapaUI.canvas) mapaUI.canvas = el('div', { id: 'mapa-pedidos', class: 'mapa-canvas' });

    $('main').replaceChildren(
      el('div', { class: 'toolbar' },
        selStatus, selPer,
        el('button', { class: 'btn secondary', title: 'Buscar pedidos novos no banco', onclick: () => viewMapa(true) }, '🔄 Atualizar'),
        el('span', { class: 'grow' }),
        legenda),
      el('div', { class: 'mapa-info' }, statusTxt),
      el('div', { class: 'mapa-wrap' }, mapaUI.canvas));

    const [pedidos] = await Promise.all([obterPedidos(!!forcar), mapaCarregarLeaflet()]);
    if (run !== mapaRun) return;

    const L = window.L;
    if (!mapaUI.map) {
      mapaUI.map = L.map(mapaUI.canvas, { preferCanvas: true }).setView([-14.2, -51.9], 4);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(mapaUI.map);
      mapaUI.layer = L.layerGroup().addTo(mapaUI.map);
    } else {
      mapaUI.map.invalidateSize();
    }
    const map = mapaUI.map;

    const lista = pedidos
      .filter((p) => pedidoNoPeriodo(p, mapaFiltro.periodo, '', ''))
      .filter((p) => !mapaFiltro.status || p.status === mapaFiltro.status);

    // Nada mudou desde a última montagem? Reaproveita o mapa pronto (instantâneo).
    const sig = mapaFiltro.status + '#' + mapaFiltro.periodo + '#' +
      lista.map((p) => p.id + ':' + p.status + ':' + (p.endereco || '') + ':' + (p.cidade || '')).join('|');
    if (mapaUI.completo && mapaUI.sig === sig) {
      statusTxt.textContent = mapaUI.resumo;
      return;
    }
    mapaUI.completo = false;
    mapaUI.layer.clearLayers();

    // Agrupa pedidos pelo endereço (uma única consulta por endereço)
    const porEndereco = new Map();
    let semEndereco = 0;
    lista.forEach((p) => {
      const end = mapaNorm(p.endereco);
      const cid = mapaNorm(p.cidade);
      if (!end && !cid) { semEndereco++; return; }
      const key = (end + '|' + cid).toLowerCase();
      if (!porEndereco.has(key)) porEndereco.set(key, { end, cid, pedidos: [] });
      porEndereco.get(key).pedidos.push(p);
    });

    const grupos = new Map();
    const bounds = [];
    let encontrados = 0, naoEncontrados = 0, feitos = 0;
    const total = porEndereco.size;
    const montarResumo = (fim) => {
      const partes = [`📍 ${lista.length} pedido${lista.length === 1 ? '' : 's'} no filtro`];
      partes.push(`${encontrados} endereço${encontrados === 1 ? '' : 's'} no mapa`);
      if (naoEncontrados) partes.push(`${naoEncontrados} não localizado${naoEncontrados === 1 ? '' : 's'}`);
      if (semEndereco) partes.push(`${semEndereco} sem endereço`);
      if (!fim) partes.push(`⏳ localizando ${feitos}/${total}...`);
      return partes.join(' • ');
    };

    const montarPopup = (g) => el('div', { class: 'mapa-popup' },
      el('div', { class: 'mapa-popup-end' }, g.rotulo),
      g.approx ? el('div', { class: 'mapa-popup-aprox' }, '⚠ Localização aproximada (somente a cidade)') : null,
      g.pedidos.map((p) => el('div', { class: 'mapa-popup-ped' },
        el('div', {}, el('b', {}, `#${p.id} ${p.cliente || ''}`), ' ', el('span', { class: 'badge ' + p.status }, STATUS[p.status] || p.status)),
        el('div', { class: 'mapa-popup-sub' }, `${p.data || fmtData(p.criado_em)} • ${p.total > 0 ? brl(p.total) : 'sem valor'}${p.endereco ? ' • ' + p.endereco : ''}`),
        el('button', { class: 'btn sm secondary', onclick: () => guard(() => verPedido(p.id)) }, 'Ver pedido'))),
      el('a', {
        class: 'btn sm', target: '_blank', rel: 'noopener noreferrer',
        href: `https://www.google.com/maps/dir/?api=1&destination=${g.lat},${g.lng}`,
        style: 'display:inline-block;margin-top:6px',
      }, '🧭 Traçar rota'));

    const desenharGrupo = (g) => {
      const st = MAPA_PRIORIDADE.find((s) => g.pedidos.some((p) => p.status === s)) || 'novo';
      const n = g.pedidos.length;
      const icon = L.divIcon({
        className: 'mapa-pin-wrap',
        html: `<div class="mapa-pin" style="--c:${MAPA_CORES[st]}"><span>${n > 1 ? n : ''}</span></div>`,
        iconSize: [30, 30], iconAnchor: [15, 36], popupAnchor: [0, -34],
      });
      if (g.marker) mapaUI.layer.removeLayer(g.marker);
      // O conteúdo do popup só é montado quando o alfinete é clicado (mais leve)
      g.marker = L.marker([g.lat, g.lng], { icon, title: g.rotulo }).bindPopup(() => montarPopup(g), { maxWidth: 320 });
      mapaUI.layer.addLayer(g.marker);
    };
    const ajustarVista = () => {
      if (!bounds.length) return;
      if (bounds.length === 1) map.setView(bounds[0], 15, { animate: false });
      else map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16, animate: false });
    };

    statusTxt.textContent = montarResumo(false);
    for (const [key, item] of porEndereco) {
      if (run !== mapaRun) return; // outra montagem começou; o cache garante retomada rápida
      let pos = mapaDoCache(key);
      const precisouRede = pos === undefined;
      if (precisouRede) {
        try { pos = await mapaGeocodificar(item.end, item.cid, key); } catch (_) { pos = null; }
        if (run !== mapaRun) return;
      }
      feitos++;
      if (pos) {
        encontrados++;
        const ck = pos.lat.toFixed(5) + ',' + pos.lng.toFixed(5);
        let g = grupos.get(ck);
        if (!g) {
          g = { lat: pos.lat, lng: pos.lng, approx: !!pos.approx, pedidos: [], rotulo: [item.end, item.cid].filter(Boolean).join(' - ') };
          grupos.set(ck, g);
          bounds.push([g.lat, g.lng]);
        } else if (g.approx && !pos.approx) {
          g.approx = false;
        }
        g.pedidos.push(...item.pedidos);
        desenharGrupo(g);
        if (precisouRede) ajustarVista();
      } else {
        naoEncontrados++;
      }
      if (precisouRede) {
        statusTxt.textContent = montarResumo(false);
        if (feitos < total) await mapaEsperar(1100); // limite do Nominatim: 1 consulta/seg
      } else if (feitos % 25 === 0) {
        await mapaEsperar(0); // respira para não travar a tela
      }
    }
    mapaSalvarGeo(true);
    ajustarVista();
    mapaUI.resumo = total ? montarResumo(true) : '📍 Nenhum pedido com endereço neste filtro.';
    mapaUI.sig = sig;
    mapaUI.completo = true;
    statusTxt.textContent = mapaUI.resumo;
  }

  /* =================================================================
     PEDIDOS
     ================================================================= */
  const MESES_NOMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  function parsePedidoDate(p) {
    if (p.data && typeof p.data === 'string') {
      const trimmed = p.data.trim();
      if (trimmed.includes('/')) {
        const parts = trimmed.split('/');
        if (parts.length === 3) {
          const d = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10) - 1;
          const y = parseInt(parts[2], 10);
          if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
            return new Date(y, m, d, 12, 0, 0);
          }
        }
      } else if (trimmed.includes('-')) {
        const parts = trimmed.split('-');
        if (parts.length === 3) {
          if (parts[0].length === 4) {
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10) - 1;
            const d = parseInt(parts[2], 10);
            if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
              return new Date(y, m, d, 12, 0, 0);
            }
          } else {
            const d = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10) - 1;
            const y = parseInt(parts[2], 10);
            if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
              return new Date(y, m, d, 12, 0, 0);
            }
          }
        }
      }
    }
    if (p.criado_em) {
      const d = new Date(p.criado_em);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  function getWeekRange(ref = new Date()) {
    const d = new Date(ref);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diffToMon = (day === 0 ? -6 : 1) - day;
    const mon = new Date(d);
    mon.setDate(d.getDate() + diffToMon);
    mon.setHours(0, 0, 0, 0);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    sun.setHours(23, 59, 59, 999);
    return { start: mon, end: sun };
  }

  function formatarDataCurta(d) {
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function pedidoNoPeriodo(p, periodo, dataIni, dataFim) {
    if (!periodo || periodo === 'todos') return true;
    const dt = parsePedidoDate(p);
    if (!dt) return false;

    const agora = new Date();
    const dtNorm = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    const hojeNorm = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();

    if (periodo === 'hoje') {
      return dtNorm === hojeNorm;
    }

    if (periodo === 'ontem') {
      const ontem = new Date(agora);
      ontem.setDate(agora.getDate() - 1);
      const ontemNorm = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate()).getTime();
      return dtNorm === ontemNorm;
    }

    if (periodo === 'semana_atual') {
      const w = getWeekRange(agora);
      return dt >= w.start && dt <= w.end;
    }

    if (periodo === 'semana_passada') {
      const ant = new Date(agora);
      ant.setDate(agora.getDate() - 7);
      const w = getWeekRange(ant);
      return dt >= w.start && dt <= w.end;
    }

    if (periodo === '7dias') {
      const limite = new Date(agora);
      limite.setDate(agora.getDate() - 7);
      limite.setHours(0, 0, 0, 0);
      return dt >= limite && dtNorm <= hojeNorm;
    }

    if (periodo === 'mes_atual') {
      return dt.getFullYear() === agora.getFullYear() &&
        dt.getMonth() === agora.getMonth();
    }

    if (periodo === 'mes_passado') {
      const ant = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
      return dt.getFullYear() === ant.getFullYear() &&
        dt.getMonth() === ant.getMonth();
    }

    if (periodo === '30dias') {
      const limite = new Date(agora);
      limite.setDate(agora.getDate() - 30);
      limite.setHours(0, 0, 0, 0);
      return dt >= limite && dtNorm <= hojeNorm;
    }

    if (periodo === 'personalizado') {
      if (dataIni) {
        const [y, m, d] = dataIni.split('-').map(Number);
        const dtIni = new Date(y, m - 1, d, 0, 0, 0, 0);
        if (dt < dtIni) return false;
      }
      if (dataFim) {
        const [y, m, d] = dataFim.split('-').map(Number);
        const dtFim = new Date(y, m - 1, d, 23, 59, 59, 999);
        if (dt > dtFim) return false;
      }
      return true;
    }

    return true;
  }

  function gerarBotoesPaginacao(paginaAtual, totalPaginas) {
    if (totalPaginas <= 7) {
      return Array.from({ length: totalPaginas }, (_, i) => i + 1);
    }
    const pages = [];
    if (paginaAtual <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push('...');
      pages.push(totalPaginas);
    } else if (paginaAtual >= totalPaginas - 3) {
      pages.push(1);
      pages.push('...');
      for (let i = totalPaginas - 4; i <= totalPaginas; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push('...');
      pages.push(paginaAtual - 1);
      pages.push(paginaAtual);
      pages.push(paginaAtual + 1);
      pages.push('...');
      pages.push(totalPaginas);
    }
    return pages;
  }

  async function viewPedidos() {
    let pedidos = await obterPedidos(false);
    if (filtro.q) {
      if (pedidos.length >= PEDIDOS_LIMITE_API) {
        pedidos = (await client.adminListarPedidos({ q: filtro.q, resumo: false })).pedidos;
      } else {
        pedidos = pedidos.filter((p) => pedidoCasaBusca(p, filtro.q));
      }
    }
    const main = $('main');

    // Filtrar pelo período selecionado
    const pedidosNoPer = pedidos.filter((p) => pedidoNoPeriodo(p, filtro.periodo, filtro.dataInicio, filtro.dataFim));

    // Contagem de status dentro do período selecionado
    const cont = { novo: 0, em_producao: 0, entregue: 0, cancelado: 0 };
    pedidosNoPer.forEach((p) => {
      if (cont[p.status] !== undefined) cont[p.status]++;
    });
    const totalGeral = pedidosNoPer.length;

    // Filtrar pelo status clicado (se houver)
    const pedidosExibidos = pedidosNoPer.filter((p) => !filtro.status || p.status === filtro.status);

    // Totais do conjunto filtrado
    const totalRegistros = pedidosExibidos.length;
    const totalValor = pedidosExibidos.reduce((acc, p) => acc + (p.total || 0), 0);
    const totalItens = pedidosExibidos.reduce((acc, p) => acc + (p.total_itens || 0), 0);

    const agora = new Date();
    const ontemRef = new Date(agora);
    ontemRef.setDate(agora.getDate() - 1);
    const wAtual = getWeekRange(agora);
    const lastWRef = new Date(agora);
    lastWRef.setDate(agora.getDate() - 7);
    const wPassada = getWeekRange(lastWRef);
    const mesAtualNome = MESES_NOMES[agora.getMonth()] + '/' + agora.getFullYear();
    const mesPassadoDate = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
    const mesPassadoNome = MESES_NOMES[mesPassadoDate.getMonth()] + '/' + mesPassadoDate.getFullYear();

    const rotuloPeriodo = {
      todos: 'Todo o histórico',
      hoje: `Hoje (${formatarDataCurta(agora)})`,
      ontem: `Ontem (${formatarDataCurta(ontemRef)})`,
      semana_atual: `Esta Semana (${formatarDataCurta(wAtual.start)} a ${formatarDataCurta(wAtual.end)})`,
      semana_passada: `Semana Passada (${formatarDataCurta(wPassada.start)} a ${formatarDataCurta(wPassada.end)})`,
      '7dias': 'Últimos 7 dias',
      mes_atual: `Este Mês (${mesAtualNome})`,
      mes_passado: `Mês Passado (${mesPassadoNome})`,
      '30dias': 'Últimos 30 dias',
      personalizado: (filtro.dataInicio || filtro.dataFim) ? `Personalizado (${filtro.dataInicio || '...'} a ${filtro.dataFim || '...'})` : 'Personalizado',
    }[filtro.periodo] || 'Período';

    // Paginação e controle de limite de registros
    const limite = parseInt(paginacaoPedidos.limite, 10) || 0;
    let totalPaginas = 1;
    let paginaAtual = 1;
    let inicioIdx = 0;
    let fimIdx = totalRegistros;
    let pedidosPaginados = pedidosExibidos;

    if (limite > 0) {
      totalPaginas = Math.max(1, Math.ceil(totalRegistros / limite));
      if (paginacaoPedidos.pagina > totalPaginas) paginacaoPedidos.pagina = totalPaginas;
      if (paginacaoPedidos.pagina < 1) paginacaoPedidos.pagina = 1;
      paginaAtual = paginacaoPedidos.pagina;
      inicioIdx = (paginaAtual - 1) * limite;
      fimIdx = Math.min(inicioIdx + limite, totalRegistros);
      pedidosPaginados = pedidosExibidos.slice(inicioIdx, fimIdx);
    }

    const totalValorPagina = pedidosPaginados.reduce((acc, p) => acc + (p.total || 0), 0);
    const totalItensPagina = pedidosPaginados.reduce((acc, p) => acc + (p.total_itens || 0), 0);

    const stat = (key, label, n) =>
      el('div', { class: 'stat' + (filtro.status === key ? ' active' : ''), onclick: () => { filtro.status = (filtro.status === key ? '' : key); paginacaoPedidos.pagina = 1; viewPedidos(); } },
        el('b', {}, String(n)), el('span', {}, label));

    const cardValor = el('div', { class: 'stat stat-valor', title: 'Valor total dos pedidos deste filtro' },
      el('b', { style: 'font-size:24px;color:#15803d;white-space:nowrap' }, brl(totalValor)),
      el('span', { style: 'color:#166534;font-weight:700' }, `💰 Total Filtrado (${pedidosExibidos.length} ped. • ${totalItens} un.)`),
      (limite > 0 && totalPaginas > 1)
        ? el('div', { style: 'font-size:12px;color:#15803d;margin-top:4px;font-weight:600' },
            `Nesta página (${pedidosPaginados.length} ped.): ${brl(totalValorPagina)}`)
        : null
    );

    const busca = el('input', { type: 'search', placeholder: 'Buscar cliente, cidade, cód. ou nº', value: filtro.q });
    let debounceBusca = null;
    busca.addEventListener('input', () => {
      clearTimeout(debounceBusca);
      debounceBusca = setTimeout(() => {
        filtro.q = busca.value.trim();
        paginacaoPedidos.pagina = 1;
        refocarBusca = true;
        viewPedidos();
      }, 250);
    });
    busca.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(debounceBusca);
        filtro.q = busca.value.trim();
        paginacaoPedidos.pagina = 1;
        viewPedidos();
      }
    });

    const pill = (key, label) =>
      el('button', {
        type: 'button',
        class: 'btn-pill' + (filtro.periodo === key ? ' active' : ''),
        onclick: () => { filtro.periodo = key; paginacaoPedidos.pagina = 1; viewPedidos(); }
      }, label);

    const selectPeriodo = el('select', {
      class: 'periodo-select',
      style: 'border:1.5px solid #bbb;border-radius:8px;padding:7px 10px;font-size:13.5px;background:#fff;font-weight:600;cursor:pointer',
      onchange: (e) => { filtro.periodo = e.target.value; paginacaoPedidos.pagina = 1; viewPedidos(); }
    },
      el('option', { value: 'todos', selected: filtro.periodo === 'todos' }, '📅 Todo o histórico'),
      el('option', { value: 'hoje', selected: filtro.periodo === 'hoje' }, `📅 Hoje (${formatarDataCurta(agora)})`),
      el('option', { value: 'ontem', selected: filtro.periodo === 'ontem' }, `📅 Ontem (${formatarDataCurta(ontemRef)})`),
      el('option', { value: 'semana_atual', selected: filtro.periodo === 'semana_atual' }, `📅 Esta Semana (${formatarDataCurta(wAtual.start)} a ${formatarDataCurta(wAtual.end)})`),
      el('option', { value: 'semana_passada', selected: filtro.periodo === 'semana_passada' }, `📅 Semana Passada (${formatarDataCurta(wPassada.start)} a ${formatarDataCurta(wPassada.end)})`),
      el('option', { value: '7dias', selected: filtro.periodo === '7dias' }, '📅 Últimos 7 dias'),
      el('option', { value: 'mes_atual', selected: filtro.periodo === 'mes_atual' }, `📅 Este Mês (${mesAtualNome})`),
      el('option', { value: 'mes_passado', selected: filtro.periodo === 'mes_passado' }, `📅 Mês Passado (${mesPassadoNome})`),
      el('option', { value: '30dias', selected: filtro.periodo === '30dias' }, '📅 Últimos 30 dias'),
      el('option', { value: 'personalizado', selected: filtro.periodo === 'personalizado' }, '📅 Escolher datas...')
    );

    const inputDataIni = el('input', {
      type: 'date',
      value: filtro.dataInicio,
      title: 'Data inicial',
      style: 'border:1.5px solid #bbb;border-radius:8px;padding:6px 8px;font-size:13px;background:#fff',
      onchange: (e) => { filtro.dataInicio = e.target.value; paginacaoPedidos.pagina = 1; viewPedidos(); }
    });
    const inputDataFim = el('input', {
      type: 'date',
      value: filtro.dataFim,
      title: 'Data final',
      style: 'border:1.5px solid #bbb;border-radius:8px;padding:6px 8px;font-size:13px;background:#fff',
      onchange: (e) => { filtro.dataFim = e.target.value; paginacaoPedidos.pagina = 1; viewPedidos(); }
    });

    const btnLimpar = (filtro.periodo !== 'todos' || filtro.status || filtro.q || filtro.dataInicio || filtro.dataFim)
      ? el('button', {
        type: 'button',
        class: 'btn sm secondary',
        title: 'Limpar filtros',
        onclick: () => {
          filtro = { status: '', q: '', periodo: 'todos', dataInicio: '', dataFim: '' };
          paginacaoPedidos.pagina = 1;
          viewPedidos();
        }
      }, '✕ Limpar')
      : null;

    function criarSelectLimite(sufixo = '') {
      return el('select', {
        class: 'paginacao-select',
        id: 'select-limite' + sufixo,
        title: 'Quantidade de registros por página',
        onchange: (e) => {
          paginacaoPedidos.limite = parseInt(e.target.value, 10);
          paginacaoPedidos.pagina = 1;
          viewPedidos();
        }
      },
        el('option', { value: '10', selected: paginacaoPedidos.limite === 10 }, '10 por pág.'),
        el('option', { value: '20', selected: paginacaoPedidos.limite === 20 }, '20 por pág.'),
        el('option', { value: '30', selected: paginacaoPedidos.limite === 30 }, '30 por pág.'),
        el('option', { value: '50', selected: paginacaoPedidos.limite === 50 }, '50 por pág.'),
        el('option', { value: '100', selected: paginacaoPedidos.limite === 100 }, '100 por pág.'),
        el('option', { value: '0', selected: paginacaoPedidos.limite === 0 }, 'Todos')
      );
    }

    function irParaPagina(p) {
      if (p < 1 || p > totalPaginas || p === paginacaoPedidos.pagina) return;
      paginacaoPedidos.pagina = p;
      viewPedidos();
      const tbl = document.querySelector('.table-wrap');
      if (tbl) {
        const y = tbl.getBoundingClientRect().top + window.pageYOffset - 80;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }
    }

    let barraPaginacao = null;
    if (totalRegistros > 0) {
      const textoInfo = limite > 0
        ? `Mostrando ${inicioIdx + 1}–${fimIdx} de ${totalRegistros} pedido${totalRegistros === 1 ? '' : 's'}${totalPaginas > 1 ? ` (Página ${paginaAtual} de ${totalPaginas})` : ''}`
        : `Mostrando todos os ${totalRegistros} pedidos`;

      const listaNav = [];
      if (totalPaginas > 1) {
        listaNav.push(
          el('button', {
            type: 'button',
            class: 'btn-pag',
            title: 'Primeira página',
            disabled: paginaAtual <= 1,
            onclick: () => irParaPagina(1)
          }, '«'),
          el('button', {
            type: 'button',
            class: 'btn-pag',
            title: 'Página anterior',
            disabled: paginaAtual <= 1,
            onclick: () => irParaPagina(paginaAtual - 1)
          }, '‹ Anterior')
        );

        const pages = gerarBotoesPaginacao(paginaAtual, totalPaginas);
        pages.forEach((p) => {
          if (p === '...') {
            listaNav.push(el('span', { class: 'btn-pag ellipsis' }, '…'));
          } else {
            listaNav.push(
              el('button', {
                type: 'button',
                class: 'btn-pag' + (p === paginaAtual ? ' active' : ''),
                title: `Página ${p}`,
                onclick: () => irParaPagina(p)
              }, String(p))
            );
          }
        });

        listaNav.push(
          el('button', {
            type: 'button',
            class: 'btn-pag',
            title: 'Próxima página',
            disabled: paginaAtual >= totalPaginas,
            onclick: () => irParaPagina(paginaAtual + 1)
          }, 'Próxima ›'),
          el('button', {
            type: 'button',
            class: 'btn-pag',
            title: 'Última página',
            disabled: paginaAtual >= totalPaginas,
            onclick: () => irParaPagina(totalPaginas)
          }, '»')
        );
      }

      barraPaginacao = el('div', { class: 'paginacao-bar' },
        el('div', { class: 'paginacao-info' }, el('b', {}, textoInfo)),
        totalPaginas > 1 ? el('div', { class: 'paginacao-nav' }, ...listaNav) : null,
        el('div', { class: 'paginacao-limite' },
          el('span', {}, 'Limite:'),
          criarSelectLimite('-bottom')
        )
      );
    }

    main.replaceChildren(
      el('div', { class: 'cards' },
        stat('', 'Todos', totalGeral),
        ...Object.entries(STATUS).map(([k, v]) => stat(k, v, cont[k] || 0)),
        cardValor
      ),
      el('div', { class: 'toolbar' },
        busca,
        el('button', { class: 'btn secondary', onclick: () => { filtro.q = busca.value.trim(); paginacaoPedidos.pagina = 1; viewPedidos(); } }, 'Buscar'),
        el('button', { class: 'btn secondary', title: 'Buscar pedidos novos no banco', onclick: () => { invalidarPedidosCache(); viewPedidos(); } }, '🔄 Atualizar'),
        el('div', { class: 'periodo-pills' },
          pill('todos', 'Todos'),
          pill('hoje', 'Hoje'),
          pill('ontem', 'Ontem'),
          pill('semana_atual', 'Esta Semana'),
          pill('semana_passada', 'Semana Passada'),
          pill('mes_atual', 'Este Mês'),
          pill('mes_passado', 'Mês Passado'),
          selectPeriodo,
          filtro.periodo === 'personalizado' ? el('div', { style: 'display:inline-flex;gap:4px;align-items:center' }, el('span', { style: 'font-size:12px' }, 'De:'), inputDataIni, el('span', { style: 'font-size:12px' }, 'Até:'), inputDataFim) : null
        ),
        btnLimpar,
        el('span', { class: 'grow' }),
        el('div', { class: 'toolbar-limite', style: 'display:inline-flex;align-items:center;gap:6px' },
          el('span', { style: 'font-size:13px;font-weight:600;color:#555;white-space:nowrap' }, 'Limite:'),
          criarSelectLimite('-top')
        ),
        el('button', { class: 'btn', onclick: () => guard(() => formPedido()) }, '+ Novo pedido')
      ),
      pedidosExibidos.length
        ? el('div', {},
            el('div', { class: 'table-wrap' }, el('table', {},
              el('thead', {}, el('tr', {}, ...['Nº', 'Cliente', 'Cidade', 'Data', 'Itens', 'Total', 'Status', ''].map((h) => el('th', {}, h)))),
              el('tbody', {}, pedidosPaginados.map((p) =>
                el('tr', {},
                  el('td', {}, '#' + p.id),
                  el('td', {}, el('b', {}, p.cliente), p.cod ? el('div', { style: 'font-size:12px;color:#888' }, 'Cód. ' + p.cod) : null),
                  el('td', {}, p.cidade),
                  el('td', {}, p.data || fmtData(p.criado_em)),
                  el('td', {}, String(p.total_itens)),
                  el('td', {}, p.total > 0 ? brl(p.total) : '—'),
                  el('td', {}, el('span', { class: 'badge ' + p.status }, STATUS[p.status])),
                  el('td', { class: 'actions' },
                    el('button', { class: 'btn sm secondary', onclick: () => guard(() => verPedido(p.id)) }, 'Ver'),
                    el('button', { class: 'btn sm secondary', title: 'Imprimir cupom fiscal do pedido', onclick: () => guard(() => imprimirCupom(p.id)) }, '🖨 Imprimir'),
                    el('button', { class: 'btn sm secondary', onclick: () => guard(() => formPedido(p.id)) }, 'Editar'),
                    el('button', { class: 'btn sm danger', onclick: () => excluirPedido(p) }, 'Excluir'))))),
              el('tfoot', {},
                (limite > 0 && totalPaginas > 1)
                  ? [
                      el('tr', { class: 'table-footer-row', style: 'background:#f1f5f9' },
                        el('td', { colspan: '4', style: 'padding:10px 14px;font-weight:700;color:#475569' },
                          `Subtotal desta página (Mostrando ${inicioIdx + 1} a ${fimIdx}): ${pedidosPaginados.length} pedidos`),
                        el('td', { style: 'padding:10px 14px;font-weight:700;color:#475569' }, `${totalItensPagina} un.`),
                        el('td', { style: 'padding:10px 14px;font-weight:700;color:#15803d;font-size:15px' }, brl(totalValorPagina)),
                        el('td', { colspan: '2' }, '')),
                      el('tr', { class: 'table-footer-row' },
                        el('td', { colspan: '4', style: 'padding:12px 14px;font-weight:800' },
                          `Total Geral Filtrado (${rotuloPeriodo}${filtro.status ? ' • ' + STATUS[filtro.status] : ''}): ${totalRegistros} pedido${totalRegistros === 1 ? '' : 's'}`),
                        el('td', { style: 'padding:12px 14px;font-weight:800' }, `${totalItens} un.`),
                        el('td', { style: 'padding:12px 14px;font-weight:900;color:#15803d;font-size:17px' }, brl(totalValor)),
                        el('td', { colspan: '2' }, ''))
                    ]
                  : el('tr', { class: 'table-footer-row' },
                      el('td', { colspan: '4', style: 'padding:12px 14px;font-weight:800' },
                        `Total Filtrado (${rotuloPeriodo}${filtro.status ? ' • ' + STATUS[filtro.status] : ''}): ${totalRegistros} pedido${totalRegistros === 1 ? '' : 's'}`),
                      el('td', { style: 'padding:12px 14px;font-weight:800' }, `${totalItens} un.`),
                      el('td', { style: 'padding:12px 14px;font-weight:900;color:#15803d;font-size:17px' }, brl(totalValor)),
                      el('td', { colspan: '2' }, ''))
              )
            )),
            barraPaginacao
          )
        : el('div', { class: 'table-wrap' },
          el('div', { class: 'empty', style: 'padding:32px 16px;text-align:center' },
            el('p', { style: 'font-size:16px;margin-bottom:12px;color:#666' }, `Nenhum pedido encontrado em "${rotuloPeriodo}".`),
            el('button', { class: 'btn sm secondary', onclick: () => { filtro = { status: '', q: '', periodo: 'todos', dataInicio: '', dataFim: '' }; paginacaoPedidos.pagina = 1; viewPedidos(); } }, 'Ver todos os pedidos')))
    );
    if (refocarBusca) {
      refocarBusca = false;
      busca.focus();
      const n = busca.value.length;
      try { busca.setSelectionRange(n, n); } catch (_) { }
    }
  }

  function excluirPedido(p) {
    pedirSenha({
      titulo: `Excluir pedido #${p.id}?`,
      mensagem: `O pedido de ${p.cliente} será removido permanentemente.`,
      executar: async (senha) => {
        await client.excluirPedido(p.id, senha);
        toast('Pedido excluído');
        closeModal();
        invalidarPedidosCache();
        carregar();
      },
    });
  }

  async function mudarStatus(id, status) {
    await guard(async () => {
      await client.adminAtualizarStatus(id, status);
      toast('Status atualizado');
      verPedido(id);
      invalidarPedidosCache();
      carregar();
    });
  }

  function gerarHtmlCupom(p, cfg) {
    const escapeHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const nomeEmpresa = (cfg && cfg.nome_empresa) ? cfg.nome_empresa : 'EISBERG';
    const foneEmpresa = (cfg && cfg.telefone_empresa) ? cfg.telefone_empresa : '(51) 989634089';
    const statusTxt = (STATUS[p.status] || p.status || 'Novo').toUpperCase();

    // Data e hora
    let dataTxt = p.data || '';
    let horaTxt = '';
    if (p.criado_em) {
      try {
        const d = new Date(p.criado_em);
        if (!dataTxt) dataTxt = d.toLocaleDateString('pt-BR');
        horaTxt = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      } catch (_) { }
    }
    if (!dataTxt) dataTxt = new Date().toLocaleDateString('pt-BR');
    if (!horaTxt) horaTxt = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // Filtrar apenas itens com quantidade > 0
    const itens = (p.itens || p.pedido_itens || []).filter((it) => Number(it.quantidade) > 0);

    let totalQtd = 0;
    let totalValor = 0;
    const itensHtml = itens.map((it, idx) => {
      const isMetade = (Number(it.quantidade) === 0.5);
      const qtdNum = Number(it.quantidade) || 0;
      totalQtd += qtdNum;
      const qtdTxt = isMetade ? '1/2' : String(it.quantidade);
      const precoUnit = Number(it.preco) || 0;
      const subtotal = qtdNum * precoUnit;
      totalValor += subtotal;

      const desc = escapeHtml(it.produto || 'Item') + (isMetade ? ' (½)' : '');
      const showCat = it.categoria && (it.categoria.trim().toLowerCase() !== (it.produto || '').trim().toLowerCase());
      const cat = showCat ? `<div class="sub-cat">${escapeHtml(it.categoria)}</div>` : '';
      const un = escapeHtml(it.unidade || 'UND');
      const unitTxt = precoUnit > 0 ? brl(precoUnit) : '—';
      const totTxt = precoUnit > 0 ? brl(subtotal) : '—';

      return `
        <tr>
          <td class="col-item">${idx + 1}</td>
          <td class="col-qtd bold">${qtdTxt}</td>
          <td class="col-un">${un}</td>
          <td class="col-desc bold">${desc}${cat}</td>
          <td class="col-unit right">${unitTxt}</td>
          <td class="col-tot right bold">${totTxt}</td>
        </tr>`;
    }).join('');

    if (p.total > 0) totalValor = p.total;

    const totalQtdTxt = (totalQtd % 1 === 0.5)
      ? (Math.floor(totalQtd) > 0 ? `${Math.floor(totalQtd)} e ½` : '1/2')
      : String(totalQtd);

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Cupom Pedido #${p.id} - ${escapeHtml(nomeEmpresa)}</title>
  <style>
    @page {
      size: auto;
      margin: 1.5cm 0;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html, body {
      background: #fff;
      color: #000;
      margin: 0;
      padding: 0;
      width: 100%;
    }
    body {
      font-family: 'Courier New', Courier, 'Lucida Console', monospace;
      font-size: 12px;
      line-height: 1.35;
      color: #000;
      background: #fff;
      box-sizing: border-box;
    }
    .cupom-folha {
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
      margin: 0 auto;
      padding: 0.8cm 3cm;
    }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: bold; }
    .empresa-nome {
      font-size: 19px;
      font-weight: 900;
      letter-spacing: 1px;
      text-transform: uppercase;
      text-align: center;
      margin-bottom: 3px;
    }
    .empresa-sub {
      font-size: 11px;
      text-align: center;
      color: #222;
      margin-bottom: 2px;
    }
    .empresa-contato {
      font-size: 12px;
      font-weight: bold;
      text-align: center;
    }
    .linha-traco {
      border-top: 1px dashed #000;
      margin: 8px 0;
    }
    .linha-dupla {
      border-top: 2px dashed #000;
      margin: 8px 0;
    }
    .doc-titulo {
      font-size: 13px;
      font-weight: 900;
      text-align: center;
      letter-spacing: 0.5px;
    }
    .doc-sub {
      font-size: 9.5px;
      text-align: center;
      color: #333;
    }
    .linha-info {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 11.5px;
      margin-bottom: 3px;
    }
    .secao-titulo {
      font-size: 11.5px;
      font-weight: 900;
      margin-bottom: 4px;
      text-transform: uppercase;
    }
    .tabela-itens {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      margin: 6px 0;
    }
    .tabela-itens th {
      border-bottom: 1px dashed #000;
      padding: 4px 2px;
      font-size: 10.5px;
      font-weight: bold;
      text-align: left;
    }
    .tabela-itens td {
      padding: 4px 2px;
      vertical-align: top;
    }
    .col-item { width: 6%; font-size: 10px; }
    .col-qtd { width: 14%; text-align: center; }
    .col-un { width: 14%; text-align: center; font-size: 10px; }
    .col-desc { width: 38%; word-break: break-word; }
    .sub-cat { font-size: 9px; color: #444; font-weight: normal; }
    .col-unit { width: 14%; font-size: 10px; white-space: nowrap; }
    .col-tot { width: 14%; white-space: nowrap; }
    .linha-total {
      display: flex;
      justify-content: space-between;
      font-size: 11.5px;
      margin-bottom: 3px;
    }
    .linha-total-destaque {
      display: flex;
      justify-content: space-between;
      font-size: 16px;
      font-weight: 900;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid #000;
    }
    .obs-bloco {
      font-size: 11px;
      line-height: 1.35;
      padding: 3px 0;
    }
    .canhoto {
      font-size: 10.5px;
      margin-top: 12px;
      line-height: 1.6;
    }
    .rodape {
      text-align: center;
      font-size: 11px;
      font-weight: bold;
      margin-top: 8px;
    }
    @media print {
      @page {
        size: auto;
        margin: 1cm 0;
      }
      body {
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        background: #fff !important;
      }
      .cupom-folha {
        box-sizing: border-box !important;
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 auto !important;
        padding-left: 3cm !important;
        padding-right: 3cm !important;
        padding-top: 0.5cm !important;
        padding-bottom: 1.5cm !important;
      }
    }
  </style>
</head>
<body>
  <div class="cupom-folha">
    <div class="empresa-nome">${escapeHtml(nomeEmpresa)}</div>
    <div class="empresa-sub">Sorvetes, Picolés e Congelados</div>
    <div class="empresa-contato">Tel/WhatsApp: ${escapeHtml(foneEmpresa)}</div>
    
    <div class="linha-dupla"></div>
    <div class="doc-titulo">COMPROVANTE DE PEDIDO</div>
    <div class="doc-sub">DOCUMENTO NÃO FISCAL</div>
    <div class="linha-traco"></div>

    <div class="linha-info">
      <span><b>PEDIDO:</b> #${p.id}</span>
      <span><b>CÓD:</b> ${escapeHtml(p.cod || p.id)}</span>
    </div>
    <div class="linha-info">
      <span><b>DATA:</b> ${escapeHtml(dataTxt)}</span>
      <span><b>HORA:</b> ${escapeHtml(horaTxt)}</span>
    </div>
    <div class="linha-info">
      <span><b>STATUS:</b> ${escapeHtml(statusTxt)}</span>
    </div>

    <div class="linha-traco"></div>
    <div class="secao-titulo">DADOS DO CLIENTE</div>
    <div style="margin-bottom:2px"><b>CLIENTE:</b> ${escapeHtml(p.cliente || '—')}</div>
    <div style="margin-bottom:2px"><b>ENDEREÇO:</b> ${escapeHtml(p.endereco || '—')}</div>
    <div><b>CIDADE:</b> ${escapeHtml(p.cidade || '—')}</div>

    <div class="linha-traco"></div>
    <div class="secao-titulo">ITENS DO PEDIDO</div>
    <table class="tabela-itens">
      <thead>
        <tr>
          <th class="col-item">#</th>
          <th class="col-qtd">QTD</th>
          <th class="col-un">UN</th>
          <th class="col-desc">DESCRIÇÃO</th>
          <th class="col-unit right">UNIT</th>
          <th class="col-tot right">TOTAL</th>
        </tr>
      </thead>
      <tbody>
        ${itensHtml || '<tr><td colspan="6" class="center">Nenhum item</td></tr>'}
      </tbody>
    </table>

    <div class="linha-traco"></div>
    <div class="linha-total">
      <span>QTD TOTAL DE ITENS:</span>
      <span class="bold">${totalQtdTxt} (${itens.length} prod.)</span>
    </div>
    <div class="linha-total-destaque">
      <span>TOTAL DO PEDIDO:</span>
      <span>${brl(totalValor)}</span>
    </div>

    ${p.observacoes ? `
      <div class="linha-traco"></div>
      <div class="secao-titulo">OBSERVAÇÕES</div>
      <div class="obs-bloco">${escapeHtml(p.observacoes)}</div>
    ` : ''}

    <div class="linha-traco"></div>
    <div class="canhoto">
      <div>RECEBIDO EM: _____/_____/_________</div>
      <div style="margin-top:14px">ASSINATURA: ____________________________________</div>
    </div>

    <div class="linha-dupla"></div>
    <div class="rodape">Obrigado pela preferência!</div>
  </div>
</body>
</html>`;
  }

  async function imprimirCupom(pedidoOuId) {
    let p = pedidoOuId;
    if (typeof p === 'number' || typeof p === 'string' || !p.itens || !p.itens.length || !p.itens[0].produto) {
      const pid = (typeof p === 'object' && p.id) ? p.id : p;
      p = await client.adminGetPedido(pid);
    }
    let cfg = {};
    try {
      cfg = await client.getConfig();
    } catch (_) { }

    const html = gerarHtmlCupom(p, cfg);

    let iframe = document.getElementById('cupom-print-frame');
    if (iframe) {
      try { iframe.remove(); } catch (_) { }
    }
    iframe = document.createElement('iframe');
    iframe.id = 'cupom-print-frame';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    const doPrint = () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        console.warn('Iframe print falhou, tentando janela direta:', e);
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(html);
          w.document.close();
          w.focus();
          w.print();
        }
      }
      setTimeout(() => {
        try { if (iframe && iframe.parentNode) iframe.remove(); } catch (_) { }
      }, 3500);
    };

    if (iframe.contentWindow.document.readyState === 'complete') {
      setTimeout(doPrint, 150);
    } else {
      iframe.onload = () => setTimeout(doPrint, 150);
    }
  }

  async function verPedido(id) {
    const p = await client.adminGetPedido(id);
    const info = (l, v) => (v ? el('div', {}, el('b', {}, l + ': '), v) : null);
    const porCat = [];
    p.itens.forEach((it) => {
      let g = porCat.find((x) => x.nome === it.categoria);
      if (!g) porCat.push((g = { nome: it.categoria, itens: [] }));
      g.itens.push(it);
    });
    const sel = el('select', { onchange: (e) => mudarStatus(p.id, e.target.value) },
      Object.entries(STATUS).map(([k, v]) => el('option', { value: k, selected: k === p.status }, v)));

    const enderecoBusca = [p.endereco, p.cidade].filter(Boolean).join(', ');
    const mapsBtn = enderecoBusca
      ? el('a', {
        href: `https://maps.google.com/?q=${encodeURIComponent(enderecoBusca)}`,
        target: '_blank',
        rel: 'noopener noreferrer',
        class: 'btn sm secondary no-print',
        style: 'display:inline-flex;align-items:center;gap:4px;margin-top:6px;font-size:13px'
      }, '📍 Abrir no Google Maps (PIN / Traçar Rota)')
      : null;

    openModal('Pedido #' + p.id, el('div', {},
      el('div', { style: 'margin-bottom:10px;line-height:1.6' },
        info('Cliente', p.cliente), info('Endereço', p.endereco), info('Cidade', p.cidade),
        mapsBtn ? el('div', {}, mapsBtn) : null,
        info('Cód.', p.cod), info('Data', p.data), info('Recebido em', fmtData(p.criado_em)),
        el('div', {}, el('b', {}, 'Status: '), el('span', { class: 'badge ' + p.status }, STATUS[p.status]))),
      el('div', { class: 'table-wrap' }, el('table', { class: 'items-list' },
        el('tbody', {}, porCat.flatMap((g) => [
          el('tr', { class: 'group-row' }, el('td', { colspan: '3' }, g.nome)),
          ...g.itens.map((it) => {
            const isMetade = (Number(it.quantidade) === 0.5);
            const qtdTxt = isMetade ? '1/2' : String(it.quantidade);
            const subtotal = Number(it.quantidade) * (it.preco > 0 ? it.preco : 0);
            return el('tr', {},
              el('td', {}, it.produto + (isMetade ? ' (½ valor)' : '')),
              el('td', { style: 'text-align:right;white-space:nowrap' }, `${qtdTxt} ${it.unidade}`),
              el('td', { style: 'text-align:right;white-space:nowrap' }, it.preco > 0 ? `${brl(it.preco)}${Number(it.quantidade) !== 1 ? ' = ' + brl(subtotal) : ''}` : '')
            );
          }),
        ])))),
      p.total > 0 ? el('p', { style: 'text-align:right;font-size:18px' }, el('b', {}, 'Total: ' + brl(p.total))) : null,
      p.observacoes ? el('p', {}, el('b', {}, 'Observações: '), p.observacoes) : null,
      el('div', { class: 'actions no-print' },
        el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:700' }, 'Status:', sel),
        el('button', { class: 'btn', onclick: () => guard(() => imprimirCupom(p)) }, '🖨 Imprimir Cupom'),
        el('button', { class: 'btn secondary', onclick: () => guard(() => formPedido(p.id)) }, 'Editar'),
        el('button', { class: 'btn danger', onclick: () => excluirPedido(p) }, 'Excluir'))));
  }

  async function formPedido(id) {
    const [catalogo, p] = await Promise.all([
      client.getCatalogo(),
      id ? client.adminGetPedido(id) : Promise.resolve({ cliente: '', endereco: '', cidade: '', cod: '', data: '', observacoes: '', status: 'novo', itens: [] }),
    ]);
    const qtd = new Map();
    p.itens.forEach((it) => { if (it.produto_id) qtd.set(it.produto_id, (qtd.get(it.produto_id) || 0) + it.quantidade); });

    const f = {
      cliente: el('input', { value: p.cliente, maxlength: '120', required: '', placeholder: 'Nome completo' }),
      endereco: el('input', { value: p.endereco, maxlength: '200', required: '', placeholder: 'Rua, número, bairro' }),
      cidade: el('input', { value: p.cidade, maxlength: '80', required: '', placeholder: 'Cidade' }),
      cod: el('input', { value: p.cod || (id ? String(id) : 'Automático'), readonly: '', style: 'background:#f4f4f4;color:#555;font-weight:700;cursor:default;' }),
      data: el('input', { value: p.data || new Date().toLocaleDateString('pt-BR'), maxlength: '20' }),
      status: el('select', {}, Object.entries(STATUS).map(([k, v]) => el('option', { value: k, selected: k === p.status }, v))),
      observacoes: el('textarea', { rows: '4', maxlength: '2000' }),
    };
    f.observacoes.value = p.observacoes;

    const inputs = new Map();
    const totalEl = el('b', { id: 'pedido-total' }, brl(0));
    const precos = new Map();

    const parseAdminQty = (val) => {
      const s = String(val || '').trim().toLowerCase().replace(',', '.');
      if (s === '1/2' || s === '½' || s === '0.5' || s === '.5') return 0.5;
      const n = parseFloat(s);
      return (isNaN(n) || n <= 0) ? 0 : (Math.abs(n - 0.5) < 0.01 ? 0.5 : Math.min(9999, Math.trunc(n)));
    };

    const recalcular = () => {
      let t = 0;
      inputs.forEach((i, pid) => { t += parseAdminQty(i.value) * (precos.get(pid) || 0); });
      totalEl.textContent = brl(t);
    };

    const lista = catalogo.map((c) => el('div', { class: 'edit-cat' },
      el('h4', {}, `${c.nome} ${c.unidade ? '(' + c.unidade + ')' : ''}${c.ativo ? '' : ' - inativa'}`),
      c.produtos.map((pr) => {
        const qVal = qtd.get(pr.id);
        const inp = el('input', {
          type: 'text',
          value: (Number(qVal) === 0.5) ? '1/2' : String(qVal || 0),
          style: 'width:70px;padding:4px;border:1px solid #bbb;border-radius:6px;text-align:center;font-weight:700'
        });
        inp.addEventListener('input', recalcular);
        inputs.set(pr.id, inp);
        precos.set(pr.id, pr.preco);
        return el('div', { class: 'item' }, el('span', {}, pr.nome + (pr.ativo ? '' : ' (inativo)') + (pr.preco > 0 ? ' - ' + brl(pr.preco) : '')), inp);
      })));
    recalcular();

    const salvar = () => guard(async () => {
      const body = {
        cliente: f.cliente.value, endereco: f.endereco.value, cidade: f.cidade.value, cod: f.cod.value,
        data: f.data.value, observacoes: f.observacoes.value, status: f.status.value,
        itens: [...inputs].map(([produto_id, i]) => ({ produto_id, quantidade: parseAdminQty(i.value) })).filter(x => x.quantidade > 0),
      };
      await client.adminSalvarPedido(id || null, body);
      toast('Pedido salvo');
      closeModal();
      invalidarPedidosCache();
      carregar();
    });

    openModal(id ? 'Editar pedido #' + id : 'Novo pedido', el('div', {},
      el('div', { class: 'form-grid' },
        el('div', { class: 'span2' }, group('Cliente', f.cliente)),
        el('div', { class: 'span2' }, group('Endereço', f.endereco)),
        group('Cidade', f.cidade), group('Cód.', f.cod), group('Data', f.data), group('Status', f.status)),
      el('h3', {}, 'Itens'), lista,
      group('Observações', f.observacoes),
      el('div', { class: 'actions order-actions no-print' },
        el('button', { class: 'btn', onclick: salvar }, 'Salvar'),
        id ? el('button', { class: 'btn secondary', onclick: () => guard(() => imprimirCupom(id)) }, '🖨 Imprimir Cupom') : null,
        el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancelar'),
        el('div', { class: 'total-box' }, el('span', {}, 'Total'), totalEl))), true);
  }

  /* =================================================================
     CATEGORIAS
     ================================================================= */
  async function viewCategorias() {
    const cats = await client.getCatalogo();
    $('main').replaceChildren(
      el('div', { class: 'toolbar' }, el('span', { class: 'grow' }),
        el('button', { class: 'btn', onclick: () => formCategoria() }, '+ Nova categoria')),
      cats.length
        ? el('div', { class: 'table-wrap' }, el('table', {},
          el('thead', {}, el('tr', {}, ...['Nome', 'Unidade', 'Coluna', 'Ordem', 'Produtos', 'Ativa', ''].map((h) => el('th', {}, h)))),
          el('tbody', {}, cats.map((c) => el('tr', {},
            el('td', {}, el('b', {}, c.nome)),
            el('td', {}, c.unidade || '—'),
            el('td', {}, c.coluna === 2 ? 'Direita' : 'Esquerda'),
            el('td', {}, String(c.ordem)),
            el('td', {}, String(c.produtos.length)),
            el('td', {}, el('span', { class: 'badge ' + (c.ativo ? 'on' : 'off') }, c.ativo ? 'Sim' : 'Não')),
            el('td', { class: 'actions' },
              el('button', { class: 'btn sm secondary', onclick: () => formCategoria(c) }, 'Editar'),
              el('button', { class: 'btn sm danger', onclick: () => excluirCategoria(c) }, 'Excluir')))))))
        : el('div', { class: 'table-wrap' }, el('div', { class: 'empty' }, 'Nenhuma categoria cadastrada.')));
  }

  function formCategoria(c) {
    const f = {
      nome: el('input', { value: c ? c.nome : '', maxlength: '80', required: '' }),
      unidade: el('input', { value: c ? c.unidade : '', maxlength: '10', placeholder: 'UND, CX. ou vazio' }),
      coluna: el('select', {}, el('option', { value: '1', selected: !c || c.coluna !== 2 }, 'Esquerda'), el('option', { value: '2', selected: c && c.coluna === 2 }, 'Direita')),
      ordem: el('input', { type: 'number', value: String(c ? c.ordem : 0) }),
      ativo: el('input', { type: 'checkbox', checked: c ? !!c.ativo : true }),
    };
    const salvar = () => guard(async () => {
      const body = { nome: f.nome.value, unidade: f.unidade.value, coluna: Number(f.coluna.value), ordem: Number(f.ordem.value), ativo: f.ativo.checked };
      if (c) {
        await client.adminAtualizarCategoria(c.id, body);
      } else {
        await client.adminCriarCategoria(body);
      }
      toast('Categoria salva');
      closeModal();
      viewCategorias();
    });
    openModal(c ? 'Editar categoria' : 'Nova categoria', el('div', {},
      group('Nome', f.nome), group('Unidade', f.unidade), group('Coluna no app', f.coluna), group('Ordem', f.ordem),
      el('label', { class: 'check' }, f.ativo, 'Ativa (visível no app)'),
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: salvar }, 'Salvar'),
        el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancelar'))));
  }

  function excluirCategoria(c) {
    pedirSenha({
      titulo: 'Excluir categoria?',
      mensagem: `"${c.nome}" e seus ${c.produtos.length} produto(s) serão removidos. Pedidos antigos são preservados.`,
      executar: async (senha) => {
        await client.excluirCategoria(c.id, senha);
        toast('Categoria excluída');
        viewCategorias();
      },
    });
  }

  /* =================================================================
     PRODUTOS
     ================================================================= */
  function precoInput(p) {
    const inp = el('input', { type: 'number', step: '0.01', min: '0', value: Number(p.preco).toFixed(2), 'aria-label': 'Preço de ' + p.nome, style: 'width:100px;padding:5px 8px;border:1.5px solid #bbb;border-radius:6px;font-size:15px' });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('change', () => guard(async () => {
      const v = Math.max(0, Number(inp.value) || 0);
      await client.adminAtualizarProduto(p.id, { preco: v });
      p.preco = v;
      inp.value = v.toFixed(2);
      toast('Preço atualizado');
    }));
    return el('div', { style: 'display:flex;align-items:center;gap:4px' }, 'R$', inp);
  }

  async function viewProdutos() {
    const [prods, cats] = await Promise.all([client.adminListarProdutos(), client.getCatalogo()]);
    let atual = null;
    const rows = [];
    prods.forEach((p) => {
      if (p.categoria_id !== atual) {
        atual = p.categoria_id;
        rows.push(el('tr', { class: 'group-row' }, el('td', { colspan: '6' }, p.categoria)));
      }
      const meia = (p.permite_meia !== false && !(p.permite_meia === undefined && p.nome && p.nome.toLowerCase().includes('gelo')));
      rows.push(el('tr', {},
        el('td', {}, el('b', {}, p.nome)),
        el('td', {}, precoInput(p)),
        el('td', {}, el('span', { class: 'badge ' + (meia ? 'on' : 'off') }, meia ? '½ Sim' : '1 Inteiro')),
        el('td', {}, String(p.ordem)),
        el('td', {}, el('span', { class: 'badge ' + (p.ativo ? 'on' : 'off') }, p.ativo ? 'Ativo' : 'Inativo')),
        el('td', { class: 'actions' },
          el('button', { class: 'btn sm secondary', onclick: () => formProduto(cats, p) }, 'Editar'),
          el('button', { class: 'btn sm danger', onclick: () => excluirProduto(p) }, 'Excluir'))));
    });
    $('main').replaceChildren(
      el('div', { class: 'toolbar' }, el('span', { class: 'grow' }),
        el('button', { class: 'btn', onclick: () => formProduto(cats) }, '+ Novo produto')),
      rows.length
        ? el('div', { class: 'table-wrap' }, el('table', {},
          el('thead', {}, el('tr', {}, ...['Produto', 'Preço', 'Opção 1/2', 'Ordem', 'Status', ''].map((h) => el('th', {}, h)))),
          el('tbody', {}, rows)))
        : el('div', { class: 'table-wrap' }, el('div', { class: 'empty' }, 'Nenhum produto cadastrado.')));
  }

  function formProduto(cats, p) {
    if (!cats.length) return toast('Cadastre uma categoria primeiro', true);
    const meiaInicial = p ? (p.permite_meia !== false && !(p.permite_meia === undefined && p.nome && p.nome.toLowerCase().includes('gelo'))) : true;
    const f = {
      categoria_id: el('select', {}, cats.map((c) => el('option', { value: String(c.id), selected: p && p.categoria_id === c.id }, `${c.nome}${c.unidade ? ' (' + c.unidade + ')' : ''} #${c.id}`))),
      nome: el('input', { value: p ? p.nome : '', maxlength: '100', required: '' }),
      preco: el('input', { type: 'number', step: '0.01', min: '0', value: String(p ? p.preco : 0) }),
      ordem: el('input', { type: 'number', value: String(p ? p.ordem : 0) }),
      permite_meia: el('input', { type: 'checkbox', checked: meiaInicial }),
      ativo: el('input', { type: 'checkbox', checked: p ? !!p.ativo : true }),
    };
    const salvar = () => guard(async () => {
      const body = {
        categoria_id: Number(f.categoria_id.value),
        nome: f.nome.value,
        preco: Number(f.preco.value),
        ordem: Number(f.ordem.value),
        ativo: f.ativo.checked,
        permite_meia: f.permite_meia.checked
      };

      if (p && p.id) {
        try {
          const raw = localStorage.getItem('eisberg_produtos_sem_meia');
          const set = raw ? new Set(JSON.parse(raw)) : new Set();
          if (!f.permite_meia.checked) set.add(Number(p.id)); else set.delete(Number(p.id));
          localStorage.setItem('eisberg_produtos_sem_meia', JSON.stringify([...set]));
        } catch (_) { }
      }

      if (p) {
        await client.adminAtualizarProduto(p.id, body);
      } else {
        await client.adminCriarProduto(body);
      }
      toast('Produto salvo');
      closeModal();
      viewProdutos();
    });
    openModal(p ? 'Editar produto' : 'Novo produto', el('div', {},
      group('Categoria', f.categoria_id), group('Nome', f.nome), group('Preço (R$)', f.preco), group('Ordem', f.ordem),
      el('label', { class: 'check' }, f.permite_meia, 'Permitir 1/2 unidade (metade do preço)'),
      el('p', { style: 'font-size:12px;color:#777;margin:-4px 0 12px 24px;line-height:1.3' }, 'Se desmarcado (ex: Gelo), o app só permitirá quantidades inteiras (1, 2, 3...) e não exibirá o botão ½.'),
      el('label', { class: 'check' }, f.ativo, 'Ativo (visível no app)'),
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: salvar }, 'Salvar'),
        el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancelar'))));
  }

  function excluirProduto(p) {
    pedirSenha({
      titulo: 'Excluir produto?',
      mensagem: `"${p.nome}" será removido do cardápio. Pedidos antigos são preservados.`,
      executar: async (senha) => {
        await client.excluirProduto(p.id, senha);
        toast('Produto excluído');
        viewProdutos();
      },
    });
  }

  /* =================================================================
     DASHBOARD (pedidos, status e valores por dia)
     ================================================================= */
  let dashFiltro = { periodo: 'mes_atual', status: '', dataInicio: '', dataFim: '' };
  const DIAS_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const brl0 = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const pad2 = (n) => String(n).padStart(2, '0');
  const dashIso = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const dashDia0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dashFmt = (d) => pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
  const dashParseIso = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };

  // Intervalo (primeiro e último dia) do período escolhido, para preencher dias sem pedidos com zero.
  function dashIntervalo(periodo, ini, fim, datas) {
    const hoje = dashDia0(new Date());
    const y = hoje.getFullYear(), m = hoje.getMonth(), d = hoje.getDate();
    let s = null, e = null;
    if (periodo === 'hoje') { s = e = hoje; }
    else if (periodo === 'ontem') { s = e = new Date(y, m, d - 1); }
    else if (periodo === 'semana_atual') { const w = getWeekRange(hoje); s = dashDia0(w.start); e = dashDia0(w.end); }
    else if (periodo === 'semana_passada') { const w = getWeekRange(new Date(y, m, d - 7)); s = dashDia0(w.start); e = dashDia0(w.end); }
    else if (periodo === '7dias') { s = new Date(y, m, d - 7); e = hoje; }
    else if (periodo === '30dias') { s = new Date(y, m, d - 30); e = hoje; }
    else if (periodo === 'mes_atual') { s = new Date(y, m, 1); e = new Date(y, m + 1, 0); }
    else if (periodo === 'mes_passado') { s = new Date(y, m - 1, 1); e = new Date(y, m, 0); }
    else if (periodo === 'personalizado') {
      if (ini) s = dashParseIso(ini);
      if (fim) e = dashParseIso(fim);
    }
    const ordenadas = datas.slice().sort((a, b) => a - b);
    if (!s) s = ordenadas.length ? dashDia0(ordenadas[0]) : hoje;
    if (!e) e = ordenadas.length ? dashDia0(ordenadas[ordenadas.length - 1]) : hoje;
    if ((periodo === 'semana_atual' || periodo === 'mes_atual') && e > hoje) e = hoje; // não mostra dias futuros
    if (e < s) e = s;
    return { s, e };
  }

  async function viewDashboard(forcar) {
    const pedidos = await obterPedidos(!!forcar);
    const noPeriodo = pedidos.filter((p) => pedidoNoPeriodo(p, dashFiltro.periodo, dashFiltro.dataInicio, dashFiltro.dataFim));
    const lista = noPeriodo.filter((p) => !dashFiltro.status || p.status === dashFiltro.status);

    const datas = noPeriodo.map(parsePedidoDate).filter(Boolean);
    const { s, e } = dashIntervalo(dashFiltro.periodo, dashFiltro.dataInicio, dashFiltro.dataFim, datas);
    const nDias = Math.round((e - s) / 86400000) + 1;
    const mensal = nDias > 62;

    // Buckets (dia a dia, ou mês a mês quando o período é muito longo)
    const buckets = [];
    const mapaB = new Map();
    const novoBucket = (key, label, sub, titulo) => {
      const b = { key, label, sub, titulo, pedidos: 0, itens: 0, valor: 0, st: {}, stN: {} };
      Object.keys(STATUS).forEach((k) => { b.st[k] = 0; b.stN[k] = 0; });
      buckets.push(b); mapaB.set(key, b); return b;
    };
    if (mensal) {
      for (let c = new Date(s.getFullYear(), s.getMonth(), 1); c <= e; c = new Date(c.getFullYear(), c.getMonth() + 1, 1)) {
        novoBucket(c.getFullYear() + '-' + pad2(c.getMonth() + 1), MESES_ABREV[c.getMonth()], String(c.getFullYear()).slice(2),
          MESES_NOMES[c.getMonth()] + '/' + c.getFullYear());
      }
    } else {
      for (let i = 0; i < nDias; i++) {
        const c = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
        novoBucket(dashIso(c), pad2(c.getDate()) + '/' + pad2(c.getMonth() + 1), DIAS_SEM[c.getDay()], dashFmt(c) + ' (' + DIAS_SEM[c.getDay()] + ')');
      }
    }
    let semData = 0;
    lista.forEach((p) => {
      const dt = parsePedidoDate(p);
      if (!dt) { semData++; return; }
      const key = mensal ? dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) : dashIso(dt);
      const b = mapaB.get(key);
      if (!b) return;
      b.pedidos++;
      b.itens += Number(p.total_itens || 0);
      b.valor += Number(p.total || 0);
      if (b.st[p.status] !== undefined) { b.st[p.status] += Number(p.total || 0); b.stN[p.status]++; }
    });

    const totalValor = lista.reduce((a, p) => a + Number(p.total || 0), 0);
    const totalItens = lista.reduce((a, p) => a + Number(p.total_itens || 0), 0);
    const ticket = lista.length ? totalValor / lista.length : 0;
    const comPedidos = buckets.filter((b) => b.pedidos > 0);
    const melhor = comPedidos.reduce((m, b) => (!m || b.valor > m.valor ? b : m), null);
    const maxValor = Math.max(1, ...buckets.map((b) => b.valor));

    // ---- Cabeçalho com filtros ----
    const rotulos = {
      todos: 'Todo o histórico', hoje: 'Hoje', ontem: 'Ontem', semana_atual: 'Esta semana', semana_passada: 'Semana passada',
      '7dias': 'Últimos 7 dias', mes_atual: 'Este mês', mes_passado: 'Mês passado', '30dias': 'Últimos 30 dias', personalizado: 'Escolher datas...',
    };
    const refrescar = () => { viewDashboard(); };
    const pill = (key, label) => el('button', {
      type: 'button', class: 'btn-pill' + (dashFiltro.periodo === key ? ' active' : ''),
      onclick: () => { dashFiltro.periodo = key; refrescar(); },
    }, label);
    const selPer = el('select', { onchange: (ev) => { dashFiltro.periodo = ev.target.value; refrescar(); } },
      Object.entries(rotulos).map(([k, v]) => el('option', { value: k, selected: dashFiltro.periodo === k }, '📅 ' + v)));
    const selStatus = el('select', { onchange: (ev) => { dashFiltro.status = ev.target.value; refrescar(); } },
      el('option', { value: '', selected: !dashFiltro.status }, 'Todos os status'),
      Object.entries(STATUS).map(([k, v]) => el('option', { value: k, selected: dashFiltro.status === k }, v)));
    const dateStyle = 'border:1.5px solid #bbb;border-radius:8px;padding:6px 8px;font-size:13px;background:#fff';
    const inpIni = el('input', { type: 'date', value: dashFiltro.dataInicio, title: 'Data inicial', style: dateStyle, onchange: (ev) => { dashFiltro.dataInicio = ev.target.value; refrescar(); } });
    const inpFim = el('input', { type: 'date', value: dashFiltro.dataFim, title: 'Data final', style: dateStyle, onchange: (ev) => { dashFiltro.dataFim = ev.target.value; refrescar(); } });
    const filtrado = dashFiltro.periodo !== 'mes_atual' || dashFiltro.status;

    // ---- Cards ----
    const card = (valor, rotulo, extra) => el('div', { class: 'stat', style: 'cursor:default' },
      el('b', { style: 'font-size:22px;white-space:nowrap' }, valor), el('span', {}, rotulo), extra || null);
    const cards = el('div', { class: 'cards' },
      el('div', { class: 'stat stat-valor', title: 'Soma dos pedidos do filtro' },
        el('b', { style: 'white-space:nowrap' }, brl(totalValor)), el('span', {}, '💰 Total em Valor')),
      card(String(lista.length), 'Pedidos'),
      card(brl(ticket), 'Ticket médio'),
      card(String(totalItens), 'Unidades vendidas'),
      card(melhor ? brl(melhor.valor) : '—', melhor ? `Melhor ${mensal ? 'mês' : 'dia'}: ${melhor.titulo}` : 'Melhor dia'));

    // ---- Status ----
    const porStatus = {};
    Object.keys(STATUS).forEach((k) => { porStatus[k] = { n: 0, valor: 0 }; });
    noPeriodo.forEach((p) => { if (porStatus[p.status]) { porStatus[p.status].n++; porStatus[p.status].valor += Number(p.total || 0); } });
    const totalPer = noPeriodo.reduce((a, p) => a + Number(p.total || 0), 0);
    const blocoStatus = el('div', { class: 'dash-box' },
      el('h3', {}, '📌 Pedidos por status'),
      el('p', { class: 'dash-hint' }, 'Clique em um status para filtrar o dashboard.'),
      Object.entries(STATUS).map(([k, nome]) => {
        const st = porStatus[k];
        const pct = totalPer > 0 ? (st.valor / totalPer) * 100 : 0;
        return el('div', { class: 'dash-st' + (dashFiltro.status === k ? ' active' : ''), onclick: () => { dashFiltro.status = dashFiltro.status === k ? '' : k; refrescar(); } },
          el('div', { class: 'dash-st-top' },
            el('span', {}, el('i', { class: 'dash-dot', style: 'background:' + MAPA_CORES[k] }), el('b', {}, nome)),
            el('span', {}, `${st.n} pedido${st.n === 1 ? '' : 's'} • `, el('b', {}, brl(st.valor)))),
          el('div', { class: 'dash-st-bar' }, el('div', { style: `width:${pct.toFixed(1)}%;background:${MAPA_CORES[k]}` })),
          el('div', { class: 'dash-hint' }, `${pct.toFixed(1).replace('.', ',')}% do valor do período`));
      }));

    // ---- Gráfico: valor por dia (barras empilhadas por status) ----
    const mostrarValores = buckets.length <= 14;
    const grafico = el('div', { class: 'dash-chart' + (mostrarValores ? ' show-vals' : '') },
      buckets.map((b) => {
        const tip = `${b.titulo}\nTotal: ${brl(b.valor)} • ${b.pedidos} pedido${b.pedidos === 1 ? '' : 's'}` +
          Object.entries(STATUS).filter(([k]) => b.stN[k]).map(([k, nome]) => `\n${nome}: ${b.stN[k]} (${brl(b.st[k])})`).join('');
        const alt = b.valor > 0 ? Math.max(2, (b.valor / maxValor) * 100) : 0;
        return el('div', { class: 'dash-col', title: tip },
          el('div', { class: 'dash-bararea' },
            el('div', { class: 'dash-barwrap', style: `height:${alt}%` },
              b.valor > 0 ? el('div', { class: 'dash-val' }, brl0(b.valor)) : null,
              el('div', { class: 'dash-bar' }, Object.keys(STATUS).filter((k) => b.st[k] > 0).map((k) =>
                el('div', { style: `height:${(b.st[k] / b.valor) * 100}%;background:${MAPA_CORES[k]}` }))))),
          el('div', { class: 'dash-lbl' }, b.label), el('div', { class: 'dash-sub' }, b.sub));
      }));
    const legenda = el('div', { class: 'mapa-legenda', style: 'margin:8px 0 0' },
      Object.entries(STATUS).map(([k, v]) => el('span', {}, el('i', { style: 'background:' + MAPA_CORES[k] }), v)));
    const blocoGrafico = el('div', { class: 'dash-box' },
      el('h3', {}, mensal ? '📈 Valor por mês' : '📈 Valor por dia'),
      el('p', { class: 'dash-hint' }, `${dashFmt(s)} a ${dashFmt(e)}${dashFiltro.status ? ' • ' + STATUS[dashFiltro.status] : ''} — passe o mouse (ou toque) na barra para ver os detalhes.`),
      grafico, legenda);

    // ---- Tabela resumo por dia ----
    const linhas = comPedidos.slice().reverse();
    const blocoTabela = el('div', { class: 'dash-box' },
      el('h3', {}, mensal ? '🗓️ Resumo por mês' : '🗓️ Resumo por dia'),
      linhas.length
        ? el('div', { class: 'table-wrap', style: 'box-shadow:none;border:1px solid #eee' }, el('table', { style: 'min-width:420px' },
          el('thead', {}, el('tr', {}, ...[mensal ? 'Mês' : 'Dia', 'Pedidos', 'Unidades', 'Valor', 'Ticket médio'].map((h) => el('th', {}, h)))),
          el('tbody', {}, linhas.map((b) => el('tr', {},
            el('td', {}, el('b', {}, b.titulo)), el('td', {}, String(b.pedidos)), el('td', {}, String(b.itens)),
            el('td', { style: 'font-weight:700;white-space:nowrap' }, brl(b.valor)), el('td', { style: 'white-space:nowrap' }, brl(b.valor / b.pedidos))))),
          el('tfoot', {}, el('tr', { class: 'table-footer-row' },
            el('td', { style: 'padding:12px 14px;font-weight:800' }, 'Total'),
            el('td', { style: 'padding:12px 14px;font-weight:800' }, String(lista.length)),
            el('td', { style: 'padding:12px 14px;font-weight:800' }, String(totalItens)),
            el('td', { style: 'padding:12px 14px;font-weight:900;color:#15803d;white-space:nowrap' }, brl(totalValor)),
            el('td', { style: 'padding:12px 14px;font-weight:800;white-space:nowrap' }, brl(ticket))))))
        : el('div', { class: 'empty' }, 'Nenhum pedido neste filtro.'),
      semData ? el('p', { class: 'dash-hint' }, `${semData} pedido(s) sem data não aparecem por dia.`) : null);

    $('main').replaceChildren(
      el('div', { class: 'toolbar' },
        el('h2', { style: 'margin:0 8px 0 0;font-size:20px' }, '📊 Dashboard'),
        el('div', { class: 'periodo-pills' }, pill('hoje', 'Hoje'), pill('semana_atual', 'Esta Semana'), pill('mes_atual', 'Este Mês'), pill('todos', 'Todos'), selPer,
          dashFiltro.periodo === 'personalizado' ? el('div', { style: 'display:inline-flex;gap:4px;align-items:center' }, el('span', { style: 'font-size:12px' }, 'De:'), inpIni, el('span', { style: 'font-size:12px' }, 'Até:'), inpFim) : null),
        selStatus,
        (filtrado ? el('button', { class: 'btn sm secondary', onclick: () => { dashFiltro = { periodo: 'mes_atual', status: '', dataInicio: '', dataFim: '' }; refrescar(); } }, '✕ Limpar') : null),
        el('span', { class: 'grow' }),
        el('button', { class: 'btn secondary', title: 'Buscar pedidos novos no banco', onclick: () => guard(() => viewDashboard(true)) }, '🔄 Atualizar')),
      cards,
      el('div', { class: 'dash-grid' }, blocoGrafico, blocoStatus),
      blocoTabela);
  }

  /* =================================================================
     DESPESAS / GASTOS
     ================================================================= */
  const FORMAS_PGTO = { dinheiro: '💵 Dinheiro', pix: '⚡ PIX', cartao: '💳 Cartão' };
  const DESPESAS_SQL = `create table if not exists public.despesas (
  id               bigint generated always as identity primary key,
  data             date          not null default current_date,
  descricao        text          not null check (char_length(btrim(descricao)) between 1 and 200),
  valor            numeric(12,2) not null check (valor >= 0),
  forma_pagamento  text          not null default 'dinheiro'
                                 check (forma_pagamento in ('dinheiro', 'pix', 'cartao')),
  data_pagamento   date,
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
grant  execute on function public.excluir_despesa(bigint, text) to authenticated;`;
  const SQL_EDITOR_URL = 'https://supabase.com/dashboard/project/wibqizlxrwiovgkynprj/sql/66105b49-93b9-49c8-b59e-af92eb40377a';

  let despesasFiltro = { periodo: 'mes_atual', forma: '' };
  let despesasCache = { rows: null, t: 0 };

  const hojeISO = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  function invalidarDespesasCache() { despesasCache = { rows: null, t: 0 }; }
  async function obterDespesas(forcar) {
    if (!forcar && despesasCache.rows && Date.now() - despesasCache.t < PEDIDOS_TTL_MS) return despesasCache.rows;
    const rows = await client.adminListarDespesas();
    despesasCache = { rows, t: Date.now() };
    return rows;
  }
  const despesasSemTabela = (e) => {
    const msg = (e && e.message) || '';
    return /despesas/i.test(msg) && (e.status === 404 || /schema cache|does not exist|permission denied|not find/i.test(msg));
  };

  function telaSetupDespesas() {
    const pre = el('textarea', { readonly: '', rows: '14', style: 'width:100%;font-family:Consolas,monospace;font-size:12px;border:1.5px solid #cbd5e1;border-radius:8px;padding:10px;background:#f8fafc' });
    pre.value = DESPESAS_SQL;
    $('main').replaceChildren(el('div', { style: 'max-width:760px;background:#fff;border-radius:14px;padding:24px;box-shadow:0 1px 6px rgba(0,0,0,.1)' },
      el('h3', { style: 'margin:0 0 8px;color:var(--red);font-size:22px' }, '💸 Ativar o registro de despesas'),
      el('p', { style: 'color:var(--muted);font-size:14px;line-height:1.5;margin:0 0 12px' },
        'Para guardar as despesas é preciso criar uma tabela nova no banco (uma única vez). Ela não altera nada do que você já tem (pedidos, produtos, categorias).'),
      el('ol', { style: 'font-size:14px;line-height:1.7;margin:0 0 12px 18px;padding:0' },
        el('li', {}, 'Clique em ', el('b', {}, '📋 Copiar SQL'), '.'),
        el('li', {}, 'Abra o ', el('a', { href: SQL_EDITOR_URL, target: '_blank', rel: 'noopener noreferrer', style: 'color:var(--red);font-weight:700' }, 'SQL Editor do Supabase'), ', cole e clique em ', el('b', {}, 'Run'), '.'),
        el('li', {}, 'Volte aqui e clique em ', el('b', {}, '✅ Já executei'), '.')),
      pre,
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' },
        el('button', { class: 'btn secondary', onclick: async () => { try { await navigator.clipboard.writeText(DESPESAS_SQL); } catch (_) { pre.select(); document.execCommand('copy'); } toast('SQL copiado!'); } }, '📋 Copiar SQL'),
        el('button', { class: 'btn', onclick: () => viewDespesas(true).catch((e) => toast(e.message || 'Erro', true)) }, '✅ Já executei'))));
  }

  async function viewDespesas(forcar) {
    let todas;
    try {
      todas = await obterDespesas(!!forcar);
    } catch (e) {
      if (despesasSemTabela(e)) return telaSetupDespesas();
      throw e;
    }

    const noPeriodo = todas.filter((d) => pedidoNoPeriodo(d, despesasFiltro.periodo, '', ''));
    const lista = noPeriodo.filter((d) => !despesasFiltro.forma || d.forma_pagamento === despesasFiltro.forma);
    const soma = (arr) => arr.reduce((a, d) => a + Number(d.valor || 0), 0);
    const total = soma(lista);
    const porForma = (f) => noPeriodo.filter((d) => d.forma_pagamento === f);

    const stat = (key, label, valor, n) =>
      el('div', { class: 'stat' + (despesasFiltro.forma === key ? ' active' : ''), onclick: () => { despesasFiltro.forma = (despesasFiltro.forma === key ? '' : key); viewDespesas(); } },
        el('b', { style: 'font-size:22px;white-space:nowrap' }, brl(valor)), el('span', {}, `${label} (${n})`));

    const cardTotal = el('div', { class: 'stat stat-despesa', title: 'Total das despesas do filtro' },
      el('b', { style: 'white-space:nowrap' }, brl(total)),
      el('span', {}, `💸 Total de despesas (${lista.length} registro${lista.length === 1 ? '' : 's'})`));

    const pill = (key, label) => el('button', {
      type: 'button', class: 'btn-pill' + (despesasFiltro.periodo === key ? ' active' : ''),
      onclick: () => { despesasFiltro.periodo = key; viewDespesas(); },
    }, label);
    const periodos = [['todos', 'Todo o histórico'], ['hoje', 'Hoje'], ['ontem', 'Ontem'], ['semana_atual', 'Esta semana'],
      ['semana_passada', 'Semana passada'], ['mes_atual', 'Este mês'], ['mes_passado', 'Mês passado'], ['30dias', 'Últimos 30 dias']];
    const selPer = el('select', { onchange: (e) => { despesasFiltro.periodo = e.target.value; viewDespesas(); } },
      periodos.map(([k, v]) => el('option', { value: k, selected: despesasFiltro.periodo === k }, '📅 ' + v)));

    const detalheCartao = (d) => {
      if (d.forma_pagamento !== 'cartao') return '—';
      const n = d.parcelas || 1;
      const parc = n > 1 ? `${n}x de ${brl(Number(d.valor) / n)}` : '1x (à vista)';
      return `${parc}${d.data_pagamento ? ' • pgto ' + fmtData(d.data_pagamento) : ''}`;
    };

    $('main').replaceChildren(
      el('div', { class: 'cards' },
        cardTotal,
        stat('dinheiro', FORMAS_PGTO.dinheiro, soma(porForma('dinheiro')), porForma('dinheiro').length),
        stat('pix', FORMAS_PGTO.pix, soma(porForma('pix')), porForma('pix').length),
        stat('cartao', FORMAS_PGTO.cartao, soma(porForma('cartao')), porForma('cartao').length)),
      el('div', { class: 'toolbar' },
        el('div', { class: 'periodo-pills' }, pill('hoje', 'Hoje'), pill('semana_atual', 'Esta Semana'), pill('mes_atual', 'Este Mês'), pill('todos', 'Todos'), selPer),
        (despesasFiltro.forma ? el('button', { class: 'btn sm secondary', onclick: () => { despesasFiltro.forma = ''; viewDespesas(); } }, '✕ Limpar forma') : null),
        el('span', { class: 'grow' }),
        el('button', { class: 'btn secondary', title: 'Recarregar do banco', onclick: () => guard(() => viewDespesas(true)) }, '🔄 Atualizar'),
        el('button', { class: 'btn', onclick: () => formDespesa() }, '+ Nova despesa')),
      lista.length
        ? el('div', { class: 'table-wrap' }, el('table', {},
          el('thead', {}, el('tr', {}, ...['Data', 'Descrição', 'Forma', 'Valor', 'Cartão (parcelas / pagamento)', ''].map((h) => el('th', {}, h)))),
          el('tbody', {}, lista.map((d) => el('tr', {},
            el('td', {}, fmtData(d.data)),
            el('td', {}, el('b', {}, d.descricao)),
            el('td', {}, FORMAS_PGTO[d.forma_pagamento] || d.forma_pagamento),
            el('td', { style: 'font-weight:700;white-space:nowrap' }, brl(d.valor)),
            el('td', {}, detalheCartao(d)),
            el('td', { class: 'actions' },
              el('button', { class: 'btn sm secondary', onclick: () => formDespesa(d) }, 'Editar'),
              el('button', { class: 'btn sm danger', onclick: () => excluirDespesa(d) }, 'Excluir')))),
          ),
          el('tfoot', {}, el('tr', { class: 'table-footer-row' },
            el('td', { colspan: '3', style: 'padding:12px 14px;font-weight:800' }, `Total (${lista.length} registro${lista.length === 1 ? '' : 's'})`),
            el('td', { style: 'padding:12px 14px;font-weight:900;color:#b91c1c;font-size:16px;white-space:nowrap' }, brl(total)),
            el('td', { colspan: '2' }, '')))))
        : el('div', { class: 'table-wrap' }, el('div', { class: 'empty' }, 'Nenhuma despesa neste filtro. Clique em "+ Nova despesa" para registrar.')));
  }

  function formDespesa(d) {
    const f = {
      data: el('input', { type: 'date', value: d ? String(d.data).slice(0, 10) : hojeISO(), required: '' }),
      descricao: el('input', { value: d ? d.descricao : '', maxlength: '200', required: '', placeholder: 'Ex: Compra de caixas de isopor' }),
      valor: el('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: d ? String(d.valor) : '', placeholder: '0,00' }),
      forma: el('select', {}, Object.entries(FORMAS_PGTO).map(([k, v]) => el('option', { value: k, selected: d ? d.forma_pagamento === k : k === 'dinheiro' }, v))),
      data_pagamento: el('input', { type: 'date', value: d && d.data_pagamento ? String(d.data_pagamento).slice(0, 10) : '' }),
      parcelas: el('input', { type: 'number', min: '1', max: '48', step: '1', value: String(d ? d.parcelas || 1 : 1) }),
    };
    const preview = el('div', { style: 'font-size:13px;color:#166534;font-weight:700;margin:-4px 0 10px' });
    const blocoCartao = el('div', { style: 'background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:12px 12px 2px;margin-bottom:12px' },
      group('Data para pagamento (vencimento do cartão)', f.data_pagamento),
      group('Parcelado em quantas vezes (X vezes)', f.parcelas),
      preview);

    const atualizar = () => {
      const cartao = f.forma.value === 'cartao';
      blocoCartao.style.display = cartao ? '' : 'none';
      if (cartao && !f.data_pagamento.value && f.data.value) f.data_pagamento.value = f.data.value;
      const n = Math.max(1, parseInt(f.parcelas.value, 10) || 1);
      const v = Number(f.valor.value) || 0;
      preview.textContent = n > 1 ? `${n}x de ${brl(v / n)}` : `À vista no cartão: ${brl(v)}`;
    };
    ['change', 'input'].forEach((ev) => { f.forma.addEventListener(ev, atualizar); f.parcelas.addEventListener(ev, atualizar); f.valor.addEventListener(ev, atualizar); });
    atualizar();

    const salvar = () => guard(async () => {
      const descricao = f.descricao.value.trim();
      const valor = Number(f.valor.value);
      if (!f.data.value) throw new Error('Informe a data');
      if (!descricao) throw new Error('Informe a descrição');
      if (!(valor > 0)) throw new Error('Informe um valor maior que zero');
      const cartao = f.forma.value === 'cartao';
      const parcelas = Math.min(48, Math.max(1, parseInt(f.parcelas.value, 10) || 1));
      if (cartao && !f.data_pagamento.value) throw new Error('Informe a data para pagamento do cartão');
      await client.adminSalvarDespesa(d ? d.id : null, {
        data: f.data.value,
        descricao,
        valor: Math.round(valor * 100) / 100,
        forma_pagamento: f.forma.value,
        data_pagamento: cartao ? f.data_pagamento.value : null,
        parcelas: cartao ? parcelas : 1,
      });
      invalidarDespesasCache();
      toast('Despesa salva');
      closeModal();
      viewDespesas(true);
    });

    openModal(d ? 'Editar despesa' : 'Nova despesa', el('div', {},
      group('Data', f.data), group('Descrição', f.descricao), group('Valor (R$)', f.valor), group('Forma de pagamento', f.forma),
      blocoCartao,
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: salvar }, 'Salvar'),
        el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancelar'))));
  }

  function excluirDespesa(d) {
    pedirSenha({
      titulo: 'Excluir despesa?',
      mensagem: `"${d.descricao}" (${brl(d.valor)}) será removida permanentemente.`,
      executar: async (senha) => {
        await client.excluirDespesa(d.id, senha);
        invalidarDespesasCache();
        toast('Despesa excluída');
        viewDespesas(true);
      },
    });
  }

  /* =================================================================
     USUÁRIOS DO APP (login e senha)
     ================================================================= */
  const USUARIOS_SQL = `create extension if not exists pgcrypto;
create table if not exists public.usuarios (
  id            bigint generated always as identity primary key,
  nome          text        not null default '' check (char_length(btrim(nome)) <= 120),
  login         text        not null check (char_length(btrim(login)) between 2 and 120 and btrim(login) !~ '\\s'),
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
returns table (id bigint, nome text, login text, ativo boolean, criado_em timestamptz, atualizado_em timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  return query select u.id, u.nome, u.login, u.ativo, u.criado_em, u.atualizado_em from public.usuarios u order by u.id desc;
end; $$;
create or replace function public.admin_salvar_usuario(p_id bigint, p_nome text, p_login text, p_senha text, p_ativo boolean default true)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_nome text := btrim(coalesce(p_nome, ''));
  v_login text := lower(btrim(coalesce(p_login, '')));
  v_senha text := coalesce(p_senha, '');
  v_ativo boolean := coalesce(p_ativo, true);
  v_row public.usuarios%rowtype;
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  if char_length(v_nome) > 120 then raise exception 'O nome deve ter no máximo 120 caracteres'; end if;
  if char_length(v_login) < 2 or char_length(v_login) > 120 or v_login ~ '\\s' then raise exception 'Informe um login válido (mínimo 2 caracteres, sem espaços)'; end if;
  if exists (select 1 from public.usuarios where lower(btrim(login)) = v_login and (p_id is null or id <> p_id)) then
    raise exception 'Já existe um usuário cadastrado com este login';
  end if;
  if p_id is null then
    if char_length(v_senha) < 4 then raise exception 'Informe uma senha com pelo menos 4 caracteres'; end if;
    insert into public.usuarios (nome, login, senha_hash, ativo) values (v_nome, v_login, crypt(v_senha, gen_salt('bf')), v_ativo) returning * into v_row;
  else
    if char_length(v_senha) > 0 then
      if char_length(v_senha) < 4 then raise exception 'A nova senha deve ter pelo menos 4 caracteres'; end if;
      update public.usuarios set nome = v_nome, login = v_login, senha_hash = crypt(v_senha, gen_salt('bf')), ativo = v_ativo, atualizado_em = now() where id = p_id returning * into v_row;
    else
      update public.usuarios set nome = v_nome, login = v_login, ativo = v_ativo, atualizado_em = now() where id = p_id returning * into v_row;
    end if;
    if v_row.id is null then raise exception 'Usuário não encontrado'; end if;
  end if;
  return jsonb_build_object('id', v_row.id, 'nome', v_row.nome, 'login', v_row.login, 'ativo', v_row.ativo, 'criado_em', v_row.criado_em, 'atualizado_em', v_row.atualizado_em);
end; $$;
create or replace function public.excluir_usuario(p_id bigint, p_senha text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._checar_exclusao(p_senha);
  delete from public.usuarios where id = p_id;
  if not found then raise exception 'Usuário não encontrado'; end if;
end; $$;
create or replace function public.login_usuario(p_login text, p_senha text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_login text := lower(btrim(coalesce(p_login, ''))); v_row public.usuarios%rowtype;
begin
  if v_login = '' or coalesce(p_senha, '') = '' then raise exception 'Informe seu login e sua senha'; end if;
  select * into v_row from public.usuarios where lower(btrim(login)) = v_login or (position('@' in v_login) = 0 and lower(btrim(login)) = v_login || '@eisberg.com') limit 1;
  if v_row.id is null or v_row.senha_hash <> crypt(p_senha, v_row.senha_hash) then perform pg_sleep(0.5); raise exception 'Login ou senha incorretos'; end if;
  if not v_row.ativo then raise exception 'Usuário desativado. Contate o administrador.'; end if;
  return jsonb_build_object('id', v_row.id, 'nome', v_row.nome, 'login', v_row.login, 'ativo', v_row.ativo);
end; $$;
create or replace function public.validar_usuario_ativo(p_id bigint, p_login text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = p_id and lower(btrim(login)) = lower(btrim(coalesce(p_login, ''))) and ativo = true);
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
grant execute on function public.validar_usuario_ativo(bigint, text) to anon, authenticated;`;

  let usuariosCache = { rows: null, t: 0 };
  let usuariosFiltro = { status: '', q: '' };
  let refocarBuscaUsuarios = false;

  function invalidarUsuariosCache() { usuariosCache = { rows: null, t: 0 }; }
  async function obterUsuarios(forcar) {
    if (!forcar && usuariosCache.rows && Date.now() - usuariosCache.t < PEDIDOS_TTL_MS) return usuariosCache.rows;
    const rows = await client.adminListarUsuarios();
    usuariosCache = { rows, t: Date.now() };
    return rows;
  }
  const usuariosSemTabela = (e) => {
    const msg = (e && e.message) || '';
    return /usuarios|admin_listar_usuarios/i.test(msg) && (e.status === 404 || /schema cache|does not exist|permission denied|not find/i.test(msg));
  };

  function telaSetupUsuarios() {
    const pre = el('textarea', { readonly: '', rows: '14', style: 'width:100%;font-family:Consolas,monospace;font-size:12px;border:1.5px solid #cbd5e1;border-radius:8px;padding:10px;background:#f8fafc' });
    pre.value = USUARIOS_SQL;
    $('main').replaceChildren(el('div', { style: 'max-width:760px;background:#fff;border-radius:14px;padding:24px;box-shadow:0 1px 6px rgba(0,0,0,.1)' },
      el('h3', { style: 'margin:0 0 8px;color:var(--red);font-size:22px' }, '👥 Ativar o cadastro de usuários'),
      el('p', { style: 'color:var(--muted);font-size:14px;line-height:1.5;margin:0 0 12px' },
        'Para cadastrar usuários com login e senha é preciso criar a tabela e as funções de acesso no banco (uma única vez). Isso não altera os logins existentes nem nenhum dado do sistema.'),
      el('ol', { style: 'font-size:14px;line-height:1.7;margin:0 0 12px 18px;padding:0' },
        el('li', {}, 'Clique em ', el('b', {}, '📋 Copiar SQL'), '.'),
        el('li', {}, 'Abra o ', el('a', { href: SQL_EDITOR_URL, target: '_blank', rel: 'noopener noreferrer', style: 'color:var(--red);font-weight:700' }, 'SQL Editor do Supabase'), ', cole e clique em ', el('b', {}, 'Run'), '.'),
        el('li', {}, 'Volte aqui e clique em ', el('b', {}, '✅ Já executei'), '.')),
      pre,
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' },
        el('button', { class: 'btn secondary', onclick: async () => { try { await navigator.clipboard.writeText(USUARIOS_SQL); } catch (_) { pre.select(); document.execCommand('copy'); } toast('SQL copiado!'); } }, '📋 Copiar SQL'),
        el('button', { class: 'btn', onclick: () => viewUsuarios(true).catch((e) => toast(e.message || 'Erro', true)) }, '✅ Já executei'))));
  }

  async function viewUsuarios(forcar) {
    let todos;
    try {
      todos = await obterUsuarios(!!forcar);
    } catch (e) {
      if (usuariosSemTabela(e)) return telaSetupUsuarios();
      throw e;
    }

    const total = todos.length;
    const ativos = todos.filter((u) => u.ativo).length;
    const inativos = total - ativos;

    const lista = todos
      .filter((u) => !usuariosFiltro.status || (usuariosFiltro.status === 'ativo' ? u.ativo : !u.ativo))
      .filter((u) => {
        const q = semAcento(usuariosFiltro.q).trim();
        if (!q) return true;
        return semAcento(u.nome).includes(q) || semAcento(u.login).includes(q);
      });

    const stat = (key, label, n) =>
      el('div', {
        class: 'stat' + (usuariosFiltro.status === key ? ' active' : ''),
        onclick: () => { usuariosFiltro.status = (usuariosFiltro.status === key ? '' : key); viewUsuarios(); }
      }, el('b', {}, String(n)), el('span', {}, label));

    const busca = el('input', { type: 'search', placeholder: 'Buscar por nome ou login...', value: usuariosFiltro.q });
    let debounceBusca = null;
    busca.addEventListener('input', () => {
      clearTimeout(debounceBusca);
      debounceBusca = setTimeout(() => {
        usuariosFiltro.q = busca.value.trim();
        refocarBuscaUsuarios = true;
        viewUsuarios();
      }, 200);
    });
    busca.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(debounceBusca);
        usuariosFiltro.q = busca.value.trim();
        refocarBuscaUsuarios = true;
        viewUsuarios();
      }
    });

    const alternarAtivo = (u) => guard(async () => {
      await client.adminSalvarUsuario(u.id, { nome: u.nome, login: u.login, senha: '', ativo: !u.ativo });
      invalidarUsuariosCache();
      toast(u.ativo ? 'Usuário desativado' : 'Usuário ativado');
      viewUsuarios(true);
    });

    $('main').replaceChildren(
      el('div', { class: 'cards' },
        stat('', 'Todos os usuários', total),
        stat('ativo', 'Ativos', ativos),
        stat('inativo', 'Inativos', inativos)),
      el('div', { class: 'toolbar' },
        busca,
        (usuariosFiltro.q || usuariosFiltro.status)
          ? el('button', { class: 'btn sm secondary', onclick: () => { usuariosFiltro = { status: '', q: '' }; viewUsuarios(); } }, '✕ Limpar')
          : null,
        el('span', { class: 'grow' }),
        el('button', { class: 'btn secondary', title: 'Recarregar do banco', onclick: () => guard(() => viewUsuarios(true)) }, '🔄 Atualizar'),
        el('button', { class: 'btn', onclick: () => formUsuario() }, '+ Novo usuário')),
      lista.length
        ? el('div', { class: 'table-wrap' }, el('table', {},
          el('thead', {}, el('tr', {}, ...['Nome', 'Login', 'Status', 'Cadastrado em', ''].map((h) => el('th', {}, h)))),
          el('tbody', {}, lista.map((u) => el('tr', {},
            el('td', {}, el('b', {}, u.nome || '—')),
            el('td', {}, el('code', { style: 'background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:13px' }, u.login)),
            el('td', {}, el('span', { class: 'badge ' + (u.ativo ? 'on' : 'off') }, u.ativo ? 'Ativo' : 'Inativo')),
            el('td', {}, fmtData(u.criado_em)),
            el('td', { class: 'actions' },
              el('button', { class: 'btn sm secondary', onclick: () => alternarAtivo(u) }, u.ativo ? 'Desativar' : 'Ativar'),
              el('button', { class: 'btn sm secondary', onclick: () => formUsuario(u) }, 'Editar'),
              el('button', { class: 'btn sm danger', onclick: () => excluirUsuario(u) }, 'Excluir')))))))
        : el('div', { class: 'table-wrap' },
          el('div', { class: 'empty' }, total ? 'Nenhum usuário encontrado neste filtro.' : 'Nenhum usuário cadastrado ainda. Clique em "+ Novo usuário" para criar o primeiro.')));

    if (refocarBuscaUsuarios) {
      refocarBuscaUsuarios = false;
      busca.focus();
      const n = busca.value.length;
      try { busca.setSelectionRange(n, n); } catch (_) { }
    }
  }

  function formUsuario(u) {
    const f = {
      nome: el('input', { value: u ? (u.nome || '') : '', maxlength: '120', placeholder: 'Ex: João Silva' }),
      login: el('input', { value: u ? u.login : '', maxlength: '120', autocomplete: 'off', required: '', placeholder: 'Ex: joao ou joao@eisberg.com' }),
      senha: el('input', { type: 'password', maxlength: '100', autocomplete: 'new-password', placeholder: u ? 'Deixe em branco para não alterar' : 'Mínimo 4 caracteres' }),
      confirmar: el('input', { type: 'password', maxlength: '100', autocomplete: 'new-password', placeholder: u ? 'Repita a nova senha se for alterar' : 'Repita a senha' }),
      ativo: el('input', { type: 'checkbox', checked: u ? !!u.ativo : true }),
    };

    const btnVerSenha = el('button', {
      type: 'button',
      class: 'btn sm secondary',
      title: 'Mostrar ou ocultar senha',
      onclick: () => {
        const mostrarSenha = f.senha.type === 'password';
        f.senha.type = mostrarSenha ? 'text' : 'password';
        f.confirmar.type = mostrarSenha ? 'text' : 'password';
        btnVerSenha.textContent = mostrarSenha ? '🙈 Ocultar' : '👁 Mostrar';
      }
    }, '👁 Mostrar');

    const campoSenha = el('div', { class: 'form-group' },
      el('label', {}, u ? 'Nova senha (deixe em branco para manter)' : 'Senha *'),
      el('div', { style: 'display:flex;gap:8px;align-items:center' },
        f.senha,
        btnVerSenha));
    f.senha.style.flex = '1';

    const salvar = () => guard(async () => {
      const nome = f.nome.value.trim();
      const login = f.login.value.trim().toLowerCase();
      const senha = f.senha.value;
      const confirmar = f.confirmar.value;

      if (!login || login.length < 2 || /\s/.test(login)) {
        throw new Error('Informe um login válido (mínimo 2 caracteres, sem espaços).');
      }
      if (!u && senha.length < 4) {
        throw new Error('Informe uma senha com pelo menos 4 caracteres.');
      }
      if (senha.length > 0) {
        if (senha.length < 4) throw new Error('A nova senha deve ter pelo menos 4 caracteres.');
        if (senha !== confirmar) throw new Error('A senha e a confirmação não coincidem.');
      }

      await client.adminSalvarUsuario(u ? u.id : null, {
        nome,
        login,
        senha,
        ativo: f.ativo.checked,
      });
      invalidarUsuariosCache();
      toast('Usuário salvo');
      closeModal();
      viewUsuarios(true);
    });

    openModal(u ? 'Editar usuário' : 'Novo usuário', el('div', {},
      group('Nome', f.nome),
      group('Login (sem espaços) *', f.login),
      el('p', { style: 'font-size:12px;color:#777;margin:-6px 0 12px;line-height:1.35' },
        'O usuário usará exatamente este login e a senha para entrar no App de Pedidos.'),
      campoSenha,
      group(u ? 'Confirmar nova senha' : 'Confirmar senha *', f.confirmar),
      el('label', { class: 'check' }, f.ativo, 'Ativo (pode entrar no app de pedidos)'),
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: salvar }, 'Salvar'),
        el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancelar'))));
  }

  function excluirUsuario(u) {
    pedirSenha({
      titulo: 'Excluir usuário?',
      mensagem: `O login "${u.login}" será removido permanentemente e perderá o acesso ao app.`,
      executar: async (senha) => {
        await client.excluirUsuario(u.id, senha);
        invalidarUsuariosCache();
        toast('Usuário excluído');
        viewUsuarios(true);
      },
    });
  }

  /* =================================================================
     DADOS DA EMPRESA & WHATSAPP
     ================================================================= */
  async function viewEmpresa() {
    const main = $('main');
    main.replaceChildren(el('p', { class: 'summary' }, 'Carregando configurações...'));

    const cfg = await client.getConfig();

    const inpNome = el('input', { value: cfg.nome_empresa || 'EISBERG', maxlength: '80', required: '', placeholder: 'Ex: EISBERG' });
    const inpFone = el('input', { value: cfg.telefone_empresa || '(51) 98177.7079', maxlength: '30', placeholder: 'Ex: (51) 98177.7079' });
    const inpWa = el('input', { value: cfg.whatsapp_empresa || '5551981777079', maxlength: '20', placeholder: 'Ex: 5551981777079 (com código do país e DDD)' });

    const previewNome = el('h1', { class: 'brand-name', style: 'font-size:32px;margin:0' }, cfg.nome_empresa || 'EISBERG');
    const previewFone = el('span', { style: 'font-weight:700;color:var(--red);font-size:14px' }, cfg.telefone_empresa || '(51) 98177.7079');

    inpNome.addEventListener('input', () => { previewNome.textContent = inpNome.value.trim() || 'EISBERG'; });
    inpFone.addEventListener('input', () => { previewFone.textContent = inpFone.value.trim() || '(51) 98177.7079'; });

    const btnSalvar = el('button', { type: 'submit', class: 'btn', style: 'font-size:16px;padding:12px 24px' }, '💾 Salvar Configurações');

    const form = el('form', { style: 'max-width:580px;background:#fff;border-radius:14px;padding:24px;box-shadow:0 1px 6px rgba(0,0,0,0.1)' },
      el('h3', { style: 'margin:0 0 8px;color:var(--red);font-size:22px' }, '⚙️ Configurações da Empresa e WhatsApp'),
      el('p', { style: 'color:var(--muted);font-size:14px;margin-bottom:20px;line-height:1.4' },
        'Ao salvar, o nome da empresa, o telefone exibido no topo e o número de destino para envio dos pedidos no WhatsApp serão atualizados em tempo real em todo o aplicativo.'),

      group('Nome da Empresa', inpNome),
      group('Telefone / Celular Exibido no Topo', inpFone),
      group('Número do WhatsApp para Envio dos Pedidos (com DDD)', inpWa),
      el('p', { style: 'font-size:12px;color:#888;margin-top:-6px;margin-bottom:18px' },
        'Dica: Digite apenas números ou com DDD (ex: 51981777079). O link direto do WhatsApp será gerado automaticamente para este número.'),

      el('div', { style: 'background:#fafafa;border:1.5px dashed #ccc;border-radius:10px;padding:14px;margin-bottom:20px' },
        el('div', { style: 'font-size:12px;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:8px' }, 'Pré-visualização do Topo (Alta Resolução):'),
        el('div', { style: 'display:flex;align-items:center;gap:10px' },
          el('img', { src: 'img/mascote.svg', style: 'width:36px;height:58px;object-fit:contain' }),
          el('div', {}, previewNome, el('div', { style: 'display:flex;align-items:center;gap:4px;margin-top:2px' }, '📞 ', previewFone)))),

      el('div', { style: 'display:flex;gap:10px;align-items:center' }, btnSalvar));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btnSalvar.disabled = true;
      btnSalvar.textContent = 'Salvando...';
      try {
        const res = await client.salvarConfig(inpNome.value, inpFone.value, inpWa.value);
        if (res && typeof res === 'object') {
          if (res.nome_empresa) {
            inpNome.value = res.nome_empresa;
            previewNome.textContent = res.nome_empresa;
            const adminName = $('admin-brand-name');
            if (adminName) adminName.textContent = res.nome_empresa;
            const loginName = $('login-brand-name');
            if (loginName) loginName.textContent = res.nome_empresa;
          }
          if (res.telefone_empresa) {
            inpFone.value = res.telefone_empresa;
            previewFone.textContent = res.telefone_empresa;
          }
          if (res.whatsapp_empresa) {
            inpWa.value = res.whatsapp_empresa;
          }
          if (typeof BroadcastChannel !== 'undefined') {
            try {
              const bc = new BroadcastChannel('eisberg_config');
              bc.postMessage(res);
              bc.close();
            } catch (_) { }
          }
        }
        toast('Configurações salvas com sucesso!');
      } catch (err) {
        if (err && (err.status === 401 || /jwt/i.test(err.message || ''))) {
          sair(true);
        } else {
          toast((err && err.message) || 'Erro ao salvar configurações', true);
        }
      } finally {
        btnSalvar.disabled = false;
        btnSalvar.textContent = '💾 Salvar Configurações';
      }
    });

    const backupBox = el('div', { style: 'max-width:580px;background:#fff;border-radius:14px;padding:24px;box-shadow:0 1px 6px rgba(0,0,0,0.1);margin-top:20px' },
      el('h3', { style: 'margin:0 0 8px;color:#2e7d32;font-size:20px;display:flex;align-items:center;gap:6px' }, '📦 Backup e Exportação Completa'),
      el('p', { style: 'color:var(--muted);font-size:14px;margin-bottom:16px;line-height:1.4' },
        'Baixe uma cópia de segurança completa contendo todos os produtos, categorias, pedidos e configurações do sistema em formato JSON.'),
      el('button', { type: 'button', class: 'btn', style: 'background:#2e7d32;border-color:#2e7d32;font-size:15px;padding:10px 20px', onclick: exportarDadosSistema },
        '📦 Exportar Dados do Sistema (Backup JSON)')
    );

    main.replaceChildren(form, backupBox);
  }

  mostrar();
})();
