// Testes da rentabilidade anual dos investimentos (annualReturn e xirr), com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
// O "hoje" é fixo (13/10/2026). As taxas esperadas foram calculadas à parte.
//
//     node --test tests/rentabilidade.test.js
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
  return vm.runInContext(code, ctx);
};

const A = 'INV_00000000000a', B = 'INV_00000000000b';
let seq = 0;
const inv = id => ({ id, kind: 'investment', name: id, inv_type: 'ETF', notes: '' });
const move = (id, date, amount, kind = 'contribution') =>
  ({ id: `IMV_${date}_${String(++seq).padStart(12, '0')}`, kind: 'inv_move', investment_id: id, date, move: kind, amount, description: '' });
const val = (id, month, value) => ({ id: `VAL_${id.slice(4)}_${month}`, kind: 'valuation', investment_id: id, month, value });
const load = (moves, vals, invs = [inv(A)]) =>
  run('D = { ...emptyData(), investments: invs, inv_moves: moves, valuations: vals }', { invs, moves, vals });
const annual = (id = '') => run('annualReturn(id)', { id });
const near = (got, want) => assert.ok(Math.abs(got - want) < 1e-6, `esperava ${want}, deu ${got}`);

test('um aporte: +10% num ano dá 10% ao ano; +21% em dois anos também; uma perda dá negativo', () => {
  load([move(A, '2025-09-30', 1000)], [val(A, '2026-09', 1100)]);
  near(annual(A), 0.10);
  load([move(A, '2024-09-30', 1000)], [val(A, '2026-09', 1210)]);
  near(annual(A), 0.10);   // o ganho total é 21%, mas por ano são 10% (1,1 × 1,1 = 1,21)
  load([move(A, '2025-09-30', 1000)], [val(A, '2026-09', 900)]);
  near(annual(A), -0.10);
});

test('vários aportes e um resgate: conta com a data de cada um', () => {
  load([move(A, '2024-01-15', 1000), move(A, '2024-07-10', 500), move(A, '2025-03-20', 500), move(A, '2025-11-05', 300, 'withdrawal')],
    [val(A, '2025-06', 2050), val(A, '2026-09', 2100)]);
  near(annual(A), 0.08693919250249815);
});

test('só conta até ao último valor registado; no mês atual, até hoje', () => {
  // um aporte depois do último valor não entra (ainda não se sabe quanto rendeu)
  load([move(A, '2025-09-30', 1000), move(A, '2026-10-05', 5000)], [val(A, '2026-09', 1100)]);
  near(annual(A), 0.10);
  // valor do mês atual: o fim é hoje (13/10/2026), não o fim do mês
  load([move(A, '2025-10-13', 1000)], [val(A, '2026-10', 1100)]);
  near(annual(A), 0.10);
});

test('a carteira junta os aportes e os valores de todos os investimentos', () => {
  load([move(A, '2025-09-30', 1000), move(B, '2024-09-30', 2000)], [val(A, '2026-09', 1100), val(B, '2026-09', 2420)], [inv(A), inv(B)]);
  near(annual(), 0.10);
  near(annual(A), 0.10);
  near(annual(B), 0.10);
});

test('sem valor registado, sem aportes ou com menos de 1 ano, não há taxa', () => {
  load([move(A, '2024-01-15', 1000)], []);
  assert.ok(Number.isNaN(annual(A)));
  load([], [val(A, '2026-09', 1100)]);
  assert.ok(Number.isNaN(annual(A)));
  load([move(A, '2026-01-15', 1000)], [val(A, '2026-09', 1100)]);
  assert.ok(Number.isNaN(annual(A)));
  // sem investimentos nenhuns
  load([], [], []);
  assert.ok(Number.isNaN(annual()));
});

test('xirr: sem solução (só saídas) dá NaN', () => {
  assert.ok(Number.isNaN(run('xirr(f)', { f: [{ date: '2024-01-01', amount: -100 }, { date: '2025-01-01', amount: -50 }] })));
  near(run('xirr(f)', { f: [{ date: '2024-01-01', amount: -100 }, { date: '2024-12-31', amount: 105 }] }), 0.05);
});
