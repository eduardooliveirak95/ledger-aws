// Testes da renovação da sessão (auth.js): uma falha passageira não pode deitar a sessão abaixo.
// Correm no Node, sem browser: o auth.js é carregado num contexto isolado (vm), com um fetch falso
// que faz de Cognito e de API, e com o armazenamento do browser simulado.
//
//     node --test tests/auth.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const COGNITO = 'https://cognito-idp.eu-west-1.amazonaws.com/';
const API = 'https://api.example.com';

// Um JWT falso (só a parte do meio interessa ao auth.js) que expira daqui a "segundos"
const jwt = segundos => ['x', Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + segundos })).toString('base64url'), 'y'].join('.');

// Armazenamento do browser (sessionStorage / localStorage) simulado
const storage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};

// Respostas falsas do fetch
const ok = data => ({ ok: true, status: 200, json: async () => data });
const cognitoError = type => ({ ok: false, status: 400, json: async () => ({ __type: type, message: type }) });
const networkError = () => Promise.reject(new TypeError('Failed to fetch'));

// Carrega o auth.js com uma sessão cujo ID token já expirou (obriga a renovar no próximo pedido).
// renovacoes = lista do que o Cognito responde a cada renovação, por ordem; api = respostas da API.
function setup({ renovacoes, api = [ok({ dados: 1 })] }) {
  const calls = { cognito: 0, api: 0, expired: 0 };
  const fetch = async (url, opts) => {
    if (url === COGNITO) {
      const r = renovacoes[calls.cognito++];
      return typeof r === 'function' ? r() : r;
    }
    assert.ok(url.startsWith(API));
    return api[Math.min(calls.api++, api.length - 1)];
  };
  const ctx = vm.createContext({
    window: { LEDGER_CONFIG: { apiUrl: API, region: 'eu-west-1', clientId: 'cliente-exemplo' } },
    sessionStorage: storage(), localStorage: storage(), addEventListener: () => {},
    atob, fetch, setTimeout: fn => fn(),   // sem esperar os 2 s entre tentativas
    loading: () => {},
  });
  ctx.localStorage.setItem('ledger.left', String(Date.now()));   // a página não esteve fechada
  ctx.sessionStorage.setItem('ledger.idToken', jwt(-60));
  ctx.sessionStorage.setItem('ledger.refreshToken', 'refresh-exemplo');
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'auth.js'), 'utf8'), ctx, { filename: 'auth.js' });
  ctx.onExpired = () => { calls.expired++; };
  vm.runInContext('onSessionExpired = () => onExpired()', ctx);
  return { ctx, calls, apiFetch: p => vm.runInContext(`apiFetch(${JSON.stringify(p)})`, ctx) };
}
const renovado = () => ok({ AuthenticationResult: { IdToken: jwt(3600), AccessToken: 'acesso-exemplo' } });

test('uma falha de rede na renovação tenta outra vez e o pedido segue', async () => {
  const { ctx, calls, apiFetch } = setup({ renovacoes: [networkError, renovado()] });
  assert.deepEqual(await apiFetch('/data'), { dados: 1 });
  assert.equal(calls.cognito, 2);
  assert.equal(calls.expired, 0);
  assert.ok(ctx.sessionStorage.getItem('ledger.refreshToken'));
});

test('duas falhas passageiras seguidas mostram um erro mas não terminam a sessão', async () => {
  for (const falha of [networkError, cognitoError('TooManyRequestsException'), cognitoError('InternalErrorException')]) {
    const { ctx, calls, apiFetch } = setup({ renovacoes: [falha, falha] });
    await assert.rejects(apiFetch('/data'), /Sem ligação ao serviço de login/);
    assert.equal(calls.expired, 0);
    assert.equal(calls.api, 0);
    assert.equal(ctx.sessionStorage.getItem('ledger.refreshToken'), 'refresh-exemplo');
  }
});

test('se o Cognito recusar o refresh token, a sessão termina logo (sem segunda tentativa)', async () => {
  for (const tipo of ['NotAuthorizedException', 'UserNotFoundException']) {
    const { calls, apiFetch } = setup({ renovacoes: [cognitoError(tipo)] });
    await assert.rejects(apiFetch('/data'), /Sessão expirada/);
    assert.equal(calls.expired, 1);
    assert.equal(calls.cognito, 1);
  }
});

test('sem refresh token guardado, a sessão termina', async () => {
  const { ctx, calls } = setup({ renovacoes: [] });
  ctx.sessionStorage.removeItem('ledger.refreshToken');
  await assert.rejects(vm.runInContext('apiFetch("/data")', ctx), /Sessão expirada/);
  assert.equal(calls.expired, 1);
});

test('se a API recusar o token duas vezes, a sessão termina', async () => {
  const recusado = { ok: false, status: 401, json: async () => ({}) };
  const { calls, apiFetch } = setup({ renovacoes: [renovado(), renovado()], api: [recusado, recusado] });
  await assert.rejects(apiFetch('/data'), /Sessão expirada/);
  assert.equal(calls.expired, 1);
  assert.equal(calls.api, 2);
});
