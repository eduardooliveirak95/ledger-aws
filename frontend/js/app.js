// ── app.js: ecrãs, formulários e ligação dos botões ─────────────────────
// É o último ficheiro a carregar: usa as funções de todos os outros e arranca a app (init, no fim).

// Estado da interface (o que está escolhido no ecrã, não os dados):
// separador ativo, período e filtros de Movimentos, investimento filtrado
const S = {
  tab: 'mov',
  movMode: 'month',
  movAnchor: thisMonth(),
  movAccount: '',
  movCatIn: [],      // categorias de entrada escolhidas no filtro (vazio = todas)
  movCatOut: [],     // categorias de saída escolhidas no filtro (vazio = todas)
  movSel: new Set(), // ids dos movimentos selecionados na tabela (para mudar a categoria de vários)
  movBulkCat: '',    // categoria escolhida para os selecionados
  invFilter: '',
  loanHistory: '',   // crédito mostrado no histórico de prestações
};

// ════════ LOGIN / ARRANQUE ════════
// Mostrar / esconder o ecrã de login (volta sempre ao cartão de email + password)
function showLogin(msg = '') {
  $('#login-screen').classList.remove('hidden');
  $('#login-form').classList.remove('hidden');
  $('#newpw-form').classList.add('hidden');
  $('#login-error').textContent = msg;
  $('#login-password').value = '';
}
function hideLogin() {
  $('#login-screen').classList.add('hidden');
  $('#user-email').textContent = store.get('email') || '';
}
// Bolinha de estado no topo: verde (ligado à API), vermelha (erro) ou neutra
function setStatus(ok) {
  $('#status-dot').className = 'status-dot' + (ok === true ? ' ok' : ok === false ? ' err' : '');
}
// Sair: apaga os tokens, limpa os dados da memória e volta ao login
function logout() {
  store.clear();
  D = emptyData();
  setStatus(null);
  modal.close();
  showLogin();
}
// Quando o auth.js não consegue renovar a sessão, faz logout
onSessionExpired = () => logout();

// Formulário de login: autentica no Cognito e carrega os dados
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#login-btn');
  btn.disabled = true; btn.textContent = 'A entrar…';
  $('#login-error').textContent = '';
  try {
    const challenge = await login($('#login-email').value.trim(), $('#login-password').value);
    if (challenge) return showNewPassword(challenge);   // primeiro login: escolher a password
    hideLogin();
    await loadData();
  } catch (err) {
    $('#login-error').textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
});
// ── primeiro login: aviso + escolher a password definitiva ──
// O pedido do Cognito (challenge) fica guardado aqui até se submeter o formulário
let pendingChallenge = null;
function showNewPassword(challenge) {
  pendingChallenge = challenge;
  $('#login-form').classList.add('hidden');
  $('#newpw-form').classList.remove('hidden');
  $('#newpw-error').textContent = '';
  $('#login-password').value = '';
  $('#newpw-1').focus();
}
$('#newpw-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('#newpw-1').value, err = $('#newpw-error');
  const problem = passwordProblem(pw, $('#newpw-2').value);
  if (problem) return (err.textContent = problem);
  const btn = $('#newpw-btn');
  btn.disabled = true; btn.textContent = 'A guardar…';
  err.textContent = '';
  try {
    await completeNewPassword(pendingChallenge.email, pendingChallenge.session, pw);
    pendingChallenge = null;
    $('#newpw-1').value = $('#newpw-2').value = '';
    hideLogin();
    toast('Password guardada. Bem-vindo!');
    await loadData();
  } catch (x) {
    err.textContent = x.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar e entrar';
  }
});

// ── mudar a password (botão 🔑 no topo; só para a própria conta) ──
function passwordForm() {
  formModal({
    title: 'Mudar password',
    intro: `Conta: <b>${esc(store.get('email') || '')}</b>. A password nova tem de ter ${PASSWORD_RULES}.`,
    submitLabel: 'Mudar password',
    values: {},
    fields: [
      { name: 'old', label: 'Password atual', type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'pw', label: 'Nova password', type: 'password', required: true, autocomplete: 'new-password' },
      { name: 'pw2', label: 'Repete a nova password', type: 'password', required: true, autocomplete: 'new-password' },
    ],
    onSubmit: async v => {
      const problem = passwordProblem(v.pw, v.pw2);
      if (problem) throw new Error(problem);
      if (v.pw === v.old) throw new Error('A password nova tem de ser diferente da atual');
      await changePassword(v.old, v.pw);
      toast('Password alterada');
    },
  });
}

// Botões fixos do topo
$('#logout-btn').addEventListener('click', logout);
$('#export-all-btn').addEventListener('click', exportAll);
$('#password-btn').addEventListener('click', passwordForm);

// Carrega tudo da API (GET /data) para D e desenha o ecrã
async function loadData() {
  try {
    D = { ...emptyData(), ...(await api.loadAll()) };
    setStatus(true);
    renderAll();
  } catch (e) {
    setStatus(false);
    toast(e.message, true);
  }
}

/** Usado por todos os formulários: envia para a API, junta a resposta a D e redesenha o ecrã. */
async function saveItems(items, deletes = []) {
  const res = await api.save(items, deletes);
  applyChanges(res);
  renderAll();
  return res;
}
// Apaga um item na API e mostra quantos registos associados também foram apagados (cascata)
async function removeItem(id, what) {
  const res = await api.remove(id);
  applyChanges(res);
  renderAll();
  toast(`${what} apagado${res.deleted.length > 1 ? ` (+${res.deleted.length - 1} registos associados)` : ''}`);
}

