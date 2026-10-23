// Testes do saldo previsto no fim do mês (recurringFlows, monthForecast), dos meses de gastos (emergencyMonths) e da alocação
// dos investimentos (allocation e o aviso de fora do alvo), com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
// O "hoje" é fixo (19/10/2026).
//
//     node --test tests/previsao.test.js
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
const load = (data = {}) => run('D = { ...emptyData(), ...data }', { data: JSON.parse(JSON.stringify(data)) });

const ACC1 = 'ACC_000000000001', ACC2 = 'ACC_000000000002';
let seq = 0;
const tx = (date, direction, amount, description, extra = {}) => ({ id: `TX_${date}_${String(++seq).padStart(12, '0')}`, kind: 'transaction',
  date, direction, amount, description, category: 'Outros', account_id: ACC1, ...extra });
const months = (list, day, f) => list.map(m => f(`2026-${m}-${day}`));
const MAY_SEP = ['05', '06', '07', '08', '09'];

// Conta à ordem: ordenado a 20, renda a 1, internet a 28, ginásio a 5 (ainda não saiu em outubro), um reembolso a 2 (ainda não
// entrou), aporte para o ETF a 15, transferência para a Poupança a 3 e o supermercado 4 vezes por mês (gasto do dia a dia)
const DATA = {
  accounts: [
    { id: ACC1, kind: 'account', name: 'Ordem', acc_type: 'Conta à ordem', opening_balance: 1000, opening_date: '2026-05-01' },
    { id: ACC2, kind: 'account', name: 'Poupança', acc_type: 'Poupança', opening_balance: 3000, opening_date: '2026-05-01' },
  ],
  transactions: [
    ...months(MAY_SEP, '20', d => tx(d, 'in', 2000, 'ORDENADO')),
    ...months([...MAY_SEP, '10'], '01', d => tx(d, 'out', 700, 'RENDA')),
    ...months(MAY_SEP, '28', d => tx(d, 'out', 40, 'FIBRA')),
    ...months(MAY_SEP, '05', d => tx(d, 'out', 30, 'GINASIO')),
    ...months(MAY_SEP, '02', d => tx(d, 'in', 50, 'REEMBOLSO')),
    ...months(MAY_SEP, '15', d => tx(d, 'out', 300, 'APORTE ETF', { category: 'Investimentos' })),
    ...months([...MAY_SEP, '10'], '03', d => tx(d, 'transfer', 200, 'PARA POUPANCA', { to_account_id: ACC2 })),
    ...['07', '08', '09'].flatMap(m => ['04', '11', '18', '25'].map(dd => tx(`2026-${m}-${dd}`, 'out', 100, 'SUPERMERCADO'))),
    tx('2026-10-05', 'out', 100, 'SUPERMERCADO'), tx('2026-10-12', 'out', 100, 'SUPERMERCADO'),
    tx('2026-10-25', 'out', 120, 'SEGURO CARRO'),   // já registado, com data futura
  ],
};

test('entradas e saídas habituais: o que ainda está por vir este mês', () => {
  load(DATA);
  const flows = run('recurringFlows()');
  const by = Object.fromEntries(flows.map(x => [x.description, [x.sign, x.amount, x.pending]]));
  assert.deepEqual(by, {
    ORDENADO: [1, 2000, true],        // costuma vir a 20: ainda não chegou
    RENDA: [-1, 700, false],          // já saiu este mês
    FIBRA: [-1, 40, true],            // costuma sair a 28
    GINASIO: [-1, 30, true],          // atrasado (a 5): as saídas atrasadas contam
    REEMBOLSO: [1, 50, false],        // atrasado (a 2): as entradas atrasadas não contam
    'APORTE ETF': [-1, 300, true],    // os aportes também mexem no saldo
  });
  // numa só conta, as transferências contam
  assert.deepEqual(run('recurringFlows(a).filter(x => x.description === "PARA POUPANCA").map(x => [x.sign, x.pending])', { a: ACC1 }), [[-1, false]]);
  assert.deepEqual(run('recurringFlows(a).map(x => [x.description, x.sign])', { a: ACC2 }), [['PARA POUPANCA', 1]]);
});

test('saldo previsto no fim do mês: hoje + já registado + entradas habituais − saídas habituais − dia a dia que falta', () => {
  load(DATA);
  const f = run('monthForecast()');
  // hoje: 4000 + 10 000 − 4200 − 200 − 150 + 250 − 1500 − 1400 = 6800
  assert.equal(f.balance, 6800);
  assert.equal(f.scheduled, -120);
  assert.deepEqual(f.incoming.map(x => x.description), ['ORDENADO']);
  assert.deepEqual(f.outgoing.map(x => x.description), ['APORTE ETF', 'FIBRA', 'GINASIO']);
  // supermercado: 400 € por mês em jul–set, 200 € já gastos em outubro
  assert.equal(f.daily, 200);
  assert.equal(f.total, 6800 - 120 + 2000 - 370 - 200);
  assert.equal(f.end, '2026-10-31');
  // na conta à ordem, com a transferência para a Poupança (que já saiu este mês)
  const o = run('monthForecast(a)', { a: ACC1 });
  assert.deepEqual([o.balance, o.total], [2600, 2600 - 120 + 2000 - 370 - 200]);
  const p = run('monthForecast(a)', { a: ACC2 });
  assert.deepEqual([p.balance, p.scheduled, p.incoming, p.outgoing, p.daily, p.total], [4200, 0, [], [], 0, 4200]);
  // sem dados
  load({});
  assert.deepEqual(run('monthForecast()'), { balance: 0, scheduled: 0, incoming: [], outgoing: [], daily: 0, end: '2026-10-31', total: 0 });
});

