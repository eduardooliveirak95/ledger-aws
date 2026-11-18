// Teste da app no browser (Chromium, com o Playwright). O login e a API são simulados e os dados são inventados: nunca liga ao
// site real. Abre a app no PC (1280 px) e no telemóvel (390 px) e confere a página inicial, os separadores, a barra lateral, o
// voltar e o F5, sair e entrar e uma conta sem admin; no PC, também os formulários dos movimentos e das contas (categoria
// sugerida, "Mais opções", apagar e "Anular", contas fechadas). Um erro de JavaScript também conta como falha.
//
// Uso:  node tests/app.e2e.cjs [--out <pasta das capturas>]
// Sai com 0 se tudo passou e com 1 se alguma verificação falhou. Precisa do Node, do Python 3 (serve os ficheiros do site) e do
// Playwright com o Chromium (no GitHub Actions instalam-se no passo "Browser tests" do deploy.yml).

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const FRONTEND = path.resolve(__dirname, '..', 'frontend');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-e2e-'));
fs.mkdirSync(OUT, { recursive: true });

// O Playwright instalado neste projeto ou, se não houver, o global
function loadPlaywright() {
  try { return require('playwright'); } catch {}
  try { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch {}
  console.error('Não encontrei o Playwright (npm install playwright e depois npx playwright install chromium).');
  process.exit(2);
}
const { chromium } = loadPlaywright();

// ── dados inventados (os mesmos formatos de ids e campos que o backend aceita) ──
const pad = n => String(n).padStart(2, '0');
const NOW = new Date();
const TODAY = `${NOW.getFullYear()}-${pad(NOW.getMonth() + 1)}-${pad(NOW.getDate())}`;
const monthsAgo = k => { const d = new Date(NOW.getFullYear(), NOW.getMonth() - k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const day = (k, dd) => `${monthsAgo(k)}-${pad(dd)}`;
const hex = n => n.toString(16).padStart(12, '0');
const ORDEM = 'ACC_' + hex(1), POUP = 'ACC_' + hex(2), VELHA = 'ACC_' + hex(3), VAZIA = 'ACC_' + hex(4);
const ETF = 'INV_' + hex(1), CASA = 'LOAN_' + hex(1);

function makeData() {
  let seq = 100;
  const tx = (date, direction, amount, category, description, extra = {}) => ({ id: `TX_${date}_${hex(seq++)}`, kind: 'transaction',
    date, direction, amount, category, description, account_id: ORDEM, approx: false, ...extra });
  const data = {
    accounts: [
      { id: ORDEM, kind: 'account', name: 'Conta à ordem', acc_type: 'Conta à ordem', opening_balance: 2500, opening_date: day(12, 1), archived: false },
      { id: POUP, kind: 'account', name: 'Poupança', acc_type: 'Poupança', opening_balance: 8000, opening_date: day(12, 1), archived: false },
      { id: VELHA, kind: 'account', name: 'Banco antigo', acc_type: 'Conta à ordem', opening_balance: 400, opening_date: day(12, 1), archived: false },
      { id: VAZIA, kind: 'account', name: 'Criada por engano', acc_type: 'Conta à ordem', opening_balance: 0, opening_date: day(1, 1), archived: false },
    ],
    transactions: [tx(day(3, 4), 'out', 25, 'Casa', 'Lâmpadas', { account_id: VELHA })],
    investments: [{ id: ETF, kind: 'investment', name: 'Fundo de ações', inv_type: 'ETF', notes: '', archived: false }],
    inv_moves: [], valuations: [],
    loans: [{ id: CASA, kind: 'loan', name: 'Crédito habitação', loan_type: 'Habitação', lender: 'Banco Exemplo', principal: 120000,
      start_date: '2020-01-15', end_date: '2050-01-15', rate: 3.2, payment: 520, notes: '', archived: false }],
    loan_balances: [],
    properties: [{ id: 'PROP_' + hex(1), kind: 'property', name: 'Casa', prop_type: 'Habitação própria', value: 250000,
      purchase_price: 180000, purchase_date: '2020-01-15', loan_id: CASA, notes: '', archived: false }],
    bank_formats: [], budgets: [], alloc_targets: [], mov_filters: [],
    goals: [{ id: 'GOAL_' + hex(1), kind: 'goal', name: 'Fundo de emergência', target: 12000, source: 'reserve' }],
    reservations: [{ id: `GRES_${day(2, 6)}_${hex(500)}`, kind: 'reservation', goal_id: 'GOAL_' + hex(1), source_id: POUP,
      date: day(2, 6), move: 'reserve', amount: 3000 }],
  };
  for (let k = 5; k >= 0; k--) {
    data.transactions.push(tx(day(k, 1), 'in', 1800, 'Salário', 'Ordenado'));
    data.transactions.push(tx(day(k, 5), 'out', 320.45, 'Supermercado', 'Mercearia do bairro'));
    data.transactions.push(tx(day(k, 7), 'out', 12.5, 'Restauração', 'Café'));
    data.transactions.push(tx(day(k, 10), 'transfer', 200, 'Transferência', 'Para a poupança', { to_account_id: POUP }));
    if (k > 0) data.transactions.push(tx(day(k, 3), 'out', 30, 'Lazer', 'Ginásio', { account_id: VELHA }));   // uma despesa fixa da conta que se vai fechar
    data.inv_moves.push({ id: `IMV_${day(k, 12)}_${hex(seq++)}`, kind: 'inv_move', investment_id: ETF, date: day(k, 12),
      move: 'contribution', amount: 500, description: 'Aporte', approx: false });
    data.valuations.push({ id: `VAL_${hex(1)}_${monthsAgo(k)}`, kind: 'valuation', investment_id: ETF, month: monthsAgo(k), value: 500 * (6 - k) * 1.02 });
    data.loan_balances.push({ id: `LBAL_${hex(1)}_${monthsAgo(k)}`, kind: 'loan_balance', loan_id: CASA, month: monthsAgo(k),
      balance: 98000 - (5 - k) * 250, payment: 520, extra: 0 });
  }
  // um jantar com 60 € a receber da Rita (e dois MB WAY, um com o nome dela) e um gasto fora do normal este mês
  data.transactions.push(tx(day(1, 15), 'out', 80, 'Restauração', 'Jantar de grupo', { due: 60, due_from: 'Rita' }),
    tx(day(1, 16), 'in', 30, 'Transferências in', 'MB WAY Joana'), tx(day(1, 17), 'in', 20, 'Transferências in', 'MB WAY de RITA S.'),
    tx(day(0, 2), 'out', 250, 'Reparações', 'Canalizador'));
  return data;
}
const ADMIN_USERS = { users: [{ email: 'chefe@example.com', status: 'CONFIRMED', enabled: true, created: '2026-01-01T09:00:00+00:00',
  admin: true, last_login: NOW.toISOString(), logins: 3 }], logins: [{ at: NOW.toISOString(), email: 'chefe@example.com' }] };

// tokens falsos: a app só lê o email, o prazo e os grupos do ID token
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = claims => `${b64({ alg: 'none' })}.${b64(claims)}.x`;
const tokens = admin => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { IdToken: jwt({ email: 'chefe@example.com', exp, ...(admin ? { 'cognito:groups': ['admin'] } : {}) }),
    AccessToken: jwt({ exp }), RefreshToken: 'refresh-falso' };
};

// ── resultados ──
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push({ ok: !!ok, text: `${name}${extra ? ' — ' + extra : ''}` });

// A API simulada guarda o que se grava (POST /items) e apaga (DELETE) numa cópia dos dados, como o backend: uma conta com
// movimentos não se apaga (409). posts = os pedidos de gravação, para conferir o que a app enviou.
async function setup(page, admin, label) {
  const data = makeData();
  const posts = [];
  page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|status of 409/i.test(m.text())) errors.push(`${label} (consola): ${m.text()}`); });
  await page.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript',
    body: "window.LEDGER_CONFIG = { apiUrl: 'https://api.example.test', region: 'eu-west-1', clientId: 'cliente-falso' };" }));
  await page.route('https://cognito-idp.eu-west-1.amazonaws.com/', r =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ Username: 'x', AuthenticationResult: tokens(admin) }) }));
  const cols = { account: 'accounts', transaction: 'transactions', investment: 'investments', inv_move: 'inv_moves', mov_filter: 'mov_filters' };
  let next = 900;
  await page.route('https://api.example.test/**', r => {
    const req = r.request(), p = new URL(req.url()).pathname;
    const reply = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/data') return reply(data);
    if (p === '/settings') return reply({ daily_backup: false });
    if (p === '/admin/users') return reply(ADMIN_USERS);
    if (p === '/items' && req.method() === 'POST') {
      const body = JSON.parse(req.postData());
      posts.push(body);
      const saved = body.items.map(it => ({ ...it, id: it.id || (it.kind === 'transaction' ? `TX_${it.date}_${hex(next++)}`
        : `${it.kind === 'mov_filter' ? 'MFL' : 'ACC'}_${hex(next++)}`) }));
      for (const it of saved) {
        const col = data[cols[it.kind]];
        if (col) { const i = col.findIndex(x => x.id === it.id); if (i >= 0) col[i] = it; else col.push(it); }
      }
      return reply({ saved, deleted: body.delete || [] });
    }
    if (p.startsWith('/items/') && req.method() === 'DELETE') {
      const id = decodeURIComponent(p.slice('/items/'.length));
      if (id.startsWith('ACC_') && data.transactions.some(t => t.account_id === id || t.to_account_id === id)) {
        return reply({ detail: 'Esta conta tem movimentos: em vez de a apagar, marca "Conta fechada" (o histórico fica)' }, 409);
      }
      for (const col of Object.values(data)) { const i = col.findIndex(x => x.id === id); if (i >= 0) col.splice(i, 1); }
      return reply({ deleted: [id] });
    }
    return reply({});
  });
  return { data, posts };
}
const visible = (page, sel) => page.locator(sel).first().isVisible();
const pause = (page, ms = 250) => page.waitForTimeout(ms);
async function login(page) {
  await page.fill('#login-email', 'chefe@example.com');
  await page.fill('#login-password', 'Abcdefgh12');
  await page.click('#login-btn');
  await page.waitForSelector('#login-screen.hidden', { state: 'attached', timeout: 10000 });
  await pause(page, 500);
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const TABS = { mov: 'Movimentos', inv: 'Investimentos', loan: 'Créditos', prop: 'Património', year: 'Resumo do ano', admin: 'Utilizadores' };

// No telemóvel a barra lateral está fechada: abre-a no ☰ (e as "⚙ Definições", para os botões que estão lá dentro)
async function sideClick(page, mobile, sel) {
  if (mobile) {
    if (!(await page.evaluate(() => document.body.classList.contains('menu-open')))) { await page.click('#menu-btn'); await pause(page); }
    if (await page.locator('#side-settings-body ' + sel).count() && !(await visible(page, '#side-settings-body'))) await page.click('#settings-btn');
  }
  await page.click('#sidebar ' + sel);
  await pause(page);
}

// ── navegação, no PC e no telemóvel ──
async function runViewport(browser, label, viewport, SITE) {
  const mobile = viewport.width <= 960;
  const page = await browser.newPage({ viewport });
  await setup(page, true, label);
  await page.goto(SITE + '/#mov');
  await login(page);
  check(`${label}: login → página inicial`, await visible(page, '#tab-home') && page.url().endsWith('#inicio'), page.url());
  check(`${label}: ${mobile ? 'barra lateral fechada, com ☰' : 'barra lateral à vista, sem ☰'}`,
    mobile ? !(await visible(page, '#sidebar')) && await visible(page, '#menu-btn') : await visible(page, '#sidebar') && !(await visible(page, '#menu-btn')));
  const nums = await page.$$eval('#nw-total, #nw-accounts, #nw-investments, #nw-debt, #nw-properties', els => els.map(e => e.textContent));
  check(`${label}: números da página inicial`, nums.every(t => /€/.test(t)), nums.join(' | '));
  await sideClick(page, mobile, '#private-btn');
  const hidden = await page.textContent('#nw-total');
  await sideClick(page, mobile, '#private-btn');
  if (mobile) { await page.keyboard.press('Escape'); await pause(page); }
  check(`${label}: modo privado esconde e mostra os valores`, hidden === '••• €' && /\d/.test(await page.textContent('#nw-total')), hidden);
  check(`${label}: sem scroll horizontal na página inicial`, await noHorizontalScroll(page));
  await shot(page, `${label}-inicio`);

  for (const [tab, name] of Object.entries(TABS)) {
    await page.click(mobile ? '.mobile-bar .logo-btn' : '#sidebar .logo-btn');
    await pause(page);
    await page.click(`.home-card[data-go="${tab}"]`);
    await pause(page, 600);
    check(`${label}: cartão ${name} abre o separador`, await visible(page, `#tab-${tab}`) && !(await visible(page, '#tab-home')) &&
      (await page.getAttribute('#sidebar .side-link.active', 'data-go')) === tab && page.url().endsWith('#' + tab), page.url());
    check(`${label}: ${name} sem scroll horizontal`, await noHorizontalScroll(page));
    if (tab === 'year') {
      await page.emulateMedia({ media: 'print' });
      check(`${label}: ao imprimir, só o resumo do ano`, !(await visible(page, '#sidebar')) && await visible(page, '#year-report'));
      await page.emulateMedia({ media: 'screen' });
    }
    await shot(page, `${label}-${tab}`);
  }

  await sideClick(page, mobile, '.side-link[data-go="loan"]');
  check(`${label}: barra lateral → Créditos`, await visible(page, '#tab-loan') && page.url().endsWith('#loan'));
  await page.goBack();
  await pause(page);
  check(`${label}: voltar → página inicial`, await visible(page, '#tab-home'));
  await page.click('.home-card[data-go="inv"]');
  await page.reload();
  await pause(page, 800);
  check(`${label}: F5 fica no separador`, await visible(page, '#tab-inv'), page.url());

  await page.click(mobile ? '.mobile-bar .logo-btn' : '#sidebar .logo-btn');
  await page.click('.home-card[data-go="mov"]');
  await pause(page);
  await page.click('#tab-mov [data-action="tx-new"]');
  await pause(page);
  check(`${label}: "+ Movimento" abre a janela, com o "Mais opções" fechado`, await page.locator('#modal.open').count() === 1 &&
    !(await page.locator('#modal details.more-fields').evaluate(e => e.open)));
  await shot(page, `${label}-novo-movimento`);
  await page.keyboard.press('Escape');
  await pause(page);
  check(`${label}: Esc fecha a janela`, await page.locator('#modal.open').count() === 0);

  await sideClick(page, mobile, '#logout-btn');
  check(`${label}: sair mostra o login, com os números a zero`, await visible(page, '#login-screen') &&
    (await page.textContent('#nw-total')).replace(/\s+/g, ' ') === '0,00 €');
  await login(page);
  check(`${label}: sair e entrar → página inicial`, await visible(page, '#tab-home'));
  await page.close();
}

// ── formulários dos movimentos e das contas (no PC) ──
async function runForms(browser, SITE) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const { data, posts } = await setup(page, true, 'formulários');
  await page.goto(SITE + '/#mov');
  await login(page);
  await page.evaluate(() => { location.hash = '#mov'; });
  await pause(page, 500);
  const catText = async () => (await page.textContent('#modal details.pick > summary')).trim();
  const toastText = () => page.textContent('#toast');

  // categoria sugerida pela descrição; a escolhida à mão não muda
  await page.click('#tab-mov [data-action="tx-new"]');
  await pause(page);
  const desc = page.locator('#modal input[id$="-description"]');
  await desc.fill('mercearia');
  await pause(page, 150);
  check('formulários: a descrição sugere a categoria que se costuma usar', await catText() === 'Supermercado', await catText());
  await page.click('#modal details.pick > summary');
  await page.locator('#modal details.pick input[type=checkbox][value="Casa"]').check();
  await desc.fill('café');
  await pause(page, 150);
  check('formulários: a categoria escolhida à mão não muda com a descrição', await catText() === 'Casa', await catText());
  // um erro num campo do "Mais opções" abre-o (aqui, o "A receber" maior do que o valor, que só se vê ao gravar)
  await page.locator('#modal input[inputmode=decimal]').first().fill('10');
  await page.click('#modal details.more-fields > summary');
  await page.locator('#modal input[id$="-due"]').fill('50');
  await page.click('#modal details.more-fields > summary');
  await page.click('#modal-footer button[type=submit]');
  await pause(page, 300);
  check('formulários: o erro do "A receber" abre o "Mais opções"', await page.locator('#modal details.more-fields').evaluate(e => e.open) &&
    /A receber/.test(await page.textContent('#modal .form-error')));
  await page.locator('#modal input[id$="-due"]').fill('');
  await page.click('#modal-footer button[type=submit]');
  await pause(page, 500);
  const sent = posts.at(-1)?.items[0] || {};
  check('formulários: grava o movimento com a categoria escolhida', sent.description === 'café' && sent.category === 'Casa' && sent.amount === 10,
    JSON.stringify(sent));

  // apagar e "Anular"
  const n = await page.evaluate(() => D.transactions.length);
  await page.evaluate(() => { deleteTx(D.transactions.find(t => t.description === 'café').id); });
  await pause(page, 300);
  await page.click('#modal-footer button.primary');
  await pause(page, 500);
  check('formulários: apagar mostra o "Anular"', await page.evaluate(() => D.transactions.length) === n - 1 &&
    (await toastText()).startsWith('Movimento apagado') && await visible(page, '#toast button'));
  await page.click('#toast button');
  await pause(page, 500);
  check('formulários: o "Anular" repõe o movimento', await page.evaluate(() => D.transactions.length) === n &&
    (await toastText()).startsWith('Anulado'));

  // antes de a fechar, a conta tem previsão do fim do mês (a despesa fixa dela)
  await page.selectOption('#mov-filter-account', VELHA);
  await pause(page, 400);
  check('contas: antes de fechar, a previsão do fim do mês aparece para a conta', await visible(page, '#forecast-panel'));
  await page.selectOption('#mov-filter-account', '');
  await pause(page, 300);
  // contas: a com movimentos não se apaga; a vazia sim
  const oldBalance = await page.evaluate(v => accountBalance(v), VELHA);
  await page.click(`[data-edit-acc="${VELHA}"]`);
  await pause(page, 300);
  check('contas: uma conta com movimentos não tem "Apagar conta"', !(await page.locator('#modal-footer button', { hasText: 'Apagar conta' }).count()));
  // fechar com o saldo passado para outra conta
  await page.locator('#modal label', { hasText: 'Conta fechada' }).click();
  await pause(page, 150);
  await page.locator('#modal select').nth(1).selectOption(ORDEM);
  await page.click('#modal-footer button[type=submit]');
  await pause(page, 600);
  const closing = posts.at(-1).items;
  check(`contas: fechar grava a conta fechada e a transferência do saldo (${oldBalance} €)`, oldBalance > 0 && closing.length === 2 &&
    closing[0].archived === true && closing[1].direction === 'transfer' && closing[1].account_id === VELHA && closing[1].to_account_id === ORDEM &&
    closing[1].amount === oldBalance && await page.evaluate(v => accountBalance(v), VELHA) === 0,
    JSON.stringify(closing.map(i => [i.kind, i.amount])));
  check('contas: a fechada passa para "Contas fechadas" e sai do "+ Movimento"',
    (await page.textContent('#acc-list details.closed-accs > summary')) === 'Contas fechadas (1)' &&
    !(await page.evaluate(v => accountOptions().some(o => o.value === v), VELHA)));
  // no filtro, a fechada continua a dar para ver o histórico, sem a previsão do fim do mês
  await page.selectOption('#mov-filter-account', VELHA);
  await pause(page, 400);
  check('contas: a conta fechada no filtro, sem a previsão do fim do mês', !(await visible(page, '#forecast-panel')));
  await page.selectOption('#mov-filter-account', '');
  await pause(page, 300);
  await page.click(`[data-edit-acc="${VAZIA}"]`);
  await pause(page, 300);
  await page.click('#modal-footer button', { hasText: 'Apagar conta' });
  await pause(page, 300);
  await page.click('#modal-footer button.primary');
  await pause(page, 500);
  check('contas: uma conta vazia apaga-se, com "Anular"', !data.accounts.some(a => a.id === VAZIA) && (await toastText()).startsWith('Conta apagada'));
  // sair logo a seguir: a mensagem com o "Anular" não fica por cima do login
  await page.evaluate(() => logout());
  await pause(page, 300);
  check('sair: a mensagem com o "Anular" desaparece', !(await page.locator('#toast').evaluate(e => e.classList.contains('show'))));
  await page.close();
}

