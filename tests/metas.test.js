// Testes das metas de poupança (goalStatus, goalsStatus, reservedTotal, reserveSources), com dados inventados.
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
const G1 = 'GOAL_000000000001', G2 = 'GOAL_000000000002';
let seq = 0;
const tx = (date, direction, amount, account_id, extra = {}) =>
  ({ id: 'TX_' + String(++seq).padStart(12, '0'), kind: 'transaction', date, direction, amount, account_id, category: 'Outros', ...extra });
const acc = (id, name, opening_balance, extra = {}) =>
  ({ id, kind: 'account', name, acc_type: 'Poupança', opening_balance, opening_date: '2025-01-01', ...extra });
const goal = (id, name, target, extra = {}) => ({ id, kind: 'goal', name, target, source: 'reserve', ...extra });
const res = (goal_id, source_id, date, amount, move = 'reserve') =>
  ({ id: `GRES_${date}_${String(++seq).padStart(12, '0')}`, kind: 'reservation', goal_id, source_id, date, move, amount });
const load = data => run('D = { ...emptyData(), ...data }', { data });
const status = g => run('goalStatus(g)', { g });

// Fundo de emergência: 3000 € reservados na Poupança em set 2025 (ao criar a meta) e depois 300 € por mês, de out 2025 a out 2026
const months = [];
for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) if ((y > 2025 || m >= 10) && (y < 2026 || m <= 10)) months.push(`${y}-${String(m).padStart(2, '0')}`);
const FUND = goal(G1, 'Fundo de emergência', 10000, { deadline: '2027-12' });
const SAVINGS = {
  accounts: [acc(ACC1, 'Poupança', 20000), acc(ACC2, 'Ordem', 1500), acc(ACC3, 'Antiga', 0, { archived: true })],
  investments: [{ id: INV1, kind: 'investment', name: 'ETF', inv_type: 'ETF' }],
  inv_moves: [{ id: 'IMV_2026-01-05_000000000001', kind: 'inv_move', investment_id: INV1, date: '2026-01-05', move: 'contribution', amount: 1000 }],
  valuations: [{ id: 'VAL_000000000001_2026-09', kind: 'valuation', investment_id: INV1, month: '2026-09', value: 1200 }],
  goals: [FUND],
  reservations: [
    res(G1, ACC1, '2025-09-10', 3000),
    ...months.map(m => res(G1, ACC1, `${m}-05`, 300)),
    res(G1, ACC1, '2026-10-25', 1000),   // data futura: ainda não conta
  ],
};

test('com reservas e prazo: quanto há, quanto falta, o ritmo, quanto é preciso por mês e quando lá chega', () => {
  load(SAVINGS);
  const s = status(FUND);
  // 3000 + 13 × 300 (a reserva de 25/10 ainda não conta)
  assert.equal(s.current, 6900);
  assert.equal(s.left, 3100);
  assert.equal(s.ratio, 0.69);
  // o que se reservou em set 2025, ao criar a meta, não é ritmo: de set 2025 (3000 €) a set 2026 (6600 €) são 300 € por mês
  assert.equal(s.rate, 300);
  assert.equal(s.rateMonths, 12);
  // de out 2026 a dez 2027 são 14 meses: 3100 / 14
  assert.equal(s.monthsLeft, 14);
  assert.equal(s.perMonth, 221.43);
  // 3100 / 300 → 11 meses depois de out 2026
  assert.equal(s.eta, '2027-09');
  assert.equal(s.state, 'ok');
  assert.equal(s.source, 'reserve');
  assert.deepEqual(s.sources, [{ id: ACC1, name: 'Poupança', amount: 6900 }]);
});

