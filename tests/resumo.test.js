// Testes do resumo do ano (yearSummary, yearPeriod, periodTx e summaryYears), com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
// O "hoje" é fixo (20/10/2026): 2026 é o ano atual (até hoje), 2025 e 2024 já acabaram.
//
//     node --test tests/resumo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ Intl });
for (const f of ['util.js', 'calc.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', f), 'utf8'), ctx, { filename: f });
}
vm.runInContext('todayISO = () => "2026-10-20"', ctx);
const run = (code, vars = {}) => {
  Object.assign(ctx, vars);
  const v = vm.runInContext(code, ctx);
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
};
const load = (data = {}) => run('D = { ...emptyData(), ...data }', { data: JSON.parse(JSON.stringify(data)) });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

const ACC1 = 'ACC_000000000001', ACC2 = 'ACC_000000000002';
const ETF = 'INV_000000000001', CA = 'INV_000000000002', CRIPTO = 'INV_000000000003';
const CASA = 'LOAN_000000000001', CARRO = 'LOAN_000000000002';
let seq = 0;
const hex = () => String(++seq).padStart(12, '0');
const tx = (date, direction, amount, category, description = '') => ({ id: `TX_${date}_${hex()}`, kind: 'transaction', date, direction,
  amount, category, description, account_id: ACC1 });
const mm = n => String(n).padStart(2, '0');
const each = (year, months, f) => months.map(m => f(`${year}-${mm(m)}`));
const M12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], M10 = M12.slice(0, 10), M9 = M12.slice(0, 9);
const move = (inv, date, kind, amount) => ({ id: `IMV_${date}_${hex()}`, kind: 'inv_move', investment_id: inv, date, move: kind, amount });
const val = (inv, month, value) => ({ id: `VAL_${inv.slice(4)}_${month}`, kind: 'valuation', investment_id: inv, month, value });
const bal = (month, balance, extra = 0) => ({ id: `LBAL_${CASA.slice(5)}_${month}`, kind: 'loan_balance', loan_id: CASA, month, balance, payment: 450, extra });

// 2025 (o ano inteiro): ordenado 2000 a 25, renda 700, supermercado 300, restauração 100, combustível 200 e uma viagem de 1500 €.
// 2026 (até 20/10): ordenado 2100 (o de 25/10 já está registado, mas ainda não conta), renda 750, supermercado 320 (220 em
// fevereiro), restauração 200, um sofá de 900 € em maio, 50 € numa categoria "constructor", 300 € por mês para investimentos e
// um seguro com data futura; deixou de haver combustível.
const DATA = {
  accounts: [
    { id: ACC1, kind: 'account', name: 'Ordem', acc_type: 'Conta à ordem', opening_balance: 1000, opening_date: '2024-06-01' },
    { id: ACC2, kind: 'account', name: 'Poupança', acc_type: 'Poupança', opening_balance: 5000, opening_date: '2024-06-01' },
  ],
  transactions: [
    ...each(2025, M12, m => tx(`${m}-25`, 'in', 2000, 'Salário', 'ORDENADO')),
    ...each(2025, M12, m => tx(`${m}-01`, 'out', 700, 'Habitação', 'RENDA')),
    ...each(2025, M12, m => tx(`${m}-10`, 'out', 300, 'Supermercado', 'SUPERMERCADO')),
    ...each(2025, M12, m => tx(`${m}-12`, 'out', 100, 'Restauração', 'JANTAR')),
    ...each(2025, M12, m => tx(`${m}-18`, 'out', 200, 'Combustível', 'GASOLINA')),
    tx('2025-07-15', 'out', 1500, 'Viagens', 'FÉRIAS'),
    ...each(2026, [...M9, 10], m => tx(`${m}-25`, 'in', 2100, 'Salário', 'ORDENADO')),
    ...each(2026, M10, m => tx(`${m}-01`, 'out', 750, 'Habitação', 'RENDA')),
    ...each(2026, M10, m => tx(`${m}-10`, 'out', m === '2026-02' ? 220 : 320, 'Supermercado', 'SUPERMERCADO')),
    ...each(2026, M10, m => tx(`${m}-12`, 'out', 200, 'Restauração', 'JANTAR')),
    ...each(2026, M10, m => tx(`${m}-15`, 'out', 300, 'Investimentos', 'APORTE')),
    tx('2026-05-20', 'out', 900, 'Compras', 'SOFÁ'),
    tx('2026-03-03', 'out', 50, 'constructor', 'TESTE'),
    tx('2026-10-28', 'out', 200, 'Seguros', 'SEGURO'),
  ],
  investments: [
    { id: ETF, kind: 'investment', name: 'ETF Mundo', inv_type: 'ETF' },
    { id: CA, kind: 'investment', name: 'Certificados', inv_type: 'Certificados de Aforro' },
    { id: CRIPTO, kind: 'investment', name: 'Cripto', inv_type: 'Cripto', archived: true },
  ],
  inv_moves: [
    move(CRIPTO, '2024-06-05', 'contribution', 200), move(CRIPTO, '2024-07-10', 'withdrawal', 250),
    move(CA, '2025-03-01', 'contribution', 1000), move(ETF, '2025-06-15', 'contribution', 500),
    ...each(2026, M10, m => move(ETF, `${m}-15`, 'contribution', 300)),
  ],
  valuations: [val(CRIPTO, '2024-06', 250), val(CA, '2025-12', 1020), val(CA, '2026-09', 1035), val(ETF, '2025-12', 600), val(ETF, '2026-09', 3800)],
  loans: [
    { id: CASA, kind: 'loan', name: 'Casa', loan_type: 'Habitação', principal: 100000, start_date: '2020-01-15', rate: 3, payment: 450 },
    { id: CARRO, kind: 'loan', name: 'Carro', loan_type: 'Automóvel', principal: 10000, start_date: '2026-04-10', rate: 6 },
  ],
  // casa: 200 € de capital por mês e uma amortização extra de 1000 € em junho (sem o saldo de outubro)
  loan_balances: [bal('2025-12', 90000), ...M9.map(k => bal(`2026-${mm(k)}`, 90000 - 200 * k - (k >= 6 ? 1000 : 0), k === 6 ? 1000 : 0))],
  properties: [{ id: 'PROP_000000000001', kind: 'property', name: 'Casa', prop_type: 'Habitação própria', value: 200000,
    purchase_price: 150000, purchase_date: '2020-01-15', loan_id: CASA }],
  budgets: [
    { id: 'BUD_000000000001', kind: 'budget', category: 'Restauração', amount: 150 },
    { id: 'BUD_000000000002', kind: 'budget', category: 'constructor', amount: 10 },
  ],
};

