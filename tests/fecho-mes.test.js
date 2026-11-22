// Testes do fecho do mês (monthClose e monthCloseItem): o que falta para fechar o mês que acabou e o resumo dele.
// Com dados inventados e o "hoje" fixo (22/11/2026): o mês a fechar é outubro de 2026.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
//
//     node --test tests/fecho-mes.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ Intl });
for (const f of ['util.js', 'calc.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', f), 'utf8'), ctx, { filename: f });
}
vm.runInContext('todayISO = () => "2026-11-22"', ctx);
const run = (code, vars = {}) => {
  Object.assign(ctx, vars);
  const v = vm.runInContext(code, ctx);
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
};
const N = s => s.replace(/\s/g, ' ');   // os euros têm um espaço especial antes do €

let seq = 0;
const hex = n => String(n).padStart(12, '0');
const acc = (n, name, extra = {}) => ({ id: 'ACC_' + hex(n), kind: 'account', name, opening_balance: 0, opening_date: '2026-01-01', ...extra });
const ORDEM = acc(1, 'Ordem'), POUP = acc(2, 'Poupança'), FECHADA = acc(3, 'Antiga', { archived: true }), NOVA = acc(4, 'Nova', { opening_date: '2026-11-05' });
const tx = (date, direction, amount, category, description, extra = {}) =>
  ({ id: `TX_${date}_${hex(++seq)}`, kind: 'transaction', date, direction, amount, category, description, account_id: ORDEM.id, ...extra });
const TXS = [
  // de maio a setembro: 1000 € de gastos por mês (a média dos meses antes de outubro)
  ...['05', '06', '07', '08', '09'].flatMap(m => [tx(`2026-${m}-01`, 'in', 2000, 'Salário', 'Ordenado'), tx(`2026-${m}-03`, 'out', 1000, 'Casa', 'Renda')]),
  tx('2026-10-01', 'in', 2000, 'Salário', 'Ordenado'),
  tx('2026-10-03', 'out', 1000, 'Casa', 'Renda'),
  tx('2026-10-10', 'out', 300, 'Restaurantes', 'Jantares'),
  tx('2026-10-12', 'out', 80, 'Outros', 'COMPRA 0000 LOJA'),
  tx('2026-10-14', 'out', 20, 'Outros', 'MBWAY X'),
  tx('2026-10-20', 'out', 60, 'Lazer', 'Jantar de grupo', { due: 45 }),       // 45 € por receber
  tx('2026-11-02', 'out', 30, 'Lazer', 'Cinema', { due: 15 }),               // de novembro: não conta no fecho de outubro
  tx('2026-10-28', 'transfer', 100, 'Transferência', 'Para a poupança', { to_account_id: POUP.id }),
];
const inv = (n, name) => ({ id: 'INV_' + hex(n), kind: 'investment', name, inv_type: 'ETF' });
const imv = (n, date, amount) => ({ id: `IMV_${date}_${hex(++seq)}`, kind: 'inv_move', investment_id: 'INV_' + hex(n), date, move: 'contribution', amount });
const val = (n, month, value) => ({ id: `VAL_${hex(n)}_${month}`, kind: 'valuation', investment_id: 'INV_' + hex(n), month, value });
const loan = (n, name) => ({ id: 'LOAN_' + hex(n), kind: 'loan', name, principal: 100000, start_date: '2020-01-15' });
const lbal = (n, month, balance) => ({ id: `LBAL_${hex(n)}_${month}`, kind: 'loan_balance', loan_id: 'LOAN_' + hex(n), month, balance });
const DATA = {
  accounts: [ORDEM, POUP, FECHADA, NOVA], transactions: TXS,
  investments: [inv(1, 'ETF Mundo'), inv(2, 'PPR')],
  inv_moves: [imv(1, '2026-03-01', 1000), imv(2, '2026-03-01', 500)],
  valuations: [val(1, '2026-09', 1100), val(1, '2026-10', 1150), val(2, '2026-09', 520)],
  loans: [loan(1, 'Casa')], loan_balances: [lbal(1, '2026-09', 90000)],
  budgets: [{ id: 'BUD_' + hex(1), kind: 'budget', category: 'Restaurantes', amount: 200 }],
};
const load = (extra = {}) => run('D = { ...emptyData(), ...data }', { data: { ...DATA, ...extra } });

test('o mês a fechar é o que acabou', () => {
  assert.equal(run('closeMonth()'), '2026-10');
});