test('meses de gastos: o saldo nas contas a dividir pela média dos gastos por mês (sem investimentos)', () => {
  load(DATA);
  const em = run('emergencyMonths()');
  // gastos de mai a set: 770 + 770 + 1170 + 1170 + 1170 = 5050, 1010 € por mês; 6800 / 1010
  assert.deepEqual([em.avg, em.cash, em.n], [1010, 6800, 5]);
  assert.ok(Math.abs(em.months - 6800 / 1010) < 1e-9);
  // sem um mês completo ou sem gastos: null
  load({ accounts: DATA.accounts, transactions: [tx('2026-10-02', 'out', 50, 'CAFE')] });
  assert.equal(run('emergencyMonths()'), null);
  load({ accounts: DATA.accounts, transactions: [tx('2026-09-02', 'in', 50, 'PRENDA')] });
  assert.equal(run('emergencyMonths()'), null);
});

// Carteira: dois ETF (1200 € e 300 €), um PPR (800 €) e cripto (500 €, sem valor registado)
const inv = (n, name, inv_type) => ({ id: 'INV_' + String(n).padStart(12, '0'), kind: 'investment', name, inv_type });
const imv = (n, date, amount) => ({ id: `IMV_${date}_${String(++seq).padStart(12, '0')}`, kind: 'inv_move', investment_id: 'INV_' + String(n).padStart(12, '0'), date, move: 'contribution', amount });
const val = (n, month, value) => ({ id: `VAL_${String(n).padStart(12, '0')}_${month}`, kind: 'valuation', investment_id: 'INV_' + String(n).padStart(12, '0'), month, value });
const alt = (n, inv_type, pct, updated_at = '2026-10-01T10:00:00+00:00') => ({ id: 'ALT_' + String(n).padStart(12, '0'), kind: 'alloc_target', inv_type, pct, updated_at });
const PORTFOLIO = {
  investments: [inv(1, 'ETF Mundo', 'ETF'), inv(2, 'PPR', 'PPR'), inv(3, 'Bitcoin', 'Cripto'), inv(4, 'ETF Europa', 'ETF')],
  inv_moves: [imv(1, '2026-05-10', 1000), imv(2, '2026-06-10', 800), imv(3, '2026-07-10', 500), imv(4, '2026-08-10', 300)],
  valuations: [val(1, '2026-09', 1200), val(2, '2026-09', 800)],
};

test('alocação por tipo: peso de hoje, alvo e quanto falta ou sobra', () => {
  load(PORTFOLIO);
  assert.deepEqual(run('allocation().map(a => [a.type, a.value, Math.round(a.share * 1000) / 10, a.target, a.diff])'),
    [['ETF', 1500, 53.6, null, null], ['PPR', 800, 28.6, null, null], ['Cripto', 500, 17.9, null, null]]);
  // com alvos (o mais recente de cada tipo conta) e um tipo com alvo e sem investimentos
  load({ ...PORTFOLIO, alloc_targets: [alt(1, 'ETF', 60, '2026-09-01T10:00:00+00:00'), alt(2, 'ETF', 70), alt(3, 'PPR', 20), alt(4, 'Obrigações', 10)] });
  assert.deepEqual(run('allocation().map(a => [a.type, a.target, a.diff])'),
    [['ETF', 70, 460], ['PPR', 20, -240], ['Cripto', null, null], ['Obrigações', 10, 280]]);
  // o aviso: os tipos a mais de 5 pontos do alvo
  const a = run('homeAlerts().filter(x => x.action.type === "inv")');
  assert.equal(a.length, 1);
  assert.equal(a[0].text, 'Alocação dos investimentos fora do alvo: ETF 54% (alvo 70%), PPR 29% (alvo 20%), Obrigações 0% (alvo 10%).');
  // perto do alvo, sem aviso
  load({ ...PORTFOLIO, alloc_targets: [alt(1, 'ETF', 55), alt(2, 'PPR', 27), alt(3, 'Cripto', 18)] });
  assert.equal(run('homeAlerts().filter(x => x.action.type === "inv").length'), 0);
  // sem investimentos
  load({});
  assert.deepEqual(run('allocation()'), []);
});