test('anos do resumo e o período: o ano inteiro num ano que acabou, até hoje no ano atual', () => {
  load(DATA);
  assert.deepEqual(run('summaryYears()'), ['2024', '2025', '2026']);
  assert.deepEqual(run('yearPeriod("2025")'), { year: '2025', from: '2025-01', to: '2025-12', start: '2025-01-01', end: '2025-12-31', current: false });
  assert.deepEqual(run('yearPeriod(2026)'), { year: '2026', from: '2026-01', to: '2026-10', start: '2026-01-01', end: '2026-10-20', current: true });
  // no ano atual não contam os movimentos já registados com data futura (o ordenado de 25/10 e o seguro de 28/10)
  assert.equal(run('periodTx(yearPeriod(2026)).length'), 51);
  assert.equal(run('periodTx(yearPeriod(2026)).some(t => t.date > "2026-10-20")'), false);
  load({});
  assert.deepEqual(run('summaryYears()'), ['2026']);
});

test('ano atual: totais até hoje e a comparação com o mesmo período do ano anterior', () => {
  load(DATA);
  const r = run('yearSummary("2026")');
  assert.deepEqual(r.period.prev, { year: '2025', start: '2025-01-01', end: '2025-10-20' });
  assert.equal(r.period.months, 10);
  const t = r.totals;
  assert.deepEqual([t.in, t.out, t.invested, t.amortized, t.net, t.saved, t.count], [18900, 13550, 3000, 0, 2350, 5350, 51]);
  close(t.rate, 5350 / 18900);
  // 2025 até 20/10: os ordenados de janeiro a setembro e as saídas de janeiro a outubro (o combustível de dia 18 também)
  const p = r.prev;
  assert.deepEqual([p.in, p.out, p.count], [18000, 7000 + 3000 + 1000 + 2000 + 1500, 50]);
});

test('ano que acabou: o ano inteiro e, sem movimentos desde janeiro do ano anterior, sem comparação', () => {
  load(DATA);
  const r = run('yearSummary("2025")');
  assert.equal(r.period.current, false);
  assert.equal(r.period.prev, null);
  assert.equal(r.prev, null);
  assert.deepEqual([r.totals.in, r.totals.out, r.totals.count], [24000, 17100, 61]);
  assert.equal(r.months.length, 12);
  assert.equal(r.months.some(m => m.partial), false);
  assert.ok(r.outCats.every(c => c.prev === null));
  assert.equal(r.highlights.up, null);
  assert.equal(r.highlights.down, null);
});

