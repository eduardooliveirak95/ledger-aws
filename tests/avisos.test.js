// Testes dos avisos da página inicial (homeAlerts), das despesas fixas que subiram de preço (priceRises) e do modo
// privado (eur com privateMode), com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
// O "hoje" é fixo (19/10/2026): o mês atual é out 2026 e o anterior set 2026.
//
//     node --test tests/avisos.test.js
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
const N = s => s.replace(/\s/g, ' ');   // os euros têm um espaço especial antes do €

const ACC1 = 'ACC_000000000001', ACC2 = 'ACC_000000000002';
let seq = 0;
const id = (p, date = '') => `${p}_${date ? date + '_' : ''}${String(++seq).padStart(12, '0')}`;
const out = (date, amount, category, description, account_id = ACC1) =>
  ({ id: id('TX', date), kind: 'transaction', date, direction: 'out', amount, category, description, account_id });
const inv = (n, name, extra = {}) => ({ id: 'INV_' + String(n).padStart(12, '0'), kind: 'investment', name, inv_type: 'ETF', ...extra });
const imv = (n, date, amount, move = 'contribution') =>
  ({ id: id('IMV', date), kind: 'inv_move', investment_id: 'INV_' + String(n).padStart(12, '0'), date, move, amount });
const val = (n, month, value) => ({ id: `VAL_${String(n).padStart(12, '0')}_${month}`, kind: 'valuation', investment_id: 'INV_' + String(n).padStart(12, '0'), month, value });
const loan = (n, name) => ({ id: 'LOAN_' + String(n).padStart(12, '0'), kind: 'loan', name, principal: 100000, start_date: '2020-01-15' });
const lbal = (n, month, balance) => ({ id: `LBAL_${String(n).padStart(12, '0')}_${month}`, kind: 'loan_balance', loan_id: 'LOAN_' + String(n).padStart(12, '0'), month, balance });
const goal = (n, name, target, extra = {}) => ({ id: 'GOAL_' + String(n).padStart(12, '0'), kind: 'goal', name, target, source: 'reserve', ...extra });
const res = (g, source_id, date, amount) =>
  ({ id: id('GRES', date), kind: 'reservation', goal_id: 'GOAL_' + String(g).padStart(12, '0'), source_id, date, move: 'reserve', amount });

const DATA = {
  accounts: [
    { id: ACC1, kind: 'account', name: 'Ordem', acc_type: 'Conta à ordem', opening_balance: 1000, opening_date: '2025-01-01' },
    { id: ACC2, kind: 'account', name: 'Poupança', acc_type: 'Poupança', opening_balance: 5000, opening_date: '2025-01-01' },
  ],
  transactions: [
    // subscrição que subiu (11,99 € → 13,99 €), uma que não mudou e uma que varia sempre (não são subidas)
    ...['06', '07', '08'].map(m => out(`2026-${m}-10`, 11.99, 'Subscrições', 'NETFLIX.COM')), out('2026-09-10', 13.99, 'Subscrições', 'NETFLIX.COM'),
    ...['06', '07', '08', '09'].map(m => out(`2026-${m}-12`, 30, 'Lazer', 'GINASIO')),
    ...[['06', 40], ['07', 55], ['08', 48], ['09', 60]].map(([m, v]) => out(`2026-${m}-15`, v, 'Água / Luz / Gás', 'LUZ')),
    // orçamentos deste mês: Restauração a 90%, Lazer acima do limite
    out('2026-10-05', 90, 'Restauração', 'Jantar'), out('2026-10-06', 70, 'Lazer', 'Concerto'),
  ],
  budgets: [
    { id: 'BUD_000000000001', kind: 'budget', category: 'Restauração', amount: 100 },
    { id: 'BUD_000000000002', kind: 'budget', category: 'Lazer', amount: 50 },
  ],
  investments: [inv(1, 'ETF'), inv(2, 'PPR'), inv(3, 'Cripto'), inv(4, 'Vendido'), inv(5, 'Antigo', { archived: true })],
  inv_moves: [
    imv(1, '2026-05-01', 1000),                              // ETF: último valor em ago → aviso
    imv(2, '2026-10-02', 300),                               // PPR: começou este mês → sem aviso
    imv(3, '2026-01-05', 500),                               // Cripto: tem o valor de set → sem aviso
    imv(4, '2026-01-05', 500), imv(4, '2026-03-05', 500, 'withdrawal'),   // vendido: vale 0 → sem aviso
    imv(5, '2026-01-05', 500),                               // arquivado → sem aviso
  ],
  valuations: [val(1, '2026-08', 1100), val(3, '2026-09', 650)],
  loans: [loan(1, 'Casa'), loan(2, 'Carro'), loan(3, 'Pago')],
  loan_balances: [lbal(1, '2026-08', 90000), lbal(2, '2026-09', 8000), lbal(3, '2026-05', 0)],
  goals: [
    goal(1, 'Férias', 2000, { deadline: '2026-08' }),                                    // o prazo passou
    goal(2, 'Carro novo', 10000, { deadline: '2027-03', monthly: 200, monthly_source: ACC2 }),   // não chega e falta a reserva do mês
    goal(3, 'Bicicleta', 1000, { monthly: 50, monthly_source: 'ACC_999999999999' }),    // a conta do plano foi apagada
    goal(4, 'Mota', 5000),                                                               // reservou-se demais na Ordem
    goal(5, 'Cem mil', 100000, { source: 'networth' }),
  ],
  reservations: [
    res(1, ACC2, '2026-05-02', 500),
    res(2, ACC2, '2026-01-03', 1000), ...['02', '03', '04', '05', '06', '07', '08', '09'].map(m => res(2, ACC2, `2026-${m}-03`, 100)),
    res(4, ACC1, '2026-10-01', 600),
  ],
};
// cada teste trabalha numa cópia dos dados (nenhum mexe nos de outro)
const load = (extra = {}) => run('D = { ...emptyData(), ...data }', { data: JSON.parse(JSON.stringify({ ...DATA, ...extra })) });
const alerts = () => (load(), run('homeAlerts()'));

