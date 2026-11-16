'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const STATUS = { novo: 'Novo', em_producao: 'Em produção', entregue: 'Entregue', cancelado: 'Cancelado' };

  const savedToken = sessionStorage.getItem('eisberg_sb_token') || '';
  const client = window.eisbergSupabase ? window.eisbergSupabase.createClient({ token: savedToken }) : null;

  let tab = 'pedidos';
  let filtro = { status: '', q: '' };

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
      produtos: viewProdutos,
      categorias: viewCategorias,
      empresa: viewEmpresa,
    }[tab]()));
  }

  /* =================================================================
     PEDIDOS
     ================================================================= */
  async function viewPedidos() {
    const { pedidos, resumo } = await client.adminListarPedidos({ status: filtro.status, q: filtro.q });
    const cont = Object.fromEntries(resumo.map((r) => [r.status, r.n]));
    const totalGeral = resumo.reduce((a, r) => a + r.n, 0);
    const main = $('main');

    const stat = (key, label, n) =>
      el('div', { class: 'stat' + (filtro.status === key ? ' active' : ''), onclick: () => { filtro.status = key; viewPedidos(); } },
        el('b', {}, String(n)), el('span', {}, label));

    const busca = el('input', { type: 'search', placeholder: 'Buscar cliente, cidade, cód. ou nº', value: filtro.q });
    busca.addEventListener('keydown', (e) => { if (e.key === 'Enter') { filtro.q = busca.value.trim(); viewPedidos(); } });

    main.replaceChildren(
      el('div', { class: 'cards' },
        stat('', 'Todos', totalGeral),
        ...Object.entries(STATUS).map(([k, v]) => stat(k, v, cont[k] || 0))),
      el('div', { class: 'toolbar' },
        busca,
        el('button', { class: 'btn secondary', onclick: () => { filtro.q = busca.value.trim(); viewPedidos(); } }, 'Buscar'),
        el('span', { class: 'grow' }),
        el('button', { class: 'btn', onclick: () => guard(() => formPedido()) }, '+ Novo pedido')),
      pedidos.length
        ? el('div', { class: 'table-wrap' }, el('table', {},
          el('thead', {}, el('tr', {}, ...['Nº', 'Cliente', 'Cidade', 'Data', 'Itens', 'Total', 'Status', ''].map((h) => el('th', {}, h)))),
          el('tbody', {}, pedidos.map((p) =>
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
                el('button', { class: 'btn sm danger', onclick: () => excluirPedido(p) }, 'Excluir')))))))
        : el('div', { class: 'table-wrap' }, el('div', { class: 'empty' }, 'Nenhum pedido encontrado.')));
  }

  function excluirPedido(p) {
    pedirSenha({
      titulo: `Excluir pedido #${p.id}?`,
      mensagem: `O pedido de ${p.cliente} será removido permanentemente.`,
      executar: async (senha) => {
        await client.excluirPedido(p.id, senha);
        toast('Pedido excluído');
        closeModal();
        viewPedidos();
      },
    });
  }

  async function mudarStatus(id, status) {
    await guard(async () => {
      await client.adminAtualizarStatus(id, status);
      toast('Status atualizado');
      verPedido(id);
      viewPedidos();
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
      size: 80mm auto;
      margin: 4mm 2mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Courier New', Courier, 'Lucida Console', monospace;
      font-size: 11.5px;
      line-height: 1.25;
      color: #000;
      background: #fff;
      padding: 6px;
      width: 100%;
      max-width: 320px;
      margin: 0 auto;
    }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: bold; }
    .empresa-nome {
      font-size: 18px;
      font-weight: 900;
      letter-spacing: 1px;
      text-transform: uppercase;
      text-align: center;
      margin-bottom: 2px;
    }
    .empresa-sub {
      font-size: 10px;
      text-align: center;
      color: #222;
      margin-bottom: 2px;
    }
    .empresa-contato {
      font-size: 11px;
      font-weight: bold;
      text-align: center;
    }
    .linha-traco {
      border-top: 1px dashed #000;
      margin: 6px 0;
    }
    .linha-dupla {
      border-top: 2px dashed #000;
      margin: 6px 0;
    }
    .doc-titulo {
      font-size: 12px;
      font-weight: 900;
      text-align: center;
      letter-spacing: 0.5px;
    }
    .doc-sub {
      font-size: 9px;
      text-align: center;
      color: #333;
    }
    .linha-info {
      display: flex;
      justify-content: space-between;
      gap: 4px;
      font-size: 11px;
      margin-bottom: 2px;
    }
    .secao-titulo {
      font-size: 11px;
      font-weight: 900;
      margin-bottom: 3px;
      text-transform: uppercase;
    }
    .tabela-itens {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
      margin: 4px 0;
    }
    .tabela-itens th {
      border-bottom: 1px dashed #000;
      padding: 3px 1px;
      font-size: 9.5px;
      font-weight: bold;
      text-align: left;
    }
    .tabela-itens td {
      padding: 3px 1px;
      vertical-align: top;
    }
    .col-item { width: 6%; font-size: 9px; }
    .col-qtd { width: 14%; text-align: center; }
    .col-un { width: 14%; text-align: center; font-size: 9.5px; }
    .col-desc { width: 40%; word-break: break-word; }
    .sub-cat { font-size: 8.5px; color: #444; font-weight: normal; }
    .col-unit { width: 12%; font-size: 9px; white-space: nowrap; }
    .col-tot { width: 14%; white-space: nowrap; }
    .linha-total {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      margin-bottom: 2px;
    }
    .linha-total-destaque {
      display: flex;
      justify-content: space-between;
      font-size: 15px;
      font-weight: 900;
      margin-top: 4px;
      padding-top: 4px;
      border-top: 1px solid #000;
    }
    .obs-bloco {
      font-size: 10.5px;
      line-height: 1.3;
      padding: 2px 0;
    }
    .canhoto {
      font-size: 10px;
      margin-top: 8px;
      line-height: 1.5;
    }
    .rodape {
      text-align: center;
      font-size: 10.5px;
      font-weight: bold;
      margin-top: 6px;
    }
    @media print {
      body {
        width: 100%;
        max-width: none;
        padding: 0;
        margin: 0;
      }
    }
  </style>
</head>
<body>
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
    <div style="margin-top:12px">ASSINATURA: ____________________________________</div>
  </div>

  <div class="linha-dupla"></div>
  <div class="rodape">Obrigado pela preferência!</div>
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
      viewPedidos();
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
