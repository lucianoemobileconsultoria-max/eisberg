'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const client = window.eisbergSupabase ? window.eisbergSupabase.createClient() : null;
  const qty = new Map(); // produto_id -> quantidade
  let catalogo = [];
  let whatsapp = (client && client.config && client.config.whatsapp) || '5551981777079';

  const hoje = () => {
    const d = new Date();
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  };

  const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const preco = new Map(); // produto_id -> preço
  let gpsCoords = null; // { lat, lng } capturado pelo botão GPS

  function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children) e.append(c);
    return e;
  }

  function parseQty(value) {
    if (typeof value === 'number') {
      if (value <= 0) return 0;
      if (Math.abs(value - 0.5) < 0.01) return 0.5;
      return Math.min(9999, Math.trunc(value));
    }
    const s = String(value || '').trim().toLowerCase().replace(',', '.');
    if (!s || s === '0') return 0;
    if (s === '1/2' || s === '½' || s === '0.5' || s === '.5' || s === '0.50') return 0.5;
    const n = parseFloat(s);
    if (isNaN(n) || n <= 0) return 0;
    if (Math.abs(n - 0.5) < 0.01) return 0.5;
    return Math.min(9999, Math.trunc(n));
  }

  function fmtQty(v) {
    if (v === 0.5) return '1/2';
    return String(v || 0);
  }

  function setQty(id, value, input, row, priceEl, p, btnHalf) {
    const v = parseQty(value);
    if (v > 0) {
      qty.set(id, v);
    } else {
      qty.delete(id);
    }
    input.value = fmtQty(v);
    input.scrollLeft = 0;
    row.classList.toggle('has-qty', v > 0);
    if (btnHalf) {
      btnHalf.classList.toggle('active', v === 0.5);
    }

    if (priceEl && p && p.preco > 0) {
      if (v === 0.5) {
        const metade = p.preco * 0.5;
        priceEl.innerHTML = `<span style="font-size:10px;text-decoration:line-through;opacity:.6;margin-right:2px">${brl(p.preco)}</span>${brl(metade)} <small style="font-size:9px;background:#ffe5e7;color:var(--red);padding:1px 3px;border-radius:3px;font-weight:700">½</small>`;
      } else if (v > 1) {
        priceEl.textContent = brl(p.preco * v);
      } else {
        priceEl.textContent = brl(p.preco);
      }
    }

    updateSummary();
  }

  function changeQty(p, delta, input, row, priceEl, btnHalf) {
    const cur = qty.get(p.id) || 0;
    let next = 0;
    if (delta > 0) {
      if (cur === 0) {
        next = 0.5; // Antes do 1, tem a opção 1/2!
      } else if (cur === 0.5) {
        next = 1;
      } else {
        next = Math.min(9999, Math.trunc(cur) + 1);
      }
    } else {
      if (cur > 1) {
        next = Math.trunc(cur) - 1;
      } else if (cur === 1) {
        next = 0.5; // Antes do 0, passa pela opção 1/2!
      } else if (cur === 0.5) {
        next = 0;
      } else if (cur === 0) {
        // Se estiver em 0 e clicar em diminuir / abaixo, também vai para 1/2!
        next = 0.5;
      } else {
        next = 0;
      }
    }
    setQty(p.id, next, input, row, priceEl, p, btnHalf);
  }

  function renderItem(p) {
    const semPreco = !(p.preco > 0);
    const priceEl = el('span', { class: 'price' }, semPreco ? '' : brl(p.preco));
    const btnHalf = el('button', {
      type: 'button',
      class: 'btn-half',
      title: 'Opção 1/2 (Metade do valor)',
      'aria-label': 'Meia unidade de ' + p.nome,
    }, '½');

    const input = el('input', {
      type: 'text',
      inputmode: 'decimal',
      maxlength: '5',
      autocomplete: 'off',
      list: 'qty-options',
      value: '0',
      'aria-label': 'Quantidade de ' + p.nome,
    });
    const row = el('div', { class: 'item' + (semPreco ? ' unavailable' : '') });

    const info = el('div', { class: 'item-info' },
      el('span', { class: 'item-name' }, p.nome),
      semPreco
        ? el('span', { class: 'tag-off' }, 'sem preço')
        : priceEl
    );

    if (semPreco) {
      input.disabled = true;
      btnHalf.disabled = true;
      row.setAttribute('title', 'Indisponível: sem preço');
      row.append(
        info,
        el('div', { class: 'qty' },
          btnHalf,
          el('button', { type: 'button', disabled: '', 'aria-label': p.nome + ' indisponível' }, '−'),
          input,
          el('button', { type: 'button', disabled: '', 'aria-label': p.nome + ' indisponível' }, '+')));
      return row;
    }

    btnHalf.addEventListener('click', () => {
      const cur = qty.get(p.id) || 0;
      const next = (cur === 0.5) ? 0 : 0.5;
      setQty(p.id, next, input, row, priceEl, p, btnHalf);
    });

    input.addEventListener('change', () => setQty(p.id, input.value, input, row, priceEl, p, btnHalf));
    input.addEventListener('input', () => {
      const v = parseQty(input.value);
      if (v > 0) qty.set(p.id, v); else qty.delete(p.id);
      row.classList.toggle('has-qty', v > 0);
      btnHalf.classList.toggle('active', v === 0.5);
      if (v === 0.5) {
        const metade = p.preco * 0.5;
        priceEl.innerHTML = `<span style="font-size:10px;text-decoration:line-through;opacity:.6;margin-right:2px">${brl(p.preco)}</span>${brl(metade)} <small style="font-size:9px;background:#ffe5e7;color:var(--red);padding:1px 3px;border-radius:3px;font-weight:700">½</small>`;
      } else if (v > 1) {
        priceEl.textContent = brl(p.preco * v);
      } else {
        priceEl.textContent = brl(p.preco);
      }
      updateSummary();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        changeQty(p, 1, input, row, priceEl, btnHalf);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        changeQty(p, -1, input, row, priceEl, btnHalf);
      }
    });
    input.addEventListener('blur', () => {
      const cur = qty.get(p.id) || 0;
      input.value = fmtQty(cur);
      input.scrollLeft = 0;
      btnHalf.classList.toggle('active', cur === 0.5);
    });
    input.addEventListener('focus', () => input.select());

    row.append(
      info,
      el('div', { class: 'qty' },
        btnHalf,
        el('button', { type: 'button', 'aria-label': 'Diminuir ' + p.nome, onclick: () => changeQty(p, -1, input, row, priceEl, btnHalf) }, '−'),
        input,
        el('button', { type: 'button', 'aria-label': 'Aumentar ' + p.nome, onclick: () => changeQty(p, 1, input, row, priceEl, btnHalf) }, '+'))
    );
    return row;
  }

  function render() {
    const root = $('catalog');
    root.replaceChildren();
    if (!catalogo.length) {
      root.append(el('p', { class: 'summary' }, 'Nenhum produto disponível no momento.'));
      return;
    }
    const cols = [el('div', { class: 'col' }), el('div', { class: 'col' })];
    for (const c of catalogo) {
      if (!c.produtos.length) continue;
      const card = el('section', { class: 'cat' },
        el('div', { class: 'cat-head' }, el('span', {}, c.nome), el('small', {}, c.unidade)));
      c.produtos.forEach((p) => card.append(renderItem(p)));
      cols[c.coluna === 2 ? 1 : 0].append(card);
    }
    root.append(...cols);
  }

  function updateSummary() {
    let totalItens = 0;
    let valor = 0;
    qty.forEach((v, id) => {
      totalItens += v;
      valor += v * (preco.get(id) || 0);
    });

    let totalStr = '';
    if (totalItens > 0) {
      if (totalItens === 0.5) {
        totalStr = '½';
      } else if (totalItens % 1 === 0.5) {
        totalStr = `${Math.floor(totalItens)} ½`;
      } else {
        totalStr = String(totalItens);
      }
    }

    $('summary').textContent = totalItens ? `${qty.size} produto(s) • ${totalStr} un./cx.` : '';
    $('total').textContent = brl(valor);
  }

  function fail(msg) {
    const e = $('error');
    e.textContent = msg;
    e.hidden = !msg;
  }

  function mensagemWhatsApp(p) {
    const nomeEmpresa = ($('empresa-nome') && $('empresa-nome').textContent.trim()) || 'EISBERG';
    const linhas = [`*${nomeEmpresa} - PEDIDO #${p.id}*`, ''];
    linhas.push(`*Cliente:* ${p.cliente}`);
    if (p.endereco) linhas.push(`*Endereço:* ${p.endereco}`);
    if (p.cidade) linhas.push(`*Cidade:* ${p.cidade}`);

    // PIN do Google Maps para localização / traçar rota até o cliente
    let mapsUrl = '';
    const gps = p.gps || gpsCoords;
    if (gps && gps.lat && gps.lng) {
      mapsUrl = `https://maps.google.com/?q=${gps.lat},${gps.lng}`;
    } else {
      const endBusca = [p.endereco, p.cidade].filter(Boolean).join(', ');
      if (endBusca) {
        mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(endBusca)}`;
      }
    }
    if (mapsUrl) {
      linhas.push(`📍 *Localização no Maps (PIN):* ${mapsUrl}`);
    }

    if (p.cod) linhas.push(`*Cód.:* ${p.cod}`);
    if (p.data) linhas.push(`*Data:* ${p.data}`);
    let cat = null;
    for (const it of p.itens) {
      if (it.categoria !== cat) {
        cat = it.categoria;
        linhas.push('', `*${cat}*`);
      }
      const isMetade = (Number(it.quantidade) === 0.5);
      const qtdFormatada = isMetade ? '1/2' : String(it.quantidade);
      const valorItem = Number(it.quantidade) * (it.preco > 0 ? it.preco : 0);

      if (isMetade) {
        linhas.push(`• ${it.produto}: 1/2 ${it.unidade || 'UND'} (Metade: ${brl(valorItem)})`);
      } else {
        linhas.push(`• ${it.produto}: ${qtdFormatada}${it.unidade ? ' ' + it.unidade : ''}${it.preco > 0 ? ' x ' + brl(it.preco) + (it.quantidade > 1 ? ' = ' + brl(valorItem) : '') : ''}`);
      }
    }
    if (p.total > 0) linhas.push('', `*Total: ${brl(p.total)}*`);
    if (p.observacoes) linhas.push('', `*Observações:* ${p.observacoes}`);
    return linhas.join('\n');
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function updateProgress(pct, statusText) {
    const bar = $('sending-progress-bar');
    const pctEl = $('sending-progress-pct');
    const statusEl = $('sending-status');
    const wrap = bar ? bar.parentElement : null;
    if (bar) bar.style.width = pct + '%';
    if (wrap) wrap.setAttribute('aria-valuenow', pct);
    if (pctEl) pctEl.textContent = pct + '%';
    if (statusEl && statusText) statusEl.textContent = statusText;
  }

  async function enviar(ev) {
    ev.preventDefault();
    fail('');

    const camposObrigatorios = [
      { id: 'cliente', nome: 'Cliente', field: $('f-cliente') },
      { id: 'endereco', nome: 'Endereço', field: $('f-endereco') },
      { id: 'cidade', nome: 'Cidade', field: $('f-cidade') }
    ];

    let primeiroVazio = null;
    camposObrigatorios.forEach((c) => {
      const val = $(c.id) ? $(c.id).value.trim() : '';
      if (!val) {
        if (c.field) {
          c.field.classList.add('invalid');
          c.field.classList.remove('field-shake');
          void c.field.offsetWidth; // reflow para reiniciar animação
          c.field.classList.add('field-shake');
        }
        if (!primeiroVazio) primeiroVazio = c;
      } else {
        if (c.field) c.field.classList.remove('invalid', 'field-shake');
      }
    });

    if (primeiroVazio) {
      if (primeiroVazio.field) {
        primeiroVazio.field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if ($(primeiroVazio.id)) $(primeiroVazio.id).focus();
      return fail(`Por favor, preencha o campo obrigatório (*): ${primeiroVazio.nome}`);
    }

    if (!qty.size) {
      $('catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return fail('Adicione ao menos um item ao pedido antes de enviar.');
    }

    const btn = $('send');
    const sendingOverlay = $('sending-overlay');
    btn.disabled = true;

    try {
      if (!client) throw new Error('Cliente Supabase não inicializado');

      const sessaoOk = await garantirSessaoAtiva(true);
      if (!sessaoOk) return;

      // Exibe modal com barra de progresso
      updateProgress(15, 'Validando informações do pedido...');
      if (sendingOverlay) sendingOverlay.hidden = false;
      await sleep(220);

      updateProgress(45, 'Conectando ao sistema Eisberg...');
      await sleep(220);

      updateProgress(75, 'Gravando pedido no banco de dados...');
      const pedidoPromise = client.criarPedido({
        cliente: $('cliente').value.trim(),
        endereco: $('endereco').value.trim(),
        cidade: $('cidade').value.trim(),
        cod: $('cod').value,
        data: $('data').value,
        observacoes: $('observacoes').value,
        itens: [...qty].map(([produto_id, quantidade]) => ({ produto_id, quantidade })),
      });

      await sleep(250);
      updateProgress(90, 'Gerando comprovante e link do WhatsApp...');

      const [j] = await Promise.all([pedidoPromise, atualizarConfigEmpresa(true)]);

      updateProgress(100, 'Pedido enviado com sucesso!');
      await sleep(400);

      if (sendingOverlay) sendingOverlay.hidden = true;
      $('done-id').textContent = '#' + j.id;
      const pedidoComGps = Object.assign({ gps: gpsCoords }, j);
      $('done-wa').href = `https://wa.me/${whatsapp}?text=${encodeURIComponent(mensagemWhatsApp(pedidoComGps))}`;
      $('done').hidden = false;
    } catch (e) {
      if (sendingOverlay) sendingOverlay.hidden = true;
      fail(e.message || 'Falha ao enviar pedido');
    } finally {
      btn.disabled = false;
    }
  }

  async function carregarProximoCodigo() {
    if (!client) return;
    try {
      const n = await client.getProximoCodigo();
      $('cod').value = n;
    } catch (_) {
      $('cod').value = '1';
    }
  }

  function novoPedido() {
    $('form').reset();
    $('data').value = hoje();
    carregarProximoCodigo();
    atualizarConfigEmpresa(true);
    qty.clear();
    gpsCoords = null;
    const btnGps = $('btn-gps');
    if (btnGps) {
      btnGps.textContent = '📍 Usar GPS';
      btnGps.classList.remove('active');
      btnGps.disabled = false;
    }
    render();
    updateSummary();
    ['f-cliente', 'f-endereco', 'cidade'].forEach((id) => {
      const f = $(id.startsWith('f-') ? id : 'f-' + id);
      if (f) f.classList.remove('invalid', 'field-shake');
    });
    $('done').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  let ultimaAtualizacaoConfig = 0;

  function aplicarConfigEmpresa(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    if (cfg.nome_empresa) {
      const elNome = $('empresa-nome');
      if (elNome) elNome.textContent = cfg.nome_empresa;
      const elLoginNome = $('login-empresa-nome');
      if (elLoginNome) elLoginNome.textContent = cfg.nome_empresa;
      document.title = cfg.nome_empresa + ' - Pedido';
    }
    if (cfg.telefone_empresa) {
      const elFone = $('empresa-fone');
      if (elFone) elFone.textContent = cfg.telefone_empresa;
    }
    if (cfg.whatsapp_empresa) {
      whatsapp = cfg.whatsapp_empresa;
    }
  }

  async function atualizarConfigEmpresa(forcar) {
    if (!client || !client.getConfig) return;
    const agora = Date.now();
    if (!forcar && (agora - ultimaAtualizacaoConfig) < 1500) return;
    ultimaAtualizacaoConfig = agora;
    try {
      const cfg = await client.getConfig();
      aplicarConfigEmpresa(cfg);
    } catch (_) { }
  }

  function parseJwtExp(jwt) {
    try {
      const parts = String(jwt || '').split('.');
      if (parts.length !== 3) return 0;
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const payload = JSON.parse(atob(padded));
      return Number(payload.exp) || 0;
    } catch (_) {
      return 0;
    }
  }

  function isTokenExpiringSoon(jwt) {
    const exp = parseJwtExp(jwt);
    if (!exp) return true;
    return (Date.now() / 1000) >= (exp - 60);
  }

  function limparSessaoLocal() {
    localStorage.removeItem('eisberg_user_token');
    localStorage.removeItem('eisberg_user_refresh_token');
    localStorage.removeItem('eisberg_user_email');
    if (client) client.setToken(null);
  }

  async function garantirSessaoAtiva(mostrarErroLogin) {
    const token = localStorage.getItem('eisberg_user_token');
    const refreshToken = localStorage.getItem('eisberg_user_refresh_token');
    if (!token) return false;

    if (!isTokenExpiringSoon(token)) {
      if (client) client.setToken(token);
      return true;
    }

    if (refreshToken && client && client.auth && client.auth.refreshSession) {
      try {
        const res = await client.auth.refreshSession(refreshToken);
        if (res && res.access_token) {
          localStorage.setItem('eisberg_user_token', res.access_token);
          if (res.refresh_token) localStorage.setItem('eisberg_user_refresh_token', res.refresh_token);
          if (res.user && res.user.email) localStorage.setItem('eisberg_user_email', res.user.email);
          client.setToken(res.access_token);
          return true;
        }
      } catch (_) { }
    }

    limparSessaoLocal();
    $('app-main').hidden = true;
    $('app-login').hidden = false;
    if (mostrarErroLogin) {
      const err = $('app-login-error');
      if (err) {
        err.textContent = 'Sua sessão expirou. Entre novamente com seu login e senha.';
        err.hidden = false;
      }
    }
    return false;
  }

  async function carregarCatalogo(jaTentouRenovar) {
    try {
      if (!client) throw new Error('Cliente Supabase não carregado');
      catalogo = await client.getCatalogo();
      preco.clear();
      catalogo.forEach((c) => c.produtos.forEach((p) => preco.set(p.id, p.preco)));
      render();
    } catch (e) {
      const ehAuth = e && (e.status === 401 || /jwt/i.test(e.message || ''));
      if (ehAuth && !jaTentouRenovar) {
        // Força tentativa de refresh ou encerramento limpo de sessão expirada
        localStorage.removeItem('eisberg_user_token');
        const ok = await garantirSessaoAtiva(true);
        if (ok) return carregarCatalogo(true);
        return;
      }
      console.error(e);
      $('catalog').replaceChildren(
        el('div', { class: 'error-msg', style: 'padding: 18px 8px; line-height: 1.5;' },
          el('b', {}, 'Não foi possível carregar os produtos do Supabase.'),
          el('div', { style: 'font-size: 13px; font-weight: normal; margin-top: 6px; color: #555;' },
            'Se for a primeira vez, execute o arquivo ',
            el('code', {}, 'supabase/schema.sql'),
            ' no SQL Editor do seu projeto Supabase.'
          )
        )
      );
    }
  }

  async function verificarSessao() {
    const token = localStorage.getItem('eisberg_user_token');
    const email = localStorage.getItem('eisberg_user_email') || '';
    if (token) {
      const ativa = await garantirSessaoAtiva(true);
      if (!ativa) return false;
      const emailAtual = localStorage.getItem('eisberg_user_email') || email;
      $('app-login').hidden = true;
      $('app-main').hidden = false;
      const bEmail = $('user-badge-email');
      if (bEmail) bEmail.textContent = emailAtual;
      if (!$('cliente').value.trim() && emailAtual) {
        $('cliente').value = emailAtual.split('@')[0];
      }
      carregarCatalogo(false);
      return true;
    } else {
      $('app-main').hidden = true;
      $('app-login').hidden = false;
      return false;
    }
  }

  async function init() {
    // Aplica última configuração conhecida imediatamente antes de buscar a mais recente no banco
    if (client && client.getCachedConfig) {
      aplicarConfigEmpresa(client.getCachedConfig());
    }
    atualizarConfigEmpresa(true);

    $('app-login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = $('app-login-error');
      err.hidden = true;
      const btn = $('btn-app-login');
      btn.disabled = true;
      btn.textContent = 'Entrando...';

      try {
        if (!client) throw new Error('Cliente Supabase não inicializado');
        const loginRaw = $('app-email').value.trim();
        const senha = $('app-senha').value;

        if (!loginRaw || !senha) {
          throw new Error('Informe seu login e sua senha.');
        }

        // Tenta com e-mail direto, ou caso o usuário tenha cadastrado com ou sem @
        const emailTentativa = loginRaw.includes('@') ? loginRaw : `${loginRaw.toLowerCase()}@eisberg.com`;

        let res;
        try {
          res = await client.auth.signInWithPassword(emailTentativa, senha);
        } catch (authErr) {
          if (!loginRaw.includes('@')) {
            try {
              res = await client.auth.signInWithPassword(loginRaw, senha);
            } catch (_) {
              throw authErr;
            }
          } else {
            throw authErr;
          }
        }

        const emailFinal = (res.user && res.user.email) || loginRaw;
        localStorage.setItem('eisberg_user_token', res.access_token);
        if (res.refresh_token) {
          localStorage.setItem('eisberg_user_refresh_token', res.refresh_token);
        }
        localStorage.setItem('eisberg_user_email', emailFinal);

        client.setToken(res.access_token);
        $('app-senha').value = '';
        $('app-login').hidden = true;
        $('app-main').hidden = false;
        const bEmail = $('user-badge-email');
        if (bEmail) bEmail.textContent = emailFinal;

        if (!$('cliente').value.trim()) {
          $('cliente').value = emailFinal.split('@')[0];
        }

        atualizarConfigEmpresa(true);
        carregarProximoCodigo();
        carregarCatalogo(false);
      } catch (e) {
        err.textContent = e.message === 'Invalid login credentials'
          ? 'Login ou senha incorretos no sistema.'
          : (e.message || 'Falha ao autenticar');
        err.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
    });

    const btnLogout = $('btn-app-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', async () => {
        limparSessaoLocal();
        if (client) {
          try { await client.auth.signOut(); } catch (_) { }
        }
        $('app-main').hidden = true;
        $('app-login').hidden = false;
        $('app-email').focus();
      });
    }

    $('data').value = hoje();
    $('form').addEventListener('submit', enviar);
    $('done-new').addEventListener('click', novoPedido);

    const btnGps = $('btn-gps');
    if (btnGps) {
      btnGps.addEventListener('click', () => {
        if (!navigator.geolocation) {
          alert('Geolocalização não suportada neste navegador.');
          return;
        }
        btnGps.textContent = 'Buscando GPS...';
        btnGps.disabled = true;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            gpsCoords = { lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) };
            btnGps.textContent = '📍 GPS ativo ✓';
            btnGps.classList.add('active');
            btnGps.disabled = false;
          },
          (err) => {
            console.warn('GPS indisponível:', err.message);
            btnGps.textContent = '📍 Usar GPS';
            btnGps.disabled = false;
            alert('Não foi possível obter a localização do GPS. O endereço digitado será usado para gerar o PIN no Google Maps.');
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
      });
    }

    ['cliente', 'endereco', 'cidade'].forEach((id) => {
      const elInp = $(id);
      if (elInp) {
        elInp.addEventListener('input', () => {
          const f = $('f-' + id);
          if (f) f.classList.remove('invalid', 'field-shake');
          if ($('error')) fail('');
        });
      }
    });

    // Sincronização em tempo real com alterações do Painel Admin
    window.addEventListener('focus', () => atualizarConfigEmpresa(false));
    window.addEventListener('pageshow', () => atualizarConfigEmpresa(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') atualizarConfigEmpresa(false);
    });
    window.addEventListener('storage', (ev) => {
      if (ev.key === 'eisberg_company_config' && ev.newValue) {
        try { aplicarConfigEmpresa(JSON.parse(ev.newValue)); } catch (_) { }
      }
    });
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel('eisberg_config');
        bc.addEventListener('message', (ev) => {
          if (ev.data) aplicarConfigEmpresa(ev.data);
        });
      } catch (_) { }
    }
    setInterval(() => {
      if (document.visibilityState === 'visible') atualizarConfigEmpresa(false);
    }, 30000);

    // Configura autenticação do App de Pedidos e carrega catálogo/código
    await verificarSessao();
    carregarProximoCodigo();
  }
  init();
})();