test('subidas de preço: só quando o último valor passa os anteriores, que eram sempre iguais', () => {
  load();
  assert.deepEqual(run('priceRises()'), [{ key: 'netflix com', description: 'NETFLIX.COM', from: 11.99, to: 13.99, date: '2026-09-10' }]);
  // quando o valor novo se repete, deixa de ser uma subida
  load({ transactions: [...DATA.transactions, out('2026-10-10', 13.99, 'Subscrições', 'NETFLIX.COM')] });
  assert.deepEqual(run('priceRises()'), []);
});

test('avisos: os de cada tipo, dos mais graves para os menos, com o botão certo', () => {
  const list = alerts();
  assert.deepEqual(list.map(a => [a.level, a.action.type, a.action.arg]), [
    ['bad', 'goals', ''],                                  // reservado a mais na Ordem
    ['bad', 'goal-edit', 'GOAL_000000000001'],             // Férias: o prazo passou
    ['bad', 'mov', ''],                                    // orçamentos (um acima do limite)
    ['warn', 'goal-edit', 'GOAL_000000000002'],            // Carro novo: o ritmo não chega
    ['warn', 'goal-edit', 'GOAL_000000000003'],            // Bicicleta: conta do plano apagada
    ['warn', 'inv-month', ''],                             // ETF sem o valor de setembro
    ['warn', 'loan-month', ''],                            // Casa sem o saldo de setembro
    ['info', 'goal-monthly', 'GOAL_000000000002'],         // Carro novo: reserva do mês por fazer
    ['info', 'recurring', ''],                             // Netflix subiu
  ]);
  const text = list.map(a => N(a.text));
  assert.equal(text[0], 'Em Ordem reservaste 132,96 € a mais do que lá tens (467,04 €): tira esse valor de alguma meta.');
  assert.equal(text[1], 'Férias: o prazo acabou em agosto 2026 e faltam 1500,00 €.');
  assert.equal(text[2], 'Orçamentos de outubro 2026: Lazer 20,00 € acima do limite, Restauração a 90%.');
  assert.equal(text[3], 'Carro novo: ao ritmo atual (+100 €/mês) só chegas lá em agosto 2033; o prazo é março 2027. Precisas de 1640 €/mês.');
  assert.equal(text[4], 'Bicicleta: a conta das reservas mensais foi apagada; escolhe outra.');
  assert.equal(text[5], 'Investimentos sem o valor de setembro 2026: ETF (último: agosto 2026).');
  assert.equal(text[6], 'Créditos sem o saldo de setembro 2026: Casa (último: agosto 2026).');
  assert.equal(text[7], 'Carro novo: ainda não reservaste os 200,00 € deste mês (de Poupança).');
  assert.equal(N(list[7].action.label), 'Reservar 200,00 €');
  assert.equal(text[8], 'NETFLIX.COM: passou de 11,99 € para 13,99 € (+2,00 €/mês).');
  // ids diferentes para cada aviso, com o mês (um aviso dispensado volta no mês seguinte ou se mudar)
  assert.equal(new Set(list.map(a => a.id)).size, list.length);
  assert.ok(list.find(a => a.action.type === 'inv-month').id.startsWith('inv:2026-09:'));
});

test('sem nada a apontar, não há avisos', () => {
  assert.deepEqual(run('D = emptyData(); homeAlerts()'), []);
});

test('modo privado: os euros aparecem como ••• €, as percentagens não mudam', () => {
  try {
    run('setPrivateMode(true)');
    assert.deepEqual(run('[eur(1234.5), eurShort(99), eurSigned(-3), eurSignedShort(7), pct(0.051)]'),
      ['••• €', '••• €', '−••• €', '+••• €', '+5,1%']);
    // os avisos também não mostram valores
    assert.ok(alerts().every(a => !/\d,\d\d\s€|\d\s€/.test(a.text)), 'valores à vista nos avisos');
  } finally {
    run('setPrivateMode(false)');
  }
  assert.equal(N(run('eur(1234.5)')), '1234,50 €');
});
