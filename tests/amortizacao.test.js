// Testes do simulador de amortização antecipada (annuityPayment, payoff e simulateEarlyRepayment), com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
// O "hoje" é fixo (13/10/2026), para o prazo que falta não depender do dia em que os testes correm.
//
//     node --test tests/amortizacao.test.js
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
const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

const LOAN = 'LOAN_000000000001';
// Crédito de 100 000 € em dívida em outubro de 2026, TAN 3%, a acabar daqui a 300 meses (25 anos)
const loan = (extra = {}) => ({ id: LOAN, kind: 'loan', name: 'Crédito', principal: 120000, start_date: '2020-01-15',
  rate: 3, end_date: '2051-10-15', ...extra });
const load = (l, balance = 100000) => run('D = { ...emptyData(), loans: [l], loan_balances: bs }', {
  l, bs: balance === null ? [] : [{ id: 'LBAL_000000000001', kind: 'loan_balance', loan_id: LOAN, month: '2026-10', balance }],
});
const sim = (amount, fee = 0) => run('simulateEarlyRepayment(D.loans[0], amount, fee)', { amount, fee });

test('prestação e juros da amortização francesa', () => {
  near(run('annuityPayment(100000, 0.0025, 300)'), 474.21, 0.01);
  const p = run('payoff(100000, 0.0025, annuityPayment(100000, 0.0025, 300))');
  assert.equal(p.months, 300);
  near(p.interest, run('annuityPayment(100000, 0.0025, 300)') * 300 - 100000, 0.01);
  assert.equal(run('annuityPayment(12000, 0, 12)'), 1000);
  assert.deepEqual(run('payoff(12000, 0, 1000)'), { months: 12, interest: 0 });
});

test('sem amortizar: a prestação que paga o saldo no prazo que falta', () => {
  load(loan());
  const s = sim(0);
  assert.equal(s.balance, 100000);
  assert.equal(s.now.months, 300);
  near(s.now.payment, 474.21, 0.01);
  near(s.now.interest, 42263.39, 0.01);
});

test('amortizar 10 000 €: reduzir a prestação ou reduzir o prazo, com comissão de 0,5%', () => {
  load(loan());
  const s = sim(10000, 0.5);
  assert.equal(s.paidOff, false);
  assert.equal(s.fee, 50);
  // reduzir a prestação: mesmo prazo, prestação e juros 10% mais baixos
  assert.equal(s.byPayment.months, 300);
  near(s.byPayment.payment, s.now.payment * 0.9, 0.01);
  near(s.byPayment.interest, s.now.interest * 0.9, 0.5);
  // reduzir o prazo: mesma prestação, 258 meses (n = −ln(1 − r·B/P) / ln(1 + r) com B = 90 000)
  assert.equal(s.byTerm.payment, s.now.payment);
  assert.equal(s.byTerm.months, 258);
  // reduzir o prazo poupa mais juros; a poupança líquida desconta a comissão
  assert.ok(s.byTerm.saved > s.byPayment.saved && s.byPayment.saved > 0);
  for (const c of [s.byPayment, s.byTerm]) {
    near(c.saved, s.now.interest - c.interest, 0.01);
    near(c.net, c.saved - 50, 0.01);
  }
});

test('amortizar tudo (ou mais): o crédito fica pago e poupam-se os juros todos', () => {
  load(loan());
  const s = sim(150000, 2);
  assert.equal(s.paidOff, true);
  assert.equal(s.saved, s.now.interest);
  assert.equal(s.fee, 3000);
  near(s.net, s.now.interest - 3000, 0.01);
});

test('sem juros (TAN 0%): não se poupa nada, mas o prazo encurta', () => {
  load(loan({ rate: 0, end_date: '2027-10-15' }), 12000);
  const s = sim(6000);
  assert.equal(s.now.payment, 1000);
  assert.equal(s.byTerm.months, 6);
  assert.equal(s.byTerm.saved, 0);
  assert.equal(s.byPayment.payment, 500);
});

test('sem dados para simular: sem taxa, sem prazo conhecido ou já pago', () => {
  load(loan({ rate: undefined }));
  assert.equal(sim(1000), null);
  load(loan({ end_date: undefined, payment: undefined }));   // sem fim do contrato, sem prestação e só um saldo
  assert.equal(sim(1000), null);
  load(loan(), 0);
  assert.equal(sim(1000), null);
  load(loan({ end_date: undefined, payment: 474.22 }));       // sem fim do contrato: prazo pela prestação
  assert.equal(sim(0).now.months, 300);
});
