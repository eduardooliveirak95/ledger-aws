// Testes do registo rápido dos Movimentos (parseQuickEntry): o texto "almoço 12,5 revolut #trabalho" passa a valores para o
// formulário do movimento. Com dados inventados e o "hoje" fixo (22/11/2026).
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
//
//     node --test tests/registo-rapido.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ Intl });
for (const f of ['util.js', 'calc.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', f), 'utf8'), ctx, { filename: f });
}
vm.runInContext('todayISO = () => "2026-11-22"', ctx);
const run = (code, vars = {}) => {
  Object.assign(ctx, vars);
  const v = vm.runInContext(code, ctx);
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
};

const acc = (n, name, extra = {}) => ({ id: 'ACC_' + String(n).padStart(12, '0'), kind: 'account', name, opening_balance: 0, ...extra });
const ORDEM = acc(1, 'Conta à ordem'), REV = acc(2, 'Revolut'), REF = acc(3, 'Cartão refeição'), VELHA = acc(4, 'Rendimento antigo', { archived: true });
run('D = { ...emptyData(), accounts: accs }', { accs: [ORDEM, REV, REF, VELHA] });
const parse = text => run('parseQuickEntry(t)', { t: text });

test('lê o valor, a conta, as etiquetas e o resto fica a descrição', () => {
  assert.deepEqual(parse('almoço 12,5 revolut #trabalho'),
    { direction: 'out', tags: ['trabalho'], description: 'almoço', amount: 12.5, account_id: REV.id });
});

test('o valor pode ter ponto, vírgula, milhares e o €; com "+" é uma entrada', () => {
  assert.equal(parse('café 1.20').amount, 1.2);
  assert.equal(parse('café 1,2€').amount, 1.2);
  assert.equal(parse('portátil 1.234,56').amount, 1234.56);
  assert.equal(parse('entrada da casa 12.500').amount, 12500);   // pontos a separar milhares, como se escreve à mão
  const s = parse('+1800 ordenado de novembro');
  assert.equal(s.direction, 'in');
  assert.equal(s.amount, 1800);
  assert.equal(s.description, 'ordenado de novembro');
  assert.equal(parse('-12 gasolina').direction, 'out');
});

test('com vários números, o valor é o que tem casas decimais ou € (senão o último) e os outros ficam na descrição', () => {
  assert.deepEqual([parse('2 cafés 1,60').amount, parse('2 cafés 1,60').description], [1.6, '2 cafés']);
  assert.deepEqual([parse('jantar 4 pessoas 80').amount, parse('jantar 4 pessoas 80').description], [80, 'jantar 4 pessoas']);
  assert.equal(parse('3 bilhetes 15€ cinema').amount, 15);
});

test('sem valor, o formulário fica com o valor vazio', () => {
  const p = parse('renda');
  assert.equal(p.amount, undefined);
  assert.equal(p.description, 'renda');
});

test('a data: hoje, ontem, anteontem ou um dia com ou sem ano', () => {
  assert.equal(parse('pão 2 hoje').date, '2026-11-22');
  assert.equal(parse('pão 2 ontem').date, '2026-11-21');
  assert.equal(parse('pão 2 Anteontem').date, '2026-11-20');
  assert.equal(parse('pão 2 21/11').date, '2026-11-21');
  assert.equal(parse('pão 2 3-11').date, '2026-11-03');
  assert.equal(parse('pão 2 21/11/2025').date, '2025-11-21');
  assert.equal(parse('pão 2 5/1/26').date, '2026-01-05');
  // sem ano e no futuro: é do ano passado (um gasto de dezembro registado em janeiro, por exemplo)
  assert.equal(parse('prenda 30 24/12').date, '2025-12-24');
  // um dia que não existe fica na descrição; sem data, o formulário fica com a de hoje
  assert.equal(parse('pão 2 31/02').date, undefined);
  assert.equal(parse('pão 2 31/02').description, 'pão 31/02');
  assert.equal(parse('pão 2').date, undefined);
});

test('a conta: o início do nome ou de uma palavra dele, sem acentos nem maiúsculas; só as contas abertas', () => {
  assert.equal(parse('luz 40 ORDEM').account_id, ORDEM.id);
  assert.equal(parse('almoço 7 refeiçao').account_id, REF.id);
  assert.equal(parse('almoço 7 rev').account_id, REV.id);
  // com menos de 3 letras não conta como conta: fica na descrição
  assert.equal(parse('x 7 re').account_id, undefined);
  // uma conta fechada não é escolhida
  assert.equal(parse('juros 3 rendimento').account_id, undefined);
  // a palavra tem de ser o início da conta, não o contrário ("continente" não é a "Conta à ordem")
  assert.equal(parse('continente 30').account_id, undefined);
  assert.equal(parse('continente 30').description, 'continente');
});

test('com duas contas que começam da mesma forma, a palavra fica na descrição', () => {
  run('D.accounts.push(a)', { a: acc(5, 'Revolut poupança') });
  const p = parse('cinema 9 revolut');
  assert.equal(p.account_id, undefined);
  assert.equal(p.description, 'cinema revolut');
  run('D.accounts.pop()');
});

test('as etiquetas: sem o #, sem repetidas e até 5', () => {
  assert.deepEqual(parse('jantar 20 #Férias #férias #praia').tags, ['Férias', 'praia']);
  assert.deepEqual(parse('x 1 #a #b #c #d #e #f').tags, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(parse('x 1 #').tags, []);
});

test('texto vazio não dá nada', () => {
  assert.deepEqual(parse('   '), { direction: 'out', tags: [], description: '' });
});
