// ── admin.js: separador Utilizadores (só para o grupo "admin" do Cognito) ──
// Mostra todas as contas e quem entrou e quando. Os dados vêm de GET /admin/users (função admin do
// backend), que recusa (403) quem não for administrador: esconder o separador aos outros é só arrumação.
// Também cria contas normais (com convite por email), desativa / reativa contas e repõe passwords.
// O grupo admin nunca muda aqui: só com a AWS (make-admin).
// Cada login é registado pelo Cognito no momento em que a pessoa entra e fica guardado 90 dias;
// renovar a sessão sem pedir a password não conta como login.

// Último resultado de GET /admin/users ({ users, logins }); null até se abrir o separador
let ADMIN = null;
// Quantos logins recentes a API devolve (igual a MAX_LOGINS_SHOWN no backend/app.py)
const ADMIN_MAX_LOGINS = 200;

// Data e hora em hora de Portugal: "2026-10-07T13:21:00+00:00" -> "07/10/2026 14:21"
const ADMIN_TIME = new Intl.DateTimeFormat('pt-PT', {
  timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function dateTimeLabel(iso) {
  if (!iso) return '—';
  const p = Object.fromEntries(ADMIN_TIME.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

// Há quanto tempo: "agora mesmo", "há 5 min", "há 3 h", "há 1 dia", "há 12 dias", "há 2 meses".
// now em milissegundos (por omissão, agora; os testes passam um valor fixo)
function sinceLabel(iso, now = Date.now()) {
  if (!iso) return '';
  const min = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `há ${d} dia${d === 1 ? '' : 's'}`;
  return `há ${Math.floor(d / 30)} meses`;
}

// Estado da conta, em português, a partir do que o Cognito devolve (UserStatus e Enabled)
function userStateLabel(u) {
  if (u.enabled === false) return 'Desativada';
  if (u.status === 'FORCE_CHANGE_PASSWORD') return 'Password temporária';
  if (u.status === 'CONFIRMED') return 'Ativa';
  if (u.status === 'RESET_REQUIRED') return 'Password reposta';
  return u.status || '—';
}

// Email com aspecto válido (algo@algo.algo, sem espaços nem aspas), como no backend (EMAIL_RE)
function isValidEmail(s) {
  return /^[^@\s"\\]+@[^@\s"\\]+\.[^@\s"\\]+$/.test(String(s || '').trim());
}

// Ações em cada conta (botões da coluna "Ações"), pela ordem em que aparecem. As contas de administrador
// (incluindo a tua) não têm nenhuma: só se mudam pela AWS (create-user / make-admin); o backend recusa-as (403).
// Apagar só aparece nas contas desativadas (primeiro desativar, depois apagar; o backend também obriga).
// me = o teu email em minúsculas
function adminActions(u, me) {
  if (u.admin || u.email.toLowerCase() === me) return [];
  if (u.enabled === false) return ['enable', 'reset-password', 'delete'];
  return [...(u.status === 'FORCE_CHANGE_PASSWORD' ? ['resend-invite'] : []), 'disable', 'reset-password'];
}
const ADMIN_ACTION_LABEL = {
  'resend-invite': 'Reenviar convite', disable: 'Desativar', enable: 'Reativar', 'reset-password': 'Repor password',
  delete: 'Apagar',
};
// Texto da confirmação de cada ação (e = email já escapado) e mensagem quando corre bem
const ADMIN_ACTION_CONFIRM = {
  'resend-invite': e => `Enviar outra vez o convite para <b>${e}</b>?<br><br>Leva uma password temporária nova, válida 7 dias.`,
  disable: e => `Desativar a conta de <b>${e}</b>?<br><br>Deixa de conseguir entrar e as sessões abertas terminam
    no máximo em 60 minutos. Os dados ficam guardados e podes reativar a conta quando quiseres.`,
  enable: e => `Reativar a conta de <b>${e}</b>?<br><br>Volta a conseguir entrar com a password que tinha.`,
  'reset-password': e => `Repor a password de <b>${e}</b>?<br><br>As sessões abertas terminam e recebes uma password
    temporária para lhe dares. No login seguinte, a pessoa escolhe uma nova.`,
  delete: e => `Apagar de vez a conta de <b>${e}</b>?<br><br>Apaga a conta e todos os dados dela (movimentos,
    investimentos, créditos, património e o backup diário). <b>Não se pode desfazer.</b>`,
};
const ADMIN_ACTION_DONE = {
  'resend-invite': e => `Convite enviado outra vez para ${e} (pode cair no spam)`,
  disable: e => `Conta de ${e} desativada`,
  enable: e => `Conta de ${e} reativada`,
  delete: e => `Conta de ${e} apagada, com todos os dados`,
};

// Corre uma ação numa conta, depois de pedir confirmação, e volta a carregar a lista
async function runAdminAction(action, email) {
  if (!await confirmDialog(ADMIN_ACTION_CONFIRM[action](esc(email)), ADMIN_ACTION_LABEL[action])) return;
  try {
    const r = await api.adminAction(action, email);
    if (action === 'reset-password') showTempPassword(email, r.temporary_password);
    else toast(r.warning || ADMIN_ACTION_DONE[action](email), !!r.warning);
  } catch (e) {
    toast(e.message, true);
  }
  loadAdmin();
}

// Mostra a password temporária (só desta vez: o backend não a guarda) com um botão para a copiar
function showTempPassword(email, password) {
  modal.open({
    title: 'Password temporária',
    body: `<div class="modal-hint" style="font-size:14px;color:var(--text)">Password temporária de <b>${esc(email)}</b>:</div>
      <div style="font-family:monospace;font-size:20px;letter-spacing:1px;text-align:center;padding:12px;margin:12px 0;
        border:1px solid var(--border);border-radius:8px;user-select:all">${esc(password)}</div>
      <div class="modal-hint">Dá-a à pessoa. <b>Só aparece agora</b> e é válida durante 7 dias; no login seguinte, ela escolhe uma nova.</div>`,
    footer: [
      { label: 'Copiar', onClick: () => navigator.clipboard.writeText(password)
        .then(() => toast('Password copiada'), () => toast('Não foi possível copiar: seleciona-a e copia à mão', true)) },
      { label: 'Fechar', cls: 'primary', onClick: () => modal.close() },
    ],
    onClose: () => { $('#modal-body').innerHTML = ''; },   // não deixa a password na página
  });
}

// "+ Nova conta": cria uma conta normal e o Cognito envia o convite por email
function newAccountForm() {
  formModal({
    title: 'Nova conta',
    intro: `A pessoa recebe um email de convite com o endereço da app e uma password temporária (válida 7 dias);
      no primeiro login escolhe a dela. Recebe também um email da Amazon Web Services para confirmar o endereço
      (só é preciso para o backup diário). A conta é sempre de utilizador normal.`,
    fields: [{ name: 'email', label: 'Email', type: 'text', required: true, placeholder: 'nome@exemplo.com' }],
    submitLabel: 'Enviar convite',
    async onSubmit({ email }) {
      if (!isValidEmail(email)) throw new Error('Email inválido');
      const r = await api.adminAction('create', email);
      toast(r.warning || `Convite enviado para ${email.toLowerCase()} (pode cair no spam)`, !!r.warning);
      loadAdmin();
    },
  });
}

// Os 4 números do topo: utilizadores (quantos admins e desativados), quem entrou nos últimos 7 dias,
// quem não tem nenhum login registado e o login mais recente
function adminStats(users, logins, now = Date.now()) {
  const weekAgo = now - 7 * 86400000;
  return {
    total: users.length,
    admins: users.filter(u => u.admin).length,
    disabled: users.filter(u => u.enabled === false).length,
    week: users.filter(u => u.last_login && new Date(u.last_login).getTime() >= weekAgo).length,
    never: users.filter(u => !u.last_login).length,
    last: logins[0] || null,
  };
}

// Vai buscar os utilizadores e os logins à API e desenha o separador (botão ↻ e primeira abertura)
async function loadAdmin() {
  try {
    ADMIN = await api.adminUsers();
  } catch (e) {
    ADMIN = { users: [], logins: [], error: e.message };
    toast(e.message, true);
  }
  if (S.tab === 'admin') renderAdmin();
}

// Ao sair: esquece os dados e limpa as tabelas (o próximo a entrar pode não ser administrador)
function clearAdmin() {
  ADMIN = null;
  S.adminUser = '';
  $('#adm-users').innerHTML = $('#adm-logins').innerHTML = '';
}

// Desenha o separador Utilizadores com os dados já carregados (na primeira vez, carrega-os)
function renderAdmin() {
  if (!ADMIN) { loadAdmin(); return; }
  const { users, logins } = ADMIN;
  const me = (store.get('email') || '').toLowerCase();
  const st = adminStats(users, logins);

  $('#adm-total').textContent = st.total;
  $('#adm-total-sub').textContent = [`${st.admins} admin`, st.disabled ? `${st.disabled} desativada(s)` : ''].filter(Boolean).join(' · ');
  $('#adm-week').textContent = st.week;
  $('#adm-week-sub').textContent = `de ${st.total} utilizador(es)`;
  $('#adm-never').textContent = st.never;
  $('#adm-last').textContent = st.last ? sinceLabel(st.last.at) : '—';
  $('#adm-last-sub').textContent = st.last ? `${st.last.email} · ${dateTimeLabel(st.last.at)}` : 'ainda nenhum login registado';

  $('#adm-users').innerHTML = ADMIN.error
    ? `<div class="empty">Não foi possível carregar os utilizadores.<br>${esc(ADMIN.error)}</div>`
    : `<table class="data">
    <thead><tr><th>Utilizador</th><th>Estado</th><th>Conta criada</th><th>Último login</th>
      <th class="num" title="Desde que os logins começaram a ser registados">Logins</th><th>Ações</th></tr></thead>
    <tbody>${users.map(u => `<tr>
      <td><div class="li-name">${esc(u.email)}${u.admin ? ' <span class="badge admin">Admin</span>' : ''}${u.email.toLowerCase() === me ? ' <span class="muted">(tu)</span>' : ''}</div></td>
      <td>${esc(userStateLabel(u))}</td>
      <td class="date">${u.created ? dateTimeLabel(u.created).slice(0, 10) : '—'}</td>
      <td>${u.last_login ? `<span class="date">${dateTimeLabel(u.last_login)}</span><div class="li-sub">${sinceLabel(u.last_login)}</div>` : '<span class="muted">sem registo</span>'}</td>
      <td class="num">${u.logins}</td>
      <td class="actions">${adminActions(u, me).map(a => `<button class="btn${a === 'delete' ? ' danger' : ''}" style="margin:2px" data-adm-action="${a}" data-email="${esc(u.email)}">${ADMIN_ACTION_LABEL[a]}</button>`).join('')
        || '<span class="muted" title="As contas de administrador só se mudam pela AWS">—</span>'}</td>
    </tr>`).join('')}</tbody></table>`;

  // filtro dos logins: só os emails que aparecem na lista (inclui contas já apagadas)
  const emails = [...new Set(logins.map(l => l.email))].sort((a, b) => a.localeCompare(b));
  S.adminUser = fillSelect($('#adm-filter'), emails.map(e => ({ value: e, label: e })), S.adminUser, 'Todos os utilizadores');
  const shown = S.adminUser ? logins.filter(l => l.email === S.adminUser) : logins;
  $('#adm-logins').innerHTML = shown.length ? `<table class="data">
    <thead><tr><th>Data e hora</th><th>Utilizador</th><th></th></tr></thead>
    <tbody>${shown.map(l => `<tr>
      <td class="date">${dateTimeLabel(l.at)}</td><td>${esc(l.email)}</td><td class="date">${sinceLabel(l.at)}</td>
    </tr>`).join('')}</tbody></table>
    <div class="empty" style="text-align:left">Hora de Portugal. Mostra os últimos ${ADMIN_MAX_LOGINS} logins de todos os utilizadores;
      cada um fica guardado 90 dias. Renovar a sessão sem pedir a password não conta como login.</div>`
    : `<div class="empty">${ADMIN.error ? 'Sem dados.' : 'Ainda não há logins registados.<br>Cada vez que alguém entra na app, o login aparece aqui.'}</div>`;
}
