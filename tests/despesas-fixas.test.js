// Testes das despesas fixas e subscrições (recurringExpenses e recurringKey), com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
// O "hoje" é fixo (13/10/2026): a janela é de outubro de 2025 a outubro de 2026.
//
//     node --test tests/despesas-fixas.test.js
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
const tx = (date, amount, description, category = 'Outros', direction = 'out', extra = {}) =>
  ({ id: 'TX_' + String(++seq).padStart(12, '0'), kind: 'transaction', date, direction, amount, account_id: ACC, category, description, ...extra });
const monthly = (from, to, day, amount, description, category, direction) => {
  const out = [];
  for (let m = from; m <= to; m = run('addMonths(m, 1)', { m })) {
    out.push(tx(`${m}-${day}`, typeof amount === 'function' ? amount(m) : amount,
      typeof description === 'function' ? description(m) : description, category, direction));
  }
  return out;
};
const load = transactions => run('D = { ...emptyData(), accounts: [{ id: acc, kind: "account", name: "Conta", opening_balance: 0 }], transactions: txs }',
  { acc: ACC, txs: transactions });
const keys = () => run('recurringExpenses().map(x => x.key)');

test('a chave ignora números, pontuação, acentos e maiúsculas', () => {
  assert.equal(run('recurringKey("COMPRA 0000 NETFLIX.COM 05/09")'), 'compra netflix com');
  assert.equal(run('recurringKey("Água — Câmara  12/2026")'), 'agua camara');
  assert.equal(run('recurringKey(undefined)'), '');
});

test('encontra as despesas de todos os meses, mesmo com datas e referências diferentes na descrição', () => {
  load([
    ...monthly('2026-01', '2026-10', '05', 13.99, m => `COMPRA ${m.slice(5)}12 NETFLIX.COM ${m.slice(5)}/05`, 'Subscrições'),
    ...monthly('2025-10', '2026-09', '01', 650, 'Renda de casa', 'Habitação'),
  ]);
  const list = run('recurringExpenses()');
  assert.deepEqual(list.map(x => [x.key, x.amount, x.months, x.variable]), [
    ['renda de casa', 650, 12, false],
    ['compra netflix com', 13.99, 10, false],
  ]);
  assert.equal(list[1].description, 'COMPRA 1012 NETFLIX.COM 10/05');   // a descrição do movimento mais recente
  assert.equal(list[1].last, '2026-10-05');
  assert.equal(list[0].category, 'Habitação');
});

test('valores que mudam: conta pela mediana e fica marcada', () => {
  const luz = { '2026-05': 61.2, '2026-06': 48.5, '2026-07': 44.1, '2026-08': 45, '2026-09': 52.3 };
  load(monthly('2026-05', '2026-09', '20', m => luz[m], 'EDP Comercial', 'Água / Luz / Gás'));
  const [x] = run('recurringExpenses()');
  assert.equal(x.amount, 48.5);
  assert.equal(x.min, 44.1);
  assert.equal(x.max, 61.2);
  assert.equal(x.variable, true);
});

test('ficam de fora: várias vezes por mês, só 2 meses, já parou, de vez em quando e fora dos 12 meses', () => {
  load([
    ...['02', '09', '16', '23'].flatMap(d => monthly('2026-05', '2026-10', d, 45, 'Pingo Doce', 'Supermercado')),
    ...monthly('2026-09', '2026-10', '03', 9.99, 'Spotify', 'Subscrições'),
    ...monthly('2026-01', '2026-07', '02', 35, 'Ginásio', 'Lazer'),
    tx('2026-01-15', 120, 'Seguro carro'), tx('2026-04-15', 120, 'Seguro carro'), tx('2026-07-15', 120, 'Seguro carro'),
    tx('2026-10-15', 120, 'Seguro carro'),
    ...monthly('2024-10', '2025-09', '08', 20, 'Revista antiga', 'Subscrições'),
    tx('2026-10-08', 20, 'Revista antiga'),
  ]);
  assert.deepEqual(keys(), []);
});

test('não contam os investimentos, as amortizações, as transferências, as entradas nem os movimentos sem descrição', () => {
  load([
    ...monthly('2026-05', '2026-10', '12', 300, 'Plano de investimento', 'Investimentos'),
    ...monthly('2026-05', '2026-10', '08', 520, 'Prestação casa', 'Amortizações'),
    ...monthly('2026-05', '2026-10', '10', 200, 'Para a poupança', 'Transferência', 'transfer'),
    ...monthly('2026-05', '2026-10', '01', 1800, 'Ordenado', 'Salário', 'in'),
    ...monthly('2026-05', '2026-10', '20', 30, '', 'Outros'),
  ]);
  assert.deepEqual(keys(), []);
});

test('descrições com nomes especiais do JavaScript ("constructor") não estragam a lista', () => {
  load(monthly('2026-07', '2026-10', '04', 9.99, 'Constructor', 'Subscrições'));
  assert.deepEqual(run('recurringExpenses().map(x => [x.key, x.amount])'), [['constructor', 9.99]]);
});

test('um mês sem a despesa não a tira da lista (60% dos meses chega)', () => {
  load(monthly('2026-04', '2026-10', '07', 25, 'Telemóvel', 'Telecomunicações').filter(t => !t.date.startsWith('2026-06')));
  assert.deepEqual(run('recurringExpenses().map(x => [x.key, x.months])'), [['telemovel', 6]]);
});
