// Testes da importação dos extratos da Caixadirecta em CSV (frontend/js/bank.js), com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
//
//     node --test tests/bank.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Carrega os scripts do site pela mesma ordem do index.html (os que a importação usa)
const ctx = vm.createContext({ Intl });
for (const f of ['util.js', 'calc.js', 'csv.js', 'bank.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', f), 'utf8'), ctx, { filename: f });
}
// Corre código no contexto e devolve o resultado copiado por JSON (os objetos do contexto têm
// outros protótipos e o assert.deepEqual não os aceitaria como iguais)
const run = (code, vars = {}) => {
  Object.assign(ctx, vars);
  const v = vm.runInContext(code, ctx);
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
};
const reset = (data = {}) => run('D = { ...emptyData(), ...data }', { data });

// Extrato da conta à ordem como a Caixadirecta o exporta (mais recente primeiro, espaços no fim das células)
const ORDEM = [
  'Consultar saldos e movimentos à ordem - 04-10-2026',
  '',
  'Conta ;1234567890123 - EUR - Conta à ordem ',
  'Data de início ;27-09-2026',
  'Data de fim ;04-10-2026',
  '',
  'Data mov. ;Data valor ;Descrição ;Débito ;Crédito ;Saldo contabilístico ;Saldo disponível ;Categoria ;',
  '03-10-2026;03-10-2026;TRANSFERENCIA P/ POUPANCA ;100,00;;1.150,00;1.150,00;Diversos ;',
  '02-10-2026;01-10-2026;SUPERMERCADO  EXEMPLO ;20,50;;1.250,00;1.240,00;COMPRAS ;',
  '01-10-2026;01-10-2026;VENCIMENTO ;;1.000,00;1.270,50;1.270,50;Diversos ;',
  '28-09-2026;28-09-2026;ATM EXEMPLO ;30,00;;270,50;270,50;LEVANTAMENTOS ;',
  ' ; ; ; ;Saldo contabilístico ;1.150,00 EUR ; ; ;',
  '',
].join('\r\n');

// Extrato da conta poupança (sem a coluna Categoria nem o saldo disponível)
const POUPANCA = [
  'Consultar saldos e movimentos de poupança - 04-10-2026',
  'Conta ;9876543210987 - EUR - Conta Poupança Exemplo ',
  'Data de início ;27-09-2026',
  'Data de fim ;04-10-2026',
  'Data mov. ;Data valor ;Descrição ;Débito ;Crédito ;Saldo contabilístico ;',
  '03-10-2026;03-10-2026;TRANSFERENCIA ;;100,00;600,00;',
  '30-09-2026;30-09-2026;JUROS ;;0,25;500,00;',
].join('\r\n');

test('lê o extrato da conta à ordem', () => {
  const st = run('parseCgdCsv(text)', { text: ORDEM });
  assert.equal(st.number, '1234567890123');
  assert.equal(st.product, 'Conta à ordem');
  assert.equal(st.savings, false);
  assert.equal(st.from, '2026-09-27');
  assert.equal(st.to, '2026-10-04');
  assert.deepEqual(st.warnings, []);
  // do mais antigo para o mais recente, com o valor com sinal e a descrição limpa
  assert.deepEqual(st.rows.map(r => [r.date, r.description, r.amount, r.balance, r.cgdCategory]), [
    ['2026-09-28', 'ATM EXEMPLO', -30, 270.5, 'LEVANTAMENTOS'],
    ['2026-10-01', 'VENCIMENTO', 1000, 1270.5, 'Diversos'],
    ['2026-10-02', 'SUPERMERCADO EXEMPLO', -20.5, 1250, 'COMPRAS'],
    ['2026-10-03', 'TRANSFERENCIA P/ POUPANCA', -100, 1150, 'Diversos'],
  ]);
  assert.equal(st.opening, 300.5);
  assert.equal(st.closing, 1150);
});

test('lê o extrato da poupança, que tem menos colunas', () => {
  const st = run('parseCgdCsv(text)', { text: POUPANCA });
  assert.equal(st.savings, true);
  assert.deepEqual(st.rows.map(r => [r.date, r.amount, r.cgdCategory]), [['2026-09-30', 0.25, ''], ['2026-10-03', 100, '']]);
});