// ════════ SEPARADORES ════════
// Muda de separador (Movimentos / Investimentos / Créditos / Património) e guarda-o no endereço (#mov, #inv, #loan, #prop)
function setTab(tab) {
  S.tab = tab;
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + tab));
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
  renderAll();
}
$$('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

// Redesenha o património líquido e o separador visível (os outros são desenhados quando se abrem)
function renderAll() {
  renderNetWorth();
  if (S.tab === 'mov') renderMovements();
  if (S.tab === 'inv') renderInvestments();
  if (S.tab === 'loan') renderLoans();
  if (S.tab === 'prop') renderProperties();
}

// Os 5 números do topo: contas, investimentos, imóveis, dívidas e património líquido
function renderNetWorth() {
  const nw = netWorth();
  $('#nw-accounts').textContent = eur(nw.accounts);
  $('#nw-investments').textContent = eur(nw.investments);
  $('#nw-properties').textContent = eur(nw.properties);
  $('#nw-debt').textContent = nw.debt ? '−' + eur(nw.debt) : eur(0);
  $('#nw-total').textContent = eur(nw.total);
}

// ════════ MOVIMENTOS ════════
// Controlos do período: Mês / Ano / Tudo e as setas ‹ › para andar para trás e para a frente
$$('#mov-period-mode button').forEach(b => b.addEventListener('click', () => {
  S.movMode = b.dataset.mode;
  $$('#mov-period-mode button').forEach(x => x.classList.toggle('active', x === b));
  renderMovements();
}));
$$('#mov-period-nav .nav-btn').forEach(b => b.addEventListener('click', () => {
  S.movAnchor = addMonths(S.movAnchor, Number(b.dataset.step) * (S.movMode === 'year' ? 12 : 1));
  renderMovements();
}));
// Filtros por conta e por categoria
$('#mov-filter-account').addEventListener('change', e => { S.movAccount = e.target.value; renderMovements(); });

// Filtro de categorias com escolha múltipla (um para entradas, outro para saídas).
// É um <details>: o resumo mostra o que está escolhido e, aberto, uma lista de caixas para marcar.
// key = 'movCatIn' ou 'movCatOut' (onde fica a escolha em S). Devolve a escolha, sem categorias que já não existam.
// otherActive = o outro filtro tem categorias escolhidas: então este, vazio, não mostra nenhuma ("nenhuma").
function renderCatFilter(el, key, label, cats, otherActive) {
  const chosen = S[key].filter(c => cats.includes(c));
  const summary = chosen.length > 1 ? chosen.length + ' categorias' : chosen.length ? esc(chosen[0]) : otherActive ? 'nenhuma' : 'todas';
  el.innerHTML = `<summary>${esc(label)}: ${summary}</summary>
    <div class="multi-panel">
      ${cats.length ? cats.map(c => `<label class="check"><input type="checkbox" value="${esc(c)}" ${chosen.includes(c) ? 'checked' : ''}> ${esc(c)}</label>`).join('')
        : '<div class="muted">Sem categorias</div>'}
      ${chosen.length ? '<button class="link-btn" data-clear>Limpar</button>' : ''}
    </div>`;
  return chosen;
}
for (const [id, key] of [['#mov-filter-in', 'movCatIn'], ['#mov-filter-out', 'movCatOut']]) {
  const el = $(id);
  el.addEventListener('change', e => {
    const v = e.target.value;
    S[key] = e.target.checked ? [...S[key], v] : S[key].filter(c => c !== v);
    renderMovements();
  });
  el.addEventListener('click', e => { if (e.target.matches('[data-clear]')) { e.preventDefault(); S[key] = []; renderMovements(); } });
}
// Clicar fora de um filtro aberto fecha-o
document.addEventListener('click', e => $$('details.multi[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }));

// Preenche uma lista de opções (com "Todas..." no topo) e mantém a escolha atual se ainda existir
function fillSelect(sel, options, current, allLabel) {
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  sel.value = options.some(o => o.value === current) ? current : '';
  return sel.value;
}

// Desenha o separador Movimentos: totais, gráficos, lista de contas e tabela de movimentos
function renderMovements() {
  S.movAccount = fillSelect($('#mov-filter-account'), sortByName(D.accounts).map(a => ({ value: a.id, label: a.name })), S.movAccount, 'Todas as contas');
  const catsOf = dir => [...new Set(D.transactions.filter(t => t.direction === dir).map(t => t.category))].sort((a, b) => a.localeCompare(b, 'pt'));
  const catsIn = catsOf('in'), catsOut = catsOf('out');
  const activeIn = S.movCatIn.some(c => catsIn.includes(c)), activeOut = S.movCatOut.some(c => catsOut.includes(c));
  S.movCatIn = renderCatFilter($('#mov-filter-in'), 'movCatIn', 'Entradas', catsIn, activeOut);
  S.movCatOut = renderCatFilter($('#mov-filter-out'), 'movCatOut', 'Saídas', catsOut, activeIn);

  // Período escolhido e os movimentos que lhe pertencem
  const { from, to } = periodBounds(S.movMode, S.movAnchor);
  $('#mov-period-nav').classList.toggle('hidden', S.movMode === 'all');
  $('#mov-period-label').textContent = S.movMode === 'month' ? monthLabel(S.movAnchor) : S.movAnchor.slice(0, 4);

  const filters = { from, to, account: S.movAccount, catIn: S.movCatIn, catOut: S.movCatOut };
  const txs = filterTx(filters);
  const tot = flowTotals(txs, S.movAccount);
  const nMonths = monthRange(from, to).length;

  // Cartões de resumo: entradas, saídas, saldo e taxa de poupança
  $('#mov-in').textContent = eur(tot.in);
  $('#mov-out').textContent = eur(tot.out);
  $('#mov-net').textContent = eurSigned(tot.net);
  $('#mov-net').className = 'stat-value ' + signClass(tot.net);
  $('#mov-rate').textContent = tot.in > 0 ? pct(tot.saved / tot.in, 0) : '—';
  $('#mov-rate').className = 'stat-value ' + (tot.in > 0 ? signClass(tot.saved) : '');
  // o que saiu das contas mas não foi gasto: investimentos e amortizações de crédito
  const putAside = [tot.invested > 0 && `${eurShort(tot.invested)} investidos`, tot.amortized > 0 && `${eurShort(tot.amortized)} amortizados`].filter(Boolean).join(' e ');
  $('#mov-rate-sub').textContent = putAside ? `inclui ${putAside}` : 'do que entrou, quanto não foi gasto';
  const countIn = txs.filter(t => txEffect(t, S.movAccount) > 0).length;
  const countOut = txs.filter(t => txEffect(t, S.movAccount) < 0 && !isSavingOut(t)).length;
  $('#mov-in-sub').textContent = `${countIn} movimento(s)` + (nMonths > 1 ? ` · média ${eurShort(tot.in / nMonths)}/mês` : '');
  $('#mov-out-sub').textContent = `${countOut} movimento(s)` + (nMonths > 1 ? ` · média ${eurShort(tot.out / nMonths)}/mês` : '')
    + (putAside ? ` · sem ${putAside}` : '');
  $('#mov-net-sub').textContent = tot.net >= 0 ? 'ficou nas contas' : 'saiu mais das contas do que entrou';

  // gráfico: entradas vs saídas por mês
  let months;
  if (S.movMode === 'month') months = monthRange(addMonths(S.movAnchor, -11), S.movAnchor);
  else if (S.movMode === 'year') months = monthRange(from, to);
  else months = monthRange(from, to);
  $('#mov-chart-flow-title').textContent = S.movMode === 'month' ? 'Entradas e saídas (12 meses até ao mês escolhido)' : 'Entradas e saídas por mês';
  let flows = monthlyFlows(months, { account: S.movAccount, catIn: S.movCatIn, catOut: S.movCatOut });
  let labels = months.map(monthShort), titles = months.map(monthLabel);
  if (months.length > 36) {
    // meses a mais para as barras se lerem: agrupa por ano
    const years = [...new Set(months.map(m => m.slice(0, 4)))];
    const sumBy = arr => years.map(y => round2(arr.reduce((s2, v, i) => (months[i].startsWith(y) ? s2 + v : s2), 0)));
    flows = { in: sumBy(flows.in), out: sumBy(flows.out), invested: sumBy(flows.invested), amortized: sumBy(flows.amortized) };
    labels = years; titles = years;
    $('#mov-chart-flow-title').textContent = 'Entradas e saídas por ano';
  }
  drawChart('chart-mov-flow', {
    type: 'bar',
    data: { labels, datasets: [barDataset('Entradas', flows.in, SERIES[0]), barDataset('Gastos', flows.out, SERIES[1]),
      ...(flows.invested.some(v => v > 0) ? [barDataset('Investido', flows.invested, SERIES[2])] : []),
      ...(flows.amortized.some(v => v > 0) ? [barDataset('Amortizado', flows.amortized, SERIES[3])] : [])] },
    options: {
      interaction: INDEX_HOVER,
      scales: { x: catAxis(), y: moneyAxis({ beginAtZero: true }) },
      plugins: {
        legend: { position: 'top', align: 'end' },
        tooltip: { callbacks: { title: i => titles[i[0].dataIndex], label: tooltipMoney,
          footer: i => { const k = i[0].dataIndex, e = flows.in[k] || 0, g = flows.out[k] || 0, v = (flows.invested[k] || 0) + (flows.amortized[k] || 0);
            return [`Saldo: ${eurSigned(e - g - v)}`, ...(e > 0 ? [`Taxa de poupança: ${pct((e - g) / e, 0)}`] : [])]; } } },
      },
    },
  }, 'Sem movimentos neste período. Adiciona um com "+ Movimento".');

  // gráfico: gastos por categoria (as 8 maiores + "Outras")
  let cat = categoryTotals(txs, 'out');
  if (cat.length > 9) cat = [...cat.slice(0, 8), ['Outras', round2(cat.slice(8).reduce((s, c) => s + c[1], 0))]];
  drawChart('chart-mov-cat', {
    type: 'bar',
    data: { labels: cat.map(c => c[0]), datasets: [barDataset('Gastos', cat.map(c => c[1]), SERIES[1], { maxBarThickness: 18, borderWidth: 0 })] },
    options: {
      indexAxis: 'y',
      scales: { x: moneyAxis({ beginAtZero: true, ticks: { maxTicksLimit: 4, callback: v => compactEur(v) } }), y: { grid: { display: false }, border: { display: false }, ticks: { color: '#e8ecf4', font: { family: "'Syne', sans-serif", size: 11 } } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${eur(c.parsed.x)} · ${tot.out ? Math.round(c.parsed.x / tot.out * 100) : 0}%` } } },
    },
  }, 'Sem gastos neste período');

  // lista de contas com o saldo de hoje
  const accs = sortByName(D.accounts);
  $('#acc-list').innerHTML = accs.length ? accs.map(a => {
    const b = accountBalance(a.id, todayISO());
    return `<div class="list-item">
      <div><div class="li-name">${esc(a.name)}</div><div class="li-sub">${esc(a.acc_type)}</div></div>
      <div style="display:flex;align-items:center;gap:6px">
        <div class="li-value ${b < 0 ? 'neg' : ''}">${eur(b)}</div>
        <button class="icon-btn" data-edit-acc="${esc(a.id)}" aria-label="Editar conta ${esc(a.name)}">✎</button>
      </div></div>`;
  }).join('') + `<div class="list-item"><div class="li-name">Total</div><div class="li-value">${eur(totalAccountsBalance(todayISO()))}</div></div>`
    : `<div class="empty">Ainda não tens contas.<br>Cria uma para começares a registar movimentos.<br><button class="btn primary" data-action="acc-new">+ Criar conta</button></div>`;

  // gráfico do saldo no fim de cada mês
  const bs = balanceSeries(S.movAccount);
  drawChart('chart-mov-balance', {
    type: 'line',
    data: { labels: bs.months.map(monthShort), datasets: [lineDataset(S.movAccount ? accountName(S.movAccount) : 'Todas as contas', bs.values, SERIES[0])] },
    options: {
      interaction: INDEX_HOVER,
      scales: { x: catAxis(), y: moneyAxis() },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => monthLabel(bs.months[i[0].dataIndex]), label: c => ` Saldo no fim do mês: ${eur(c.parsed.y)}` } } },
    },
  }, 'O gráfico aparece quando registares movimentos');

  // tabela de movimentos (mais recentes primeiro; no máximo 500 para a página não ficar lenta)
  const rows = [...txs].sort((a, b) => b.date.localeCompare(a.date) || (b.updated_at || '').localeCompare(a.updated_at || ''));
  $('#mov-table-title').textContent = `Movimentos (${rows.length})`;
  const shown = rows.slice(0, 500);
  // Só entradas e saídas se podem selecionar (as transferências entre contas não têm categoria).
  // A seleção fica só com movimentos visíveis, para nunca mudar algo que os filtros escondem.
  movSelectable = shown.filter(t => t.direction !== 'transfer').map(t => t.id);
  S.movSel = new Set(movSelectable.filter(id => S.movSel.has(id)));
  $('#mov-table').innerHTML = rows.length ? `<table class="data">
    <thead><tr><th class="sel"><input type="checkbox" id="mov-sel-all" aria-label="Selecionar todos"></th><th>Data</th><th>Tipo</th><th>Conta</th><th>Categoria</th><th>Descrição</th><th class="num">Valor</th><th></th></tr></thead>
    <tbody>${shown.map(t => {
      const e = txEffect(t, S.movAccount);
      const acct = t.direction === 'transfer' ? `${esc(accountName(t.account_id))} → ${esc(accountName(t.to_account_id))}` : esc(accountName(t.account_id));
      const selected = S.movSel.has(t.id);
      return `<tr class="${selected ? 'selected' : ''}">
        <td class="sel">${t.direction === 'transfer' ? '' : `<input type="checkbox" data-sel="${esc(t.id)}" ${selected ? 'checked' : ''} aria-label="Selecionar">`}</td>
        <td class="date">${dateLabel(t.date)}</td>
        <td><span class="badge ${t.direction}">${DIRECTION_LABEL[t.direction]}</span>${t.approx ? '<span class="badge approx" title="Valor aproximado">≈</span>' : ''}</td>
        <td class="muted">${acct}</td>
        <td><span class="chip">${esc(t.category)}</span></td>
        <td class="desc" title="${esc(t.description)}">${esc(t.description) || '<span class="muted">—</span>'}</td>
        <td class="num ${signClass(t.direction === 'transfer' && !S.movAccount ? 0 : e)}">${t.direction === 'transfer' && !S.movAccount ? eur(t.amount) : eurSigned(e)}</td>
        <td class="actions"><button class="icon-btn" data-edit-tx="${esc(t.id)}" aria-label="Editar">✎</button><button class="icon-btn del" data-del-tx="${esc(t.id)}" aria-label="Apagar">✕</button></td>
      </tr>`;
    }).join('')}</tbody></table>${rows.length > shown.length ? `<div class="empty">A mostrar os 500 mais recentes. Usa os filtros para ver os restantes.</div>` : ''}`
    : `<div class="empty">Sem movimentos neste período.<br><button class="btn primary" data-action="tx-new">+ Movimento</button></div>`;
  renderBulk();
}

// ── mudar a categoria de vários movimentos de uma vez ──
// ids dos movimentos que se podem selecionar na tabela visível (preenchido por renderMovements)
let movSelectable = [];

// Barra que aparece com movimentos selecionados: escolher a categoria (só uma), aplicar ou cancelar.
// Entradas e saídas têm categorias diferentes, por isso só se podem mudar juntas se forem do mesmo tipo.
function renderBulk() {
  const bar = $('#mov-bulk');
  const sel = D.transactions.filter(t => S.movSel.has(t.id));
  // caixa "selecionar todos": marcada com todos, a meio com alguns
  const all = $('#mov-sel-all');
  if (all) { all.checked = sel.length > 0 && sel.length === movSelectable.length; all.indeterminate = sel.length > 0 && sel.length < movSelectable.length; }
  bar.classList.toggle('hidden', !sel.length);
  if (!sel.length) { S.movBulkCat = ''; return; }
  const dirs = new Set(sel.map(t => t.direction));
  const count = `<span>${sel.length} selecionado(s)</span>`;
  const cancel = '<button class="btn" data-bulk-cancel>Cancelar</button>';
  if (dirs.size > 1) {
    bar.innerHTML = `${count}<span class="err">Escolhe só entradas ou só saídas: têm categorias diferentes</span>${cancel}`;
    return;
  }
  const cats = knownCategories([...dirs][0]);
  if (S.movBulkCat && !cats.includes(S.movBulkCat)) cats.push(S.movBulkCat);   // categoria nova escrita à mão
  bar.innerHTML = `${count}
    <details class="multi" id="mov-bulk-cat">
      <summary>Categoria: ${S.movBulkCat ? esc(S.movBulkCat) : 'escolher'}</summary>
      <div class="multi-panel">
        ${cats.map(c => `<label class="check"><input type="checkbox" data-pick value="${esc(c)}" ${c === S.movBulkCat ? 'checked' : ''}> ${esc(c)}</label>`).join('')}
        <input class="inline" data-newcat placeholder="Outra categoria… (Enter)">
      </div>
    </details>
    <button class="btn primary" data-bulk-apply ${S.movBulkCat ? '' : 'disabled'}>Mudar categoria</button>${cancel}`;
}

// Marcar / desmarcar um movimento ou todos (sem redesenhar a página toda)
$('#mov-table').addEventListener('change', e => {
  if (e.target.id === 'mov-sel-all') {
    S.movSel = new Set(e.target.checked ? movSelectable : []);
    $$('#mov-table [data-sel]').forEach(c => { c.checked = e.target.checked; c.closest('tr').classList.toggle('selected', c.checked); });
  } else if (e.target.dataset.sel) {
    S.movSel[e.target.checked ? 'add' : 'delete'](e.target.dataset.sel);
    e.target.closest('tr').classList.toggle('selected', e.target.checked);
  } else return;
  renderBulk();
});
// Escolher a categoria: só pode haver uma, por isso marcar uma desmarca as outras (e fecha a lista)
$('#mov-bulk').addEventListener('change', e => {
  if (!e.target.matches('[data-pick]')) return;
  S.movBulkCat = e.target.checked ? e.target.value : '';
  renderBulk();
});
$('#mov-bulk').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('[data-newcat]') || !e.target.value.trim()) return;
  e.preventDefault();
  S.movBulkCat = e.target.value.trim().slice(0, 60);
  renderBulk();
});
$('#mov-bulk').addEventListener('click', async e => {
  if (e.target.matches('[data-bulk-cancel]')) { S.movSel.clear(); renderMovements(); return; }
  if (!e.target.matches('[data-bulk-apply]') || !S.movBulkCat) return;
  const cat = S.movBulkCat;
  const items = D.transactions.filter(t => S.movSel.has(t.id) && t.category !== cat).map(t => ({ ...t, category: cat }));
  const n = S.movSel.size;
  e.target.disabled = true; e.target.textContent = 'A guardar…';
  try {
    if (items.length) await saveItems(items);
    S.movSel.clear(); S.movBulkCat = '';
    renderMovements();
    toast(`${n} movimento(s) em «${cat}»`);
  } catch (x) {
    toast(x.message, true);
    renderBulk();
  }
});

// ── formulário de conta ──
// acc = conta a editar (ou null para criar); after = função a chamar depois de criar
function accountForm(acc = null, after) {
  formModal({
    title: acc ? 'Editar conta' : 'Nova conta',
    values: acc || { acc_type: 'Conta à ordem', opening_balance: '', opening_date: todayISO() },
    fields: [
      { name: 'name', label: 'Nome', type: 'text', required: true, placeholder: 'ex.: CGD, Revolut, Carteira' },
      { name: 'acc_type', label: 'Tipo', type: 'select', options: ACCOUNT_TYPES, required: true },
      { name: 'opening_balance', label: 'Saldo inicial (€)', type: 'money', required: false,
        hint: 'O dinheiro que já estava na conta antes do primeiro movimento que vais registar. Pode ser 0.' },
    ],
    onSubmit: async v => {
      const res = await saveItems([{ kind: 'account', id: acc?.id, name: v.name, acc_type: v.acc_type,
        opening_balance: v.opening_balance ?? 0, opening_date: acc?.opening_date || todayISO() }]);
      toast(acc ? 'Conta atualizada' : 'Conta criada');
      if (after) setTimeout(() => after(res.saved[0]), 50);
    },
    danger: acc && { label: 'Apagar conta', onClick: async () => {
      const n = D.transactions.filter(t => t.account_id === acc.id || t.to_account_id === acc.id).length;
      if (await confirmDialog(`Apagar a conta <b>${esc(acc.name)}</b>${n ? ` e os <b>${n} movimentos</b> dela` : ''}? Não dá para desfazer.`)) {
        try { await removeItem(acc.id, 'Conta'); } catch (e) { toast(e.message, true); }
      }
    } },
  });
}

// ── formulário de movimento ──
// Sem contas, primeiro abre o formulário de conta e depois volta aqui. preset = valores iniciais.
function txForm(tx = null, preset = {}) {
  if (!D.accounts.length) {
    toast('Primeiro cria uma conta');
    return accountForm(null, () => txForm(tx, preset));
  }
  const accOpts = sortByName(D.accounts).map(a => ({ value: a.id, label: a.name }));
  const defaults = { direction: 'out', date: todayISO(), account_id: S.movAccount || accOpts[0].value, amount: '', category: '', description: '', approx: false, ...preset };
  formModal({
    title: tx ? 'Editar movimento' : 'Novo movimento',
    values: tx ? { ...tx } : defaults,
    fields: [
      { name: 'direction', label: 'Tipo', type: 'seg', required: true,
        options: [{ value: 'out', label: 'Saída' }, { value: 'in', label: 'Entrada' }, { value: 'transfer', label: 'Transferência' }],
        onChange: (v, st, f) => f.setSuggestions('category', knownCategories(v === 'transfer' ? 'out' : v)) },
      { name: 'amount', label: 'Valor (€)', type: 'money', required: true, positive: true, half: true, placeholder: '0,00' },
      { name: 'date', label: 'Data', type: 'date', required: true, half: true },
      { name: 'account_id', label: 'Conta', type: 'select', options: accOpts, required: true, half: true },
      { name: 'to_account_id', label: 'Para a conta', type: 'select', options: accOpts, required: true, half: true, showIf: v => v.direction === 'transfer' },
      { name: 'category', label: 'Categoria', type: 'suggest', required: true, showIf: v => v.direction !== 'transfer', placeholder: 'Escolhe ou escreve uma nova',
        init: (st, f) => f.setSuggestions('category', knownCategories(st.direction === 'in' ? 'in' : 'out')) },
      { name: 'description', label: 'Descrição', type: 'text', placeholder: 'ex.: Continente, renda de março…' },
      { name: 'approx', label: 'Valor aproximado (ex.: reconstituído de papel)', type: 'check' },
    ],
    onSubmit: async v => {
      if (v.direction === 'transfer' && v.to_account_id === v.account_id) throw new Error('Escolhe duas contas diferentes');
      await saveItems([{ kind: 'transaction', id: tx?.id, ...v, category: v.direction === 'transfer' ? 'Transferência' : v.category }]);
      toast(tx ? 'Movimento atualizado' : 'Movimento guardado');
    },
    danger: tx && { label: 'Apagar', onClick: () => deleteTx(tx.id) },
  });
}
// Apagar um movimento (depois de confirmar)
async function deleteTx(id) {
  const t = findById('transactions', id);
  if (!t) return;
  if (await confirmDialog(`Apagar o movimento de <b>${eur(t.amount)}</b> (${esc(t.category)}, ${dateLabel(t.date)})?`)) {
    try { await removeItem(id, 'Movimento'); } catch (e) { toast(e.message, true); }
  }
}

// ── grelha "Histórico por mês": totais aproximados por categoria ──
// Para reconstituir meses antigos: cada valor vira um movimento "≈" no último dia do mês,
// repetido em todos os meses do intervalo. Valores já registados não são duplicados.
function historyGrid() {
  if (!D.accounts.length) { toast('Primeiro cria uma conta'); return accountForm(null, historyGrid); }
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  const outCats = knownCategories('out'), inCats = knownCategories('in');
  const catRows = (cats, dir) => cats.map(c => `<tr><td>${esc(c)}</td><td style="width:130px"><input data-dir="${dir}" data-cat="${esc(c)}" inputmode="decimal" placeholder="0"></td></tr>`).join('') +
    `<tr><td><input data-dir="${dir}" data-custom="1" placeholder="Outra categoria…" style="text-align:left"></td><td><input data-dir="${dir}" data-custom-val="1" inputmode="decimal" placeholder="0"></td></tr>`;
  body.innerHTML = `
    <div class="modal-hint">Para reconstituir meses antigos (por exemplo, a partir de registos em papel): escolhe a conta e o mês,
      e escreve o <b>total aproximado</b> de cada categoria. Cada valor fica como um movimento marcado com <span class="badge approx">≈</span>
      no último dia do mês. Se os valores forem iguais durante vários meses, escolhe um intervalo e eles repetem-se.</div>
    <div class="field-row" style="grid-template-columns:1fr 1fr 1fr">
      <div class="field"><label>Conta</label><select id="hg-acc">${sortByName(D.accounts).map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Do mês</label><input type="month" id="hg-from" value="${addMonths(thisMonth(), -1)}"></div>
      <div class="field"><label>Até ao mês</label><input type="month" id="hg-to" value="${addMonths(thisMonth(), -1)}"></div>
    </div>
    <div class="grid-cols">
      <div><div class="grid-section-title neg">Saídas</div><div class="grid-scroll"><table class="grid-edit"><tbody>${catRows(outCats, 'out')}</tbody></table></div></div>
      <div><div class="grid-section-title pos">Entradas</div><div class="grid-scroll"><table class="grid-edit"><tbody>${catRows(inCats, 'in')}</tbody></table></div></div>
    </div>
    <div class="preview-box" id="hg-summary">Preenche pelo menos um valor.</div>
    <div class="form-error" id="hg-err"></div>`;

  // Lê a grelha: meses do intervalo + lista de {sentido, categoria, valor} preenchidos
  const collect = () => {
    const from = $('#hg-from', body).value, to = $('#hg-to', body).value || from;
    const entries = [];
    $$('input[data-cat]', body).forEach(i => { const n = parseNum(i.value); if (n > 0) entries.push({ dir: i.dataset.dir, cat: i.dataset.cat, amount: round2(n) }); });
    ['out', 'in'].forEach(dir => {
      const name = $(`input[data-custom][data-dir="${dir}"]`, body).value.trim();
      const n = parseNum($(`input[data-custom-val][data-dir="${dir}"]`, body).value);
      if (name && n > 0) entries.push({ dir, cat: name, amount: round2(n) });
    });
    return { from, to, months: monthRange(from, to), entries };
  };
  // Atualiza o resumo por baixo da grelha sempre que se escreve
  const update = () => {
    const { months, entries } = collect();
    const tin = entries.filter(e => e.dir === 'in').reduce((s, e) => s + e.amount, 0);
    const tout = entries.filter(e => e.dir === 'out').reduce((s, e) => s + e.amount, 0);
    $('#hg-summary', body).innerHTML = !months.length ? '<span class="err">O mês final tem de ser igual ou depois do inicial</span>'
      : entries.length ? `Por mês: entradas <b class="pos">${eur(tin)}</b> · saídas <b class="neg">${eur(tout)}</b> · saldo <b>${eurSigned(tin - tout)}</b><br>
        Vai criar <b>${entries.length * months.length}</b> movimento(s) em <b>${months.length}</b> mês(es) (${monthLabel(months[0])}${months.length > 1 ? ' → ' + monthLabel(months[months.length - 1]) : ''}).`
      : 'Preenche pelo menos um valor.';
  };
  body.addEventListener('input', update);

  modal.open({
    title: 'Histórico por mês', body, wide: true,
    footer: [
      { label: 'Cancelar', onClick: () => modal.close() },
      { label: 'Adicionar ao histórico', cls: 'primary', onClick: async e => {
        const { months, entries } = collect();
        const acc = $('#hg-acc', body).value;
        if (!months.length) return ($('#hg-err', body).textContent = 'Verifica os meses');
        if (!entries.length) return ($('#hg-err', body).textContent = 'Preenche pelo menos um valor');
        if (months.length > 240) return ($('#hg-err', body).textContent = 'Máximo de 20 anos de cada vez');
        const existing = new Set(D.transactions.map(fingerprint));
        const items = [];
        let skipped = 0;
        for (const m of months) for (const en of entries) {
          const it = { kind: 'transaction', date: lastDayOf(m), account_id: acc, direction: en.dir, category: en.cat,
            description: 'Total aproximado do mês', amount: en.amount, approx: true };
          if (existing.has(fingerprint(it))) { skipped++; continue; }
          items.push(it);
        }
        if (!items.length) return ($('#hg-err', body).textContent = 'Esses valores já estão todos registados');
        e.target.disabled = true; e.target.textContent = 'A guardar…';
        try {
          await saveItems(items);
          modal.close();
          toast(`${items.length} movimentos adicionados${skipped ? ` (${skipped} já existiam)` : ''}`);
        } catch (err) {
          $('#hg-err', body).textContent = err.message;
          e.target.disabled = false; e.target.textContent = 'Adicionar ao histórico';
        }
      } },
    ],
  });
}

// ════════ INVESTIMENTOS ════════
// Filtro: carteira completa ou um investimento
$('#inv-filter').addEventListener('change', e => { S.invFilter = e.target.value; renderInvestments(); });

// Desenha o separador Investimentos: resumo, 3 gráficos e 2 tabelas
function renderInvestments() {
  S.invFilter = fillSelect($('#inv-filter'), sortByName(D.investments).map(i => ({ value: i.id, label: i.name })), S.invFilter, 'Carteira completa');
  const f = S.invFilter;
  const sum = f ? investmentSummary(f) : portfolioSummary();
  const year = thisMonth().slice(0, 4);
  const yearMonths = monthRange(`${year}-01`, thisMonth());
  const yearContrib = netContributions(yearMonths, f).reduce((s, x) => s + x, 0);

  $('#inv-invested').textContent = eur(sum.invested);
  $('#inv-value').textContent = eur(sum.value);
  const lastVal = D.valuations.filter(v => !f || v.investment_id === f).reduce((m, v) => (v.month > m ? v.month : m), '');
  $('#inv-value-sub').textContent = lastVal ? `último valor registado: ${monthLabel(lastVal)}` : 'sem valores registados — usa "Atualizar mês"';
  $('#inv-gain').textContent = eurSigned(sum.gain);
  $('#inv-gain').className = 'stat-value ' + signClass(sum.gain);
  $('#inv-gain-sub').textContent = isFinite(sum.gainPct) ? `${pct(sum.gainPct)} sobre o investido` : '—';
  $('#inv-year').textContent = eurSigned(round2(yearContrib));
  $('#inv-year-sub').textContent = `${year} · média ${eurShort(yearContrib / yearMonths.length)}/mês`;

  // gráfico: valor vs investido ao longo do tempo
  const s = investmentSeries(f);
  drawChart('chart-inv-value', {
    type: 'line',
    data: { labels: s.months.map(monthShort), datasets: [
      lineDataset('Valor', s.value, SERIES[0]),
      lineDataset('Investido', s.invested, SERIES[1], { borderDash: [6, 4], stepped: 'before', tension: 0 }),
    ] },
    options: {
      interaction: INDEX_HOVER,
      scales: { x: catAxis(), y: moneyAxis({ beginAtZero: true }) },
      plugins: {
        legend: { position: 'top', align: 'end' },
        tooltip: { callbacks: { title: i => monthLabel(s.months[i[0].dataIndex]), label: tooltipMoney,
          footer: i => { const k = i[0].dataIndex, g = s.value[k] - s.invested[k]; return `Ganho/perda: ${eurSigned(g)}${s.invested[k] > 0 ? ` (${pct(g / s.invested[k])})` : ''}`; } } },
      },
    },
  }, 'Adiciona um investimento e usa "Atualizar mês" para registar aportes e o valor no fim de cada mês.');

  // gráfico: aportes líquidos por mês (últimos 12)
  const m12 = monthRange(addMonths(thisMonth(), -11), thisMonth());
  const c12 = netContributions(m12, f);
  drawChart('chart-inv-contrib', {
    type: 'bar',
    data: { labels: m12.map(monthShort), datasets: [barDataset('Aportes líquidos', c12, SERIES[0])] },
    options: {
      scales: { x: catAxis(), y: moneyAxis() },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => monthLabel(m12[i[0].dataIndex]), label: c => ` ${eurSigned(c.parsed.y)}` } } },
    },
  }, 'Sem aportes nos últimos 12 meses');

  // gráfico: ganho/perda acumulado (linha do zero mais visível)
  const gains = s.months.map((_, i) => round2(s.value[i] - s.invested[i]));
  drawChart('chart-inv-gain', {
    type: 'line',
    data: { labels: s.months.map(monthShort), datasets: [lineDataset('Ganho / perda', gains, SERIES[0])] },
    options: {
      interaction: INDEX_HOVER,
      scales: { x: catAxis(), y: moneyAxis({ grid: { color: c => (c.tick.value === 0 ? '#4a5470' : GRID), drawTicks: false } }) },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => monthLabel(s.months[i[0].dataIndex]), label: c => ` ${eurSigned(c.parsed.y)}` } } },
    },
  }, 'O ganho aparece quando registares o valor dos investimentos');

  // tabela de investimentos (clicar no nome filtra a página por esse investimento)
  const invs = sortByName(D.investments).map(i => ({ i, ...investmentSummary(i.id) }));
  const totalValue = invs.reduce((s2, x) => s2 + x.value, 0);
  $('#inv-table').innerHTML = invs.length ? `<table class="data">
    <thead><tr><th>Investimento</th><th class="num">Investido</th><th class="num">Valor</th><th class="num">Ganho / perda</th><th class="num">%</th><th class="num">Peso</th><th>Último valor</th><th></th></tr></thead>
    <tbody>${invs.map(x => `<tr>
      <td><a href="#" class="li-name" style="color:inherit" data-inv-focus="${esc(x.i.id)}">${esc(x.i.name)}</a><div class="li-sub">${esc(x.i.inv_type)}</div></td>
      <td class="num">${eur(x.invested)}</td>
      <td class="num">${eur(x.value)}</td>
      <td class="num ${signClass(x.gain)}">${eurSigned(x.gain)}</td>
      <td class="num ${signClass(x.gain)}">${pct(x.gainPct)}</td>
      <td class="num muted">${totalValue > 0 ? Math.round(x.value / totalValue * 100) + '%' : '—'}</td>
      <td class="date">${x.lastValMonth ? monthShort(x.lastValMonth) : '—'}</td>
      <td class="actions"><button class="icon-btn" data-edit-inv="${esc(x.i.id)}" aria-label="Editar">✎</button></td>
    </tr>`).join('')}</tbody></table>`
    : `<div class="empty">Ainda não tens investimentos.<br><button class="btn primary" data-action="inv-new">+ Investimento</button></div>`;

  // tabela de aportes e resgates (os 300 mais recentes)
  const moves = D.inv_moves.filter(x => !f || x.investment_id === f).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300);
  $('#imv-table').innerHTML = moves.length ? `<table class="data">
    <thead><tr><th>Data</th><th>Investimento</th><th>Operação</th><th>Descrição</th><th class="num">Valor</th><th></th></tr></thead>
    <tbody>${moves.map(x => `<tr>
      <td class="date">${dateLabel(x.date)}</td>
      <td>${esc(investmentName(x.investment_id))}</td>
      <td><span class="badge ${x.move === 'contribution' ? 'in' : 'out'}">${x.move === 'contribution' ? 'Aporte' : 'Resgate'}</span>${x.approx ? '<span class="badge approx">≈</span>' : ''}</td>
      <td class="desc muted">${esc(x.description) || '—'}</td>
      <td class="num">${eur(x.amount)}</td>
      <td class="actions"><button class="icon-btn" data-edit-imv="${esc(x.id)}" aria-label="Editar">✎</button><button class="icon-btn del" data-del-imv="${esc(x.id)}" aria-label="Apagar">✕</button></td>
    </tr>`).join('')}</tbody></table>`
    : `<div class="empty">Sem aportes ou resgates registados.</div>`;
}

// Formulário de investimento (criar / editar / apagar)
function investmentForm(inv = null, after) {
  formModal({
    title: inv ? 'Editar investimento' : 'Novo investimento',
    values: inv || { inv_type: 'ETF' },
    fields: [
      { name: 'name', label: 'Nome', type: 'text', required: true, placeholder: 'ex.: VWCE, PPR Save & Grow, Bitcoin' },
      { name: 'inv_type', label: 'Tipo', type: 'select', options: INVESTMENT_TYPES, required: true },
      { name: 'notes', label: 'Notas', type: 'textarea', placeholder: 'Corretora, objetivo, etc.' },
    ],
    onSubmit: async v => {
      const res = await saveItems([{ kind: 'investment', id: inv?.id, ...v }]);
      toast(inv ? 'Investimento atualizado' : 'Investimento criado');
      if (after) setTimeout(() => after(res.saved[0]), 50);
    },
    danger: inv && { label: 'Apagar investimento', onClick: async () => {
      if (await confirmDialog(`Apagar <b>${esc(inv.name)}</b> com todos os aportes, resgates e valores mensais? Não dá para desfazer.`)) {
        try { await removeItem(inv.id, 'Investimento'); } catch (e) { toast(e.message, true); }
      }
    } },
  });
}

// Formulário de um aporte ou resgate
function invMoveForm(mv = null) {
  if (!D.investments.length) { toast('Primeiro cria um investimento'); return investmentForm(null, () => invMoveForm()); }
  const opts = sortByName(D.investments).map(i => ({ value: i.id, label: i.name }));
  formModal({
    title: mv ? 'Editar operação' : 'Aporte / resgate',
    values: mv ? { ...mv } : { move: 'contribution', date: todayISO(), investment_id: S.invFilter || opts[0].value, amount: '' },
    fields: [
      { name: 'move', label: 'Operação', type: 'seg', required: true, options: [{ value: 'contribution', label: 'Aporte (pus dinheiro)' }, { value: 'withdrawal', label: 'Resgate (tirei dinheiro)' }] },
      { name: 'investment_id', label: 'Investimento', type: 'select', options: opts, required: true },
      { name: 'amount', label: 'Valor (€)', type: 'money', required: true, positive: true, half: true },
      { name: 'date', label: 'Data', type: 'date', required: true, half: true },
      { name: 'description', label: 'Descrição', type: 'text' },
      { name: 'approx', label: 'Valor aproximado', type: 'check' },
    ],
    onSubmit: async v => {
      await saveItems([{ kind: 'inv_move', id: mv?.id, ...v }]);
      toast('Guardado');
    },
    danger: mv && { label: 'Apagar', onClick: () => deleteImv(mv.id) },
  });
}
// Apagar um aporte/resgate (depois de confirmar)
async function deleteImv(id) {
  const x = findById('inv_moves', id);
  if (x && await confirmDialog(`Apagar ${x.move === 'contribution' ? 'o aporte' : 'o resgate'} de <b>${eur(x.amount)}</b> em ${esc(investmentName(x.investment_id))}?`)) {
    try { await removeItem(id, 'Registo'); } catch (e) { toast(e.message, true); }
  }
}

// ── rotina mensal "Atualizar mês": aportes + valor no fim do mês, numa só grelha ──
// Apagar um valor na grelha apaga o valor desse mês; só grava valores que mudaram.
function investmentMonthGrid() {
  if (!D.investments.length) { toast('Primeiro cria um investimento'); return investmentForm(null, investmentMonthGrid); }
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="modal-hint">Uma vez por mês (ou para meses antigos): regista quanto puseste ou tiraste e <b>quanto vale</b> cada investimento
      no fim do mês (vê na app do banco/corretora). É com estes valores que a app calcula o ganho ou perda.</div>
    <div class="field" style="max-width:220px"><label>Mês</label><input type="month" id="ig-month" value="${thisMonth()}"></div>
    <div class="grid-scroll"><table class="grid-edit"><thead><tr><th>Investimento</th><th style="text-align:right">Investido até ao mês</th><th style="width:150px">Novo aporte (+) / resgate (−)</th><th style="width:150px">Valor no fim do mês</th></tr></thead><tbody id="ig-rows"></tbody></table></div>
    <div class="form-error" id="ig-err"></div>`;

  const renderRows = () => {
    const m = $('#ig-month', body).value || thisMonth();
    $('#ig-rows', body).innerHTML = sortByName(D.investments).map(i => {
      const cur = valuationFor(i.id, m), prev = lastValuationBefore(i.id, m);
      return `<tr data-id="${esc(i.id)}">
        <td>${esc(i.name)}<div class="li-sub">${esc(i.inv_type)}</div></td>
        <td class="num">${eur(investedUpTo(i.id, m))}</td>
        <td><input data-f="move" inputmode="decimal" placeholder="0"></td>
        <td><input data-f="value" inputmode="decimal" value="${numInput(cur?.value)}" placeholder="${prev ? 'antes: ' + eurShort(prev.value) : 'ex.: 1 234,56'}"></td>
      </tr>`;
    }).join('');
  };
  renderRows();
  $('#ig-month', body).addEventListener('change', renderRows);

  modal.open({
    title: 'Atualizar investimentos do mês', body, wide: true,
    footer: [
      { label: 'Cancelar', onClick: () => modal.close() },
      { label: 'Guardar mês', cls: 'primary', onClick: async e => {
        const m = $('#ig-month', body).value;
        const err = $('#ig-err', body);
        if (!m) return (err.textContent = 'Escolhe o mês');
        const items = [], deletes = [];
        for (const tr of $$('#ig-rows tr', body)) {
          const id = tr.dataset.id;
          const mvRaw = $('[data-f=move]', tr).value.trim(), valRaw = $('[data-f=value]', tr).value.trim();
          if (mvRaw) {
            const n = parseNum(mvRaw);
            if (isNaN(n) || n === 0) return (err.textContent = `Valor de aporte inválido em ${investmentName(id)}`);
            items.push({ kind: 'inv_move', investment_id: id, date: m === thisMonth() ? todayISO() : lastDayOf(m),
              move: n > 0 ? 'contribution' : 'withdrawal', amount: Math.abs(n), description: '' });
          }
          const cur = valuationFor(id, m);
          if (valRaw) {
            const v = parseNum(valRaw);
            if (isNaN(v) || v < 0) return (err.textContent = `Valor inválido em ${investmentName(id)}`);
            if (!cur || cur.value !== round2(v)) items.push({ kind: 'valuation', investment_id: id, month: m, value: v });
          } else if (cur) deletes.push(cur.id);
        }
        if (!items.length && !deletes.length) return (err.textContent = 'Não há nada para guardar');
        e.target.disabled = true; e.target.textContent = 'A guardar…';
        try {
          await saveItems(items, deletes);
          modal.close();
          toast(`${monthLabel(m)} guardado`);
        } catch (x) {
          err.textContent = x.message;
          e.target.disabled = false; e.target.textContent = 'Guardar mês';
        }
      } },
    ],
  });
}

// ════════ CRÉDITOS ════════
// Desenha o separador Créditos: resumo, gráfico da dívida e um cartão por crédito
function renderLoans() {
  const loans = sortByName(D.loans);
  const total = round2(loans.reduce((s, l) => s + loanCurrent(l), 0));
  const principal = loans.reduce((s, l) => s + l.principal, 0);
  const active = loans.filter(l => loanCurrent(l) > 0);
  const lefts = active.map(loanMonthsLeft);

  $('#loan-total').textContent = eur(total);
  $('#loan-total-sub').textContent = `${active.length} crédito(s) ativo(s)`;
  $('#loan-payments').textContent = eur(active.reduce((s, l) => s + (l.payment || 0), 0));
  $('#loan-paid').textContent = eur(Math.max(0, principal - total));
  $('#loan-paid-sub').textContent = principal > 0 ? `${Math.round(Math.max(0, principal - total) / principal * 100)}% do montante inicial` : '—';
  // "Livre de dívidas em": o crédito que acaba mais tarde (— se algum não der para estimar)
  // "fim do contrato" quando todos os créditos ativos têm essa data; senão é uma estimativa pela fórmula
  $('#loan-free-sub').textContent = active.length && active.every(l => l.end_date) ? 'fim do(s) contrato(s)' : 'estimativa';
  $('#loan-free').textContent = !active.length ? (loans.length ? 'Já estás!' : '—')
    : lefts.some(x => x === null) ? '—' : monthLabel(addMonths(thisMonth(), Math.max(...lefts)));

  const s = loanSeries();
  // Até 4 créditos: uma linha por crédito; mais do que isso: só a linha do total
  const datasets = s.perLoan.length <= 4
    ? s.perLoan.map((p, i) => lineDataset(p.loan.name, p.values, SERIES[i], { stepped: 'before', tension: 0 }))
    : [lineDataset('Total em dívida', s.total, SERIES[0], { stepped: 'before', tension: 0 })];
  drawChart('chart-loan', {
    type: 'line',
    data: { labels: s.months.map(monthShort), datasets },
    options: {
      interaction: INDEX_HOVER,
      scales: { x: catAxis(), y: moneyAxis({ beginAtZero: true }) },
      plugins: {
        legend: { display: datasets.length > 1, position: 'top', align: 'end' },
        tooltip: { callbacks: { title: i => monthLabel(s.months[i[0].dataIndex]), label: tooltipMoney,
          footer: i => (datasets.length > 1 ? `Total: ${eur(s.total[i[0].dataIndex])}` : '') } },
      },
    },
  }, 'Adiciona um crédito e regista o saldo em dívida com "Atualizar mês".');

  $('#loan-list').innerHTML = loans.length ? loans.map(l => {
    const cur = loanCurrent(l);
    const paid = Math.max(0, l.principal - cur);
    const pctPaid = l.principal > 0 ? Math.min(100, paid / l.principal * 100) : 0;
    const left = loanMonthsLeft(l);
    const lastBal = D.loan_balances.filter(b => b.loan_id === l.id).reduce((m, b) => (b.month > m ? b.month : m), '');
    return `<div class="loan-card">
      <div class="loan-top">
        <div><div class="li-name">${esc(l.name)}</div><div class="li-sub">${esc(l.loan_type)}${l.lender ? ' · ' + esc(l.lender) : ''} · desde ${dateLabel(l.start_date)}</div></div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="li-value">${eur(cur)}<div class="li-sub" style="text-align:right">em dívida${lastBal ? ' · ' + monthShort(lastBal) : ''}</div></div>
          <button class="icon-btn" data-edit-loan="${esc(l.id)}" aria-label="Editar">✎</button>
        </div>
      </div>
      <div>
        <div class="progress" role="progressbar" aria-valuenow="${Math.round(pctPaid)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pctPaid}%"></div></div>
        <div class="progress-label" style="margin-top:6px"><span>${Math.round(pctPaid)}% pago (${eur(paid)})</span><span>montante inicial ${eur(l.principal)}</span></div>
      </div>
      <div class="loan-meta">
        <div><div class="k">Prestação</div><div class="v">${l.payment ? eur(l.payment) : '—'}</div></div>
        <div><div class="k">Taxa</div><div class="v">${l.rate !== undefined && l.rate !== null ? String(l.rate).replace('.', ',') + '%' : '—'}</div></div>
        <div><div class="k">Faltam</div><div class="v">${cur <= 0 ? 'pago ✓' : left === null ? '—' : `${Math.floor(left / 12)}a ${left % 12}m`}</div></div>
        <div><div class="k">${l.end_date ? 'Fim do contrato' : 'Fim previsto'}</div><div class="v">${cur <= 0 ? '—' : left === null ? '—' : monthShort(addMonths(thisMonth(), left))}</div></div>
      </div>
    </div>`;
  }).join('') : `<div class="empty">Sem créditos registados. Boa!<br>Se tiveres algum, adiciona-o para acompanhar a amortização.<br><button class="btn primary" data-action="loan-new">+ Crédito</button></div>`;

  renderLoanHistory();
}

// ── histórico de prestações de um crédito ──
$('#loan-history-select').addEventListener('change', e => { S.loanHistory = e.target.value; renderLoanHistory(); });

// Resumo, gráfico (capital vs juros de cada prestação) e tabela mês a mês com totais por ano
function renderLoanHistory() {
  const loans = sortByName(D.loans);
  $('#loan-history-panel').classList.toggle('hidden', !loans.length);
  if (!loans.length) return;
  // Por omissão mostra o crédito com mais dívida (normalmente o da casa)
  if (!loans.some(l => l.id === S.loanHistory)) S.loanHistory = [...loans].sort((a, b) => loanCurrent(b) - loanCurrent(a))[0].id;
  const sel = $('#loan-history-select');
  sel.innerHTML = loans.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
  sel.value = S.loanHistory;
  sel.classList.toggle('hidden', loans.length < 2);

  const loan = findById('loans', S.loanHistory);
  const rows = loanHistory(loan);
  const year = thisMonth().slice(0, 4);
  const t = loanTotals(rows, year);
  const anyEstimated = rows.some(r => r.estimated);

  $('#loan-history-stats').innerHTML = `
    <div class="stat"><div class="stat-label">Prestações pagas</div><div class="stat-value">${eur(t.payments)}</div><div class="stat-sub">${rows.filter(r => r.payment !== null).length} prestação(ões) registada(s)</div></div>
    <div class="stat"><div class="stat-label">Dos quais juros</div><div class="stat-value">${eur(t.interest)}</div><div class="stat-sub">${t.payments > 0 ? pct(t.interest / t.payments, 0).replace('+', '') + ' do que pagaste' : '—'}${anyEstimated ? ' · inclui estimativas' : ''}</div></div>
    <div class="stat"><div class="stat-label">Juros em ${year}</div><div class="stat-value">${eur(t.yearInterest)}</div><div class="stat-sub">prestações em ${year}: ${eur(t.yearPayments)}</div></div>
    <div class="stat"><div class="stat-label">Amortizações extra</div><div class="stat-value">${eur(t.extra)}</div><div class="stat-sub">${rows.filter(r => r.extra > 0).map(r => monthShort(r.month)).join(', ') || 'nenhuma registada'}</div></div>`;

  // Gráfico: cada barra é uma prestação, dividida em capital e juros (a amortização extra fica no tooltip,
  // porque uma barra de 5 000 € esmagaria as prestações normais)
  const chartRows = rows.filter(r => r.interest !== null).slice(-60);
  drawChart('chart-loan-pay', {
    type: 'bar',
    data: { labels: chartRows.map(r => monthShort(r.month)), datasets: [
      barDataset('Capital', chartRows.map(r => r.principal), SERIES[0], { stack: 'p' }),
      barDataset('Juros', chartRows.map(r => r.interest), SERIES[1], { stack: 'p' }),
    ] },
    options: {
      interaction: INDEX_HOVER,
      scales: { x: { ...catAxis(), stacked: true }, y: moneyAxis({ stacked: true, beginAtZero: true }) },
      plugins: {
        legend: { position: 'top', align: 'end' },
        tooltip: { callbacks: { title: i => monthLabel(chartRows[i[0].dataIndex].month), label: tooltipMoney,
          footer: i => { const r = chartRows[i[0].dataIndex];
            return [r.payment !== null ? `Prestação: ${eur(r.payment)}` : 'Prestação não registada (juros estimados)',
              ...(r.extra ? [`Amortização extra: ${eur(r.extra)}`] : [])]; } } },
      },
    },
  }, 'Regista o saldo em dívida e a prestação em "Atualizar mês" para ver quanto é juro e quanto é capital.');

  // Tabela: mais recente primeiro, com uma linha de total no início de cada ano
  const money = v => (v === null ? '<span class="muted">—</span>' : eur(v));
  const desc = [...rows].reverse();
  let html = '', curYear = null;
  for (const r of desc) {
    const y = r.month.slice(0, 4);
    if (y !== curYear) {
      curYear = y;
      const ty = loanTotals(rows.filter(x => x.month.startsWith(y)));
      html += `<tr class="year-row"><td>${y}</td><td class="num">${eur(ty.payments)}</td><td class="num">${eur(ty.interest)}</td>
        <td class="num">${eur(ty.principal)}</td><td class="num">${ty.extra ? eur(ty.extra) : ''}</td><td></td><td></td></tr>`;
    }
    html += `<tr>
      <td class="date">${monthLabel(r.month)}${r.extra ? '<span class="badge extra">extra</span>' : ''}</td>
      <td class="num">${money(r.payment)}</td>
      <td class="num">${r.interest === null ? money(null) : (r.estimated ? '≈ ' : '') + eur(r.interest)}</td>
      <td class="num">${money(r.principal)}</td>
      <td class="num ${r.extra ? 'pos' : 'muted'}">${r.extra ? eur(r.extra) : '—'}</td>
      <td class="num">${r.drop === null ? money(null) : eurSigned(-r.drop)}</td>
      <td class="num">${eur(r.balance)}</td>
    </tr>`;
  }
  $('#loan-history-table').innerHTML = rows.length ? `<table class="data">
    <thead><tr><th>Mês</th><th class="num">Prestação</th><th class="num">Juros</th><th class="num">Capital</th>
      <th class="num">Amortização extra</th><th class="num">Variação da dívida</th><th class="num">Dívida no fim do mês</th></tr></thead>
    <tbody>${html}</tbody></table>
    <div class="empty" style="text-align:left">Juros = prestação + amortização extra − quanto a dívida baixou no mês
      (se a prestação incluir seguros ou comissões, também contam aqui).${anyEstimated ? ' «≈» = sem prestação registada: estimado com a taxa do crédito.' : ''}</div>`
    : `<div class="empty">Ainda sem saldos registados para este crédito.<br><button class="btn primary" data-action="loan-month">Atualizar mês</button></div>`;
}

// Formulário de crédito (criar / editar / apagar)
function loanForm(loan = null, after) {
  formModal({
    title: loan ? 'Editar crédito' : 'Novo crédito',
    values: loan ? { ...loan } : { loan_type: 'Habitação', start_date: todayISO() },
    intro: loan ? '' : 'O saldo em dívida atual regista-se depois, em "Atualizar mês". Se não registares nenhum, assume-se o montante inicial.',
    fields: [
      { name: 'name', label: 'Nome', type: 'text', required: true, placeholder: 'ex.: Crédito habitação' },
      { name: 'loan_type', label: 'Tipo', type: 'select', options: LOAN_TYPES, required: true, half: true },
      { name: 'lender', label: 'Banco / entidade', type: 'text', half: true },
      { name: 'principal', label: 'Montante inicial (€)', type: 'money', required: true, min: 0, half: true },
      { name: 'start_date', label: 'Data de início', type: 'date', required: true, half: true },
      { name: 'payment', label: 'Prestação mensal (€)', type: 'money', min: 0, half: true },
      { name: 'rate', label: 'Taxa anual (%)', type: 'number', min: 0, half: true, hint: 'TAN atual.' },
      { name: 'end_date', label: 'Fim do contrato (última prestação)', type: 'date',
        hint: 'Está no contrato ou no extrato. Com esta data, "Livre de dívidas" mostra o fim do contrato; sem ela, a app estima pela prestação e pela taxa (pouco fiável com taxa variável).' },
      { name: 'notes', label: 'Notas', type: 'textarea' },
    ],
    onSubmit: async v => {
      const res = await saveItems([{ kind: 'loan', id: loan?.id, ...v }]);
      toast(loan ? 'Crédito atualizado' : 'Crédito criado');
      if (after) setTimeout(() => after(res.saved[0]), 50);
    },
    danger: loan && { label: 'Apagar crédito', onClick: async () => {
      if (await confirmDialog(`Apagar <b>${esc(loan.name)}</b> e todo o histórico de saldos? Não dá para desfazer.`)) {
        try { await removeItem(loan.id, 'Crédito'); } catch (e) { toast(e.message, true); }
      }
    } },
  });
}

// Grelha "Atualizar mês" dos créditos: saldo em dívida, prestação e amortização extra de cada crédito num mês
function loanMonthGrid() {
  if (!D.loans.length) { toast('Primeiro adiciona um crédito'); return loanForm(null, loanMonthGrid); }
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="modal-hint">Regista o <b>saldo em dívida</b> de cada crédito no fim do mês (aparece no extrato ou na app do banco),
      a <b>prestação</b> que pagaste e, se fizeste, a <b>amortização extraordinária</b>. Os juros do mês são calculados sozinhos:
      prestação + amortização extra − quanto a dívida baixou. Podes escolher meses antigos para reconstituir o histórico.
      Quando acabares de pagar um crédito, escreve 0.</div>
    <div class="field" style="max-width:220px"><label>Mês</label><input type="month" id="lg-month" value="${thisMonth()}"></div>
    <div class="grid-scroll"><table class="grid-edit"><thead><tr><th>Crédito</th><th style="text-align:right">Saldo anterior</th><th style="width:130px">Saldo em dívida</th><th style="width:110px">Prestação paga</th><th style="width:110px">Amortização extra</th><th style="text-align:right">Juros do mês</th></tr></thead><tbody id="lg-rows"></tbody></table></div>
    <div class="form-error" id="lg-err"></div>`;
  const renderRows = () => {
    const m = $('#lg-month', body).value || thisMonth();
    $('#lg-rows', body).innerHTML = sortByName(D.loans).map(l => {
      const cur = loanBalanceFor(l.id, m);
      return `<tr data-id="${esc(l.id)}">
        <td>${esc(l.name)}<div class="li-sub">${esc(l.loan_type)}</div></td>
        <td class="num">${eur(loanBalanceAt(l, addMonths(m, -1)))}</td>
        <td><input data-f="balance" inputmode="decimal" value="${numInput(cur?.balance)}" placeholder="ex.: 120 000"></td>
        <td><input data-f="payment" inputmode="decimal" value="${numInput(cur?.payment ?? l.payment)}" placeholder="opcional"></td>
        <td><input data-f="extra" inputmode="decimal" value="${numInput(cur?.extra)}" placeholder="0"></td>
        <td class="num" data-f="interest" data-before="${loanBalanceAt(l, addMonths(m, -1))}">—</td>
      </tr>`;
    }).join('');
    updateInterest();
  };
  // Juros do mês, calculados enquanto escreves: prestação + extra − (saldo anterior − saldo novo)
  const updateInterest = () => {
    for (const tr of $$('#lg-rows tr', body)) {
      const cell = $('[data-f=interest]', tr);
      const b = parseNum($('[data-f=balance]', tr).value), p = parseNum($('[data-f=payment]', tr).value);
      const x = parseNum($('[data-f=extra]', tr).value) || 0;
      cell.textContent = isNaN(b) || isNaN(p) ? '—' : eur(round2(p + x - (Number(cell.dataset.before) - b)));
    }
  };
  renderRows();
  $('#lg-month', body).addEventListener('change', renderRows);
  body.addEventListener('input', updateInterest);

  modal.open({
    title: 'Atualizar créditos do mês', body, wide: true,
    footer: [
      { label: 'Cancelar', onClick: () => modal.close() },
      { label: 'Guardar mês', cls: 'primary', onClick: async e => {
        const m = $('#lg-month', body).value;
        const err = $('#lg-err', body);
        if (!m) return (err.textContent = 'Escolhe o mês');
        const items = [], deletes = [];
        for (const tr of $$('#lg-rows tr', body)) {
          const id = tr.dataset.id, cur = loanBalanceFor(id, m);
          const bRaw = $('[data-f=balance]', tr).value.trim(), pRaw = $('[data-f=payment]', tr).value.trim();
          const xRaw = $('[data-f=extra]', tr).value.trim();
          if (!bRaw) { if (cur) deletes.push(cur.id); continue; }
          const b = parseNum(bRaw), p = pRaw ? parseNum(pRaw) : null, x = xRaw ? parseNum(xRaw) : null;
          if (isNaN(b) || b < 0) return (err.textContent = `Saldo inválido em ${loanName(id)}`);
          if (p !== null && (isNaN(p) || p < 0)) return (err.textContent = `Prestação inválida em ${loanName(id)}`);
          if (x !== null && (isNaN(x) || x < 0)) return (err.textContent = `Amortização extra inválida em ${loanName(id)}`);
          items.push({ kind: 'loan_balance', loan_id: id, month: m, balance: b, payment: p, extra: x });
        }
        if (!items.length && !deletes.length) return (err.textContent = 'Não há nada para guardar');
        e.target.disabled = true; e.target.textContent = 'A guardar…';
        try {
          await saveItems(items, deletes);
          modal.close();
          toast(`${monthLabel(m)} guardado`);
        } catch (x) {
          err.textContent = x.message;
          e.target.disabled = false; e.target.textContent = 'Guardar mês';
        }
      } },
    ],
  });
}

// ════════ PATRIMÓNIO (IMÓVEIS) ════════
// Desenha o separador Património: resumo e tabela dos imóveis
function renderProperties() {
  const props = sortByName(D.properties).map(p => ({ p, ...propertySummary(p) }));
  const total = propertiesTotal();
  const withPrice = props.filter(x => x.gain !== null);
  const gain = round2(withPrice.reduce((s, x) => s + x.gain, 0));
  const bought = withPrice.reduce((s, x) => s + x.p.purchase_price, 0);
  // cada crédito conta uma só vez, mesmo que esteja associado a dois imóveis
  const loans = new Map(props.filter(x => x.loan).map(x => [x.loan.id, x.debt]));
  const debt = round2([...loans.values()].reduce((s, v) => s + v, 0));

  $('#prop-total').textContent = eur(total);
  $('#prop-total-sub').textContent = `${props.length} imóvel(is)`;
  $('#prop-gain').textContent = withPrice.length ? eurSigned(gain) : '—';
  $('#prop-gain').className = 'stat-value ' + (withPrice.length ? signClass(gain) : '');
  $('#prop-gain-sub').textContent = withPrice.length ? `${bought > 0 ? pct(gain / bought) + ' ' : ''}sobre o preço de compra` : 'preenche o preço de compra';
  $('#prop-debt').textContent = debt ? '−' + eur(debt) : eur(0);
  $('#prop-equity').textContent = eur(round2(total - debt));
  $('#prop-equity-sub').textContent = !(total > 0 && debt > 0) ? 'valor − crédito'
    : debt > total ? 'a dívida é maior que o valor' : `${Math.round((total - debt) / total * 100)}% já é teu`;

  $('#prop-table').innerHTML = props.length ? `<table class="data">
    <thead><tr><th>Imóvel</th><th class="num">Valor atual</th><th class="num">Preço de compra</th><th class="num">Valorização</th>
      <th>Crédito associado</th><th class="num">Capital próprio</th><th>Atualizado</th><th></th></tr></thead>
    <tbody>${props.map(x => `<tr>
      <td><div class="li-name">${esc(x.p.name)}</div><div class="li-sub">${esc(x.p.prop_type)}${x.p.purchase_date ? ' · desde ' + dateLabel(x.p.purchase_date) : ''}</div></td>
      <td class="num">${eur(x.p.value)}</td>
      <td class="num">${x.gain === null ? '<span class="muted">—</span>' : eur(x.p.purchase_price)}</td>
      <td class="num ${x.gain === null ? '' : signClass(x.gain)}">${x.gain === null ? '<span class="muted">—</span>' : eurSigned(x.gain) + (isFinite(x.gainPct) ? ` <span class="muted">(${pct(x.gainPct)})</span>` : '')}</td>
      <td>${x.loan ? `${esc(x.loan.name)}<div class="li-sub">${eur(x.debt)} em dívida</div>` : '<span class="muted">—</span>'}</td>
      <td class="num">${eur(x.equity)}</td>
      <td class="date">${x.p.updated_at ? dateLabel(x.p.updated_at.slice(0, 10)) : '—'}</td>
      <td class="actions"><button class="icon-btn" data-edit-prop="${esc(x.p.id)}" aria-label="Editar">✎</button></td>
    </tr>`).join('')}</tbody></table>
    <div class="empty" style="text-align:left">O valor atual conta para o património líquido no topo; o crédito associado já está em "Créditos em dívida".
      Quando o valor mudar (avaliação do banco, anúncios de casas parecidas…), carrega em ✎ e atualiza-o.</div>`
    : `<div class="empty">Ainda não tens imóveis registados.<br>Adiciona a tua casa com o valor que achas que vale hoje.<br><button class="btn primary" data-action="prop-new">+ Imóvel</button></div>`;
}

// Formulário de imóvel (criar / editar / apagar)
function propertyForm(prop = null) {
  const loanOpts = [{ value: '', label: 'Nenhum' }, ...sortByName(D.loans).map(l => ({ value: l.id, label: l.name }))];
  formModal({
    title: prop ? 'Editar imóvel' : 'Novo imóvel',
    values: prop ? { ...prop, loan_id: prop.loan_id || '' } : { prop_type: 'Habitação própria', loan_id: D.loans.find(l => l.loan_type === 'Habitação')?.id || '' },
    fields: [
      { name: 'name', label: 'Nome', type: 'text', required: true, placeholder: 'ex.: Casa, Apartamento Porto' },
      { name: 'prop_type', label: 'Tipo', type: 'select', options: PROPERTY_TYPES, required: true, half: true },
      { name: 'value', label: 'Valor atual (€)', type: 'money', required: true, min: 0, half: true,
        hint: 'Quanto achas que vale hoje (avaliação do banco, preço de casas parecidas…). É este valor que entra no património líquido.' },
      { name: 'purchase_price', label: 'Preço de compra (€)', type: 'money', min: 0, half: true },
      { name: 'purchase_date', label: 'Data de compra', type: 'date', half: true },
      { name: 'loan_id', label: 'Crédito associado', type: 'select', options: loanOpts,
        hint: 'Opcional. Serve para mostrar o capital próprio (valor − dívida). A dívida já conta em "Créditos em dívida", não é descontada duas vezes.' },
      { name: 'notes', label: 'Notas', type: 'textarea' },
    ],
    onSubmit: async v => {
      await saveItems([{ kind: 'property', id: prop?.id, ...v }]);
      toast(prop ? 'Imóvel atualizado' : 'Imóvel adicionado');
    },
    danger: prop && { label: 'Apagar imóvel', onClick: async () => {
      if (await confirmDialog(`Apagar <b>${esc(prop.name)}</b>? Não dá para desfazer.`)) {
        try { await removeItem(prop.id, 'Imóvel'); } catch (e) { toast(e.message, true); }
      }
    } },
  });
}

// ════════ ENCAMINHAMENTO DE CLIQUES (botões com atributos data-*) ════════
// Um único "listener" para a página toda (delegação de eventos): funciona também para botões
// criados depois, dentro das tabelas. O atributo diz o que fazer (ex.: data-edit-tx="<id>").
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action],[data-edit-acc],[data-edit-tx],[data-del-tx],[data-edit-inv],[data-inv-focus],[data-edit-imv],[data-del-imv],[data-edit-loan],[data-edit-prop]');
  if (!el) return;
  const d = el.dataset;
  if (d.invFocus) { e.preventDefault(); S.invFilter = d.invFocus; renderInvestments(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (d.editAcc) return accountForm(findById('accounts', d.editAcc));
  if (d.editTx) return txForm(findById('transactions', d.editTx));
  if (d.delTx) return deleteTx(d.delTx);
  if (d.editInv) return investmentForm(findById('investments', d.editInv));
  if (d.editImv) return invMoveForm(findById('inv_moves', d.editImv));
  if (d.delImv) return deleteImv(d.delImv);
  if (d.editLoan) return loanForm(findById('loans', d.editLoan));
  if (d.editProp) return propertyForm(findById('properties', d.editProp));
  switch (d.action) {
    case 'acc-new': return accountForm();
    case 'tx-new': return txForm();
    case 'mov-history': return historyGrid();
    case 'inv-new': return investmentForm();
    case 'imv-new': return invMoveForm();
    case 'inv-month': return investmentMonthGrid();
    case 'loan-new': return loanForm();
    case 'loan-month': return loanMonthGrid();
    case 'prop-new': return propertyForm();
    case 'import': return openImport(d.format);
    case 'export': return exportCSV(d.format);
  }
});

// ════════ ARRANQUE ════════
// Corre uma vez ao abrir a página: escolhe o separador pelo endereço (#inv...),
// verifica se o config.js existe e, se já houver sessão guardada, entra sem pedir password.
(function init() {
  const hashTab = location.hash.slice(1);
  if (['mov', 'inv', 'loan', 'prop'].includes(hashTab)) S.tab = hashTab;
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  $$('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + S.tab));

  if (!API_BASE || !CFG.clientId) {
    showLogin('Falta o config.js. Faz o deploy com o deploy.ps1 primeiro.');
    $('#login-btn').disabled = true;
    return;
  }
  if (store.get('refreshToken')) {
    getToken().then(() => { hideLogin(); loadData(); }).catch(() => showLogin());
  } else {
    showLogin();
  }
})();
