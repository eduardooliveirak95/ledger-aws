// Testes da evolução do património líquido (netWorthSeries e propertyValueAt), com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
// O "hoje" é fixo (13/10/2026) para os meses não dependerem do dia em que os testes correm.
//
//     node --test tests/patrimonio.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ Intl });
for (const f of ['util.js', 'calc.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', f), 'utf8'), ctx, { filename: f });
}
vm.runInContext('todayISO = () => "2026-10-13"', ctx);
const run = (code, vars = {}) => {
  Object.assign(ctx, vars);
  const v = vm.runInContext(code, ctx);
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
};
const load = data => run('D = { ...emptyData(), ...data }', { data });

const id = (prefix, n) => prefix + '_' + String(n).padStart(12, '0');
const ACC1 = id('ACC', 1), ACC2 = id('ACC', 2), INV = id('INV', 1), LOAN = id('LOAN', 1);
const account = (accId, opening_balance) => ({ id: accId, kind: 'account', name: accId, opening_balance });
let seq = 0;
const tx = (date, direction, amount, extra = {}) =>
  ({ id: id('TX', ++seq), kind: 'transaction', date, direction, amount, account_id: ACC1, category: 'Outros', ...extra });
const property = (n, value, extra = {}) => ({ id: id('PROP', n), kind: 'property', name: 'Imóvel ' + n, value, ...extra });

test('sem movimentos nem investimentos não há gráfico', () => {
  load({ accounts: [account(ACC1, 500)], properties: [property(1, 100000)] });
  assert.deepEqual(run('netWorthSeries().months'), []);
});

