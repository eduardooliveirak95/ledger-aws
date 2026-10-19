// Teste de ida e volta do backup: exportar os 5 CSV ("⬇ Backup") e importá-los numa conta vazia tem de dar
// exatamente os mesmos dados. Com dados inventados; corre no Node, sem browser (os ficheiros do site são
// carregados num contexto isolado e a gravação na API é simulada, com ids como os do backend).
//
//     node --test tests/backup.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ Intl });
for (const f of ['util.js', 'calc.js', 'csv.js', 'bank.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', f), 'utf8'), ctx, { filename: f });
}
const run = (code, vars = {}) => {
  Object.assign(ctx, vars);
  const v = vm.runInContext(code, ctx);
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
};

// API simulada: devolve os itens gravados com um id (valores e saldos com o id "um por mês" do backend)
let seq = 0;
const hex = () => (++seq).toString(16).padStart(12, '0');
const tail = id => id.split('_').pop();
const newId = it => ({
  account: () => 'ACC_' + hex(), investment: () => 'INV_' + hex(), loan: () => 'LOAN_' + hex(), property: () => 'PROP_' + hex(),
  transaction: () => `TX_${it.date}_${hex()}`, inv_move: () => `IMV_${it.date}_${hex()}`,
  valuation: () => `VAL_${tail(it.investment_id)}_${it.month}`, loan_balance: () => `LBAL_${tail(it.loan_id)}_${it.month}`,
}[it.kind])();
ctx.api = { save: async items => ({ saved: items.map(it => ({ ...it, id: it.id || newId(it) })), deleted: [] }) };

const ACC1 = 'ACC_000000000a01', ACC2 = 'ACC_000000000a02', ACC3 = 'ACC_000000000a03';
const ETF = 'INV_000000000c01', FUNDO = 'INV_000000000c02', CASA = 'LOAN_000000000e01', CARRO = 'LOAN_000000000e02';
const DATA = {
  accounts: [
    { id: ACC1, kind: 'account', name: 'Conta à ordem', acc_type: 'Conta à ordem', opening_balance: 1250.55, opening_date: '2024-01-01' },
    { id: ACC2, kind: 'account', name: 'Poupança', acc_type: 'Poupança', opening_balance: 3000, opening_date: '2024-02-01' },
    { id: ACC3, kind: 'account', name: 'Carteira', acc_type: 'Dinheiro', opening_balance: 0, opening_date: '2025-01-01' },
  ],
  transactions: [
    // dois movimentos iguais no mesmo dia são ambos reais
    { id: 'TX_2026-01-05_000000000b01', kind: 'transaction', date: '2026-01-05', direction: 'out', amount: 32.4, category: 'Supermercado', description: 'Compras; pão "caseiro"', account_id: ACC1, approx: false },
    { id: 'TX_2026-01-05_000000000b02', kind: 'transaction', date: '2026-01-05', direction: 'out', amount: 32.4, category: 'Supermercado', description: 'Compras; pão "caseiro"', account_id: ACC1, approx: false },
    { id: 'TX_2026-01-25_000000000b03', kind: 'transaction', date: '2026-01-25', direction: 'in', amount: 1800, category: 'Salário', description: '', account_id: ACC1, approx: false },
    { id: 'TX_2026-01-31_000000000b04', kind: 'transaction', date: '2026-01-31', direction: 'out', amount: 120, category: 'Restauração', description: '=SOMA(A1) total do mês', account_id: ACC1, approx: true },
    { id: 'TX_2026-02-01_000000000b05', kind: 'transaction', date: '2026-02-01', direction: 'transfer', amount: 200, category: 'Transferência', description: 'Para a poupança', account_id: ACC1, to_account_id: ACC2, approx: false },
    { id: 'TX_2026-02-03_000000000b06', kind: 'transaction', date: '2026-02-03', direction: 'out', amount: 2.4, category: 'Café', description: 'linha 1\nlinha 2', account_id: ACC3, approx: false },
  ],
  investments: [
    { id: ETF, kind: 'investment', name: 'ETF Mundial', inv_type: 'ETF', notes: 'ISIN: IE0000000001' },
    { id: FUNDO, kind: 'investment', name: 'Fundo sem registos', inv_type: 'Fundo', notes: 'só para guardar' },
  ],
  inv_moves: [
    { id: 'IMV_2025-01-10_000000000d01', kind: 'inv_move', investment_id: ETF, date: '2025-01-10', move: 'contribution', amount: 500, description: 'Compra' },
    { id: 'IMV_2025-06-10_000000000d02', kind: 'inv_move', investment_id: ETF, date: '2025-06-10', move: 'withdrawal', amount: 100.5, description: '' },
  ],
  valuations: [
    { id: `VAL_${tail(ETF)}_2025-01`, kind: 'valuation', investment_id: ETF, month: '2025-01', value: 505.25 },
    { id: `VAL_${tail(ETF)}_2026-09`, kind: 'valuation', investment_id: ETF, month: '2026-09', value: 480 },
  ],
  loans: [
    { id: CASA, kind: 'loan', name: 'Crédito habitação', loan_type: 'Habitação', lender: 'Banco Exemplo', principal: 150000, start_date: '2023-06-15', end_date: '2063-06-15', rate: 3.125, payment: 650 },
    { id: CARRO, kind: 'loan', name: 'Crédito carro', loan_type: 'Automóvel', lender: '', principal: 12000, start_date: '2025-03-01', end_date: null, rate: null, payment: null },
  ],
  loan_balances: [
    // num mês a prestação foi diferente; no outro não foi registada (vale a do crédito)
    { id: `LBAL_${tail(CASA)}_2026-01`, kind: 'loan_balance', loan_id: CASA, month: '2026-01', balance: 140000, payment: 660, extra: null },
    { id: `LBAL_${tail(CASA)}_2026-02`, kind: 'loan_balance', loan_id: CASA, month: '2026-02', balance: 134500, payment: null, extra: 5000 },
  ],
  properties: [
    { id: 'PROP_000000000f01', kind: 'property', name: 'Casa', prop_type: 'Habitação própria', value: 250000, purchase_price: 180000, purchase_date: '2023-06-15', loan_id: CASA, notes: 'T2' },
    { id: 'PROP_000000000f02', kind: 'property', name: 'Garagem', prop_type: 'Garagem', value: 15000, purchase_price: null, purchase_date: '', loan_id: '', notes: '' },
  ],
};

