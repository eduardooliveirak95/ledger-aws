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
