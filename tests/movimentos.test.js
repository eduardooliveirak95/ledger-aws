// Testes da pesquisa nos Movimentos (filterTx com texto e os totais por mês), com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
//
//     node --test tests/movimentos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ Intl });
for (const f of ['util.js', 'calc.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', f), 'utf8'), ctx, { filename: f });
}
const run = (code, vars = {}) => {
  Object.assign(ctx, vars);
  const v = vm.runInContext(code, ctx);
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
};

const ACC = 'ACC_000000000001';
const tx = (id, date, direction, amount, category, description) =>
  ({ id: 'TX_' + String(id).padStart(12, '0'), kind: 'transaction', date, direction, amount, account_id: ACC, category, description });
const TXS = [
  tx(1, '2026-09-01', 'out', 650, 'Habitação', 'Renda de casa'),
  tx(2, '2026-09-05', 'out', 45.9, 'Supermercado', 'Compras da semana'),
  tx(3, '2026-09-12', 'out', 23.4, 'Casa', 'Conta da água'),
  tx(4, '2026-09-25', 'in', 1800, 'Salário', 'Ordenado de setembro'),
  tx(5, '2026-10-01', 'out', 650, 'Habitação', 'Renda de casa'),
];
run('D = { ...emptyData(), accounts: [{ id: acc, kind: "account", name: "Conta à ordem", opening_balance: 0 }], transactions: txs }',
  { acc: ACC, txs: TXS });
const ids = filters => run('filterTx(f).map(t => t.id.slice(-1))', { f: filters });

test('sem texto, a pesquisa não filtra nada', () => {
  assert.deepEqual(ids({ text: '' }), ['1', '2', '3', '4', '5']);
  assert.deepEqual(ids({ text: '   ' }), ['1', '2', '3', '4', '5']);
});

test('procura na descrição sem distinguir maiúsculas nem acentos', () => {
  assert.deepEqual(ids({ text: 'RENDA' }), ['1', '5']);
  assert.deepEqual(ids({ text: 'agua' }), ['3']);
  assert.deepEqual(ids({ text: 'Água' }), ['3']);
});

test('procura também na categoria e no valor (com vírgula)', () => {
  assert.deepEqual(ids({ text: 'supermercado' }), ['2']);
  assert.deepEqual(ids({ text: 'habitacao' }), ['1', '5']);
  assert.deepEqual(ids({ text: '45,9' }), ['2']);
  assert.deepEqual(ids({ text: '1800' }), ['4']);
});

test('com várias palavras, todas têm de aparecer (em qualquer ordem)', () => {
  assert.deepEqual(ids({ text: 'casa renda' }), ['1', '5']);
  assert.deepEqual(ids({ text: 'renda água' }), []);
});

test('junta-se aos outros filtros (período e categorias)', () => {
  assert.deepEqual(ids({ text: 'renda', from: '2026-10', to: '2026-10' }), ['5']);
  assert.deepEqual(ids({ text: 'casa', catOut: ['Casa'] }), ['3']);
});

test('os totais por mês dos gráficos também seguem a pesquisa', () => {
  const flows = run('monthlyFlows(["2026-09", "2026-10"], { text: "renda" })');
  assert.deepEqual(flows.out, [650, 650]);
  assert.deepEqual(flows.in, [0, 0]);
});

test('etiquetas: "#etiqueta" encontra os movimentos dela, de qualquer categoria, sem acentos', () => {
  const tagged = [...TXS, { ...tx(6, '2026-09-20', 'out', 80, 'Restauração', 'Jantar'), tags: ['Férias 2026', 'amigos'] },
    { ...tx(7, '2026-09-21', 'out', 30, 'Transportes', 'Gasolina'), tags: ['férias 2026'] }];
  run('D.transactions = txs', { txs: tagged });
  try {
    assert.deepEqual(ids({ text: '#ferias' }), ['6', '7']);
    assert.deepEqual(ids({ text: '#amigos' }), ['6']);
    assert.deepEqual(ids({ text: '#casa' }), []);   // "Renda de casa" e a categoria "Casa" não são etiquetas
  } finally {
    run('D.transactions = txs', { txs: TXS });
  }
});

