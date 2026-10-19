// Testes das metas de poupança (goalStatus / goalsStatus), com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
// O "hoje" é fixo (19/10/2026): o mês atual é out 2026 e o ritmo conta os meses até set 2026.
//
//     node --test tests/metas.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ Intl });
for (const f of ['util.js', 'calc.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', f), 'utf8'), ctx, { filename: f });
}
vm.runInContext('todayISO = () => "2026-10-19"', ctx);
const run = (code, vars = {}) => {
  Object.assign(ctx, vars);
  const v = vm.runInContext(code, ctx);
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
};

const ACC1 = 'ACC_000000000001', ACC2 = 'ACC_000000000002', ACC3 = 'ACC_000000000003', INV1 = 'INV_000000000001';
let seq = 0;
const tx = (date, direction, amount, account_id, extra = {}) =>
  ({ id: 'TX_' + String(++seq).padStart(12, '0'), kind: 'transaction', date, direction, amount, account_id, category: 'Outros', ...extra });
const acc = (id, name, opening_balance, opening_date) => ({ id, kind: 'account', name, acc_type: 'Poupança', opening_balance, opening_date });
const goal = (n, name, target, extra = {}) =>
  ({ id: 'GOAL_' + String(n).padStart(12, '0'), kind: 'goal', name, target, source: 'networth', ...extra });
const load = data => run('D = { ...emptyData(), ...data }', { data });
const status = g => run('goalStatus(g)', { g });

// Poupança: 1000 € de saldo inicial e 300 € por mês vindos da conta à ordem, de jan 2025 a out 2026
const months = [];
for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) if (y < 2026 || m <= 10) months.push(`${y}-${String(m).padStart(2, '0')}`);
const SAVINGS = {
  accounts: [acc(ACC1, 'Poupança', 1000, '2025-01-10'), acc(ACC2, 'Ordem', 50000, '2025-01-10')],
  transactions: [
    ...months.map(m => tx(`${m}-05`, 'transfer', 300, ACC2, { to_account_id: ACC1 })),
    tx('2026-10-25', 'in', 5000, ACC1),   // data futura: ainda não conta
  ],
  // ETF: 100 € por mês de abr a set 2026, a valer 660 € no fim de set
  investments: [{ id: INV1, kind: 'investment', name: 'ETF', inv_type: 'ETF' }],
  inv_moves: ['04', '05', '06', '07', '08', '09'].map((m, i) =>
    ({ id: `IMV_2026-${m}-01_00000000000${i}`, kind: 'inv_move', investment_id: INV1, date: `2026-${m}-01`, move: 'contribution', amount: 100 })),
  valuations: [{ id: 'VAL_000000000001_2026-09', kind: 'valuation', investment_id: INV1, month: '2026-09', value: 660 }],
};

test('uma conta com prazo: quanto há, quanto falta, o ritmo, quanto é preciso por mês e quando lá chega', () => {
  load(SAVINGS);
  const s = status(goal(1, 'Fundo de emergência', 10000, { source: 'selected', parts: [ACC1], deadline: '2027-12' }));
  // 1000 + 22 × 300 (a entrada de 25/10 ainda não conta)
  assert.equal(s.current, 7600);
  assert.equal(s.left, 2400);
  assert.equal(s.ratio, 0.76);
  // de set 2025 (3700 €) a set 2026 (7300 €): 300 € por mês em 12 meses
  assert.equal(s.rate, 300);
  assert.equal(s.rateMonths, 12);
  // de out 2026 a dez 2027 são 14 meses: 2400 / 14
  assert.equal(s.monthsLeft, 14);
  assert.equal(s.perMonth, 171.43);
  // 2400 / 300 = 8 meses depois de out 2026
  assert.equal(s.eta, '2027-06');
  assert.equal(s.state, 'ok');
  assert.equal(s.done, false);
});

test('conta + investimento: os valores somam-se e o ritmo de cada um conta só desde que há dados dele', () => {
  load(SAVINGS);
  const s = status(goal(1, 'Casa', 20000, { source: 'selected', parts: [ACC1, INV1] }));
  assert.equal(s.current, 7600 + 660);
  // conta: 300 €/mês; ETF: de abr (100 €) a set (660 €), 560 / 5 = 112 €/mês
  assert.equal(s.rate, 412);
  assert.equal(s.rateMonths, 12);
  assert.deepEqual(s.parts, [ACC1, INV1]);
  // sem prazo: sem estado nem valor por mês, mas com a data a que lá chega
  assert.equal(s.state, '');
  assert.equal(s.perMonth, null);
  assert.equal(s.monthsLeft, null);
  assert.equal(s.eta, run('addMonths("2026-10", Math.ceil((20000 - 8260) / 412))'));
});