test('mês a mês e património líquido no início e no fim', () => {
  load(DATA);
  const r = run('yearSummary("2026")');
  const s = run('netWorthSeries()');
  const at = m => s.total[s.months.indexOf(m)];
  assert.deepEqual(r.months.map(m => m.month), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(r.months.map(m => m.out), [1270, 1170, 1320, 1270, 2170, 1270, 1270, 1270, 1270, 1270]);
  assert.deepEqual(r.months.map(m => m.partial), [false, false, false, false, false, false, false, false, false, true]);
  assert.deepEqual(r.months.map(m => m.networth), r.months.map(m => at(m.month)));
  // o mês atual vai só até hoje: sem o ordenado de dia 25
  assert.deepEqual([r.months[9].in, r.months[9].invested, r.months[9].count], [0, 300, 4]);
  assert.equal(r.networth.startMonth, '2025-12');
  assert.equal(r.networth.start.total, at('2025-12'));
  assert.equal(r.networth.end.total, run('netWorth().total'));
  assert.deepEqual(r.networth.end, run('netWorth()'));
  // 2024: os dados começam em junho (o primeiro aporte), por isso o início é o fim de junho
  const r24 = run('yearSummary("2024")');
  assert.equal(r24.networth.startMonth, '2024-06');
  assert.equal(r24.networth.start.total, at('2024-06'));
  assert.equal(r24.networth.end.total, at('2024-12'));
  assert.deepEqual(r24.months.slice(0, 5).map(m => m.networth), [null, null, null, null, null]);
});

test('gastos e entradas por categoria: peso, ano anterior e orçamento do ano (× 12)', () => {
  load(DATA);
  const r = run('yearSummary("2026")');
  assert.deepEqual(r.outCats.map(c => [c.category, c.amount, c.prev, c.budget]), [
    ['Habitação', 7500, 7000, null],
    ['Supermercado', 3100, 3000, null],
    ['Restauração', 2000, 1000, 1800],
    ['Compras', 900, 0, null],
    ['constructor', 50, 0, 120],   // uma categoria com este nome conta como as outras (dicionários sem protótipo)
  ]);
  close(r.outCats[0].share, 7500 / 13550);
  close(r.outCats.reduce((s, c) => s + c.share, 0), 1);
  assert.deepEqual(r.inCats.map(c => [c.category, c.amount, c.share, c.prev, c.budget]), [['Salário', 18900, 1, 18000, null]]);
});

test('investimentos: valor no início e no fim, aportes, ganho e rentabilidade do período', () => {
  load(DATA);
  const r = run('yearSummary("2026")');
  // o Cripto (arquivado, vendido em 2024) não teve nada em 2026 e fica de fora
  assert.deepEqual(r.investments.rows.map(x => [x.name, x.start, x.net, x.end, x.gain]), [
    ['Certificados', 1020, 0, 1035, 15],
    ['ETF Mundo', 600, 3000, 3800 + 300, 500],   // em outubro: o valor de setembro mais o aporte de dia 15
  ]);
  close(r.investments.rows[0].ret, 15 / 1020);
  // Modified Dietz: cada aporte conta pela parte do período (de 31/12/2025 a hoje) em que esteve investido
  const span = days('2025-12-31', '2026-10-20');
  const weighted = M10.reduce((s, k) => s + 300 * days(`2026-${mm(k)}-15`, '2026-10-20') / span, 0);
  close(r.investments.rows[1].ret, 500 / (600 + weighted));
  const total = r.investments.total;
  assert.deepEqual([total.start, total.net, total.end, total.gain], [1620, 3000, 5135, 515]);
  close(total.ret, 515 / (1620 + weighted));
  // 2024: o Cripto comprado e vendido no ano, sem nada no início: ganho de 50 € e sem rentabilidade (nada investido em média)
  const r24 = run('yearSummary("2024")');
  assert.deepEqual(r24.investments.rows.map(x => [x.name, x.start, x.net, x.end, x.gain, x.ret]), [['Cripto', 0, -50, 0, 50, null]]);
});

test('créditos: dívida no início e no fim, prestações, juros e amortizações extra do ano', () => {
  load(DATA);
  const r = run('yearSummary("2026")');
  assert.deepEqual(r.loans.rows.map(x => [x.name, x.start, x.end, x.payments, x.interest, x.principal, x.extra, x.startedNow]), [
    ['Carro', 0, 10000, 0, 0, 0, 0, true],   // começou em abril, ainda sem saldos registados: o montante inicial
    ['Casa', 90000, 87200, 4050, 2250, 1800, 1000, false],
  ]);
  assert.deepEqual(r.loans.total, { start: 90000, end: 97200, payments: 4050, interest: 2250, principal: 1800, extra: 1000 });
  // 2025: o primeiro saldo registado é o de dezembro, por isso não se sabe a dívida no início (o montante inicial é de 2020)
  const r25 = run('yearSummary("2025").loans');
  assert.deepEqual(r25.rows.map(x => [x.name, x.start, x.end, x.payments, x.interest]), [['Casa', null, 90000, 450, 0]]);
  assert.equal(r25.total.start, null);
});

test('destaques: o maior gasto, os meses completos com mais e menos gastos, o melhor mês e o que mudou', () => {
  load(DATA);
  const h = run('yearSummary("2026").highlights');
  assert.deepEqual([h.biggest.description, h.biggest.amount], ['SOFÁ', 900]);
  assert.deepEqual([h.topMonth.month, h.topMonth.out], ['2026-05', 2170]);
  assert.deepEqual([h.lowMonth.month, h.lowMonth.out], ['2026-02', 1170]);   // outubro ainda vai a meio: não conta
  assert.equal(h.bestRate.month, '2026-02');
  assert.deepEqual(h.up, { category: 'Restauração', diff: 1000, amount: 2000, prev: 1000 });
  // deixou de haver combustível: também conta
  assert.deepEqual(h.down, { category: 'Combustível', diff: -2000, amount: 0, prev: 2000 });
  const h25 = run('yearSummary("2025").highlights');
  assert.deepEqual([h25.biggest.description, h25.topMonth.month, h25.lowMonth.month, h25.bestRate.month], ['FÉRIAS', '2025-07', '2025-01', '2025-01']);
  // em fevereiro do ano atual só há um mês completo (fevereiro ainda vai a meio): ainda não há destaques dos meses
  vm.runInContext('todayISO = () => "2026-02-20"', ctx);
  try {
    const hj = run('yearSummary("2026").highlights');
    assert.deepEqual([hj.topMonth, hj.lowMonth, hj.bestRate], [null, null, null]);
  } finally {
    vm.runInContext('todayISO = () => "2026-10-20"', ctx);
  }
});

test('dados que começam durante o ano: médias desde o primeiro movimento e sem início se só há o último mês', () => {
  load(DATA);
  const per = y => run(`(p => [p.dataFrom, p.dataMonths])(yearSummary("${y}").period)`);
  assert.deepEqual(per(2026), ['2026-01', 10]);
  assert.deepEqual(per(2025), ['2025-01', 12]);
  assert.deepEqual(per(2024), [null, 0]);   // em 2024 só há investimentos: os movimentos começam em 2025
  // uma conta nova com o primeiro movimento em junho: as médias dividem por 5 meses (junho a outubro), não por 10
  const acc = DATA.accounts.slice(0, 1);
  load({ accounts: acc, transactions: [tx('2026-06-10', 'in', 1000, 'Salário'), tx('2026-09-10', 'out', 100, 'Supermercado')] });
  assert.deepEqual(per(2026), ['2026-06', 5]);
  assert.equal(run('yearSummary("2026").networth.startMonth'), '2026-06');
  // só com movimentos no mês atual: o início seria igual ao fim, por isso fica sem início
  load({ accounts: acc, transactions: [tx('2026-10-05', 'in', 1000, 'Salário')] });
  let nw = run('yearSummary("2026").networth');
  assert.deepEqual([nw.start, nw.startMonth, nw.end.total], [null, '2025-12', 2000]);
  // o mesmo num ano acabado só com dados de dezembro
  load({ accounts: acc, transactions: [tx('2025-12-05', 'in', 1000, 'Salário')] });
  nw = run('yearSummary("2025").networth');
  assert.deepEqual([nw.start, nw.end.total], [null, 2000]);
});

test('sem dados', () => {
  load({});
  const r = run('yearSummary("2026")');
  assert.equal(r.totals.count, 0);
  assert.deepEqual([r.networth.start, r.networth.end], [null, null]);
  assert.deepEqual([r.outCats, r.inCats, r.investments.rows, r.loans.rows], [[], [], [], []]);
  assert.deepEqual(r.highlights, { biggest: null, topMonth: null, lowMonth: null, bestRate: null, up: null, down: null });
  assert.deepEqual([r.period.dataFrom, r.period.dataMonths], [null, 0]);
});
