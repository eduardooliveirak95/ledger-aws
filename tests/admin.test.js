// Testes do separador Utilizadores (só administradores), com dados inventados.
// Correm no Node, sem browser: os ficheiros do site são carregados num contexto isolado (vm).
//
//     node --test tests/admin.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Carrega os scripts do site pela mesma ordem do index.html (os que o separador usa)
const ctx = vm.createContext({ Intl });
for (const f of ['util.js', 'admin.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', f), 'utf8'), ctx, { filename: f });
}
// Corre código no contexto e devolve o resultado copiado por JSON (ver bank.test.js)
const run = (code, vars = {}) => {
  Object.assign(ctx, vars);
  const v = vm.runInContext(code, ctx);
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
};

const NOW = Date.parse('2026-10-07T12:00:00Z');

test('data e hora em hora de Portugal (verão e inverno)', () => {
  assert.equal(run("dateTimeLabel('2026-10-07T13:21:00+00:00')"), '07/10/2026 14:21');   // verão: UTC+1
  assert.equal(run("dateTimeLabel('2026-12-31T23:30:00+00:00')"), '31/12/2026 23:30');   // inverno: UTC+0
  assert.equal(run("dateTimeLabel('2026-10-06T23:30:00+00:00')"), '07/10/2026 00:30');   // já é o dia seguinte em Lisboa
  assert.equal(run('dateTimeLabel(null)'), '—');
});

test('há quanto tempo foi o login', () => {
  const since = iso => run('sinceLabel(iso, now)', { iso, now: NOW });
  assert.equal(since('2026-10-07T12:00:30Z'), 'agora mesmo');   // relógio do PC um pouco adiantado
  assert.equal(since('2026-10-07T11:55:00Z'), 'há 5 min');
  assert.equal(since('2026-10-07T09:00:00Z'), 'há 3 h');
  assert.equal(since('2026-10-06T11:00:00Z'), 'há 1 dia');
  assert.equal(since('2026-09-25T12:00:00Z'), 'há 12 dias');
  assert.equal(since('2026-06-01T12:00:00Z'), 'há 4 meses');
  assert.equal(since(null), '');
});

test('estado da conta em português', () => {
  const state = u => run('userStateLabel(u)', { u });
  assert.equal(state({ status: 'CONFIRMED', enabled: true }), 'Ativa');
  assert.equal(state({ status: 'FORCE_CHANGE_PASSWORD', enabled: true }), 'Password temporária');
  assert.equal(state({ status: 'CONFIRMED', enabled: false }), 'Desativada');
  assert.equal(state({ status: 'RESET_REQUIRED', enabled: true }), 'Password reposta');
  assert.equal(state({ status: 'OUTRO', enabled: true }), 'OUTRO');
});

test('números do topo do separador', () => {
  const users = [
    { email: 'chefe@example.com', admin: true, enabled: true, last_login: '2026-10-07T08:00:00+00:00' },
    { email: 'ana@example.com', admin: false, enabled: true, last_login: '2026-09-29T08:00:00+00:00' },
    { email: 'bruno@example.com', admin: false, enabled: false, last_login: null },
  ];
  const logins = [{ at: '2026-10-07T08:00:00+00:00', email: 'chefe@example.com' },
                  { at: '2026-09-29T08:00:00+00:00', email: 'ana@example.com' }];
  assert.deepEqual(run('adminStats(users, logins, now)', { users, logins, now: NOW }), {
    total: 3, admins: 1, disabled: 1, week: 1, never: 1, last: logins[0],
  });
  assert.equal(run('adminStats([], [], now).last', { now: NOW }), null);
});