test('avisa quando um valor não bate com os saldos', () => {
  const st = run('parseCgdCsv(text)', { text: ORDEM.replace('20,50;;1.250,00', '20,05;;1.250,00') });
  assert.equal(st.warnings.length, 1);
  assert.match(st.warnings[0], /SUPERMERCADO EXEMPLO/);
});

test('os CSV da app não são confundidos com extratos', () => {
  assert.equal(run('parseCgdCsv(text)', { text: 'Data;Conta;Tipo;Categoria;Descrição;Valor\n2026-01-01;A;Saída;X;;1,00' }), null);
  assert.equal(run('parseCgdCsv(text)', { text: 'Data,Conta,Tipo,Valor\n2026-01-01,A,Saída,1' }), null);
  // e o separador continua a ser descoberto sozinho nos outros CSV
  assert.deepEqual(run('parseCSV(text)', { text: 'a,b\n1,2' }), [['a', 'b'], ['1', '2']]);
});

test('sem número de conta dá erro em vez de importar às cegas', () => {
  assert.throws(() => run('parseCgdCsv(text)', { text: ORDEM.replace(/Conta ;.*\r\n/, '') }), /número da conta/);
  assert.throws(() => run('parseCgdCsv(text)', { text: POUPANCA.replace('Saldo contabilístico ;', 'Outra ;') }), /coluna do saldo/);
});

test('o plano cria a conta, adivinha as categorias e junta a transferência entre as duas contas', () => {
  reset();
  const plan = run('planBankImport([parseCgdCsv(a), parseCgdCsv(b)])', { a: ORDEM, b: POUPANCA });
  assert.deepEqual(plan.accounts.map(a => [a.defaultName, a.choice, a.opening]), [['CGD à ordem', 'new', 300.5], ['CGD Poupança Exemplo', 'new', 499.75]]);
  const rows = plan.items.map(t => [t.date, t.direction, t.amount, t.category, t._acc, t._to || '']);
  assert.deepEqual(rows, [
    ['2026-09-28', 'out', 30, 'Levantamentos', 'CGD à ordem', ''],
    ['2026-09-30', 'in', 0.25, 'Juros / Dividendos', 'CGD Poupança Exemplo', ''],
    ['2026-10-01', 'in', 1000, 'Salário', 'CGD à ordem', ''],
    ['2026-10-02', 'out', 20.5, 'Supermercado', 'CGD à ordem', ''],
    ['2026-10-03', 'transfer', 100, 'Transferência', 'CGD à ordem', 'CGD Poupança Exemplo'],
  ]);
});

test('importar o mesmo extrato outra vez não duplica nada', () => {
  const acc = 'ACC_aaaaaaaaaaaa';
  const tx = (date, direction, amount) => ({ id: `TX_${date}_${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`, kind: 'transaction',
    date, account_id: acc, direction, amount, category: 'Outros', description: 'x' });
  reset({ accounts: [{ id: acc, kind: 'account', name: 'CGD à ordem', opening_balance: 300.5, opening_date: '2026-09-01' }],
    transactions: [tx('2026-09-28', 'out', 30), tx('2026-10-01', 'in', 1000), tx('2026-10-02', 'out', 20.5), tx('2026-10-03', 'out', 100)] });
  const plan = run('planBankImport([parseCgdCsv(a)])', { a: ORDEM });
  assert.equal(plan.accounts[0].choice, acc);
  assert.equal(plan.items.length, 0);
  assert.equal(plan.skipped, 4);
  assert.equal(plan.accounts[0].diff, 0);   // o saldo da app antes do extrato bate com o do banco
});

test('textos começados por = + - @ não viram fórmulas no Excel, e voltam iguais ao importar', () => {
  const csv = run('toCSV(["Descrição", "Valor"], rows)', { rows: [['=HYPERLINK("x")', 12.5], ['-desconto', -3], ['@SUM(A1)', 1], ['Renda', 2]] });
  assert.equal(csv.split('\r\n').slice(1).join('|'), '"\'=HYPERLINK(""x"")";12,50|\'-desconto;-3,00|\'@SUM(A1);1,00|Renda;2,00');
  assert.deepEqual(run('parseCSV(csv)', { csv }).slice(1), [['=HYPERLINK("x")', '12,50'], ['-desconto', '-3,00'], ['@SUM(A1)', '1,00'], ['Renda', '2,00']]);
});