test('várias metas na mesma conta: cada uma conta só o que tem reservado, e o que se tira sai da meta', () => {
  load({ ...SAVINGS, goals: [FUND, goal(G2, 'Férias', 2000)], reservations: [
    ...SAVINGS.reservations,
    res(G2, ACC1, '2026-08-01', 1500), res(G2, INV1, '2026-08-01', 400), res(G2, ACC1, '2026-09-20', 600, 'release'),
  ] });
  assert.equal(status(FUND).current, 6900);
  const s = status(goal(G2, 'Férias', 2000));
  assert.equal(s.current, 1500 + 400 - 600);
  assert.deepEqual(s.sources.map(x => [x.name, x.amount]), [['Poupança', 900], ['ETF', 400]]);
  // ago (1900 €) → set (1300 €): tirou-se mais do que se reservou, sem data de chegada
  assert.deepEqual([s.rate, s.rateMonths, s.eta], [-600, 1, null]);
  assert.equal(run('reservedTotal({ sourceId: id })', { id: ACC1 }), 6900 + 900);
  assert.equal(run('reservedTotal({ goalId: id, upTo: "9999-12-31" })', { id: G1 }), 7900);   // com a reserva futura
});

test('livre para reservar: saldo de hoje menos o reservado, por conta e investimento; negativo se se reservou demais', () => {
  load({ ...SAVINGS, transactions: [tx('2026-10-10', 'out', 13500, ACC1)], reservations: [
    ...SAVINGS.reservations, res(G1, INV1, '2026-09-01', 200),
  ] });
  // só os que têm reservas: Poupança (20000 − 13500 = 6500 € de saldo, 6900 € reservados) e o ETF (1200 €, 200 € reservados)
  assert.deepEqual(run('reserveSources()').map(x => [x.name, x.value, x.reserved, x.free]),
    [['Poupança', 6500, 6900, -400], ['ETF', 1200, 200, 1000]]);
  // com all, também as contas sem reservas, mas não as arquivadas
  assert.deepEqual(run('reserveSources(true)').map(x => [x.name, x.free]), [['Ordem', 1500], ['Poupança', -400], ['ETF', 1000]]);
});

test('o ritmo só começa depois do primeiro mês com reservas', () => {
  // tudo reservado no mês passado: ainda não há ritmo
  load({ ...SAVINGS, reservations: [res(G1, ACC1, '2026-09-02', 2000), res(G1, ACC1, '2026-10-03', 300)] });
  let s = status(FUND);
  assert.deepEqual([s.current, s.rate, s.rateMonths, s.eta, s.state], [2300, null, 0, null, 'behind']);
  // 1000 € em ago e 200 € em set: o ritmo é só o de set
  load({ ...SAVINGS, reservations: [res(G1, ACC1, '2026-08-02', 1000), res(G1, ACC1, '2026-09-03', 200)] });
  s = status(FUND);
  assert.deepEqual([s.rate, s.rateMonths], [200, 1]);
  // sem reservas
  load({ ...SAVINGS, reservations: [] });
  s = status(FUND);
  assert.deepEqual([s.current, s.rate, s.sources, s.ratio], [0, null, [], 0]);
});

test('reserva mensal planeada: sem ritmo, o plano dá a data de chegada; fica por fazer até haver uma reserva este mês', () => {
  const plan = { ...FUND, monthly: 500, monthly_source: ACC1 };
  // só um mês com reservas: ainda não há ritmo; 8000 € em falta a 500 €/mês são 16 meses (fev 2028, depois do prazo)
  load({ ...SAVINGS, reservations: [res(G1, ACC1, '2026-09-02', 2000)] });
  let s = status(plan);
  assert.deepEqual([s.rate, s.fromPlan, s.monthly, s.monthlySource, s.eta, s.state, s.monthlyDue, s.monthlyAmount],
    [null, true, 500, ACC1, '2028-02', 'behind', true, 500]);
  // tirar dinheiro este mês não conta; uma reserva este mês (de qualquer valor e de qualquer conta) já conta
  load({ ...SAVINGS, reservations: [res(G1, ACC1, '2026-09-02', 2000), res(G1, ACC1, '2026-10-01', 100, 'release')] });
  assert.equal(status(plan).monthlyDue, true);
  load({ ...SAVINGS, reservations: [res(G1, ACC1, '2026-09-02', 2000), res(G1, INV1, '2026-10-01', 50)] });
  assert.equal(status(plan).monthlyDue, false);
  // perto do fim, só o que falta; atingida, nada por fazer
  load({ ...SAVINGS, reservations: [res(G1, ACC1, '2026-09-02', 9800)] });
  assert.equal(status(plan).monthlyAmount, 200);
  load({ ...SAVINGS, reservations: [res(G1, ACC1, '2026-09-02', 10000)] });
  assert.deepEqual([status(plan).done, status(plan).monthlyDue], [true, false]);
  // com ritmo, o plano não mexe na data de chegada; nas metas do património líquido não há plano
  load(SAVINGS);
  s = status(plan);
  assert.deepEqual([s.fromPlan, s.eta], [false, '2027-09']);
  assert.deepEqual([status({ ...plan, source: 'networth' }).monthly, status({ ...plan, source: 'networth' }).monthlyDue], [null, false]);
});