test('a receber: os gastos com uma parte por devolver, ainda não recebidos', () => {
  const list = [...TXS, { ...tx(6, '2026-09-20', 'out', 80, 'Restauração', 'Jantar'), due: 60 },
    { ...tx(7, '2026-09-02', 'out', 40, 'Restauração', 'Almoço'), due: 25.5 },
    { ...tx(8, '2026-09-03', 'out', 40, 'Restauração', 'Já pago'), due: 20, due_paid: true }];
  run('D.transactions = txs', { txs: list });
  try {
    const r = run('receivables()');
    assert.deepEqual(r.list.map(x => x.t.id.slice(-1)), ['7', '6']);   // do mais antigo para o mais recente
    assert.equal(r.total, 85.5);
  } finally {
    run('D.transactions = txs', { txs: TXS });
  }
});

test('reembolsos: a entrada associada abate ao gasto, na categoria dele, e não conta como entrada', () => {
  const jantar = { ...tx(6, '2026-09-20', 'out', 84, 'Restauração', 'Jantar'), due: 63 };
  const mbway1 = { ...tx(7, '2026-09-21', 'in', 21, 'Transferências in', 'MB WAY Ana'), refund_of: jantar.id };
  const mbway2 = { ...tx(8, '2026-09-22', 'in', 21, 'Transferências in', 'MB WAY Rui'), refund_of: jantar.id };
  const solto = tx(9, '2026-09-23', 'in', 21, 'Transferências in', 'MB WAY Eva');
  const cafe = { ...tx(5, '2026-09-24', 'out', 10, 'Restauração', 'Cafés'), id: 'TX_' + 'c'.repeat(12), due: 6 };   // já devolvido todo
  const mbway3 = { ...tx(4, '2026-09-25', 'in', 6, 'Transferências in', 'MB WAY cafés'), id: 'TX_' + 'd'.repeat(12), refund_of: cafe.id };
  run('D.transactions = txs', { txs: [...TXS, jantar, mbway1, mbway2, solto] });
  try {
    const sept = run('flowTotals(filterTx({ from: "2026-09", to: "2026-09" }))');
    // entradas: 1800 do salário + 21 do MB WAY solto; gastos: 650 + 45,9 + 23,4 + 84 − 42
    assert.deepEqual([sept.in, sept.out, sept.saved], [1821, 761.3, 1059.7]);
    assert.deepEqual(run('categoryTotals(filterTx({ from: "2026-09", to: "2026-09" }), "out")').find(c => c[0] === 'Restauração'), ['Restauração', 42]);
    assert.deepEqual(run('categoryTotals(filterTx({ from: "2026-09", to: "2026-09" }), "in")').map(c => c[1]), [1800, 21]);
    assert.equal(run('monthlyFlows(["2026-09"], {}).out[0]'), 761.3);
    // filtrar a categoria do gasto mostra o gasto (os reembolsos são entradas e não contam por si)
    assert.deepEqual(ids({ catOut: ['Restauração'] }), ['6']);
    // falta receber 21; a Eva ainda pode ser associada (é a de valor mais perto)
    const r = run('receivables()');
    assert.deepEqual([r.list.length, r.list[0].received, r.list[0].left], [1, 42, 21]);
    assert.equal(run('refundCandidates(id)[0].id', { id: jantar.id }), solto.id);
    // um gasto já todo devolvido sai do painel, mesmo sem estar marcado como recebido
    run('D.transactions = txs', { txs: [...TXS, jantar, mbway1, mbway2, solto, cafe, mbway3] });
    assert.deepEqual(run('receivables().list').map(x => x.t.id), [jantar.id]);
    // se o gasto for apagado, os MB WAY voltam a ser entradas normais
    run('D.transactions = txs', { txs: [...TXS, mbway1, mbway2] });
    assert.equal(run('flowTotals(filterTx({ from: "2026-09", to: "2026-09" })).in'), 1842);
    // e podem ser associados a outro gasto (o refund_of antigo já não aponta para nada)
    const outro = { ...tx(5, '2026-09-20', 'out', 42, 'Restauração', 'Jantar (o certo)'), id: 'TX_' + 'e'.repeat(12), due: 42 };
    run('D.transactions = txs', { txs: [...TXS, mbway1, mbway2, outro] });
    const cands = run('refundCandidates(id).map(t => t.id)', { id: outro.id });
    assert.ok(cands.includes(mbway1.id) && cands.includes(mbway2.id), String(cands));
  } finally {
    run('D.transactions = txs', { txs: TXS });
  }
});