test('contas: saldo no fim de cada mês, sem os movimentos com data futura', () => {
  load({
    accounts: [account(ACC1, 1000), account(ACC2, 200)],
    transactions: [
      tx('2026-08-10', 'in', 500),
      tx('2026-09-02', 'out', 200),
      tx('2026-09-20', 'transfer', 300, { to_account_id: ACC2 }),   // entre contas próprias: o total não muda
      tx('2026-10-20', 'in', 100),                                  // ainda não aconteceu (hoje é 13/10)
    ],
  });
  const s = run('netWorthSeries()');
  assert.deepEqual(s.months, ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(s.accounts, [1700, 1500, 1500]);
  assert.deepEqual(s.total, [1700, 1500, 1500]);
  assert.equal(s.total[2], run('netWorth().total'));
});

test('começa no primeiro mês com investimentos, se for antes do primeiro movimento', () => {
  load({
    accounts: [account(ACC1, 0)],
    transactions: [tx('2026-10-01', 'in', 50)],
    investments: [{ id: INV, kind: 'investment', name: 'Fundo', inv_type: 'ETF' }],
    inv_moves: [{ id: id('IMV', 1), kind: 'inv_move', investment_id: INV, date: '2026-08-03', move: 'contribution', amount: 1000 }],
    valuations: [{ id: id('VAL', 1), kind: 'valuation', investment_id: INV, month: '2026-09', value: 1050 }],
  });
  const s = run('netWorthSeries()');
  assert.deepEqual(s.months, ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(s.investments, [1000, 1050, 1050]);
  assert.deepEqual(s.accounts, [0, 0, 50]);
  assert.deepEqual(s.total, [1000, 1050, 1100]);
});

test('créditos: o último saldo registado até cada mês, a descontar', () => {
  load({
    accounts: [account(ACC1, 5000)],
    transactions: [tx('2026-08-01', 'out', 0.01)],
    loans: [{ id: LOAN, kind: 'loan', name: 'Crédito', principal: 100000, start_date: '2020-01-15' }],
    loan_balances: [
      { id: id('LBAL', 1), kind: 'loan_balance', loan_id: LOAN, month: '2026-08', balance: 90000 },
      { id: id('LBAL', 2), kind: 'loan_balance', loan_id: LOAN, month: '2026-10', balance: 89000 },
    ],
  });
  const s = run('netWorthSeries()');
  assert.deepEqual(s.debt, [90000, 90000, 89000]);
  assert.deepEqual(s.total, [-85000.01, -85000.01, -84000.01]);
  assert.equal(s.total[2], run('netWorth().total'));
});

test('imóveis: do preço de compra ao valor atual em linha reta, desde a compra', () => {
  load({
    accounts: [account(ACC1, 0)],
    transactions: [tx('2026-06-01', 'in', 0.01)],
    properties: [
      property(1, 230000, { purchase_price: 200000, purchase_date: '2026-07-01' }),
      property(2, 50000),                                       // sem data de compra: sempre o valor atual
      property(3, 30000, { purchase_date: '2026-09-10' }),      // sem preço de compra: o valor atual desde a compra
    ],
  });
  const s = run('netWorthSeries()');
  assert.deepEqual(s.months, ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(run('D.properties.map(p => netWorthSeries().months.map(m => propertyValueAt(p, m, "2026-10")))'), [
    [0, 200000, 210000, 220000, 230000],
    [50000, 50000, 50000, 50000, 50000],
    [0, 0, 0, 30000, 30000],
  ]);
  assert.deepEqual(s.properties, [50000, 250000, 260000, 300000, 310000]);
  assert.equal(s.properties[4], run('netWorth().properties'));
});

test('o último mês dá sempre o mesmo que o património líquido da página inicial', () => {
  load({
    accounts: [account(ACC1, 2500), account(ACC2, 8000)],
    transactions: [tx('2025-11-05', 'in', 1800), tx('2026-03-12', 'out', 650.4), tx('2026-10-13', 'out', 45.9)],
    investments: [{ id: INV, kind: 'investment', name: 'Fundo', inv_type: 'ETF' }],
    inv_moves: [{ id: id('IMV', 1), kind: 'inv_move', investment_id: INV, date: '2026-01-15', move: 'contribution', amount: 3000 }],
    valuations: [{ id: id('VAL', 1), kind: 'valuation', investment_id: INV, month: '2026-09', value: 3210.55 }],
    loans: [{ id: LOAN, kind: 'loan', name: 'Crédito', principal: 120000, start_date: '2020-01-15' }],
    loan_balances: [{ id: id('LBAL', 1), kind: 'loan_balance', loan_id: LOAN, month: '2026-05', balance: 101234.56 }],
    properties: [property(1, 250000, { purchase_price: 180000, purchase_date: '2020-01-15', loan_id: LOAN })],
  });
  const s = run('netWorthSeries()');
  const nw = run('netWorth()');
  const last = s.months.length - 1;
  assert.equal(s.months[0], '2025-11');
  assert.equal(s.months[last], '2026-10');
  assert.deepEqual([s.accounts[last], s.investments[last], s.properties[last], s.debt[last], s.total[last]],
    [nw.accounts, nw.investments, nw.properties, nw.debt, nw.total]);
});

test('simulador do futuro: juros compostos todos os meses, poupança no fim de cada mês, euros de hoje e o objetivo', () => {
  const proj = p => run('futureProjection(p)', { p });
  // 12% ao ano, com juros compostos ao mês, dá mesmo 12% num ano
  assert.equal(proj({ start: 10000, ret: 12, years: 1 }).end.value, 11200);
  // sem rentabilidade: só o que se junta; uma linha por ano, a começar em hoje
  const flat = proj({ start: 0, monthly: 100, years: 2 });
  assert.deepEqual(flat.rows.map(r => [r.year, r.value, r.contributed]), [[0, 0, 0], [1, 1200, 1200], [2, 2400, 2400]]);
  assert.deepEqual([flat.end.gain, flat.eta], [0, null]);
  // a poupança entra no fim de cada mês e só rende a partir daí: 100 × ((1 + r)^12 − 1) / r, com r a taxa ao mês
  assert.equal(proj({ monthly: 100, ret: 12, years: 1 }).end.value, 1264.65);
  // a perder e em euros de hoje (inflação de 2%)
  assert.equal(proj({ start: 1000, ret: -10, years: 1 }).end.value, 900);
  assert.equal(proj({ start: 1000, inflation: 2, years: 1 }).end.real, 980.39);
  // objetivo: dentro do prazo, depois do prazo (procura na mesma), já atingido e nunca
  assert.equal(proj({ monthly: 100, years: 5, target: 1000 }).eta, 10);
  const later = proj({ monthly: 100, years: 1, target: 2000 });
  assert.deepEqual([later.eta, later.rows.length, later.end.value], [20, 2, 1200]);
  assert.equal(proj({ start: 5000, years: 1, target: 1000 }).eta, 0);
  assert.equal(proj({ start: 100, years: 1, target: 1000 }).eta, null);
});

test('simulador do futuro: independência financeira (25 × os gastos de um ano), em euros de hoje', () => {
  const proj = p => run('futureProjection(p)', { p });
  // sem rentabilidade nem inflação: 1000 €/mês chegam aos 6000 € ao 6.º mês, mesmo depois do prazo
  assert.equal(proj({ monthly: 1000, years: 1, fire: 6000 }).fireEta, 6);
  assert.equal(proj({ monthly: 1000, years: 1, fire: 24000 }).fireEta, 24);
  // com inflação conta o valor em euros de hoje: chega-se lá mais tarde do que ao mesmo objetivo
  const inf = proj({ monthly: 1000, years: 1, inflation: 10, fire: 24000, target: 24000 });
  assert.equal(inf.eta, 24);
  assert.ok(inf.fireEta > 24, String(inf.fireEta));
  // já lá está, nunca lá chega e sem gastos
  assert.equal(proj({ start: 9000, years: 1, fire: 6000 }).fireEta, 0);
  assert.equal(proj({ start: 100, years: 1, fire: 6000 }).fireEta, null);
  assert.equal(proj({ start: 100, years: 1 }).fireEta, null);
});

test('simular a venda: o custo é a parte do investido, o imposto só sobre o ganho', () => {
  const inv = value => ({
    investments: [{ id: INV, kind: 'investment', name: 'ETF', inv_type: 'ETF' }],
    inv_moves: [{ id: 'IMV_2026-01-05_' + '0'.repeat(11) + '1', kind: 'inv_move', investment_id: INV, date: '2026-01-05', move: 'contribution', amount: 1000 }],
    valuations: [{ id: `VAL_${INV.slice(4)}_2026-09`, kind: 'valuation', investment_id: INV, month: '2026-09', value }],
  });
  const sale = (amount = null, tax = 28) => run('saleSimulation(id, amount, tax)', { id: INV, amount, tax });
  load(inv(1500));
  assert.deepEqual(sale(), { value: 1500, amount: 1500, cost: 1000, gain: 500, tax: 140, net: 1360 });
  assert.deepEqual(sale(300), { value: 1500, amount: 300, cost: 200, gain: 100, tax: 28, net: 272 });
  assert.equal(sale(9999).amount, 1500);           // não se vende mais do que há
  assert.equal(sale(1500, 0).net, 1500);            // sem imposto
  load(inv(800));                                   // a perder: não há imposto
  assert.deepEqual(sale(), { value: 800, amount: 800, cost: 1000, gain: -200, tax: 0, net: 800 });
  // custo médio: 1000 € valem 2000 € em março e resgatam-se 1000 € em abril (metade): o resto fica com 500 € de custo, não 0
  load({ ...inv(2000), inv_moves: [...inv(2000).inv_moves,
    { id: 'IMV_2026-04-10_' + '0'.repeat(11) + '2', kind: 'inv_move', investment_id: INV, date: '2026-04-10', move: 'withdrawal', amount: 1000 }],
    valuations: [{ id: `VAL_${INV.slice(4)}_2026-03`, kind: 'valuation', investment_id: INV, month: '2026-03', value: 2000 }] });
  assert.equal(run('averageCost(id)', { id: INV }), 500);
  assert.deepEqual(sale(), { value: 1000, amount: 1000, cost: 500, gain: 500, tax: 140, net: 860 });
  // no mesmo mês, um aporte depois do resgate não conta para o valor antes dele; um resgate com data futura ainda não conta
  const mv = (n, date, move, amount) => ({ id: `IMV_${date}_` + '0'.repeat(11) + n, kind: 'inv_move', investment_id: INV, date, move, amount });
  load({ ...inv(1000), inv_moves: [mv(1, '2026-01-05', 'contribution', 1000), mv(2, '2026-04-05', 'withdrawal', 1000),
    mv(3, '2026-04-20', 'contribution', 1000), mv(4, '2026-12-01', 'withdrawal', 500)],
    valuations: [{ id: `VAL_${INV.slice(4)}_2026-03`, kind: 'valuation', investment_id: INV, month: '2026-03', value: 1000 }] });
  assert.equal(run('averageCost(id)', { id: INV }), 1000);
});

test('simulador do futuro: começa com as contas e os investimentos de hoje e com a poupança média dos meses completos', () => {
  load({
    accounts: [account(ACC1, 1000)],
    transactions: [
      tx('2026-08-01', 'in', 2000), tx('2026-08-10', 'out', 1500),
      tx('2026-09-01', 'in', 2000), tx('2026-09-10', 'out', 1200),
      tx('2026-09-12', 'out', 300, { category: 'Investimentos' }),   // um aporte conta como poupança, não como gasto
      tx('2026-10-01', 'in', 2000),                                  // o mês atual ainda não conta para a média
    ],
    investments: [{ id: INV, kind: 'investment', name: 'ETF', inv_type: 'ETF' }],
    inv_moves: [{ id: 'IMV_2026-09-12_' + '0'.repeat(11) + '1', kind: 'inv_move', investment_id: INV, date: '2026-09-12', move: 'contribution', amount: 300 }],
    valuations: [{ id: `VAL_${INV.slice(4)}_2026-09`, kind: 'valuation', investment_id: INV, month: '2026-09', value: 320 }],
    properties: [property(1, 250000)],   // os imóveis não contam (não são dinheiro que rende)
  });
  // contas 1000 + 2000 − 1500 + 2000 − 1200 − 300 + 2000 = 4000, ETF 320; poupança: (500 + 800) / 2 meses
  assert.deepEqual(run('futureDefaults()'), { start: 4320, monthly: 650, months: 2, spend: 1350, ret: null });
  // gastos por mês: (1500 + 1200) / 2, sem o aporte. A gastar mais do que entra, a poupança fica 0; sem meses completos também
  load({ accounts: [account(ACC1, 1000)], transactions: [tx('2026-09-01', 'in', 100), tx('2026-09-02', 'out', 400)] });
  assert.deepEqual(run('futureDefaults()'), { start: 700, monthly: 0, months: 1, spend: 400, ret: null });
  load({ accounts: [account(ACC1, 1000)], transactions: [tx('2026-10-01', 'out', 50)] });
  assert.deepEqual(run('futureDefaults()'), { start: 950, monthly: 0, months: 0, spend: 0, ret: null });
  // com mais de um ano de carteira, a rentabilidade vem dela (em %, a uma casa): 1000 € a 1/9/2025 valem 1100 € no fim de set 2026
  load({ investments: [{ id: INV, kind: 'investment', name: 'ETF', inv_type: 'ETF' }],
    inv_moves: [{ id: 'IMV_2025-09-01_' + '0'.repeat(11) + '1', kind: 'inv_move', investment_id: INV, date: '2025-09-01', move: 'contribution', amount: 1000 }],
    valuations: [{ id: `VAL_${INV.slice(4)}_2026-09`, kind: 'valuation', investment_id: INV, month: '2026-09', value: 1100 }] });
  const ret = run('futureDefaults().ret');
  assert.equal(ret, run('Math.round(annualReturn("") * 1000) / 10'));
  assert.ok(ret > 9 && ret < 9.5, String(ret));   // 10% em 395 dias: cerca de 9,2% ao ano
});
