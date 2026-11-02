// Testes dos orçamentos por categoria (budgetStatus), com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
// O "hoje" é fixo (13/10/2026).
//
//     node --test tests/orcamentos.test.js
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

const ACC1 = 'ACC_000000000001', ACC2 = 'ACC_000000000002';
let seq = 0;
const tx = (date, direction, amount, category, account_id = ACC1, extra = {}) =>
  ({ id: 'TX_' + String(++seq).padStart(12, '0'), kind: 'transaction', date, direction, amount, account_id, category, ...extra });
const budget = (n, category, amount, updated_at = '2026-10-01T10:00:00+00:00', extra = {}) =>
  ({ id: 'BUD_' + String(n).padStart(12, '0'), kind: 'budget', category, amount, updated_at, ...extra });
const yearly = (n, category, amount) => budget(n, category, amount, undefined, { period: 'year' });
const load = (transactions, budgets) => run('D = { ...emptyData(), transactions: txs, budgets: bs }', { txs: transactions, bs: budgets });
const status = (from, to) => run('budgetStatus(from, to)', { from, to });

const BUDGETS = [
  budget(1, 'Restauração', 150), budget(2, 'Supermercado', 300),
  budget(3, 'Lazer', 80, '2026-09-01T10:00:00+00:00'), budget(4, 'Lazer', 50, '2026-10-05T10:00:00+00:00'),   // fica o mais recente
];
const TXS = [
  tx('2026-09-03', 'out', 90, 'Restauração'), tx('2026-09-18', 'out', 40, 'Restauração', ACC2),   // as duas contas contam
  tx('2026-09-10', 'out', 100, 'Supermercado'),
  tx('2026-09-12', 'out', 70, 'Lazer'),
  tx('2026-09-15', 'in', 25, 'Restauração'),                                                     // entradas não contam
  tx('2026-09-20', 'transfer', 500, 'Transferência', ACC1, { to_account_id: ACC2 }),
  tx('2026-08-20', 'out', 60, 'Lazer'),                                                          // outro mês
];

test('num mês: gasto, limite, o que sobra e o estado de cada orçamento (os mais gastos primeiro)', () => {
  load(TXS, BUDGETS);
  assert.deepEqual(status('2026-09', '2026-09').map(b => [b.category, b.spent, b.limit, b.left, b.state, b.months]), [
    ['Lazer', 70, 50, -20, 'over', 1],
    ['Restauração', 130, 150, 20, 'near', 1],
    ['Supermercado', 100, 300, 200, 'ok', 1],
  ]);
});

test('80% já é "perto"; exatamente o limite ainda não passou', () => {
  load([tx('2026-09-01', 'out', 120, 'Restauração'), tx('2026-09-01', 'out', 150, 'Supermercado')],
    [budget(1, 'Restauração', 150), budget(2, 'Supermercado', 150)]);
  assert.deepEqual(status('2026-09', '2026-09').map(b => [b.category, b.state]), [['Supermercado', 'near'], ['Restauração', 'near']]);
});

test('vários meses: o limite multiplica pelos meses do período (num ano, sempre × 12)', () => {
  load(TXS, BUDGETS);
  const year = status('2026-01', '2026-12');
  assert.equal(year[0].months, 12);
  assert.deepEqual(year.map(b => [b.category, b.spent, b.limit]), [['Lazer', 130, 600], ['Restauração', 130, 1800], ['Supermercado', 100, 3600]]);
  assert.equal(status('2025-01', '2025-12')[0].months, 12);
  assert.equal(status('2026-08', '2026-10')[0].months, 3);
  assert.equal(status('2026-12', '2026-12')[0].months, 1);   // um mês futuro conta como um mês
});

// Orçamentos por ano: Férias (gastos de uma vez) e Seguros, com Lazer por mês para comparar
const YEARLY = [yearly(1, 'Férias', 2000), yearly(2, 'Seguros', 600), budget(3, 'Lazer', 50, undefined, { period: 'month' })];
const YEARLY_TXS = [
  tx('2025-08-10', 'out', 1500, 'Férias'),                                   // ano anterior
  tx('2026-03-02', 'out', 450, 'Seguros'),
  tx('2026-07-20', 'out', 1200, 'Férias'), tx('2026-09-05', 'out', 500, 'Férias', ACC2),
  tx('2026-09-12', 'out', 40, 'Lazer'), tx('2026-08-12', 'out', 30, 'Lazer'),
  tx('2026-11-02', 'out', 300, 'Férias'),                                    // depois do mês escolhido
];