test('reembolsos: abatem no mês do gasto, nunca mais do que o gasto; o saldo do mês é o dinheiro a sério', () => {
  const jantar = { ...tx(6, '2026-09-30', 'out', 84, 'Restauração', 'Jantar'), due: 63 };
  const mbway = { ...tx(7, '2026-10-02', 'in', 100, 'Transferências in', 'MB WAY a mais'), refund_of: jantar.id };
  run('D.transactions = txs', { txs: [...TXS, jantar, mbway] });
  try {
    const sept = run('flowTotals(filterTx({ from: "2026-09", to: "2026-09" }))');
    const oct = run('flowTotals(filterTx({ from: "2026-10", to: "2026-10" }))');
    // setembro: o jantar conta 0 (devolveram mais do que custou), sem ficar negativo; o saldo do mês foi −84
    assert.equal(run('categoryTotals(filterTx({ from: "2026-09", to: "2026-09" }), "out")').find(c => c[0] === 'Restauração')[1], 0);
    assert.deepEqual([sept.out, sept.net], [719.3, 996.7]);
    // outubro: o MB WAY não é entrada nem gasto, mas entrou na conta
    assert.deepEqual([oct.in, oct.out, oct.net], [0, 650, -550]);
    const flows = run('monthlyFlows(["2026-09", "2026-10"], {})');
    assert.deepEqual([flows.out, flows.in], [[719.3, 650], [1800, 0]]);
  } finally {
    run('D.transactions = txs', { txs: TXS });
  }
});

test('sugestão de categoria pela descrição: a mesma descrição primeiro, depois a mais usada entre as parecidas', () => {
  const extra = [
    tx(10, '2026-08-02', 'out', 30, 'Supermercado', 'Mercearia'),
    tx(11, '2026-08-20', 'out', 12, 'Casa', 'Mercearia'),              // a mesma descrição, mais recente: é esta que conta
    tx(12, '2026-08-21', 'out', 40, 'Supermercado', 'Compras Frutaria Exemplo'),
    tx(13, '2026-08-22', 'out', 35, 'Supermercado', 'Frutaria Exemplo Bairro'),
    tx(14, '2026-08-30', 'out', 9, 'Restauração', 'Frutaria Exemplo take-away'), // mais recente, mas só 1 contra 2
    tx(15, '2026-08-05', 'out', 5, 'Outros', 'Café da esquina'),         // «Outros» é o "ainda não arrumei": não se sugere
    tx(16, '2026-08-06', 'in', 50, 'Reembolsos', 'Mercearia'),          // outro sentido: não entra nas saídas
    tx(17, '2026-08-07', 'out', 20, 'Combustível', 'Gasolina'),
    tx(18, '2026-08-09', 'out', 21, 'Carro', 'Gasóleo e gasolina'),      // empate 1 a 1 em "gas": ganha a mais recente
    tx(19, '2026-08-10', 'transfer', 100, 'Transferência', 'Para a poupança'),   // as transferências não têm categoria a sugerir
  ];
  run('D.transactions = txs', { txs: [...TXS, ...extra] });
  try {
    const sug = (direction, description) => run('suggestCategory(d, t)', { d: direction, t: description });
    assert.equal(sug('out', 'mercearia'), 'Casa');
    assert.equal(sug('out', '  MERCEARIA '), 'Casa');
    assert.equal(sug('in', 'Mercearia'), 'Reembolsos');
    assert.equal(sug('out', 'frutaria'), 'Supermercado');
    assert.equal(sug('out', 'agua'), 'Casa');                // sem acentos: "Conta da água"
    assert.equal(sug('out', 'gas'), 'Carro');
    assert.equal(sug('out', 'gasolina'), 'Combustível');     // a descrição igual ganha às parecidas
    assert.equal(sug('out', 'cafe da esquina'), '');
    assert.equal(sug('out', 'fr'), '');                      // menos de 3 letras só serve se for a descrição inteira
    assert.equal(sug('out', 'nunca visto'), '');
    assert.equal(sug('out', ''), '');
    assert.equal(sug('transfer', 'Para a poupança'), '');
  } finally {
    run('D.transactions = txs', { txs: TXS });
  }
});

