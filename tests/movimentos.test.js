// Testes da pesquisa nos Movimentos (filterTx com texto e os totais por mês), com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
//
//     node --test tests/movimentos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ Intl });
for (const f of ['util.js', 'calc.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', f), 'utf8'), ctx, { filename: f });
}
const run = (code, vars = {}) => {
  Object.assign(ctx, vars);
  const v = vm.runInContext(code, ctx);
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
};

const ACC = 'ACC_000000000001';
const tx = (id, date, direction, amount, category, description) =>
  ({ id: 'TX_' + String(id).padStart(12, '0'), kind: 'transaction', date, direction, amount, account_id: ACC, category, description });
const TXS = [
  tx(1, '2026-09-01', 'out', 650, 'Habitação', 'Renda de casa'),
  tx(2, '2026-09-05', 'out', 45.9, 'Supermercado', 'Compras da semana'),
  tx(3, '2026-09-12', 'out', 23.4, 'Casa', 'Conta da água'),
  tx(4, '2026-09-25', 'in', 1800, 'Salário', 'Ordenado de setembro'),
  tx(5, '2026-10-01', 'out', 650, 'Habitação', 'Renda de casa'),
];
run('D = { ...emptyData(), accounts: [{ id: acc, kind: "account", name: "Conta à ordem", opening_balance: 0 }], transactions: txs }',
  { acc: ACC, txs: TXS });
const ids = filters => run('filterTx(f).map(t => t.id.slice(-1))', { f: filters });

test('sem texto, a pesquisa não filtra nada', () => {
  assert.deepEqual(ids({ text: '' }), ['1', '2', '3', '4', '5']);
  assert.deepEqual(ids({ text: '   ' }), ['1', '2', '3', '4', '5']);
});

test('procura na descrição sem distinguir maiúsculas nem acentos', () => {
  assert.deepEqual(ids({ text: 'RENDA' }), ['1', '5']);
  assert.deepEqual(ids({ text: 'agua' }), ['3']);
  assert.deepEqual(ids({ text: 'Água' }), ['3']);
});

test('procura também na categoria e no valor (com vírgula)', () => {
  assert.deepEqual(ids({ text: 'supermercado' }), ['2']);
  assert.deepEqual(ids({ text: 'habitacao' }), ['1', '5']);
  assert.deepEqual(ids({ text: '45,9' }), ['2']);
  assert.deepEqual(ids({ text: '1800' }), ['4']);
});

test('com várias palavras, todas têm de aparecer (em qualquer ordem)', () => {
  assert.deepEqual(ids({ text: 'casa renda' }), ['1', '5']);
  assert.deepEqual(ids({ text: 'renda água' }), []);
});

test('junta-se aos outros filtros (período e categorias)', () => {
  assert.deepEqual(ids({ text: 'renda', from: '2026-10', to: '2026-10' }), ['5']);
  assert.deepEqual(ids({ text: 'casa', catOut: ['Casa'] }), ['3']);
});

test('os totais por mês dos gráficos também seguem a pesquisa', () => {
  const flows = run('monthlyFlows(["2026-09", "2026-10"], { text: "renda" })');
  assert.deepEqual(flows.out, [650, 650]);
  assert.deepEqual(flows.in, [0, 0]);
});
