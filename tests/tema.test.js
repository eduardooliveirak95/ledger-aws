// Testes da escolha do tema (js/theme.js): automático, claro ou escuro, guardado no aparelho.
// Correm no Node, sem browser: o theme.js é carregado num contexto isolado (vm) com um browser falso
// (modo do telemóvel/PC, localStorage, <html> e a <meta name="theme-color">).
//
//     node --test tests/tema.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'theme.js'), 'utf8');
const BG = { light: '#f5f3fb', dark: '#13111b' };   // --bg de cada tema no style.css

// Abre o theme.js com: o que está guardado (stored), o modo do sistema (dark) e, se storageBroken,
// um localStorage que dá erro (ex.: o browser não deixa guardar)
function open({ stored = null, dark = false, storageBroken = false } = {}) {
  const saved = stored === null ? {} : { 'ledger.theme': stored };
  const listeners = [];
  const media = { matches: dark, addEventListener: (_, fn) => listeners.push(fn) };
  const root = { dataset: {} };
  const meta = { content: '' };
  const events = [];
  const ctx = vm.createContext({
    matchMedia: () => media,
    localStorage: storageBroken
      ? { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } }
      : { getItem: k => (k in saved ? saved[k] : null), setItem: (k, v) => { saved[k] = String(v); } },
    document: { documentElement: root, querySelector: () => meta, dispatchEvent: e => events.push(e.type) },
    getComputedStyle: el => ({ getPropertyValue: name => (name === '--bg' ? ' ' + BG[el.dataset.theme] : '') }),
    Event: class { constructor(type) { this.type = type; } },
  });
  vm.runInContext(CODE, ctx, { filename: 'theme.js' });
  const run = code => vm.runInContext(code, ctx);
  // muda o modo do telemóvel/PC com a página aberta
  const systemChanges = isDark => { media.matches = isDark; listeners.forEach(fn => fn()); };
  return { run, root, meta, events, saved, systemChanges };
}

test('sem nada guardado, segue o modo do telemóvel ou do PC', () => {
  const claro = open({ dark: false });
  assert.equal(claro.run('themeChoice()'), 'auto');
  assert.equal(claro.root.dataset.theme, 'light');
  assert.equal(claro.meta.content, BG.light);
  const escuro = open({ dark: true });
  assert.equal(escuro.root.dataset.theme, 'dark');
  assert.equal(escuro.meta.content, BG.dark);
});

test('a escolha guardada vale mais do que o modo do sistema; um valor estranho conta como automático', () => {
  assert.equal(open({ stored: 'light', dark: true }).root.dataset.theme, 'light');
  assert.equal(open({ stored: 'dark', dark: false }).root.dataset.theme, 'dark');
  const estranho = open({ stored: 'roxo', dark: true });
  assert.equal(estranho.run('themeChoice()'), 'auto');
  assert.equal(estranho.root.dataset.theme, 'dark');
});

test('o botão passa de automático a claro, a escuro e outra vez a automático', () => {
  const t = open();
  assert.equal(t.run('nextThemeChoice("auto")'), 'light');
  assert.equal(t.run('nextThemeChoice("light")'), 'dark');
  assert.equal(t.run('nextThemeChoice("dark")'), 'auto');
});

test('escolher guarda no aparelho, muda o tema e avisa a app só quando o tema muda', () => {
  const t = open({ dark: false });
  t.events.length = 0;                       // o aviso do arranque não conta
  t.run('setThemeChoice("light")');          // já estava claro: guarda, mas não há nada a redesenhar
  assert.equal(t.saved['ledger.theme'], 'light');
  assert.deepEqual(t.events, []);
  t.run('setThemeChoice("dark")');
  assert.equal(t.saved['ledger.theme'], 'dark');
  assert.equal(t.root.dataset.theme, 'dark');
  assert.equal(t.meta.content, BG.dark);
  assert.deepEqual(t.events, ['ledger-theme']);
});

test('em automático acompanha o sistema com a página aberta; com uma escolha fixa, não', () => {
  const auto = open({ dark: false });
  auto.events.length = 0;
  auto.systemChanges(true);
  assert.equal(auto.root.dataset.theme, 'dark');
  assert.deepEqual(auto.events, ['ledger-theme']);
  const fixo = open({ stored: 'light', dark: false });
  fixo.events.length = 0;
  fixo.systemChanges(true);
  assert.equal(fixo.root.dataset.theme, 'light');
  assert.deepEqual(fixo.events, []);
});

test('se o browser não deixar guardar, começa em automático e a escolha vale até fechar', () => {
  const t = open({ storageBroken: true, dark: false });
  assert.equal(t.run('themeChoice()'), 'auto');
  t.run('setThemeChoice("dark")');
  assert.equal(t.run('themeChoice()'), 'dark');
  assert.equal(t.root.dataset.theme, 'dark');
});
