// Testes da importação de extratos (Caixadirecta e outros bancos) e dos CSV da app, com dados inventados.
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

// ── outros bancos (CSV genérico) — formatos inventados, parecidos com os reais ──

// Banco português: título com o número da conta, montante com sinal, mais recente primeiro
const BANCO_PT = [
  'Extrato de conta;;;;',
  'Conta:;0012345678;;;',
  'Data lançamento;Data valor;Descrição;Montante;Saldo',
  '03-10-2026;03-10-2026;COMPRA FARMACIA EXEMPLO;-12,50;987,50',
  '02-10-2026;02-10-2026;TRF RECEBIDA;100,00;1.000,00',
  '01-10-2026;01-10-2026;LEVANTAMENTO ATM;-50,00;900,00',
  ';;Saldo final;;987,50',
].join('\n');

// Banco digital em inglês (vírgulas): comissão à parte e um movimento pendente
const DIGITAL = [
  'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
  'TOPUP,Current,2026-10-01 09:00:00,2026-10-01 09:01:00,Top-up,200.00,0.00,EUR,COMPLETED,200.00',
  'CARD_PAYMENT,Current,2026-10-02 12:00:00,2026-10-02 12:00:05,Cafe Exemplo,-2.40,0.00,EUR,COMPLETED,197.60',
  'EXCHANGE,Current,2026-10-03 10:00:00,2026-10-03 10:00:01,Exchanged to USD,-50.00,0.50,EUR,COMPLETED,147.10',
  'CARD_PAYMENT,Current,2026-10-04 08:00:00,,Loja Exemplo,-9.99,0.00,EUR,PENDING,137.11',
].join('\n');

test('reconhece um extrato de outro banco: colunas, número da conta e ordem', () => {
  const layout = run('genericBankLayout(text)', { text: BANCO_PT });
  assert.equal(layout.number, '0012345678');
  assert.deepEqual([layout.cols.date, layout.cols.desc, layout.cols.amount, layout.cols.balance, layout.cols.debit], [0, 2, 3, 4, -1]);
  const st = run('buildGenericStatement(genericBankLayout(text), genericBankLayout(text).cols, "Banco PT")', { text: BANCO_PT });
  assert.deepEqual(st.warnings, []);
  assert.deepEqual(st.rows.map(r => [r.date, r.description, r.amount, r.balance]), [
    ['2026-10-01', 'LEVANTAMENTO ATM', -50, 900], ['2026-10-02', 'TRF RECEBIDA', 100, 1000], ['2026-10-03', 'COMPRA FARMACIA EXEMPLO', -12.5, 987.5]]);
  assert.equal(st.opening, 950);
  assert.equal(st.accountName, 'Banco PT');
});

test('extrato em inglês: separador vírgula, comissão descontada e pendentes de fora', () => {
  const st = run('(l => buildGenericStatement(l, l.cols, "Digital"))(genericBankLayout(text))', { text: DIGITAL });
  assert.deepEqual(st.rows.map(r => [r.date, r.description, r.amount]), [
    ['2026-10-01', 'Top-up', 200], ['2026-10-02', 'Cafe Exemplo', -2.4], ['2026-10-03', 'Exchanged to USD', -50.5]]);
  assert.deepEqual(st.warnings, []);   // com a comissão, os saldos batem
  assert.equal(st.number, 'csv:digital');
});

test('saldo disponível que não bate com os valores: os saldos não são usados', () => {
  const text = ['Data Operação;Data Valor;Descrição;Débito;Crédito;Saldo Disponível',
    '01-10-2026;01-10-2026;A;10,00;;500,00', '02-10-2026;02-10-2026;B;;20,00;430,00', '03-10-2026;03-10-2026;C;5,00;;300,00'].join('\n');
  const st = run('(l => buildGenericStatement(l, l.cols, "Banco"))(genericBankLayout(text))', { text });
  assert.deepEqual(st.rows.map(r => [r.amount, r.balance]), [[-10, null], [20, null], [-5, null]]);
  assert.match(st.warnings[0], /saldos do ficheiro não batem/);
});

test('coluna D/C com valores sem sinal', () => {
  const text = ['Data;Descritivo;Valor;D/C', '01/10/2026;Ordenado;1500,00;C', '02/10/2026;Renda;600,00;D'].join('\n');
  const st = run('(l => buildGenericStatement(l, l.cols, "Banco"))(genericBankLayout(text))', { text });
  assert.deepEqual(st.rows.map(r => [r.description, r.amount]), [['Ordenado', 1500], ['Renda', -600]]);
});