// Os dados sem ids (que mudam ao importar): as ligações passam a nomes, e cada lista fica ordenada
const SNAPSHOT = `(() => {
  const acc = id => id ? accountName(id) : '', inv = id => investmentName(id), loan = id => id ? loanName(id) : '';
  const sorted = xs => xs.map(x => JSON.stringify(x)).sort();
  return {
    accounts: sorted(D.accounts.map(a => [a.name, a.acc_type, a.opening_balance, a.opening_date])),
    transactions: sorted(D.transactions.map(t => [t.date, acc(t.account_id), t.direction, t.category, t.description, t.amount, acc(t.to_account_id), !!t.approx])),
    investments: sorted(D.investments.map(i => [i.name, i.inv_type, i.notes || ''])),
    inv_moves: sorted(D.inv_moves.map(m => [m.date, inv(m.investment_id), m.move, m.amount, m.description || ''])),
    valuations: sorted(D.valuations.map(v => [inv(v.investment_id), v.month, v.value])),
    loans: sorted(D.loans.map(l => [l.name, l.loan_type, l.lender || '', l.principal, l.start_date, l.end_date || null, l.rate ?? null, l.payment ?? null])),
    loan_balances: sorted(D.loan_balances.map(b => [loan(b.loan_id), b.month, b.balance, b.payment ?? null, b.extra || null])),
    properties: sorted(D.properties.map(p => [p.name, p.prop_type, p.value, p.purchase_price ?? null, p.purchase_date || '', loan(p.loan_id), p.notes || ''])),
  };
})()`;

