// ── auth.js: login com o Amazon Cognito + chamadas à API ─────────────────
// Não usa o SDK da AWS: fala diretamente com a API do Cognito por fetch, o que mantém o site pequeno.

// Configuração gerada pelo deploy (frontend/config.js): URL da API, região e id do app client do Cognito
const CFG = window.LEDGER_CONFIG || {};
const API_BASE = (CFG.apiUrl || '').replace(/\/$/, '');
const COGNITO_URL = `https://cognito-idp.${CFG.region}.amazonaws.com/`;

// Guarda os tokens e o email no sessionStorage do browser: duram só enquanto o separador estiver
// aberto (recarregar a página mantém a sessão; um separador novo ou reabrir o browser pede login).
// Os try/catch evitam erros em modos privados que bloqueiam o armazenamento.
const SESSION_KEYS = ['idToken', 'accessToken', 'refreshToken', 'email'];
const store = {
  get(k) { try { return sessionStorage.getItem('ledger.' + k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem('ledger.' + k, v); } catch {} },
  clear() { try { SESSION_KEYS.forEach(k => sessionStorage.removeItem('ledger.' + k)); } catch {} },
};
// Versões antigas guardavam a sessão no localStorage (ficava aberta para sempre): apaga-a
try { SESSION_KEYS.forEach(k => localStorage.removeItem('ledger.' + k)); } catch {}

// Erro de autenticação (password errada, sessão terminada...), distinto dos erros da API
class AuthError extends Error {}

// Traduz os erros do Cognito para mensagens em português.
// O mesmo erro quer dizer coisas diferentes conforme a operação: NotAuthorized no login é
// email/password errados, no ChangePassword é a password atual errada.
function cognitoMessage(target, data) {
  const type = data.__type || '';
  if (type.includes('InvalidPassword')) return 'A password não cumpre as regras: ' + PASSWORD_RULES;
  if (type.includes('LimitExceeded') || type.includes('TooManyRequests')) return 'Demasiadas tentativas. Espera uns minutos e tenta outra vez.';
  if (target === 'ChangePassword' && type.includes('NotAuthorized')) return 'A password atual está errada';
  if (target === 'RespondToAuthChallenge' && type.includes('NotAuthorized')) return 'O pedido expirou. Volta a entrar com a password que te deram.';
  if (type.includes('NotAuthorized')) return 'Email ou password incorretos';
  return data.message || 'Falha na autenticação';
}

// Regras de password da user pool (iguais às do template.yaml: PasswordPolicy)
const PASSWORD_RULES = 'pelo menos 10 caracteres, com maiúsculas, minúsculas e um número';
// Verifica uma password nova antes de a enviar. Devolve a mensagem de erro, ou '' se estiver boa.
function passwordProblem(pw, confirm) {
  if (pw.length < 10 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'A password tem de ter ' + PASSWORD_RULES;
  if (confirm !== undefined && pw !== confirm) return 'As duas passwords não são iguais';
  return '';
}

// Chama uma operação da API do Cognito (ex.: 'InitiateAuth'). O nome da operação vai no
// cabeçalho X-Amz-Target e os parâmetros em JSON no corpo. Os erros saem já traduzidos.
async function cognito(target, body) {
  const res = await fetch(COGNITO_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.' + target,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(cognitoMessage(target, data));
  return data;
}

// Lê a data de expiração ("exp") de dentro de um JWT, em milissegundos.
// Um JWT tem 3 partes separadas por pontos; a do meio é JSON em base64url.
// (Só lê, não verifica a assinatura: quem verifica é o API Gateway.)
function jwtExp(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64 + '==='.slice((b64.length + 3) % 4))).exp * 1000;
  } catch { return 0; }
}

// Guarda os tokens devolvidos pelo Cognito. O ID token (60 min) vai nos pedidos à API;
// o access token (60 min) só serve para mudar a password; o refresh token (30 dias) renova os outros.
function saveTokens(result, email) {
  store.set('idToken', result.IdToken);
  store.set('accessToken', result.AccessToken);
  if (result.RefreshToken) store.set('refreshToken', result.RefreshToken);   // a renovação não traz um novo
  if (email) store.set('email', email);
}

// Login com email + password (fluxo USER_PASSWORD_AUTH).
// Primeiro login com a password temporária dada pelo admin (create-user.ps1 -Temporaria): o Cognito
// não deixa entrar e pede uma password nova. Nesse caso devolve { session, email } para o ecrã
// "escolhe a tua password" (ver completeNewPassword); senão devolve null e a sessão fica aberta.
async function login(email, password) {
  const data = await cognito('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CFG.clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') return { session: data.Session, email };
  if (data.ChallengeName) throw new AuthError('Esta conta precisa de um passo de login que a app não suporta. Fala com quem te criou a conta.');
  saveTokens(data.AuthenticationResult, email);
  return null;
}