test('sem saldos: ficheiros sobrepostos não duplicam, mas dois cafés iguais no mesmo dia ficam os dois', () => {
  reset();
  const a = ['Data;Descrição;Valor', '01-10-2026;CAFE;-0,80', '01-10-2026;CAFE;-0,80', '02-10-2026;PAO;-1,20'].join('\n');
  const b = ['Data;Descrição;Valor', '02-10-2026;PAO;-1,20', '03-10-2026;CAFE;-0,80'].join('\n');
  const plan = run(`planBankImport([a, b].map(t => (l => buildGenericStatement(l, l.cols, "Carteira Banco"))(genericBankLayout(t))))`, { a, b });
  assert.equal(plan.accounts.length, 1);
  assert.equal(plan.accounts[0].opening, null);
  assert.deepEqual(plan.items.map(t => [t.date, t.amount, t._acc]), [
    ['2026-10-01', 0.8, 'Carteira Banco'], ['2026-10-01', 0.8, 'Carteira Banco'], ['2026-10-02', 1.2, 'Carteira Banco'], ['2026-10-03', 0.8, 'Carteira Banco']]);
});

test('colunas escolhidas à mão e erros claros quando faltam', () => {
  const layout = run('genericBankLayout(text)', { text: BANCO_PT });
  // usar a data valor em vez da data de lançamento
  const st = run('buildGenericStatement(genericBankLayout(text), { ...genericBankLayout(text).cols, date: 1 }, "X")', { text: BANCO_PT });
  assert.equal(st.rows.length, 3);
  assert.throws(() => run('buildGenericStatement(genericBankLayout(text), { ...genericBankLayout(text).cols, date: -1 }, "X")', { text: BANCO_PT }), /coluna da data/);
  assert.throws(() => run('buildGenericStatement(genericBankLayout(text), { ...genericBankLayout(text).cols, amount: -1 }, "X")', { text: BANCO_PT }), /coluna do valor/);
  assert.equal(layout.signature, 'data lancamento|data valor|descricao|montante|saldo');
  // um CSV sem data e valor não é tomado por extrato
  assert.equal(run('genericBankLayout(text)', { text: 'Nome;Idade;Cidade\nAna;30;Porto' }), null);
});

test('o extrato da Caixadirecta continua a ser lido pelo leitor próprio', () => {
  assert.equal(run('parseCgdCsv(text).bank', { text: ORDEM }), 'CGD');
  assert.equal(run('parseCgdCsv(text)', { text: BANCO_PT }), null);
});

// ── contas no backup ──

test('o backup inclui as contas (tipo e saldo inicial) e o importar atualiza as que já existem', () => {
  reset({ accounts: [{ id: 'ACC_aaaaaaaaaaaa', kind: 'account', name: 'Ordem', acc_type: 'Conta à ordem', opening_balance: 0, opening_date: '2026-01-01' }] });
  const csv = run('toCSV(FORMATS.acc.header, [["Ordem", "Conta à ordem", 1250.5, "2025-12-31"], ["Poupança", "Poupança", 3000, "2026-01-01"]])');
  const plan = run('planImport(csv)', { csv });
  assert.equal(plan.format, 'acc');
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.items, [
    { kind: 'account', id: 'ACC_aaaaaaaaaaaa', name: 'Ordem', acc_type: 'Conta à ordem', opening_balance: 1250.5, opening_date: '2025-12-31' },
    { kind: 'account', name: 'Poupança', acc_type: 'Poupança', opening_balance: 3000, opening_date: '2026-01-01' }]);
  reset({ accounts: [{ id: 'ACC_bbbbbbbbbbbb', kind: 'account', name: 'Zeta', acc_type: 'Dinheiro', opening_balance: 20, opening_date: '2026-02-01' },
    { id: 'ACC_aaaaaaaaaaaa', kind: 'account', name: 'Ordem', acc_type: 'Conta à ordem', opening_balance: 10, opening_date: '2026-01-01' }] });
  assert.deepEqual(run('exportRows("acc")'), [['Ordem', 'Conta à ordem', 10, '2026-01-01'], ['Zeta', 'Dinheiro', 20, '2026-02-01']]);
});
