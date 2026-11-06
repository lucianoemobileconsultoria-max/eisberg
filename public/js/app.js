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

  function setQty(id, value, input, row) {
    const v = Math.max(0, Math.min(9999, Math.trunc(Number(value)) || 0));
    if (v) qty.set(id, v); else qty.delete(id);
    input.value = v;
    row.classList.toggle('has-qty', v > 0);
    updateSummary();
  }

  function renderItem(p) {
    const semPreco = !(p.preco > 0);
    const input = el('input', { type: 'number', inputmode: 'numeric', min: '0', max: '9999', value: '0', 'aria-label': 'Quantidade de ' + p.nome });
    const row = el('div', { class: 'item' + (semPreco ? ' unavailable' : '') });

    const info = el('div', { class: 'item-info' },
      el('span', { class: 'item-name' }, p.nome),
      semPreco
        ? el('span', { class: 'tag-off' }, 'sem preço')
        : el('span', { class: 'price' }, brl(p.preco))
    );

    if (semPreco) {
      input.disabled = true;
      row.setAttribute('title', 'Indisponível: sem preço');
      row.append(
        info,
        el('div', { class: 'qty' },
          el('button', { type: 'button', disabled: '', 'aria-label': p.nome + ' indisponível' }, '−'),
          input,
          el('button', { type: 'button', disabled: '', 'aria-label': p.nome + ' indisponível' }, '+')));
      return row;
    }
    const change = (delta) => setQty(p.id, (qty.get(p.id) || 0) + delta, input, row);
    input.addEventListener('input', () => setQty(p.id, input.value, input, row));
    input.addEventListener('focus', () => input.select());
    row.append(
      info,
      el('div', { class: 'qty' },
        el('button', { type: 'button', 'aria-label': 'Diminuir ' + p.nome, onclick: () => change(-1) }, '−'),
        input,
        el('button', { type: 'button', 'aria-label': 'Aumentar ' + p.nome, onclick: () => change(1) }, '+'))
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
    let total = 0;
    let valor = 0;
    qty.forEach((v, id) => { total += v; valor += v * (preco.get(id) || 0); });
    $('summary').textContent = total ? `${qty.size} produto(s) • ${total} un./cx.` : '';
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
    if (p.cod) linhas.push(`*Cód.:* ${p.cod}`);
    if (p.data) linhas.push(`*Data:* ${p.data}`);
    let cat = null;
    for (const it of p.itens) {
      if (it.categoria !== cat) {
        cat = it.categoria;
        linhas.push('', `*${cat}*`);
      }
      linhas.push(`• ${it.produto}: ${it.quantidade}${it.unidade ? ' ' + it.unidade : ''}${it.preco > 0 ? ' x ' + brl(it.preco) : ''}`);
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

      const j = await pedidoPromise;

      updateProgress(100, 'Pedido enviado com sucesso!');
      await sleep(400);

      if (sendingOverlay) sendingOverlay.hidden = true;
      $('done-id').textContent = '#' + j.id;
      $('done-wa').href = `https://wa.me/${whatsapp}?text=${encodeURIComponent(mensagemWhatsApp(j))}`;
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
    qty.clear();
    render();
    updateSummary();
    ['f-cliente', 'f-endereco', 'f-cidade'].forEach((id) => {
      const f = $(id);
      if (f) f.classList.remove('invalid', 'field-shake');
    });
    $('done').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function init() {
    $('data').value = hoje();
    $('form').addEventListener('submit', enviar);
    $('done-new').addEventListener('click', novoPedido);
    carregarProximoCodigo();

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

    // Carrega dados da empresa (nome, fone e whatsapp)
    if (client && client.getConfig) {
      client.getConfig().then((cfg) => {
        if (!cfg) return;
        if (cfg.nome_empresa) {
          const elNome = $('empresa-nome');
          if (elNome) elNome.textContent = cfg.nome_empresa;
          document.title = cfg.nome_empresa + ' - Pedido';
        }
        if (cfg.telefone_empresa) {
          const elFone = $('empresa-fone');
          if (elFone) elFone.textContent = cfg.telefone_empresa;
        }
        if (cfg.whatsapp_empresa) {
          whatsapp = cfg.whatsapp_empresa;
        }
      }).catch(() => {});
    }

    try {
      if (!client) throw new Error('Cliente Supabase não carregado');
      catalogo = await client.getCatalogo();
      catalogo.forEach((c) => c.produtos.forEach((p) => preco.set(p.id, p.preco)));
      render();
    } catch (e) {
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
  init();
})();

