// Testes da página inicial à medida (homeLayout e homeLayoutItem: a ordem dos blocos e dos cartões e os escondidos) e da data e
// hora do acesso anterior (dateTimeLabel). Com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
//
//     node --test tests/inicio.test.js
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
const ids = list => list.map(x => x.id + (x.hidden ? ' (escondido)' : ''));

test('sem nada gravado, a ordem de origem e tudo à vista', () => {
  run('D = emptyData()');
  const lay = run('homeLayout()');
  assert.deepEqual(ids(lay.blocks), ['alerts', 'close', 'cards', 'goals', 'chart']);
  assert.deepEqual(ids(lay.cards), ['mov', 'inv', 'loan', 'prop', 'year']);
  assert.equal(lay.blocks[3].label, 'Metas de poupança');
});

test('a ordem gravada e os escondidos, de blocos e de cartões', () => {
  run('D = { ...emptyData(), layouts: [l] }', { l: { id: 'LAYOUT_home', kind: 'layout', blocks: ['chart', 'cards', 'alerts', 'close', 'goals'],
    cards: ['year', 'mov', 'inv', 'loan', 'prop'], hidden: ['goals', 'prop'] } });
  const lay = run('homeLayout()');
  assert.deepEqual(ids(lay.blocks), ['chart', 'cards', 'alerts', 'close', 'goals (escondido)']);
  assert.deepEqual(ids(lay.cards), ['year', 'mov', 'inv', 'loan', 'prop (escondido)']);
});

test('ids que a app já não conhece são ignorados e os que faltam ficam no fim, à vista; sem repetidos', () => {
  const lay = run('homeLayout(l)', { l: { blocks: ['goals', 'velho', 'goals', 'alerts'], cards: ['inv'], hidden: ['velho', 'year'] } });
  assert.deepEqual(ids(lay.blocks), ['goals', 'alerts', 'close', 'cards', 'chart']);
  assert.deepEqual(ids(lay.cards), ['inv', 'mov', 'loan', 'prop', 'year (escondido)']);
});

test('o registo a gravar tem a ordem das duas listas e os escondidos das duas', () => {
  const item = run(`(() => { const lay = homeLayout(null); lay.blocks.reverse(); lay.blocks[0].hidden = true; lay.cards[1].hidden = true;
    return homeLayoutItem(lay); })()`);
  assert.deepEqual(item, { kind: 'layout', id: 'LAYOUT_home', blocks: ['chart', 'goals', 'cards', 'close', 'alerts'],
    cards: ['mov', 'inv', 'loan', 'prop', 'year'], hidden: ['chart', 'inv'] });
  // e lido outra vez dá o mesmo
  assert.deepEqual(ids(run('homeLayout(i).blocks', { i: item })), ['chart (escondido)', 'goals', 'cards', 'close', 'alerts']);
});

test('o acesso anterior (em UTC) aparece na hora de Portugal, também na hora de verão', () => {
  assert.equal(run('dateTimeLabel("2026-11-20T21:10:00+00:00", " às ")'), '20/11/2026 às 21:10');
  assert.equal(run('dateTimeLabel("2026-07-01T23:05:09+00:00", " às ")'), '02/07/2026 às 00:05');
  assert.equal(run('dateTimeLabel("2026-07-01T23:05:09+00:00")'), '02/07/2026 00:05');   // como no separador Utilizadores
  for (const bad of ['""', 'null', '"ontem"']) assert.equal(run(`dateTimeLabel(${bad})`), '—');
});