test('uma conta aberta há pouco: o ritmo conta só os meses dela, não os da conta mais antiga', () => {
  load({ ...SAVINGS,
    accounts: [...SAVINGS.accounts, acc(ACC3, 'Viagens', 0, '2026-07-03')],
    transactions: [...SAVINGS.transactions, ...['07', '08', '09'].map(m => tx(`2026-${m}-10`, 'in', 500, ACC3))] });
  const s = status(goal(1, 'Férias', 3000, { source: 'selected', parts: [ACC3] }));
  assert.equal(s.current, 1500);
  // de jul (500 €) a set (1500 €): 500 €/mês em 2 meses (e não 1500 / 12)
  assert.equal(s.rate, 500);
  assert.equal(s.rateMonths, 2);
  assert.equal(s.eta, '2027-01');
});

// Património líquido: uma conta com 1000 € de salário e 600 € de gastos por mês, de jan a out 2026
const NETWORTH = {
  accounts: [acc(ACC1, 'Ordem', 0, '2026-01-01')],
  transactions: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].flatMap(m =>
    [tx(`2026-${m}-01`, 'in', 1000, ACC1), tx(`2026-${m}-15`, 'out', 600, ACC1)]),
};

test('património líquido: o mesmo valor da página inicial e o ritmo da evolução', () => {
  load(NETWORTH);
  const s = status(goal(1, 'Primeiros 5000', 5000));
  assert.equal(s.current, run('netWorth().total'));
  assert.equal(s.current, 4000);
  // de jan (400 €) a set (3600 €): 400 €/mês em 8 meses
  assert.equal(s.rate, 400);
  assert.equal(s.rateMonths, 8);
  assert.equal(s.eta, '2027-01');
  assert.deepEqual(s.parts, []);
});

test('estados: atingida, o ritmo não chega, o prazo é este mês e o prazo passou', () => {
  load(NETWORTH);
  const done = status(goal(1, 'Feito', 3000, { deadline: '2027-01' }));
  assert.deepEqual([done.state, done.done, done.left, done.ratio, done.eta, done.perMonth], ['done', true, 0, 1, null, null]);
  // faltam 16 000 € em 8 meses (2000 €/mês), a 400 €/mês só lá chega em fev 2030
  const behind = status(goal(2, 'Carro', 20000, { deadline: '2027-06' }));
  assert.deepEqual([behind.state, behind.perMonth, behind.eta], ['behind', 2000, '2030-02']);
  const thisMonth = status(goal(3, 'Já', 5000, { deadline: '2026-10' }));
  assert.deepEqual([thisMonth.state, thisMonth.monthsLeft, thisMonth.perMonth], ['behind', 0, 1000]);
  const late = status(goal(4, 'Tarde', 5000, { deadline: '2026-08' }));
  assert.deepEqual([late.state, late.monthsLeft, late.perMonth], ['late', -2, null]);
});

test('sem um mês completo, a descer ou devagar demais: sem data de chegada', () => {
  // só movimentos neste mês: ainda não há ritmo
  load({ accounts: [acc(ACC1, 'Nova', 0, '2026-10-01')], transactions: [tx('2026-10-02', 'in', 800, ACC1)] });
  const fresh = status(goal(1, 'Nova', 5000, { deadline: '2027-10' }));
  assert.deepEqual([fresh.current, fresh.rate, fresh.rateMonths, fresh.eta, fresh.state], [800, null, 0, null, 'behind']);
  // a descer 100 €/mês
  load({ accounts: [acc(ACC1, 'Ordem', 5000, '2026-01-01')],
    transactions: ['01', '02', '03', '04', '05', '06', '07', '08', '09'].map(m => tx(`2026-${m}-20`, 'out', 100, ACC1)) });
  const down = status(goal(1, 'Descer', 9000));
  assert.deepEqual([down.rate, down.eta, down.far], [-100, null, false]);
  // a 400 €/mês, um milhão demora mais de 50 anos
  load(NETWORTH);
  const slow = status(goal(1, 'Milhão', 1000000));
  assert.deepEqual([slow.eta, slow.far], [null, true]);
});

test('contas e investimentos apagados deixam de contar', () => {
  load(SAVINGS);
  const s = status(goal(1, 'Restos', 1000, { source: 'selected', parts: ['ACC_999999999999', 'INV_999999999999', ACC1] }));
  assert.deepEqual(s.parts, [ACC1]);
  assert.equal(s.current, 7600);
  const none = status(goal(2, 'Nada', 1000, { source: 'selected', parts: ['ACC_999999999999'] }));
  assert.deepEqual([none.parts, none.current, none.rate, none.ratio], [[], 0, null, 0]);
});

test('ordem: primeiro as que faltam, do prazo mais próximo para as sem prazo, e as atingidas no fim', () => {
  load({ ...NETWORTH, goals: [
    goal(1, 'Sem prazo B', 9000), goal(2, 'Atingida', 100), goal(3, 'Prazo longe', 9000, { deadline: '2030-01' }),
    goal(4, 'Sem prazo A', 9000), goal(5, 'Prazo perto', 9000, { deadline: '2027-01' }),
  ] });
  assert.deepEqual(run('goalsStatus().map(g => g.name)'), ['Prazo perto', 'Prazo longe', 'Sem prazo A', 'Sem prazo B', 'Atingida']);
});