test('as metas do primeiro dia (contas inteiras) contam como metas com reservas', () => {
  load(SAVINGS);
  const s = status({ ...FUND, source: 'selected', parts: [ACC1] });
  assert.equal(s.source, 'reserve');
  assert.equal(s.current, 6900);
});

// Património líquido: uma conta com 1000 € de salário e 600 € de gastos por mês, de jan a out 2026
const NETWORTH = {
  accounts: [acc(ACC1, 'Ordem', 0, { opening_date: '2026-01-01' })],
  transactions: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].flatMap(m =>
    [tx(`2026-${m}-01`, 'in', 1000, ACC1), tx(`2026-${m}-15`, 'out', 600, ACC1)]),
};
const nw = (id, name, target, extra = {}) => goal(id, name, target, { source: 'networth', ...extra });

test('património líquido: o mesmo valor da página inicial e o ritmo da evolução', () => {
  load(NETWORTH);
  const s = status(nw(G1, 'Primeiros 5000', 5000));
  assert.equal(s.current, run('netWorth().total'));
  assert.equal(s.current, 4000);
  // de jan (400 €) a set (3600 €): 400 €/mês em 8 meses
  assert.deepEqual([s.rate, s.rateMonths, s.eta, s.source, s.sources], [400, 8, '2027-01', 'networth', []]);
});

test('estados: atingida, o ritmo não chega, o prazo é este mês, o prazo passou e mais de 50 anos', () => {
  load(NETWORTH);
  const done = status(nw(G1, 'Feito', 3000, { deadline: '2027-01' }));
  assert.deepEqual([done.state, done.done, done.left, done.ratio, done.eta, done.perMonth], ['done', true, 0, 1, null, null]);
  // faltam 16 000 € em 8 meses (2000 €/mês), a 400 €/mês só lá chega em fev 2030
  const behind = status(nw(G1, 'Carro', 20000, { deadline: '2027-06' }));
  assert.deepEqual([behind.state, behind.perMonth, behind.eta], ['behind', 2000, '2030-02']);
  const thisMonth = status(nw(G1, 'Já', 5000, { deadline: '2026-10' }));
  assert.deepEqual([thisMonth.state, thisMonth.monthsLeft, thisMonth.perMonth], ['behind', 0, 1000]);
  const late = status(nw(G1, 'Tarde', 5000, { deadline: '2026-08' }));
  assert.deepEqual([late.state, late.monthsLeft, late.perMonth], ['late', -2, null]);
  const slow = status(nw(G1, 'Milhão', 1000000));
  assert.deepEqual([slow.eta, slow.far], [null, true]);
});

test('ordem: primeiro as que faltam, do prazo mais próximo para as sem prazo, e as atingidas no fim', () => {
  load({ ...NETWORTH, goals: [
    nw('GOAL_000000000001', 'Sem prazo B', 9000), nw('GOAL_000000000002', 'Atingida', 100),
    nw('GOAL_000000000003', 'Prazo longe', 9000, { deadline: '2030-01' }), nw('GOAL_000000000004', 'Sem prazo A', 9000),
    nw('GOAL_000000000005', 'Prazo perto', 9000, { deadline: '2027-01' }),
  ] });
  assert.deepEqual(run('goalsStatus().map(g => g.name)'), ['Prazo perto', 'Prazo longe', 'Sem prazo A', 'Sem prazo B', 'Atingida']);
});
