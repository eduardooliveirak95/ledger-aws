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
const budget = (n, category, amount, updated_at = '2026-10-01T10:00:00+00:00') =>
  ({ id: 'BUD_' + String(n).padStart(12, '0'), kind: 'budget', category, amount, updated_at });
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

test('vários meses: o limite multiplica pelos meses (no ano atual, só até ao mês atual)', () => {
  load(TXS, BUDGETS);
  const year = status('2026-01', '2026-12');
  assert.equal(year[0].months, 10);
  assert.deepEqual(year.map(b => [b.category, b.spent, b.limit]), [['Lazer', 130, 500], ['Restauração', 130, 1500], ['Supermercado', 100, 3000]]);
  assert.equal(status('2025-01', '2025-12')[0].months, 12);
  assert.equal(status('2026-12', '2026-12')[0].months, 1);   // um mês futuro conta como um mês
});

test('sem orçamentos, a lista fica vazia', () => {
  load(TXS, []);
  assert.deepEqual(status('2026-09', '2026-09'), []);
});