// ── o "A receber" por pessoa, o "Dividir por", o "E se…" do simulador, os gastos fora do normal e o Resumo do ano (no PC) ──
async function runMoney(browser, SITE) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const { posts } = await setup(page, true, 'dinheiro');
  await page.goto(SITE + '/#inicio');
  await login(page);
  check('avisos: um gasto fora do normal aparece no "A ver"', /Gastos fora do normal em .*Reparações 250,00/.test(
    (await page.textContent('#alerts-panel')).replace(/\s+/g, ' ')));

  // simular o futuro com uma compra grande: compara com a simulação sem ela e desenha as duas
  await page.click('[data-action="future"]');
  await pause(page, 400);
  await page.fill('#fut-one', '15000');
  await pause(page, 300);
  const fut = (await page.textContent('#fut-result')).replace(/\s+/g, ' ');
  check('simular o futuro: a compra grande compara com a simulação sem ela', /Com a compra de 15 000,00 € em .* do que sem ela/.test(fut) &&
    await page.evaluate(() => charts['chart-future'].data.datasets.length) === 4, fut.slice(0, 200));
  await shot(page, 'dinheiro-simular-compra');
  await page.keyboard.press('Escape');
  await pause(page);

  // "A receber" por pessoa e, no "Recebido", o MB WAY com o nome dela primeiro
  await page.evaluate(() => { location.hash = '#mov'; });
  await pause(page, 500);
  check('a receber: o painel junta por pessoa', /Rita · 1 gasto\s*60,00/.test((await page.textContent('#due-table tr.due-person')).replace(/\s+/g, ' ').trim()),
    await page.textContent('#due-table'));
  await page.click('#due-table [data-due-paid]');
  await pause(page, 300);
  check('a receber: no "Recebido", primeiro o MB WAY com o nome da pessoa', /RITA S\./.test(await page.textContent('#modal tbody tr:first-child')) &&
    await page.locator('#modal tbody tr:first-child .badge.due').count() === 1);
  await shot(page, 'dinheiro-recebido');
  await page.keyboard.press('Escape');
  await pause(page);

  // "Dividir por" preenche o "A receber" (e não se grava); o "De quem" grava-se
  await page.click('#tab-mov [data-action="tx-new"]');
  await pause(page);
  await page.locator('#modal input[id$="-amount"]').fill('90');
  await page.locator('#modal input[id$="-description"]').fill('Jantar');
  await page.click('#modal details.more-fields > summary');
  await page.locator('#modal input[id$="-split"]').fill('3');
  await pause(page, 150);
  check('a receber: "Dividir por 3" põe 60 € no "A receber"', await page.inputValue('#modal input[id$="-due"]') === '60');
  await page.locator('#modal input[id$="-due_from"]').fill('Rui');
  await shot(page, 'dinheiro-dividir');
  await page.click('#modal-footer button[type=submit]');
  await pause(page, 500);
  const sent = posts.at(-1)?.items[0] || {};
  check('a receber: grava o "A receber" e o "De quem", sem o "Dividir por"', sent.due === 60 && sent.due_from === 'Rui' && !('split' in sent),
    JSON.stringify(sent));

  // o Resumo do ano com o diagrama "Para onde foi o dinheiro"
  await page.evaluate(() => { location.hash = '#year'; });
  await pause(page, 600);
  const flow = await page.evaluate(() => ({ bands: document.querySelectorAll('#year-report svg.flow path.flow-band').length,
    text: document.querySelector('#year-report svg.flow')?.textContent || '' }));
  check('resumo do ano: o diagrama "Para onde foi o dinheiro"', flow.bands >= 4 && /Salário/.test(flow.text) && /Ficou nas contas/.test(flow.text),
    `${flow.bands} faixas`);
  await page.locator('#year-report svg.flow').screenshot({ path: path.join(OUT, 'dinheiro-fluxo.png') });
  await sideClick(page, false, '#theme-btn');   // automático → claro → escuro
  await sideClick(page, false, '#theme-btn');
  await sideClick(page, false, '#private-btn');
  await pause(page, 400);
  check('resumo do ano: no modo privado, o diagrama sem valores', !/\d,\d\d/.test(await page.textContent('#year-report svg.flow')));
  await page.locator('#year-report svg.flow').screenshot({ path: path.join(OUT, 'dinheiro-fluxo-escuro-privado.png') });
  await sideClick(page, false, '#private-btn');
  await sideClick(page, false, '#theme-btn');   // escuro → automático

  // a taxa de esforço nos Créditos: 520 € de prestação sobre a média das entradas (5 meses de 1800 € e os dois MB WAY)
  await page.evaluate(() => { location.hash = '#loan'; });
  await pause(page, 500);
  const burden = (await page.textContent('#loan-payments-sub')).replace(/\s+/g, ' ');
  check('créditos: a taxa de esforço no cartão das prestações', /29% das entradas/.test(burden), burden);
  // e se a taxa subir: no simulador do crédito, o "+1%" põe a taxa de hoje mais um ponto (3,2% → 4,2%)
  await page.click('[data-sim-loan]');
  await pause(page, 300);
  await page.click('#modal [data-rate-step="1"]');
  await pause(page, 200);
  const rateTxt = (await page.textContent('#sim-rate-result')).replace(/\s+/g, ' ');
  check('créditos: e se a taxa subir 1 ponto, a prestação nova e a taxa de esforço com ela', await page.inputValue('#sim-rate') === '4,2' &&
    /Com a TAN a 4,2% \(\+1 ponto\), a prestação passa de .* para .* \(\+\d+,\d\d €\/mês\), com o mesmo prazo \(\d+a \d+m\); na que registaste, de 520,00 € para 5\d\d,\d\d €\. Até ao fim pagas mais \d.* A taxa de esforço passa de 29% para 3\d% das tuas entradas/.test(rateTxt),
    rateTxt.slice(0, 300));
  await shot(page, 'credito-taxa');
  await page.keyboard.press('Escape');
  await pause(page);

  // filtros guardados: guardar a pesquisa de agora com um nome, limpar, aplicar outra vez e apagar
  await page.evaluate(() => { location.hash = '#mov'; });
  await pause(page, 500);
  await page.fill('#mov-search', 'mercearia');
  await pause(page, 400);
  await page.click('#mov-saved > summary');
  await page.click('#mov-saved [data-mfl-save]');
  await pause(page, 300);
  await page.locator('#modal input[id$="-name"]').fill('Mercearia');
  await page.click('#modal-footer button[type=submit]');
  await pause(page, 500);
  const savedFilter = posts.at(-1)?.items[0] || {};
  check('filtros guardados: grava o nome e a pesquisa (sem o período)', savedFilter.kind === 'mov_filter' && savedFilter.name === 'Mercearia' &&
    savedFilter.search === 'mercearia' && !('from' in savedFilter) && (await page.textContent('#mov-saved > summary')).trim() === '★ Mercearia',
    JSON.stringify(savedFilter));
  await page.fill('#mov-search', '');
  await pause(page, 400);
  await page.click('#mov-saved > summary');
  await shot(page, 'filtros-guardados');
  await page.click('#mov-saved [data-mfl-apply]');
  await pause(page, 400);
  check('filtros guardados: carregar no nome volta a pôr a pesquisa', await page.inputValue('#mov-search') === 'mercearia' &&
    await page.evaluate(() => S.movSearch) === 'mercearia');
  await page.click('#mov-saved > summary');
  await page.click('#mov-saved [data-mfl-del]');
  await pause(page, 500);
  check('filtros guardados: o ✕ apaga, com "Anular"', await page.evaluate(() => D.mov_filters.length) === 0 &&
    (await page.textContent('#toast')).startsWith('Filtro apagado'));

  // etiqueta em lote: marcar entradas e saídas do mês, juntar-lhes uma etiqueta e guardar o filtro dela
  await page.fill('#mov-search', '');
  await pause(page, 400);
  await page.check('#mov-sel-all');
  await pause(page, 200);
  const selCount = await page.evaluate(() => S.movSel.size);
  check('etiqueta em lote: com entradas e saídas marcadas, o "# Etiqueta…" e a explicação da categoria', selCount >= 2 &&
    await visible(page, '#mov-bulk [data-bulk-tag]') && /Para mudar a categoria, escolhe só entradas ou só saídas/.test(await page.textContent('#mov-bulk')));
  await page.click('#mov-bulk [data-bulk-tag]');
  await pause(page, 300);
  await page.locator('#modal input[id$="-tag"]').fill('#Obras casa');
  await shot(page, 'etiqueta-em-lote');
  await page.click('#modal-footer button[type=submit]');
  await pause(page, 600);
  const tagged = posts.at(-2)?.items || [], tagFilter = posts.at(-1)?.items[0] || {};
  check('etiqueta em lote: grava a etiqueta em todos os marcados e o filtro "#etiqueta"', tagged.length === selCount &&
    tagged.every(t => t.tags.includes('Obras casa')) && new Set(tagged.map(t => t.direction)).size === 2 && tagFilter.kind === 'mov_filter' &&
    tagFilter.name === '#Obras casa' && tagFilter.search === '#Obras casa', JSON.stringify(tagFilter));
  check('etiqueta em lote: no fim mostra-os todos, com o filtro escolhido', await page.inputValue('#mov-search') === '#Obras casa' &&
    await page.locator('#mov-table [data-sel]').count() === selCount && (await page.textContent('#mov-saved > summary')).trim() === '★ #Obras casa',
    (await page.textContent('#mov-saved > summary')).trim());
  await shot(page, 'etiqueta-em-lote-filtro');
  await page.close();
}

