// Testes da comparação nos cartões dos Movimentos (movComparison), com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
// O "hoje" é fixo (13/10/2026): no mês atual compara-se só até ao dia 13 de cada mês.
//
//     node --test tests/comparacao.test.js
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

const ACC = 'ACC_000000000001';
let seq = 0;
const tx = (date, direction, amount, category) =>
  ({ id: 'TX_' + String(++seq).padStart(12, '0'), kind: 'transaction', date, direction, amount, account_id: ACC, category, description: category });
// Todos os meses de from a to: ordenado (2000 €, dia 1) e casa (1000 €, dia 20)
const history = (from, to) => run('monthRange(from, to)', { from, to })
  .flatMap(m => [tx(`${m}-01`, 'in', 2000, 'Salário'), tx(`${m}-20`, 'out', 1000, 'Casa')]);
const load = txs => run('D = { ...emptyData(), accounts: [{ id: acc, kind: "account", name: "Conta", opening_balance: 0 }], transactions: txs }',
  { acc: ACC, txs });
const cmp = (mode, anchor, extra = {}) => run('movComparison(mode, anchor, { account: "", catIn: [], catOut: [], text: "", ...extra })',
  { mode, anchor, extra });

test('um mês passado: média dos 12 meses anteriores e o mesmo mês do ano anterior', () => {
  load([...history('2025-09', '2026-10'), tx('2026-09-25', 'out', 500, 'Lazer')]);
  const c = cmp('month', '2026-09');
  assert.equal(c.avg.short, 'à média');
  assert.equal(c.avg.title, 'Média dos 12 meses anteriores');
  assert.deepEqual([c.avg.totals.in, c.avg.totals.out, c.avg.totals.net], [2000, 1000, 1000]);
  assert.equal(c.avg.totals.rate, 0.5);
  assert.equal(c.lastYear.short, 'a set 25');
  assert.equal(c.lastYear.title, 'setembro 2025');
  assert.deepEqual([c.lastYear.totals.in, c.lastYear.totals.out], [2000, 1000]);
});

test('o mês atual: os outros meses só contam até ao mesmo dia', () => {
  load(history('2025-09', '2026-10'));
  const c = cmp('month', '2026-10');
  assert.equal(c.avg.title, 'Média dos 12 meses anteriores (até ao dia 13)');
  assert.deepEqual([c.avg.totals.in, c.avg.totals.out], [2000, 0]);   // a casa (dia 20) ainda não conta
  assert.equal(c.lastYear.title, 'outubro 2025 (até ao dia 13)');
  assert.deepEqual([c.lastYear.totals.in, c.lastYear.totals.out], [2000, 0]);
});

test('com pouco histórico: a média só dos meses que há e sem o ano anterior', () => {
  load(history('2026-07', '2026-10'));
  const c = cmp('month', '2026-09');
  assert.equal(c.avg.title, 'Média dos 2 meses anteriores');
  assert.equal(c.lastYear, null);
  assert.equal(cmp('month', '2026-08').avg.title, 'O mês anterior');
  assert.deepEqual(cmp('month', '2026-07'), { avg: null, lastYear: null });
});

test('um ano: o mesmo período do ano anterior (no ano atual, até ao mesmo dia do mês atual)', () => {
  load(history('2024-12', '2026-10'));
  const c = cmp('year', '2026-01');
  assert.equal(c.avg, null);
  assert.equal(c.lastYear.short, 'a jan–out 2025');
  assert.equal(c.lastYear.title, 'De janeiro a outubro de 2025 (outubro só até ao dia 13)');
  assert.deepEqual([c.lastYear.totals.in, c.lastYear.totals.out], [20000, 9000]);
  // um ano passado compara com o ano inteiro anterior, se houver movimentos desde janeiro
  assert.equal(cmp('year', '2025-06').lastYear, null);   // 2024 só tem dezembro
  load(history('2024-01', '2025-12'));
  assert.equal(cmp('year', '2025-06').lastYear.short, 'a 2024');
  assert.deepEqual([cmp('year', '2025-06').lastYear.totals.in], [24000]);
});

test('"Sempre" não compara; os filtros também contam na comparação', () => {
  load([...history('2025-09', '2026-10'), ...run('monthRange("2025-09", "2026-10")', {}).map(m => tx(`${m}-05`, 'out', 40, 'Lazer'))]);
  assert.deepEqual(cmp('all', '2026-09'), { avg: null, lastYear: null });
  const c = cmp('month', '2026-09', { catOut: ['Lazer'] });
  assert.deepEqual([c.avg.totals.in, c.avg.totals.out], [0, 40]);
  const s = cmp('month', '2026-09', { text: 'casa' });
  assert.deepEqual([s.avg.totals.in, s.avg.totals.out], [0, 1000]);
});
