// Testes do simulador de amortização antecipada (annuityPayment, payoff e simulateEarlyRepayment) e da taxa de esforço (debtBurden),
// com dados inventados.
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

test('amortizar ou investir: o ganho do investimento no prazo que falta, com 28% de imposto, e a partir de quanto compensa', () => {
  load(loan());
  const s = sim(10000);   // reduzir o prazo poupa 10 076,89 € de juros (sem comissão)
  assert.equal(s.byTerm.net, 10076.89);
  // 10 000 € a 5% durante 300 meses: 10 000 × (1,05^25 − 1) = 23 863,55 € de ganho, 28% de imposto
  assert.deepEqual(run('investInstead(10000, 5, 300)'), { gain: 23863.55, tax: 6681.79, net: 17181.76 });
  assert.ok(run('investInstead(10000, 3, 300).net') < s.byTerm.net);   // à taxa do crédito, amortizar compensa mais
  // a partir de quanto investir compensa: dá exatamente a poupança de amortizar (o imposto só se paga no fim, por isso fica
  // abaixo da taxa ÷ 0,72 = 4,17%)
  const even = run('breakEvenReturn(saved, 10000, 300)', { saved: s.byTerm.net });
  near(even, 3.5632, 0.0001);
  near(run('investInstead(10000, even, 300).net', { even }), s.byTerm.net, 0.01);
  // a perder não se paga imposto; sem poupança a amortizar (ex.: a comissão come os juros), qualquer rentabilidade compensa
  assert.deepEqual(run('investInstead(1000, -10, 12)'), { gain: -100, tax: 0, net: -100 });
  assert.equal(run('breakEvenReturn(-5, 10000, 300)'), 0);
});

test('amortizar ou investir no simulador: compara com reduzir o prazo e não compara quando o valor paga o crédito todo', () => {
  load(loan());
  const c = run('investComparison(simulateEarlyRepayment(D.loans[0], 10000, 0), 10000, 5, 300)');
  assert.equal(c.amort, 10076.89);
  assert.equal(c.invest.net, 17181.76);
  assert.equal(c.better, 'invest');
  near(c.breakEven, 3.5632, 0.0001);
  assert.equal(run('investComparison(simulateEarlyRepayment(D.loans[0], 10000, 0), 10000, 3, 300).better'), 'amortize');
  // sem rentabilidade escrita: só a partir de quanto compensa
  assert.equal(run('investComparison(simulateEarlyRepayment(D.loans[0], 10000, 0), 10000, NaN, 300).invest'), null);
  // pagar tudo: as prestações deixam de sair logo no mês seguinte, e a conta de reduzir o prazo não serve
  assert.equal(run('investComparison(simulateEarlyRepayment(D.loans[0], 100000, 0), 100000, 5, 300)'), null);
});

test('taxa de esforço: as prestações dos créditos com dívida a dividir pela média das entradas dos 12 meses completos', () => {
  const ACC = 'ACC_000000000001';
  let seq = 0;
  const tx = (date, direction, amount, category, extra = {}) => ({ id: `TX_${date}_${String(++seq).padStart(12, '0')}`, kind: 'transaction',
    date, direction, amount, category, description: '', account_id: ACC, ...extra });
  const credit = (n, payment) => ({ id: 'LOAN_' + String(n).padStart(12, '0'), kind: 'loan', name: `Crédito ${n}`, principal: 10000,
    start_date: '2020-01-15', rate: 3, payment });
  // 12 meses completos (outubro de 2025 a setembro de 2026): 1500 €/mês e o subsídio de 1500 € em julho; o ordenado de outubro
  // de 2026 (o mês atual) não conta, nem a entrada que é o reembolso de um jantar
  const months = ['2025-10', '2025-11', '2025-12', ...Array.from({ length: 9 }, (_, i) => `2026-0${i + 1}`)];
  const jantar = tx('2026-05-10', 'out', 80, 'Restauração', { due: 60 });
  const txs = [...months.map(m => tx(`${m}-25`, 'in', 1500, 'Salário')), tx('2026-07-15', 'in', 1500, 'Salário'),
    tx('2026-10-01', 'in', 1500, 'Salário'), jantar, tx('2026-05-11', 'in', 60, 'Transferências in', { refund_of: jantar.id }),
    tx('2024-01-02', 'out', 10, 'Casa')];   // um movimento antigo: os 12 meses estão todos dentro dos dados
  const burden = (loans, bs = [], list = txs) => run('D = { ...emptyData(), transactions: t, loans: l, loan_balances: b }; debtBurden()',
    { t: list, l: loans, b: bs });
  // 500 + 150 de prestações sobre 19 500 / 12 = 1625 €/mês: 40%, acima do confortável; o crédito já pago não conta
  const paid = { id: 'LBAL_000000000003_2026-09', kind: 'loan_balance', loan_id: 'LOAN_000000000003', month: '2026-09', balance: 0 };
  const b = burden([credit(1, 500), credit(2, 150), credit(3, 300)], [paid]);
  assert.deepEqual([b.payments, b.income, b.months, b.level], [650, 1625, 12, 'high']);
  near(b.ratio, 0.4, 1e-9);
  assert.equal(burden([credit(1, 500)]).level, 'ok');                       // 31%
  // acima de 50%: o aviso no "A ver", com o botão para os Créditos
  assert.equal(burden([credit(1, 900)]).level, 'over');                     // 55%
  const alert = run('homeAlerts()').find(a => a.id.startsWith('burden:'));
  assert.deepEqual([alert.id, alert.level, alert.action.type], ['burden:2026-10', 'warn', 'loan']);
  assert.equal(alert.text.replace(/\s/g, ' '), 'Taxa de esforço de 55%: as prestações dos créditos (900,00 €/mês) passam metade das tuas '
    + 'entradas (média de 1625,00 €/mês). O Banco de Portugal usa 50% como limite nos créditos novos.');
  burden([credit(1, 500)]);
  assert.equal(run('homeAlerts()').find(a => a.id.startsWith('burden:')), undefined);
  // dados só desde julho: julho, o 1.º mês, não conta (quase sempre está a meio); a média é de agosto e setembro: 3000 / 2 = 1500
  const recent = txs.filter(t => t.date >= '2026-07');
  assert.deepEqual((({ income, months: n }) => [income, n])(burden([credit(1, 500)], [], recent)), [1500, 2]);
  // só com o 1.º mês (setembro), não há taxa
  assert.equal(burden([credit(1, 500)], [], txs.filter(t => t.date.startsWith('2026-09'))).ratio, null);
  // sem créditos ou sem entradas, não há taxa
  assert.equal(burden([]).ratio, null);
  assert.equal(burden([credit(1, 500)], [], []).ratio, null);
});