// Responde ao pedido de password nova do primeiro login. session vem do login() e dura 3 minutos.
async function completeNewPassword(email, session, newPassword) {
  const data = await cognito('RespondToAuthChallenge', {
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    ClientId: CFG.clientId,
    Session: session,
    ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
  });
  saveTokens(data.AuthenticationResult, email);
}

// Muda a password do utilizador com sessão aberta (botão 🔑 Password). Só o próprio o pode fazer:
// o Cognito exige a password atual e o access token desta sessão.
async function changePassword(oldPassword, newPassword) {
  let t = store.get('accessToken');
  // sessões abertas antes desta versão não têm access token; a renovação vai buscá-lo
  if (!t || jwtExp(t) <= Date.now() + 60000) {
    try { await refreshToken(); } catch { throw new AuthError('A sessão expirou. Sai, volta a entrar e tenta outra vez.'); }
    t = store.get('accessToken');
  }
  await cognito('ChangePassword', { AccessToken: t, PreviousPassword: oldPassword, ProposedPassword: newPassword });
}

// Ao sair: anula o refresh token no Cognito, para não poder voltar a ser usado (mesmo que alguém o
// tenha copiado). Se falhar (ex.: sem internet), não faz mal: a sessão local é apagada na mesma.
function revokeSession() {
  const rt = store.get('refreshToken');
  if (rt) cognito('RevokeToken', { Token: rt, ClientId: CFG.clientId }).catch(() => {});
}

// Pede um ID token novo usando o refresh token, sem voltar a pedir a password
async function refreshToken() {
  const rt = store.get('refreshToken');
  if (!rt) throw new AuthError('Sessão terminada');
  const data = await cognito('InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: CFG.clientId,
    AuthParameters: { REFRESH_TOKEN: rt },
  });
  saveTokens(data.AuthenticationResult);
  return data.AuthenticationResult.IdToken;
}

// Devolve um ID token válido: o guardado, se ainda faltar mais de 1 minuto para expirar;
// senão (ou se force = true) renova-o.
async function getToken(force = false) {
  const t = store.get('idToken');
  if (!force && t && jwtExp(t) > Date.now() + 60000) return t;
  return refreshToken();
}

// Chamada quando a sessão não se consegue recuperar (volta ao ecrã de login); o app.js define-a.
let onSessionExpired = () => {};

// Faz um pedido à API com o token no cabeçalho Authorization: Bearer <token>.
// Se a API responder 401 (token recusado), renova o token e tenta uma segunda vez;
// se falhar outra vez, termina a sessão. Erros da API viram Error com a mensagem do backend.
async function apiFetch(path, opts = {}) {
  let token;
  try { token = await getToken(); }
  catch { onSessionExpired(); throw new Error('Sessão expirada, entra outra vez'); }

  const send = t => fetch(API_BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), Authorization: 'Bearer ' + t },
  });

  loading(true);
  try {
    let res = await send(token);
    if (res.status === 401) {
      try { res = await send(await getToken(true)); }
      catch { onSessionExpired(); throw new Error('Sessão expirada, entra outra vez'); }
      if (res.status === 401) { onSessionExpired(); throw new Error('Sessão expirada, entra outra vez'); }
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err.detail || err.message || `Erro ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return res.status === 204 ? null : res.json();
  } finally {
    loading(false);
  }
}

// ── chamadas à API (as 3 rotas do backend) ──
const api = {
  // GET /data: todos os dados do utilizador
  loadAll: () => apiFetch('/data'),

  /**
   * POST /items: grava itens em blocos de 200 (o backend aceita no máximo 300 por pedido),
   * por isso importações com milhares de linhas funcionam. Os ids a apagar vão no primeiro bloco.
   * onProgress(feitos, total) permite mostrar o progresso. Devolve {saved, deleted} de todos os blocos.
   */
  async save(items, deletes = [], onProgress) {
    const CHUNK = 200;
    const out = { saved: [], deleted: [] };
    const total = items.length + deletes.length;
    let done = 0;
    for (let i = 0; i < Math.max(items.length, 1); i += CHUNK) {
      const part = items.slice(i, i + CHUNK);
      const del = i === 0 ? deletes : [];
      if (!part.length && !del.length) break;
      const r = await apiFetch('/items', { method: 'POST', body: JSON.stringify({ items: part, delete: del }) });
      out.saved.push(...r.saved);
      out.deleted.push(...r.deleted);
      done += part.length + del.length;
      if (onProgress) onProgress(done, total);
    }
    return out;
  },

  // DELETE /items/{id}: apaga um item (o backend apaga os "filhos" em cascata)
  remove: id => apiFetch('/items/' + encodeURIComponent(id), { method: 'DELETE' }),

  // POST /backup: envia os CSV para o email da própria conta. files = [{ name, content }]
  emailBackup: (date, files) => apiFetch('/backup', { method: 'POST', body: JSON.stringify({ date, files }) }),
};