async function runNonAdmin(browser, SITE) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await setup(page, false, 'sem-admin');
  await page.goto(SITE + '/#admin');
  await login(page);
  check('sem admin: entra na página inicial, sem Utilizadores', await visible(page, '#tab-home') && !(await visible(page, '#tab-admin')) &&
    !(await visible(page, '.home-card[data-go="admin"]')) && !(await visible(page, '#sidebar [data-go="admin"]')));
  await page.evaluate(() => { location.hash = '#admin'; });
  await pause(page);
  check('sem admin: #admin à mão → página inicial', await visible(page, '#tab-home') && !(await visible(page, '#tab-admin')));
  await page.close();
}

// ── servidor local com os ficheiros do site ──
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
async function waitFor(url, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('O servidor local não arrancou: ' + url);
}

(async () => {
  const port = await freePort();
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', FRONTEND], { stdio: 'ignore' });
  const SITE = `http://127.0.0.1:${port}`;
  let browser;
  try {
    await waitFor(SITE + '/index.html');
    browser = await chromium.launch();
    await runViewport(browser, 'pc', { width: 1280, height: 860 }, SITE);
    await runViewport(browser, 'telemóvel', { width: 390, height: 844 }, SITE);
    await runForms(browser, SITE);
    await runMoney(browser, SITE);
    await runNonAdmin(browser, SITE);
  } catch (e) {
    check('o teste chegou ao fim', false, e.message.split('\n')[0]);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  const failed = results.filter(r => !r.ok);
  console.log(results.map(r => `${r.ok ? 'OK   ' : 'FALHA'} ${r.text}`).join('\n'));
  console.log(errors.length ? '\nErros de JavaScript:\n' + errors.map(e => '  ' + e).join('\n') : '\nErros de JavaScript: nenhum');
  console.log(`\n${results.length - failed.length}/${results.length} verificações OK. Capturas em: ${OUT}`);
  process.exit(failed.length || errors.length ? 1 : 0);
})();