test('por ano, num mês: conta o gasto desde janeiro até esse mês e o limite do ano (o mensal só o mês)', () => {
  load(YEARLY_TXS, YEARLY);
  assert.deepEqual(status('2026-09', '2026-09').map(b => [b.category, b.period, b.from, b.times, b.spent, b.limit, b.left, b.state]), [
    ['Férias', 'year', '2026-01', 1, 1700, 2000, 300, 'near'],
    ['Lazer', 'month', '2026-09', 1, 40, 50, 10, 'near'],
    ['Seguros', 'year', '2026-01', 1, 450, 600, 150, 'ok'],
  ]);
  // em fevereiro ainda não houve gastos dos anuais (contam 0); em março já conta o seguro de março
  assert.deepEqual(status('2026-02', '2026-02').filter(b => b.period === 'year').map(b => [b.category, b.spent]), [['Férias', 0], ['Seguros', 0]]);
  assert.equal(status('2026-03', '2026-03').find(b => b.category === 'Seguros').spent, 450);
  // num mês do ano anterior, conta desde janeiro desse ano
  assert.deepEqual(status('2025-12', '2025-12').find(b => b.category === 'Férias'), {
    id: 'BUD_000000000001', category: 'Férias', amount: 2000, period: 'year', months: 1, times: 1, from: '2025-01',
    limit: 2000, spent: 1500, ratio: 0.75, left: 500, state: 'ok' });
});

test('por ano, num ano: o limite conta uma vez (o mensal × 12); em "Sempre", × o número de anos', () => {
  load(YEARLY_TXS, YEARLY);
  assert.deepEqual(status('2026-01', '2026-12').map(b => [b.category, b.times, b.spent, b.limit, b.state]), [
    ['Férias', 1, 2000, 2000, 'near'],   // exatamente o limite ainda não passou
    ['Seguros', 1, 450, 600, 'ok'],
    ['Lazer', 12, 70, 600, 'ok'],
  ]);
  // "Sempre" (de ago 2025 até ao mês atual): 2 anos, cada um conta inteiro; o gasto é o do período
  assert.deepEqual(status('2025-08', '2026-10').map(b => [b.category, b.from, b.times, b.spent, b.limit]), [
    ['Férias', '2025-08', 2, 3200, 4000],
    ['Seguros', '2025-08', 2, 450, 1200],
    ['Lazer', '2025-08', 15, 70, 750],
  ]);
  // um "Sempre" só com dados deste ano conta desde janeiro, como num mês
  assert.deepEqual(status('2026-03', '2026-10').find(b => b.category === 'Férias').from, '2026-01');
});

test('um orçamento sem period (dos antigos) é por mês', () => {
  load(TXS, [budget(1, 'Restauração', 150)]);
  assert.deepEqual(status('2026-09', '2026-09').map(b => [b.period, b.times, b.limit]), [['month', 1, 150]]);
});

test('categorias com nomes especiais do JavaScript ("constructor", "toString") contam como as outras', () => {
  load([tx('2026-09-02', 'out', 30, 'constructor'), tx('2026-09-03', 'out', 10, 'toString')],
    [budget(1, 'constructor', 100), budget(2, 'toString', 5)]);
  assert.deepEqual(status('2026-09', '2026-09').map(b => [b.category, b.spent, b.state]), [['toString', 10, 'over'], ['constructor', 30, 'ok']]);
  assert.deepEqual(run('categoryTotals(D.transactions)'), [['constructor', 30], ['toString', 10]]);
});

test('sem orçamentos, a lista fica vazia', () => {
  load(TXS, []);
  assert.deepEqual(status('2026-09', '2026-09'), []);
});

test('o limite aparece no campo da janela com vírgula e, com cêntimos, sempre com 2 casas (numInput)', () => {
  assert.equal(run('numInput(80.1)'), '80,10');
  assert.equal(run('numInput(300.55)'), '300,55');
  assert.equal(run('numInput(100)'), '100');
  assert.equal(run('numInput(0.5)'), '0,50');
  assert.equal(run('numInput(1234.5)'), '1234,50');
  assert.equal(run('numInput(12.345)'), '12,345');   // mais casas ficam como estão (não arredonda)
  assert.equal(run('numInput(null)'), '');
  assert.equal(run('numInput(undefined)'), '');
  assert.equal(run('numInput("")'), '');
});