const ORDER = ['acc', 'mov', 'inv', 'loan', 'prop'];
const exportAll = () => Object.fromEntries(ORDER.map(f => [f, run(`toCSV(FORMATS.${f}.header, exportRows("${f}"))`)]));
async function importAll(files, order = ORDER) {
  for (const f of order) {
    ctx.text = files[f];
    const plan = vm.runInContext('planImport(text)', ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(plan.errors)), [], `erros ao importar ${f}`);
    ctx.plan = plan;
    await vm.runInContext('runImport(plan, true)', ctx);
  }
}

test('exportar o backup e importá-lo numa conta vazia dá exatamente os mesmos dados', async () => {
  run('D = { ...emptyData(), ...data }', { data: DATA });
  const before = run(SNAPSHOT);
  const files = exportAll();
  run('D = emptyData()');
  await importAll(files);
  assert.deepEqual(run(SNAPSHOT), before);
  // e os números que a app mostra também são os mesmos
  assert.equal(run('totalAccountsBalance()'), 1250.55 + 3000 - 32.4 * 2 + 1800 - 120 - 2.4);
});

test('a ordem dos ficheiros só importa para o património, que vem depois dos créditos', async () => {
  run('D = { ...emptyData(), ...data }', { data: DATA });
  const before = run(SNAPSHOT);
  const files = exportAll();
  run('D = emptyData()');
  await importAll(files, ['loan', 'prop', 'inv', 'mov', 'acc']);
  assert.deepEqual(run(SNAPSHOT), before);
  // o património antes dos créditos dá um erro claro, em vez de ligar a casa a nada
  run('D = emptyData()');
  assert.deepEqual(run('planImport(text).errors', { text: files.prop }), ['Linha 2: crédito "Crédito habitação" não existe (importa primeiro os créditos)']);
});

test('importar o mesmo backup duas vezes não duplica nada', async () => {
  run('D = { ...emptyData(), ...data }', { data: DATA });
  const before = run(SNAPSHOT);
  const files = exportAll();
  await importAll(files);
  assert.deepEqual(run(SNAPSHOT), before);
});

test('as notas dos investimentos (com o ISIN) e a prestação de cada crédito vão no backup', () => {
  run('D = { ...emptyData(), ...data }', { data: DATA });
  const files = exportAll();
  assert.ok(files.inv.split('\r\n').includes(';ETF Mundial;ETF;;;ISIN: IE0000000001'));
  assert.deepEqual(files.loan.split('\r\n').slice(1), [
    ';Crédito carro;Automóvel;;;12000,00;2025-03-01;;;;',
    ';Crédito habitação;Habitação;;650,00;150000,00;2023-06-15;3,125;Banco Exemplo;;2063-06-15',
    '2026-01;Crédito habitação;Habitação;140000,00;660,00;150000,00;2023-06-15;3,125;Banco Exemplo;;2063-06-15',
    '2026-02;Crédito habitação;Habitação;134500,00;;150000,00;2023-06-15;3,125;Banco Exemplo;5000,00;2063-06-15']);
});

test('um backup antigo (sem a linha de cada crédito nem as notas) continua a importar', async () => {
  const old = ['Mês;Crédito;Tipo de crédito;Saldo em dívida;Prestação;Montante inicial;Data de início;Taxa (%);Banco;Amortização extra;Fim do contrato',
    '2026-01;Crédito habitação;Habitação;140000,00;660,00;150000,00;2023-06-15;3,125;Banco Exemplo;;2063-06-15',
    '2026-02;Crédito habitação;Habitação;134500,00;650,00;150000,00;2023-06-15;3,125;Banco Exemplo;5000,00;2063-06-15'].join('\r\n');
  run('D = emptyData()');
  ctx.text = old;
  ctx.plan = vm.runInContext('planImport(text)', ctx);
  await vm.runInContext('runImport(plan, true)', ctx);
  assert.deepEqual(run('D.loans.map(l => [l.name, l.payment, l.rate])'), [['Crédito habitação', 660, 3.125]]);
  assert.deepEqual(run('D.loan_balances.map(b => [b.month, b.balance, b.payment, b.extra])').sort(), [['2026-01', 140000, 660, null], ['2026-02', 134500, 650, 5000]]);
});