test('os passos: contas por conferir, investimentos e créditos sem o valor do mês, a receber e "Outros"', () => {
  load();
  const c = run('monthClose()');
  assert.equal(c.month, '2026-10');
  assert.equal(c.show, true);
  assert.equal(c.closed, false);
  // as contas abertas que já existiam no fim de outubro (sem a fechada nem a aberta em novembro), por nome, com o último movimento
  assert.deepEqual(c.accounts, [
    { id: ORDEM.id, name: 'Ordem', last: '2026-10-28', ok: false },
    { id: POUP.id, name: 'Poupança', last: '2026-10-28', ok: false },
  ]);
  assert.deepEqual(c.investments.map(x => [x.name, x.last]), [['PPR', '2026-09']]);
  assert.deepEqual(c.loans.map(x => [x.name, x.last]), [['Casa', '2026-09']]);
  assert.deepEqual(c.receivables.list.map(x => x.left), [45]);
  assert.equal(c.receivables.total, 45);
  assert.equal(c.others, 2);
  assert.deepEqual(c.steps, [{ key: 'accounts', done: false }, { key: 'investments', done: false }, { key: 'loans', done: false },
    { key: 'receivables', done: false }, { key: 'others', done: false }]);
  assert.equal(c.done, 0);
});

test('com tudo feito, os passos ficam todos feitos', () => {
  load({
    valuations: [...DATA.valuations, val(2, '2026-10', 530)],
    loan_balances: [...DATA.loan_balances, lbal(1, '2026-11', 89500)],   // um saldo mais recente também serve
    transactions: TXS.map(t => (t.category === 'Outros' ? { ...t, category: 'Compras' } : t.due && t.date < '2026-11' ? { ...t, due_paid: true } : t)),
    month_closes: [{ id: 'MCL_2026-10', kind: 'month_close', month: '2026-10', accounts_ok: [ORDEM.id, POUP.id, 'ACC_' + hex(99)], closed: false }],
  });
  const c = run('monthClose()');
  assert.ok(c.accounts.every(a => a.ok));
  assert.deepEqual([c.investments, c.loans, c.receivables.list, c.others], [[], [], [], 0]);
  assert.equal(c.done, c.steps.length);
  assert.equal(c.show, true);   // só sai da página inicial ao fechar
});

test('só os passos que se aplicam: sem investimentos nem créditos, ficam de fora', () => {
  load({ investments: [], inv_moves: [], valuations: [], loans: [], loan_balances: [] });
  assert.deepEqual(run('monthClose().steps.map(s => s.key)'), ['accounts', 'receivables', 'others']);
});

test('um mês fechado deixa de aparecer na página inicial; sem dados até ao mês também não aparece', () => {
  load({ month_closes: [{ id: 'MCL_2026-10', kind: 'month_close', month: '2026-10', accounts_ok: [], closed: true }] });
  assert.deepEqual(run('[monthClose().show, monthClose().closed, monthClose("2026-09").show]'), [false, true, true]);
  run('D = { ...emptyData(), accounts: [n] }', { n: NOVA });   // só uma conta aberta em novembro
  assert.equal(run('monthClose().show'), false);
  run('D = emptyData()');
  assert.equal(run('monthClose().show'), false);
});

test('o resumo do mês: totais, taxa, comparação com a média, onde se gastou mais, fora do normal e orçamentos passados', () => {
  load();
  const s = run('monthClose().summary');
  assert.deepEqual([s.in, s.out, s.saved], [2000, 1460, 540]);
  assert.equal(Math.round(s.rate * 100), 27);
  assert.equal(s.avgOut, 1000);
  assert.deepEqual(s.top, [['Casa', 1000], ['Restaurantes', 300], ['Outros', 100]]);
  assert.deepEqual(s.unusual.map(x => x.category), ['Outros', 'Lazer']);
  assert.deepEqual(s.over.map(b => [b.category, b.left]), [['Restaurantes', -100]]);
});

test('o registo a gravar: as contas conferidas e se ficou fechado, mantendo o que não muda', () => {
  load();
  assert.deepEqual(run('monthCloseItem("2026-10", { accountsOk: [a] })', { a: ORDEM.id }),
    { kind: 'month_close', month: '2026-10', accounts_ok: [ORDEM.id], closed: false });
  load({ month_closes: [{ id: 'MCL_2026-10', kind: 'month_close', month: '2026-10', accounts_ok: [POUP.id], closed: false }] });
  assert.deepEqual(run('monthCloseItem("2026-10", { closed: true })'),
    { kind: 'month_close', id: 'MCL_2026-10', month: '2026-10', accounts_ok: [POUP.id], closed: true });
  assert.equal(N(run('eur(monthClose().receivables.total)')), '45,00 €');
});