test('descrições já usadas: as mais usadas primeiro, sem repetir as que só diferem em maiúsculas ou acentos', () => {
  const extra = [
    tx(20, '2026-08-01', 'out', 1, 'Restauração', 'café'),
    tx(21, '2026-08-03', 'out', 1, 'Restauração', 'Café'),               // a escrita mais recente é a que fica
    tx(22, '2026-08-02', 'out', 1, 'Restauração', 'CAFE'),
    tx(23, '2026-08-04', 'out', 1, 'Outros', '   '),                     // sem descrição: não entra
    tx(24, '2026-08-05', 'transfer', 100, 'Transferência', 'Para a poupança'),
  ];
  run('D.transactions = txs', { txs: [...TXS, ...extra] });
  try {
    assert.deepEqual(run('knownDescriptions("out")'), ['Café', 'Renda de casa', 'Conta da água', 'Compras da semana']);
    assert.deepEqual(run('knownDescriptions("out", 2)'), ['Café', 'Renda de casa']);
    assert.deepEqual(run('knownDescriptions("in")'), ['Ordenado de setembro']);
    assert.deepEqual(run('knownDescriptions("transfer")'), ['Para a poupança']);
  } finally {
    run('D.transactions = txs', { txs: TXS });
  }
});

test('anular um apagar: os registos apagados guardam-se antes de saírem de D (itemsWithIds) e voltar a gravá-los repõe tudo', () => {
  const ids = [TXS[1].id, ACC, 'TX_' + 'f'.repeat(12)];   // um movimento, a conta e um id que não existe
  const gone = run('gone = itemsWithIds(ids)', { ids });
  assert.deepEqual(gone.map(x => x.id).sort(), [ACC, TXS[1].id].sort());
  assert.deepEqual(gone.find(x => x.id === TXS[1].id), TXS[1]);
  try {
    // depois de apagados, continuam guardados inteiros; voltar a gravá-los repõe D
    run('applyChanges({ deleted: ids })', { ids });
    assert.equal(run('D.transactions.length'), TXS.length - 1);
    assert.equal(run('D.accounts.length'), 0);
    assert.equal(run('gone.length'), 2);
    run('applyChanges({ saved: gone })');
    assert.deepEqual(run('D.transactions.map(t => t.id).sort()'), TXS.map(t => t.id).sort());
    assert.equal(run('D.accounts[0].name'), 'Conta à ordem');
  } finally {
    run('D = { ...emptyData(), accounts: [{ id: acc, kind: "account", name: "Conta à ordem", opening_balance: 0 }], transactions: txs }',
      { acc: ACC, txs: TXS });
  }
});
