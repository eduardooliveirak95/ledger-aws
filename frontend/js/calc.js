// ── calc.js: todos os números que a app mostra são calculados aqui, a partir dos dados em bruto ──
// O backend só guarda e devolve os registos; saldos, ganhos e dívidas são calculados no browser.
// D = { accounts, transactions, investments, inv_moves, valuations, loans, loan_balances, properties, bank_formats, budgets, goals,
//       reservations, alloc_targets }
// é a cópia local de tudo o que veio de GET /data (uma lista por tipo de item).

let D = emptyData();
function emptyData() {
  return { accounts: [], transactions: [], investments: [], inv_moves: [], valuations: [], loans: [], loan_balances: [], properties: [],
    bank_formats: [],   // bank_formats: colunas escolhidas para os CSV de cada banco (ver bank.js)
    budgets: [],        // budgets: orçamentos por categoria de saídas (limite por mês; ver budgetStatus)
    goals: [],          // goals: metas de poupança (ver goalStatus)
    reservations: [],   // reservations: dinheiro de contas e investimentos posto de lado para as metas (ver reservedTotal)
    alloc_targets: [] };// alloc_targets: percentagem alvo de cada tipo de investimento (ver allocation)
}
// Tipo de item -> nome da lista em D (o mesmo mapa que existe no backend)
const COLLECTION_OF = {
  account: 'accounts', transaction: 'transactions', investment: 'investments', inv_move: 'inv_moves',
  valuation: 'valuations', loan: 'loans', loan_balance: 'loan_balances', property: 'properties', bank_format: 'bank_formats',
  budget: 'budgets', goal: 'goals', reservation: 'reservations', alloc_target: 'alloc_targets',
};

/**
 * Aplica a resposta de uma gravação/remoção à cópia local D, sem voltar a pedir tudo à API.
 * Remove os ids apagados (e as versões antigas dos gravados) e junta os itens gravados.
 */
function applyChanges({ saved = [], deleted = [] }) {
  const del = new Set(deleted);
  const byKind = {};
  for (const it of saved) { del.add(it.id); (byKind[COLLECTION_OF[it.kind]] ||= []).push(it); }
  for (const col of Object.keys(D)) {
    D[col] = D[col].filter(x => !del.has(x.id));
    if (byKind[col]) D[col].push(...byKind[col]);
  }
}

// Procurar itens e nomes (com texto de recurso se o item já tiver sido apagado)
function findById(col, id) { return D[col].find(x => x.id === id); }
function accountName(id) { return findById('accounts', id)?.name ?? '(conta apagada)'; }
function investmentName(id) { return findById('investments', id)?.name ?? '(apagado)'; }
function loanName(id) { return findById('loans', id)?.name ?? '(apagado)'; }
// Ordena por nome, alfabeticamente em português (acentos no sítio certo)
function sortByName(list) { return [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt')); }

/** Categorias sugeridas: as predefinidas + todas as que já usaste nesse sentido (entrada/saída). */
function knownCategories(direction) {
  const set = new Set(CATEGORIES[direction] || []);
  for (const t of D.transactions) if (t.direction === direction && t.category) set.add(t.category);
  return [...set].sort((a, b) => a.localeCompare(b, 'pt'));
}

// ════════ CONTAS / MOVIMENTOS ════════

/**
 * Quanto um movimento muda o saldo de uma conta (+ entra, − sai),
 * ou o total de todas as contas quando accountId é vazio.
 */
function txEffect(t, accountId) {
  if (t.direction === 'in') return !accountId || t.account_id === accountId ? t.amount : 0;
  if (t.direction === 'out') return !accountId || t.account_id === accountId ? -t.amount : 0;
  if (!accountId) return 0; // transferência entre contas próprias: o total não muda
  if (t.account_id === accountId) return -t.amount;
  if (t.to_account_id === accountId) return t.amount;
  return 0;
}

// Saldo de uma conta numa data: saldo inicial + efeito de todos os movimentos até essa data
function accountBalance(accountId, upToDate = '9999-12-31') {
  const acc = findById('accounts', accountId);
  let b = acc ? acc.opening_balance : 0;
  for (const t of D.transactions) if (t.date <= upToDate) b += txEffect(t, accountId);
  return round2(b);
}

// Soma dos saldos de todas as contas numa data
function totalAccountsBalance(upToDate = '9999-12-31') {
  let b = D.accounts.reduce((s, a) => s + a.opening_balance, 0);
  for (const t of D.transactions) if (t.date <= upToDate) b += txEffect(t, '');
  return round2(b);
}

/** Meses a mostrar no separador Movimentos. mode: month (um mês) | year (um ano) | all (desde o 1.º movimento) */
function periodBounds(mode, anchor) {
  if (mode === 'month') return { from: anchor, to: anchor };
  if (mode === 'year') { const y = anchor.slice(0, 4); return { from: `${y}-01`, to: `${y}-12` }; }
  const first = firstTxMonth() || thisMonth();
  return { from: first, to: thisMonth() > first ? thisMonth() : first };
}

// Mês do movimento mais antigo (null se ainda não houver movimentos)
function firstTxMonth() {
  let m = null;
  for (const t of D.transactions) if (!m || t.date < m) m = t.date;
  return m ? ymOf(m) : null;
}

// Movimentos entre os meses from e to, opcionalmente só de uma conta e/ou de algumas categorias.
// catIn / catOut = categorias de entrada / de saída escolhidas (listas). Sem nenhuma escolhida,
// não se filtra por categoria; com alguma, só ficam as entradas e saídas dessas categorias.
// text = o que se escreveu na pesquisa (vazio = sem pesquisa; ver matchesSearch).
function filterTx({ from, to, account = '', catIn = [], catOut = [], text = '' }) {
  const byCategory = catIn.length || catOut.length;
  const words = norm(text).split(/\s+/).filter(Boolean);
  return D.transactions.filter(t => {
    const ym = ymOf(t.date);
    if (from && ym < from) return false;
    if (to && ym > to) return false;
    if (account && t.account_id !== account && t.to_account_id !== account) return false;
    if (byCategory && !(t.direction === 'in' ? catIn : t.direction === 'out' ? catOut : []).includes(t.category)) return false;
    if (words.length && !matchesSearch(t, words)) return false;
    return true;
  });
}

/** Pesquisa nos movimentos: cada palavra tem de aparecer na descrição, na categoria ou no valor
 *  (sem distinguir maiúsculas nem acentos; "agua" encontra "Água", "45,9" encontra 45,90 €). */
function matchesSearch(t, words) {
  const text = norm(`${t.description || ''} ${t.category || ''} ${String(t.amount).replace('.', ',')}`);
  return words.every(w => text.includes(w));
}

/** Totais de entradas e saídas. As transferências só contam quando se olha para uma conta.
 *  out = gasto real; invested = saídas para investimentos; amortized = amortizações de crédito;
 *  net = variação do dinheiro (in − out − invested − amortized); saved = in − out (o que não foi gasto). */
function flowTotals(txs, account = '') {
  let inn = 0, out = 0, inv = 0, am = 0;
  for (const t of txs) {
    const e = txEffect(t, account);
    if (e > 0) inn += e;
    else if (e < 0 && isAmortizationOut(t)) am -= e;
    else if (e < 0 && isInvestmentOut(t)) inv -= e;
    else out -= e;
  }
  return { in: round2(inn), out: round2(out), invested: round2(inv), amortized: round2(am),
           net: round2(inn - out - inv - am), saved: round2(inn - out) };
}

// Como flowTotals, mas mês a mês (para o gráfico de barras de entradas/saídas)
function monthlyFlows(months, filters) {
  const idx = Object.fromEntries(months.map((m, i) => [m, i]));
  const inn = months.map(() => 0), out = months.map(() => 0), inv = months.map(() => 0), am = months.map(() => 0);
  for (const t of filterTx({ ...filters, from: months[0], to: months[months.length - 1] })) {
    const i = idx[ymOf(t.date)];
    if (i === undefined) continue;
    const e = txEffect(t, filters.account);
    if (e > 0) inn[i] += e;
    else if (e < 0 && isAmortizationOut(t)) am[i] -= e;
    else if (e < 0 && isInvestmentOut(t)) inv[i] -= e;
    else out[i] -= e;
  }
  return { in: inn.map(round2), out: out.map(round2), invested: inv.map(round2), amortized: am.map(round2) };
}

/** Totais por categoria, do maior para o menor. As categorias de poupança ficam de fora das despesas. */
function categoryTotals(txs, direction = 'out') {
  const map = Object.create(null);   // sem protótipo: uma categoria chamada "constructor" ou "toString" conta como as outras
  for (const t of txs) if (t.direction === direction && !isSavingOut(t)) map[t.category] = (map[t.category] || 0) + t.amount;
  return Object.entries(map).map(([k, v]) => [k, round2(v)]).sort((a, b) => b[1] - a[1]);
}

/** Saldo no fim de cada mês de uma conta (ou de todas), desde o primeiro movimento até hoje. */
function balanceSeries(accountId = '') {
  const first = firstTxMonth();
  if (!first) return { months: [], values: [] };
  const months = monthRange(first, thisMonth() > first ? thisMonth() : first);
  const perMonth = {};
  for (const t of D.transactions) {
    const m = ymOf(t.date);
    perMonth[m] = (perMonth[m] || 0) + txEffect(t, accountId);
  }
  let b = accountId ? (findById('accounts', accountId)?.opening_balance || 0)
                    : D.accounts.reduce((s, a) => s + a.opening_balance, 0);
  const values = months.map(m => (b += perMonth[m] || 0, round2(b)));
  return { months, values };
}

// ════════ COMPARAÇÃO NOS CARTÕES DOS MOVIMENTOS ════════

// Totais de vários meses, já com a taxa de poupança (saved / in), como nos cartões
function totalsWithRate(txs, account) {
  const t = flowTotals(txs, account);
  return { ...t, rate: t.in > 0 ? t.saved / t.in : NaN };
}

/**
 * Com que se comparam os cartões dos Movimentos (com os mesmos filtros de conta, categorias e pesquisa):
 *   mês    -> avg: a média por mês dos 12 meses anteriores (só desde o primeiro movimento) e
 *             lastYear: o mesmo mês do ano anterior (se já havia movimentos nesse mês)
 *   ano    -> lastYear: o mesmo período do ano anterior (no ano atual, de janeiro até ao mesmo mês)
 *   sempre -> nada
 * No mês atual (ou no último mês do ano atual), os meses com que se compara só contam até ao mesmo dia do mês,
 * para não comparar meio mês com meses inteiros. Cada comparação é { short, title, totals } (short = texto curto
 * para o cartão, title = a explicação completa; na média, os totais são por mês) ou null.
 */
function movComparison(mode, anchor, filters) {
  const first = firstTxMonth(), now = thisMonth(), out = { avg: null, lastYear: null };
  if (!first || mode === 'all') return out;
  const day = Number(todayISO().slice(8, 10));
  const current = mode === 'month' ? anchor === now : anchor.slice(0, 4) === now.slice(0, 4);
  const sum = (from, to, keep) => totalsWithRate(filterTx({ ...filters, from, to }).filter(keep), filters.account);
  const upToDay = t => !current || Number(t.date.slice(8, 10)) <= day;
  if (mode === 'month') {
    const upTo = current ? ` (até ao dia ${day})` : '';
    const from = [addMonths(anchor, -12), first].sort().pop(), to = addMonths(anchor, -1);
    const months = monthRange(from, to).length;
    if (months) {
      const t = sum(from, to, upToDay);
      out.avg = { short: 'à média', title: `${months === 1 ? 'O mês anterior' : `Média dos ${months} meses anteriores`}${upTo}`,
        totals: { ...t, in: t.in / months, out: t.out / months, net: t.net / months } };
    }
    const ly = addMonths(anchor, -12);
    if (ly >= first) out.lastYear = { short: `a ${monthShort(ly)}`, title: `${monthLabel(ly)}${upTo}`, totals: sum(ly, ly, upToDay) };
  } else {
    const y = Number(anchor.slice(0, 4)) - 1, end = current ? Number(now.slice(5)) : 12;
    const from = `${y}-01`, to = `${y}-${String(end).padStart(2, '0')}`;
    if (from >= first) {
      out.lastYear = {
        short: `a ${end === 12 ? y : `jan–${MONTHS_SHORT[end - 1]} ${y}`}`,
        title: end === 12 ? String(y) : `De janeiro a ${MONTHS_PT[end - 1]} de ${y} (${MONTHS_PT[end - 1]} só até ao dia ${day})`,
        totals: sum(from, to, t => ymOf(t.date) < to || upToDay(t)),
      };
    }
  }
  return out;
}

// ════════ ORÇAMENTOS ════════

/**
 * Como estão os orçamentos num período (meses from a to): para cada categoria com orçamento, quanto se gastou
 * nesse período (saídas dessa categoria, em todas as contas) e o limite = orçamento por mês × número de meses do
 * período (num ano, sempre × 12, mesmo no ano atual). state: 'ok', 'near' (80% ou mais) ou 'over' (passou).
 * Se houver dois orçamentos da mesma categoria, conta o mais recente. Ordem: os mais gastos (em %) primeiro.
 */
function budgetStatus(from, to) {
  const months = Math.max(1, monthRange(from, to).length);
  // dicionários sem protótipo: uma categoria chamada "constructor" ou "toString" conta como as outras
  const latest = Object.create(null);
  for (const b of D.budgets) if (!latest[b.category] || (b.updated_at || '') > (latest[b.category].updated_at || '')) latest[b.category] = b;
  const spentBy = Object.create(null);
  for (const t of filterTx({ from, to })) if (t.direction === 'out') spentBy[t.category] = (spentBy[t.category] || 0) + t.amount;
  return Object.values(latest).map(b => {
    const limit = round2(b.amount * months), spent = round2(spentBy[b.category] || 0);
    const ratio = spent / limit;
    return { id: b.id, category: b.category, amount: b.amount, months, limit, spent, ratio, left: round2(limit - spent),
      state: ratio > 1 ? 'over' : ratio >= 0.8 ? 'near' : 'ok' };
  }).sort((a, b) => b.ratio - a.ratio || a.category.localeCompare(b.category, 'pt'));
}

// ════════ DESPESAS FIXAS ════════

// Chave para juntar os movimentos da mesma despesa: a descrição sem acentos, números nem pontuação
// (nos extratos mudam de mês para mês: datas, referências) — "COMPRA 4512 NETFLIX.COM 05/09" -> "compra netflix com"
function recurringKey(description) {
  return norm(description).replace(/[^a-z]+/g, ' ').trim();
}

/**
 * Despesas que se repetem todos os meses (renda, luz, telemóvel, ginásio, subscrições…), encontradas nas saídas
 * dos últimos 12 meses e do mês atual, em todas as contas. Juntam-se pela descrição (recurringKey) e ficam as que:
 *   - aparecem em pelo menos 3 meses diferentes, quase sempre uma vez por mês (no máximo 1,5 vezes por mês, em média;
 *     o supermercado ou a gasolina, várias vezes por mês, ficam de fora);
 *   - aparecem em pelo menos 60% dos meses entre a primeira e a última vez (regulares, não de vez em quando);
 *   - ainda estão ativas: a última foi no mês atual ou no anterior.
 * Os investimentos e as amortizações (dinheiro posto de lado) e as transferências entre contas não contam.
 * Devolve [{ key, description, category, account_id, amount, min, max, variable, months, last, amounts }], do maior valor
 * para o menor: amount = valor habitual (a mediana); variable = o valor muda mais de 10% (ex.: luz, água);
 * description, category e account_id são os do movimento mais recente; months = em quantos meses apareceu;
 * amounts = os valores por ordem de data (ver priceRises).
 */
function recurringExpenses() {
  const now = thisMonth(), from = addMonths(now, -12), entries = [];
  for (const t of D.transactions) {
    const ym = ymOf(t.date);
    if (t.direction !== 'out' || isSavingOut(t) || ym < from || ym > now) continue;
    const key = recurringKey(t.description);
    if (key.length >= 3) entries.push({ t, key, value: t.amount });
  }
  return recurringGroups(entries);
}

// Junta os movimentos que se repetem todos os meses, com as regras do recurringExpenses. entries = [{ t, key, value }]: o
// movimento, a chave do grupo e o valor que conta (positivo). Devolve um elemento por grupo, como o recurringExpenses.
function recurringGroups(entries) {
  const recent = addMonths(thisMonth(), -1);
  const groups = Object.create(null);   // sem protótipo: uma descrição como "constructor" é uma chave como as outras
  for (const e of entries) (groups[e.key] ||= []).push(e);
  const out = [];
  for (const [key, list] of Object.entries(groups)) {
    const months = [...new Set(list.map(e => ymOf(e.t.date)))].sort();
    const first = months[0], last = months[months.length - 1];
    if (months.length < 3 || list.length > months.length * 1.5 || last < recent) continue;
    if (months.length < 0.6 * (monthsDiff(first, last) + 1)) continue;
    const amounts = list.map(e => e.value).sort((a, b) => a - b);
    const mid = amounts.length >> 1;
    const amount = round2(amounts.length % 2 ? amounts[mid] : (amounts[mid - 1] + amounts[mid]) / 2);
    const min = amounts[0], max = amounts[amounts.length - 1];
    const latest = list.reduce((a, b) => (b.t.date > a.t.date ? b : a)).t;
    out.push({ key, description: latest.description, category: latest.category, account_id: latest.account_id, amount, min, max,
      variable: max - min > amount * 0.1, months: months.length, last: latest.date,
      amounts: [...list].sort((a, b) => a.t.date.localeCompare(b.t.date)).map(e => e.value) });
  }
  return out.sort((a, b) => b.amount - a.amount || a.description.localeCompare(b.description, 'pt'));
}

/**
 * Despesas fixas que subiram de preço (ex.: uma subscrição que passou de 11,99 € para 13,99 €): o último valor é mais de 2%
 * acima de todos os anteriores, que eram sempre os mesmos (±1%; pelo menos 2). Quando o valor novo se repete, os anteriores
 * deixam de ser todos iguais e o aviso desaparece sozinho. [{ key, description, from, to, date }]
 */
function priceRises(list = recurringExpenses()) {
  return list.flatMap(x => {
    const before = x.amounts.slice(0, -1), to = x.amounts[x.amounts.length - 1];
    if (before.length < 2) return [];
    const lo = Math.min(...before), from = Math.max(...before);
    if (from - lo > from * 0.01 || to <= from * 1.02) return [];
    return [{ key: x.key, description: x.description, from, to, date: x.last }];
  });
}

// ════════ SALDO PREVISTO E FUNDO DE EMERGÊNCIA ════════

/**
 * Entradas e saídas que se repetem todos os meses numa conta (ou em todas, sem account; aí as transferências entre contas
 * próprias não contam), com as regras das despesas fixas, mas a contar tudo o que mexe no saldo: também os aportes, as
 * amortizações e as transferências. Cada uma com sign (+1 entra, −1 sai) e pending = ainda não apareceu este mês e o dia do
 * mês em que apareceu da última vez ainda não chegou (ex.: a internet a 28, vista a 19). As saídas atrasadas (o dia já passou)
 * também contam, por prudência; as entradas atrasadas não (um ordenado pago uns dias antes, no fim do mês anterior, não conta
 * a dobrar).
 */
function recurringFlows(account = '') {
  const now = thisMonth(), from = addMonths(now, -12), today = todayISO(), entries = [];
  for (const t of D.transactions) {
    const ym = ymOf(t.date);
    if (ym < from || ym > now) continue;
    const e = txEffect(t, account), key = recurringKey(t.description);
    if (e && key.length >= 3) entries.push({ t, key: (e > 0 ? '+' : '−') + key, value: Math.abs(e) });
  }
  const day = Number(today.slice(8, 10));
  return recurringGroups(entries).map(x => {
    const sign = x.key[0] === '+' ? 1 : -1;
    return { ...x, sign, pending: ymOf(x.last) !== now && (Number(x.last.slice(8, 10)) > day || sign < 0) };
  });
}

/**
 * Saldo previsto no fim do mês atual, numa conta ou em todas: o saldo de hoje
 *   + os movimentos já registados com data entre amanhã e o fim do mês (scheduled)
 *   + as entradas habituais que ainda não chegaram este mês (incoming) − as saídas habituais que ainda não saíram (outgoing),
 *     cada uma com o último valor (amount; se o preço mudou, já conta o novo)
 *   − os gastos do dia a dia que ainda faltam (daily): o que costuma sair por mês em saídas que não se repetem (média dos
 *     3 meses completos antes deste, só desde o primeiro movimento) menos o que já saiu este mês; nunca negativo.
 * É uma estimativa. { balance, scheduled, incoming, outgoing, daily, total, end } (incoming e outgoing são do recurringFlows)
 */
function monthForecast(account = '') {
  const today = todayISO(), now = thisMonth(), end = lastDayOf(now);
  const balance = account ? accountBalance(account, today) : totalAccountsBalance(today);
  let scheduled = 0;
  for (const t of D.transactions) if (t.date > today && t.date <= end) scheduled += txEffect(t, account);
  const flows = recurringFlows(account);
  const pending = flows.filter(x => x.pending).map(x => ({ ...x, amount: x.amounts[x.amounts.length - 1] }));
  const incoming = pending.filter(x => x.sign > 0), outgoing = pending.filter(x => x.sign < 0);
  // gastos do dia a dia: saídas que não pertencem a nenhum grupo habitual
  const habitual = new Set(flows.map(x => x.key));
  const dailyOut = t => { const e = txEffect(t, account); return e < 0 && !habitual.has('−' + recurringKey(t.description)) ? -e : 0; };
  const first = firstTxMonth(), from = first && [addMonths(now, -3), first].sort().pop(), to = addMonths(now, -1);
  const n = from && from <= to ? monthRange(from, to).length : 0;
  let before = 0, sofar = 0;
  for (const t of D.transactions) {
    const ym = ymOf(t.date);
    if (n && ym >= from && ym <= to) before += dailyOut(t);
    else if (ym === now && t.date <= today) sofar += dailyOut(t);
  }
  const daily = n ? round2(Math.max(0, before / n - sofar)) : 0;
  const sum = list => list.reduce((s2, x) => s2 + x.amount, 0);
  return { balance, scheduled: round2(scheduled), incoming, outgoing, daily, end,
    total: round2(balance + scheduled + sum(incoming) - sum(outgoing) - daily) };
}

/**
 * Para quantos meses de gastos dá o dinheiro nas contas (o "fundo de emergência"): o saldo de hoje em todas as contas a
 * dividir pela média dos gastos por mês (flowTotals: sem investimentos nem amortizações) dos 12 meses completos antes do atual,
 * só desde o primeiro movimento. null sem um mês completo ou sem gastos. { months, avg, cash, n }
 */
function emergencyMonths() {
  const first = firstTxMonth(), now = thisMonth(), to = addMonths(now, -1);
  if (!first || first > to) return null;
  const from = [addMonths(now, -12), first].sort().pop(), n = monthRange(from, to).length;
  const avg = round2(flowTotals(filterTx({ from, to })).out / n);
  if (!(avg > 0)) return null;
  const cash = totalAccountsBalance(todayISO());
  return { months: Math.max(0, cash) / avg, avg, cash, n };
}

// ════════ INVESTIMENTOS ════════

// Um investimento só (se filterId) ou todos
function investmentIds(filterId) {
  return filterId ? [filterId] : D.investments.map(i => i.id);
}

// Primeiro mês com aportes ou valores registados nestes investimentos
function firstInvestmentMonth(ids) {
  let m = null;
  for (const x of D.inv_moves) if (ids.includes(x.investment_id) && (!m || ymOf(x.date) < m)) m = ymOf(x.date);
  for (const v of D.valuations) if (ids.includes(v.investment_id) && (!m || v.month < m)) m = v.month;
  return m;
}

/**
 * Séries mensais de "investido" e "valor" (fim de cada mês).
 * Valor = último valor de fim de mês registado + dinheiro posto/retirado desde então
 * (antes de haver algum valor registado, valor = dinheiro investido).
  * Assim não é preciso registar o valor todos os meses: os meses em falta são estimados.
 */
function investmentSeries(filterId = '') {
  const ids = investmentIds(filterId);
  const first = firstInvestmentMonth(ids);
  if (!first) return { months: [], invested: [], value: [] };
  const months = monthRange(first, thisMonth() > first ? thisMonth() : first);
  const invested = months.map(() => 0), value = months.map(() => 0);

  for (const id of ids) {
    const netByMonth = {};
    for (const x of D.inv_moves) if (x.investment_id === id) {
      const m = ymOf(x.date);
      netByMonth[m] = (netByMonth[m] || 0) + (x.move === 'contribution' ? x.amount : -x.amount);
    }
    const valByMonth = {};
    for (const v of D.valuations) if (v.investment_id === id) valByMonth[v.month] = v.value;

    // cum = total investido até ao mês; lastVal = último valor registado; netAtVal = investido nesse mês
    let cum = 0, lastVal = null, netAtVal = 0;
    months.forEach((m, i) => {
      cum += netByMonth[m] || 0;
      if (valByMonth[m] !== undefined) { lastVal = valByMonth[m]; netAtVal = cum; }
      invested[i] += cum;
      value[i] += Math.max(0, lastVal === null ? cum : lastVal + (cum - netAtVal));
    });
  }
  return { months, invested: invested.map(round2), value: value.map(round2) };
}

// Resumo de um investimento hoje: investido, valor, ganho (€ e %) e mês do último valor registado
function investmentSummary(id) {
  const s = investmentSeries(id);
  const n = s.months.length;
  const invested = n ? s.invested[n - 1] : 0;
  const value = n ? s.value[n - 1] : 0;
  const vals = D.valuations.filter(v => v.investment_id === id).sort((a, b) => b.month.localeCompare(a.month));
  const gain = round2(value - invested);
  return { invested, value, gain, gainPct: invested > 0 ? gain / invested : NaN, lastValMonth: vals[0]?.month || null };
}

// O mesmo resumo para a carteira toda
function portfolioSummary() {
  const s = investmentSeries('');
  const n = s.months.length;
  const invested = n ? s.invested[n - 1] : 0, value = n ? s.value[n - 1] : 0;
  const gain = round2(value - invested);
  return { invested, value, gain, gainPct: invested > 0 ? gain / invested : NaN };
}

/**
 * Rentabilidade anual de um investimento (ou da carteira toda, sem id): a taxa por ano que, aplicada a cada aporte
 * e resgate desde a data em que foi feito, dá o último valor registado (a TIR, como a função XIRR do Excel).
 * Ao contrário do ganho em %, conta com o tempo que o dinheiro esteve investido: +10% num ano não é o mesmo que
 * +10% em cinco. NaN sem valores registados, sem aportes, ou com menos de 1 ano entre o primeiro aporte e o último
 * valor (com menos tempo, passar o ganho para "ao ano" dava números exagerados).
 */
function annualReturn(filterId = '') {
  const ids = new Set(investmentIds(filterId));
  // o último mês com um valor registado (na carteira, o mais recente de todos os investimentos)
  const lastMonth = D.valuations.reduce((m, v) => (ids.has(v.investment_id) && v.month > m ? v.month : m), '');
  if (!lastMonth) return NaN;
  const s = investmentSeries(filterId);
  const k = s.months.indexOf(lastMonth);
  if (k < 0) return NaN;
  const end = lastDayOf(lastMonth) < todayISO() ? lastDayOf(lastMonth) : todayISO();
  // aportes saem do bolso (negativos), resgates e o valor no fim entram (positivos)
  const flows = D.inv_moves.filter(x => ids.has(x.investment_id) && ymOf(x.date) <= lastMonth)
    .map(x => ({ date: x.date, amount: x.move === 'contribution' ? -x.amount : x.amount }));
  if (!flows.some(f => f.amount < 0)) return NaN;
  flows.push({ date: end, amount: s.value[k] });
  const start = flows.reduce((m, f) => (f.date < m ? f.date : m), end);
  if (daysBetween(start, end) < 365) return NaN;
  return xirr(flows);
}

// Dias entre duas datas AAAA-MM-DD (em UTC, para a mudança de hora não tirar nem pôr uma hora)
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

/**
 * A taxa anual r em que a soma de cada fluxo [{ date, amount }] a dividir por (1 + r)^(anos desde o primeiro fluxo) dá zero.
 * Procura-a por bissecção entre −99% e +10 000% ao ano (mais lento do que outros métodos, mas converge sempre);
 * NaN se não houver solução nesse intervalo.
 */
function xirr(flows) {
  const t0 = flows.reduce((m, f) => (f.date < m ? f.date : m), flows[0].date);
  const cf = flows.map(f => ({ t: daysBetween(t0, f.date) / 365, a: f.amount }));
  const npv = r => cf.reduce((sum, f) => sum + f.a / Math.pow(1 + r, f.t), 0);
  let lo = -0.99, hi = 100, fLo = npv(lo);
  if (!(fLo * npv(hi) < 0)) return NaN;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2, fMid = npv(mid);
    if (fMid === 0) return mid;
    if (fLo * fMid < 0) hi = mid; else { lo = mid; fLo = fMid; }
  }
  return (lo + hi) / 2;
}

/**
 * Alocação da carteira por tipo de investimento (ETF, PPR, Cripto…): o valor de cada tipo hoje e o peso (share, de 0 a 1) e,
 * se houver alvos (D.alloc_targets: percentagem por tipo; com dois do mesmo tipo, conta o mais recente), o alvo (target, em %)
 * e quanto falta (+) ou sobra (−) nesse tipo para chegar ao alvo com o valor de hoje (diff). Os tipos com alvo e sem
 * investimentos aparecem com valor 0. [{ type, value, share, target, diff }], do maior valor para o menor.
 */
function allocation() {
  const by = Object.create(null), targets = Object.create(null);
  for (const i of D.investments) {
    const v = investmentSummary(i.id).value;
    if (v > 0) by[i.inv_type || 'Outro'] = (by[i.inv_type || 'Outro'] || 0) + v;
  }
  for (const t of D.alloc_targets) if (!targets[t.inv_type] || (t.updated_at || '') > (targets[t.inv_type].updated_at || '')) targets[t.inv_type] = t;
  for (const type of Object.keys(targets)) by[type] ||= 0;
  const total = Object.values(by).reduce((s2, v) => s2 + v, 0);
  return Object.entries(by).map(([type, value]) => {
    const target = targets[type] ? targets[type].pct : null;
    return { type, value: round2(value), share: total > 0 ? value / total : 0, target,
      diff: target === null ? null : round2(total * target / 100 - value) };
  }).sort((a, b) => b.value - a.value || a.type.localeCompare(b.type, 'pt'));
}

// Aportes líquidos (aportes − resgates) em cada mês
function netContributions(months, filterId = '') {
  const ids = new Set(investmentIds(filterId));
  const idx = Object.fromEntries(months.map((m, i) => [m, i]));
  const out = months.map(() => 0);
  for (const x of D.inv_moves) {
    if (!ids.has(x.investment_id)) continue;
    const i = idx[ymOf(x.date)];
    if (i !== undefined) out[i] += x.move === 'contribution' ? x.amount : -x.amount;
  }
  return out.map(round2);
}

/** Dinheiro investido num investimento até ao fim de um mês. */
function investedUpTo(id, ym) {
  let s = 0;
  for (const x of D.inv_moves) if (x.investment_id === id && ymOf(x.date) <= ym) s += x.move === 'contribution' ? x.amount : -x.amount;
  return round2(s);
}

// Valor registado de um investimento num mês / último valor registado antes de um mês
function valuationFor(id, ym) { return D.valuations.find(v => v.investment_id === id && v.month === ym); }
function lastValuationBefore(id, ym) {
  return D.valuations.filter(v => v.investment_id === id && v.month < ym).sort((a, b) => b.month.localeCompare(a.month))[0];
}

// ════════ CRÉDITOS ════════

// Saldo em dívida num mês: o último saldo registado até esse mês, ou o montante inicial
// se ainda não houver nenhum (0 antes de o crédito começar).
function loanBalanceAt(loan, ym) {
  if (ym < ymOf(loan.start_date)) return 0;
  const bs = D.loan_balances.filter(b => b.loan_id === loan.id && b.month <= ym).sort((a, b) => b.month.localeCompare(a.month));
  return bs.length ? bs[0].balance : loan.principal;
}
// Saldo em dívida atual / saldo registado para um mês exato
function loanCurrent(loan) { return loanBalanceAt(loan, thisMonth() > ymOf(loan.start_date) ? thisMonth() : ymOf(loan.start_date)); }
function loanBalanceFor(loanId, ym) { return D.loan_balances.find(b => b.loan_id === loanId && b.month === ym); }

// Saldo em dívida mês a mês, por crédito e no total (para o gráfico)
function loanSeries() {
  if (!D.loans.length) return { months: [], perLoan: [], total: [] };
  const first = D.loans.reduce((m, l) => (ymOf(l.start_date) < m ? ymOf(l.start_date) : m), '9999-12');
  const firstBal = D.loan_balances.reduce((m, b) => (b.month < m ? b.month : m), first);
  const start = firstBal < first ? firstBal : first;
  const months = monthRange(start, thisMonth() > start ? thisMonth() : start);
  const perLoan = sortByName(D.loans).map(l => ({ loan: l, values: months.map(m => loanBalanceAt(l, m)) }));
  const total = months.map((_, i) => round2(perLoan.reduce((s, p) => s + p.values[i], 0)));
  return { months, perLoan, total };
}

/**
 * Meses que faltam para pagar um crédito (0 se já está pago).
 * 1) Se o crédito tem "fim do contrato" (end_date), usa essa data: num crédito de taxa variável o
 *    banco ajusta a prestação a cada revisão da taxa para manter o prazo, por isso é o valor mais fiável.
 * 2) Senão, com prestação (P) e taxa anual conhecidas usa a fórmula da amortização francesa:
 *   n = −ln(1 − r·B/P) / ln(1 + r), com r = taxa mensal e B = saldo em dívida.
 * Sem prestação, usa a descida média do saldo nos últimos 12 registos.
 * Devolve null se não der para estimar.
 */
function loanMonthsLeft(loan) {
  const B = loanCurrent(loan);
  if (B <= 0) return 0;
  if (loan.end_date) return Math.max(0, monthsDiff(thisMonth(), ymOf(loan.end_date)));
  const P = loan.payment, r = (loan.rate || 0) / 1200;
  if (P > 0) {
    if (r === 0) return Math.ceil(B / P);
    if (P > r * B) return Math.ceil(-Math.log(1 - (r * B) / P) / Math.log(1 + r));
    return null; // a prestação nem chega para pagar os juros
  }
  const bs = D.loan_balances.filter(b => b.loan_id === loan.id).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  if (bs.length < 2) return null;
  // as amortizações extraordinárias não contam para o ritmo normal de descida
  const extras = bs.slice(1).reduce((s, b) => s + (b.extra || 0), 0);
  const drop = (bs[0].balance - bs[bs.length - 1].balance - extras) / monthsDiff(bs[0].month, bs[bs.length - 1].month);
  return drop > 0 ? Math.ceil(B / drop) : null;
}

/**
 * Histórico mês a mês de um crédito, a partir dos saldos registados (do mais antigo para o mais recente).
 * Cada linha: { month, before, balance, drop, payment, extra, interest, principal, estimated }
 *   before    saldo em dívida no fim do mês anterior
 *   drop      quanto a dívida baixou no mês (before − balance)
 *   payment   prestação paga · extra = amortização extraordinária
 *   interest  juros do mês = prestação + extra − descida da dívida
 *             (o que pagaste e não abateu à dívida foram juros, e encargos se vierem na prestação)
 *   principal capital amortizado pela prestação = prestação − juros
 * Sem prestação registada, os juros são estimados com a taxa: saldo anterior × TAN / 12 (estimated = true).
 * Se faltar o mês anterior, não dá para saber quanto baixou num só mês: drop e juros ficam null.
 */
function loanHistory(loan) {
  const bs = D.loan_balances.filter(b => b.loan_id === loan.id).sort((a, b) => a.month.localeCompare(b.month));
  const rows = [];
  let prev = null;
  for (const b of bs) {
    const consecutive = prev && monthsDiff(prev.month, b.month) === 1;
    const before = consecutive ? prev.balance : null;
    const payment = b.payment ?? null, extra = b.extra || 0;
    const drop = before !== null ? round2(before - b.balance) : null;
    let interest = null, estimated = false;
    if (drop !== null && payment !== null) interest = round2(payment + extra - drop);
    else if (before !== null && loan.rate) { interest = round2(before * loan.rate / 1200); estimated = true; }
    const principal = interest !== null && payment !== null ? round2(payment - interest)
      : drop !== null ? round2(drop - extra) : null;
    rows.push({ month: b.month, before, balance: b.balance, drop, payment, extra, interest, principal, estimated });
    prev = b;
  }
  return rows;
}

/** Totais do histórico: prestações pagas, juros, capital, amortizações extra (e juros de um ano, se year). */
function loanTotals(rows, year = '') {
  const sum = (key, list = rows) => round2(list.reduce((s, r) => s + (r[key] || 0), 0));
  const inYear = year ? rows.filter(r => r.month.startsWith(year)) : [];
  return { payments: sum('payment'), interest: sum('interest'), principal: sum('principal'), extra: sum('extra'),
           yearInterest: sum('interest', inYear), yearPayments: sum('payment', inYear) };
}

// ════════ SIMULADOR DE AMORTIZAÇÃO ANTECIPADA ════════

// Prestação (capital + juros) que paga `balance` em n meses à taxa mensal r (amortização francesa)
function annuityPayment(balance, r, n) {
  if (n <= 0) return balance;
  return r === 0 ? balance / n : balance * r / (1 - Math.pow(1 + r, -n));
}
// Paga `balance` com prestações `payment` à taxa mensal r, mês a mês (a última é só o que falta):
// devolve quantos meses leva e quanto se paga de juros
function payoff(balance, r, payment) {
  let b = balance, months = 0, interest = 0;
  while (b > 0.005 && months < 1200) {
    const i = b * r;
    interest += i;
    b += i - Math.min(payment, b + i);
    months++;
  }
  return { months, interest: round2(interest) };
}

/**
 * O que acontece se hoje amortizares `amount` € de um crédito, com uma comissão de feePct % sobre o valor
 * amortizado. Contas com a taxa atual (TAN) e o prazo que falta (loanMonthsLeft), só com capital e juros (sem
 * seguros nem outras despesas que venham na prestação). Compara três casos, cada um com { payment, months, interest }:
 *   now        sem amortizar: a prestação que paga o saldo atual no prazo que falta
 *   byPayment  reduzir a prestação (o prazo fica igual)
 *   byTerm     reduzir o prazo (a prestação fica igual)
 * saved = juros que se poupam em relação a now; net = saved − comissão. Se o valor chegar para pagar tudo,
 * paidOff = true (e só há saved e net). Devolve null sem taxa, sem prazo conhecido (sem prestação nem fim do
 * contrato e sem saldos suficientes) ou com o crédito já pago.
 */
function simulateEarlyRepayment(loan, amount, feePct = 0) {
  const balance = loanCurrent(loan), n = loanMonthsLeft(loan);
  if (!(balance > 0) || !n || loan.rate === undefined || loan.rate === null) return null;
  const r = loan.rate / 1200;
  const P = annuityPayment(balance, r, n);
  const now = { payment: round2(P), months: n, interest: payoff(balance, r, P).interest };
  const fee = round2(Math.max(0, amount) * (feePct || 0) / 100);
  const left = round2(balance - amount);
  if (left <= 0) return { balance, now, fee, paidOff: true, saved: now.interest, net: round2(now.interest - fee) };
  const Pa = annuityPayment(left, r, n);
  const byPayment = { payment: round2(Pa), months: n, interest: payoff(left, r, Pa).interest };
  const byTerm = { payment: round2(P), ...payoff(left, r, P) };
  for (const c of [byPayment, byTerm]) { c.saved = round2(now.interest - c.interest); c.net = round2(c.saved - fee); }
  return { balance, now, fee, paidOff: false, byPayment, byTerm };
}

// ════════ IMÓVEIS ════════

// Soma do valor atual de todos os imóveis
function propertiesTotal() { return round2(D.properties.reduce((s, p) => s + p.value, 0)); }

/**
 * Resumo de um imóvel hoje:
 *   gain   valorização = valor atual − preço de compra (null sem preço de compra)
 *   debt   o que ainda falta pagar do crédito associado (0 sem crédito)
 *   equity capital próprio = valor atual − dívida (a parte da casa que já é tua)
 */
function propertySummary(p) {
  const loan = p.loan_id ? findById('loans', p.loan_id) : null;
  const debt = loan ? loanCurrent(loan) : 0;
  const gain = p.purchase_price !== undefined && p.purchase_price !== null ? round2(p.value - p.purchase_price) : null;
  return { loan, debt, gain, gainPct: gain !== null && p.purchase_price > 0 ? gain / p.purchase_price : NaN, equity: round2(p.value - debt) };
}

// ════════ PATRIMÓNIO LÍQUIDO ════════
// O número principal da página inicial: dinheiro nas contas + investimentos + imóveis − dívidas
function netWorth() {
  const accounts = totalAccountsBalance(todayISO());
  const investments = portfolioSummary().value;
  const properties = propertiesTotal();
  const debt = round2(D.loans.reduce((s, l) => s + loanCurrent(l), 0));
  return { accounts, investments, properties, debt, total: round2(accounts + investments + properties - debt) };
}

/**
 * Património líquido no fim de cada mês, para o gráfico da página inicial (e as partes: contas, investimentos,
 * imóveis e créditos). Começa no primeiro mês com movimentos ou investimentos (antes disso não se sabe quanto
 * havia nas contas) e acaba no mês atual, que dá os mesmos números que netWorth().
 */
function netWorthSeries() {
  const now = thisMonth();
  const first = [firstTxMonth(), firstInvestmentMonth(investmentIds(''))].filter(Boolean).sort()[0];
  if (!first || first > now) return { months: [], accounts: [], investments: [], properties: [], debt: [], total: [] };
  const months = monthRange(first, now);

  // contas: saldos iniciais + movimentos de cada mês (os de datas futuras ainda não contam, como em netWorth)
  const today = todayISO(), perMonth = {};
  for (const t of D.transactions) {
    if (t.date <= today) perMonth[ymOf(t.date)] = (perMonth[ymOf(t.date)] || 0) + txEffect(t, '');
  }
  let b = D.accounts.reduce((s, a) => s + a.opening_balance, 0);
  const accounts = months.map(m => (b += perMonth[m] || 0, round2(b)));

  // investimentos: o valor estimado por investmentSeries (0 antes do primeiro aporte ou valor registado)
  const inv = investmentSeries('');
  const invAt = Object.fromEntries(inv.months.map((m, i) => [m, inv.value[i]]));
  const investments = months.map(m => invAt[m] ?? 0);

  const properties = months.map(m => round2(D.properties.reduce((s, p) => s + propertyValueAt(p, m, now), 0)));
  // créditos: no mês atual, o saldo de loanCurrent (como em netWorth)
  const debt = months.map(m => round2(D.loans.reduce((s, l) => s + (m === now ? loanCurrent(l) : loanBalanceAt(l, m)), 0)));
  const total = months.map((_, i) => round2(accounts[i] + investments[i] + properties[i] - debt[i]));
  return { months, accounts, investments, properties, debt, total };
}

/**
 * Valor de um imóvel no fim de um mês (now = mês atual). A app só guarda o valor atual, por isso os meses
 * anteriores são estimados: desde a compra, em linha reta do preço de compra até ao valor atual.
 * Sem data de compra conta sempre com o valor atual; sem preço de compra, com o valor atual desde a compra.
 */
function propertyValueAt(p, ym, now) {
  if (ym >= now || !p.purchase_date) return p.value;
  const bought = ymOf(p.purchase_date);
  if (ym < bought) return 0;
  if (p.purchase_price === undefined || p.purchase_price === null) return p.value;
  return round2(p.purchase_price + (p.value - p.purchase_price) * monthsDiff(bought, ym) / monthsDiff(bought, now));
}

// ════════ METAS DE POUPANÇA ════════
// Uma meta é um valor que se quer juntar (fundo de emergência, entrada da casa…), com ou sem prazo (um mês). Conta de uma
// de duas formas (source):
//   'reserve'  com reservas (D.reservations): partes do saldo de contas ou do valor de investimentos postas de lado para a
//              meta ('reserve') ou tiradas dela ('release'). O dinheiro não sai da conta: só fica a saber-se que tem destino,
//              e várias metas partilham a mesma conta sem contarem o mesmo dinheiro duas vezes.
//   'networth' o património líquido todo (ex.: "chegar aos 100 mil").
// As metas antigas com source 'selected' (contas inteiras, só no primeiro dia) contam como 'reserve'.

/** Quanto está reservado (reservas − o que se tirou) para uma meta e/ou numa conta ou investimento, até uma data. */
function reservedTotal({ goalId = '', sourceId = '', upTo = todayISO() } = {}) {
  let s = 0;
  for (const r of D.reservations) {
    if ((goalId && r.goal_id !== goalId) || (sourceId && r.source_id !== sourceId) || r.date > upTo) continue;
    s += r.move === 'reserve' ? r.amount : -r.amount;
  }
  return round2(s);
}

// Nome de uma conta ou de um investimento (as reservas podem ser feitas nos dois)
function sourceName(id) { return id.startsWith('INV_') ? investmentName(id) : accountName(id); }

/**
 * Contas e investimentos para as reservas: os que já têm dinheiro reservado e, com all, também os outros que não estão
 * arquivados. Cada um com value (saldo ou valor de hoje), reserved (o que as metas lá têm) e free (o que sobra para
 * reservar; negativo se se reservou mais do que lá há, ex.: gastou-se dinheiro que estava reservado).
 */
function reserveSources(all = false) {
  const used = new Set(D.reservations.map(r => r.source_id));
  const keep = x => used.has(x.id) || (all && !x.archived);
  return [
    ...sortByName(D.accounts.filter(keep)).map(a => ({ id: a.id, name: a.name, value: accountBalance(a.id, todayISO()) })),
    ...sortByName(D.investments.filter(keep)).map(i => ({ id: i.id, name: i.name, value: investmentSummary(i.id).value })),
  ].map(x => {
    const reserved = reservedTotal({ sourceId: x.id });
    return { ...x, reserved, free: round2(x.value - reserved) };
  });
}

/**
 * Como está uma meta hoje:
 *   current    quanto já há: o que está reservado para ela (sem as reservas com data futura) ou o património líquido (o
 *              mesmo da página inicial). sources = onde está reservado: [{ id, name, amount }] (só nas metas com reservas)
 *   left       quanto falta (0 se já lá chegou) · ratio = current / target, entre 0 e 1 (para a barra)
 *   rate       o ritmo: quanto se reservou (ou quanto o património subiu) por mês, em média, nos 12 meses completos antes do
 *              atual (o mês atual ainda vai a meio). Começa no primeiro mês com dados se for depois: o que já havia nesse mês
 *              (ex.: o que se reservou ao criar a meta) não conta como ritmo. null sem um mês completo depois desse.
 *              rateMonths = de quantos meses é a média
 *   eta        mês em que lá chega a este ritmo (null se já lá chegou ou se o valor não está a subir; far = mais de 50 anos)
 *   monthsLeft meses até ao prazo, sem contar o atual (de out 2026 a dez 2027 são 14); negativo se o prazo já passou
 *   perMonth   quanto é preciso juntar por mês para chegar a tempo = o que falta / monthsLeft (no mês do prazo, o que falta)
 *   state      'done' (chegou), 'ok' (a este ritmo chega a tempo), 'behind' (não chega, ou ainda não se sabe o ritmo),
 *              'late' (o prazo passou) ou '' (sem prazo)
 *   monthly    reserva mensal planeada (só nas metas com reservas; null sem plano) e monthlySource, de onde sai. Sem ritmo
 *              (ainda não há um mês completo), o eta e o state usam o plano (fromPlan = true).
 *              monthlyDue = há plano, a meta não está atingida e este mês ainda não se reservou nada para ela;
 *              monthlyAmount = o que reservar este mês (o plano, ou o que falta, se for menos)
 */
function goalStatus(goal) {
  const now = thisMonth(), end = addMonths(now, -1);
  const networth = goal.source === 'networth';
  let current, first, valueAt, sources = [];
  if (networth) {
    current = netWorth().total;
    const s = netWorthSeries();
    first = s.months[0];
    valueAt = m => s.total[s.months.indexOf(m)];
  } else {
    current = reservedTotal({ goalId: goal.id });
    const mine = D.reservations.filter(r => r.goal_id === goal.id);
    first = mine.reduce((m, r) => (!m || ymOf(r.date) < m ? ymOf(r.date) : m), null);
    valueAt = m => reservedTotal({ goalId: goal.id, upTo: lastDayOf(m) });
    sources = [...new Set(mine.map(r => r.source_id))]
      .map(id => ({ id, name: sourceName(id), amount: reservedTotal({ goalId: goal.id, sourceId: id }) }))
      .filter(x => x.amount !== 0).sort((a, b) => b.amount - a.amount);
  }
  let rate = null, rateMonths = 0;
  const start = first && [addMonths(end, -12), first].sort().pop();
  if (start && start < end) {
    rateMonths = monthsDiff(start, end);
    rate = round2((valueAt(end) - valueAt(start)) / rateMonths);
  }
  const done = current >= goal.target, left = done ? 0 : round2(goal.target - current);
  const monthly = !networth && goal.monthly > 0 ? goal.monthly : null;
  const fromPlan = rate === null && monthly !== null, pace = fromPlan ? monthly : rate;
  let eta = null, far = false;
  if (!done && pace > 0) {
    const n = Math.ceil(left / pace);
    if (n > 600) far = true; else eta = addMonths(now, n);
  }
  const monthlyDue = monthly !== null && !done
    && !D.reservations.some(r => r.goal_id === goal.id && r.move === 'reserve' && ymOf(r.date) === now);
  const deadline = goal.deadline || null;
  const monthsLeft = deadline ? monthsDiff(now, deadline) : null;
  const perMonth = deadline && !done && monthsLeft >= 0 ? round2(left / Math.max(1, monthsLeft)) : null;
  const state = done ? 'done' : !deadline ? '' : monthsLeft < 0 ? 'late' : eta && eta <= deadline ? 'ok' : 'behind';
  return { id: goal.id, name: goal.name, target: goal.target, deadline, source: networth ? 'networth' : 'reserve', sources,
    current, left, ratio: Math.min(1, Math.max(0, current / goal.target)), done, rate, rateMonths, eta, far, monthsLeft,
    perMonth, state, monthly, monthlySource: monthly !== null ? goal.monthly_source || null : null, fromPlan, monthlyDue,
    monthlyAmount: monthly !== null ? round2(Math.min(monthly, left)) : 0 };
}

/** Todas as metas: primeiro as que faltam, das de prazo mais próximo para as sem prazo, e por fim as atingidas. */
function goalsStatus() {
  return D.goals.map(goalStatus).sort((a, b) => a.done - b.done
    || (a.deadline || '9999-99').localeCompare(b.deadline || '9999-99') || a.name.localeCompare(b.name, 'pt'));
}

// ════════ AVISOS DA PÁGINA INICIAL ════════

/**
 * O que precisa de atenção, para o painel "A ver" da página inicial, dos mais graves para os menos:
 *   - reservou-se numa conta mais do que lá há; uma meta cujo prazo passou ou a que o ritmo já não chega a tempo
 *   - orçamentos deste mês a 80% ou mais
 *   - investimentos ainda com valor e créditos ainda por pagar sem o valor / saldo do mês passado
 *   - reservas mensais das metas por fazer este mês; despesas fixas que subiram de preço (priceRises); tipos de investimento
 *     a mais de 5 pontos percentuais do alvo da alocação (allocation)
 * Cada aviso: { id, level ('bad' | 'warn' | 'info'), text (texto simples, sem HTML), action: { label, type, arg } }.
 * O id muda quando o aviso muda (ex.: inclui o mês), para um aviso dispensado voltar a aparecer quando houver outro igual.
 */
function homeAlerts() {
  const now = thisMonth(), prev = addMonths(now, -1), out = [];
  const add = (id, level, text, label, type, arg = '') => out.push({ id, level, text, action: { label, type, arg } });

  for (const x of reserveSources().filter(x => x.free < 0)) {
    add(`over:${x.id}:${now}`, 'bad', `Em ${x.name} reservaste ${eur(-x.free)} a mais do que lá tens (${eur(x.value)}): tira esse valor de alguma meta.`,
      'Ver metas', 'goals');
  }
  for (const g of goalsStatus()) {
    if (g.state === 'late') {
      add(`late:${g.id}:${now}`, 'bad', `${g.name}: o prazo acabou em ${monthLabel(g.deadline)} e faltam ${eur(g.left)}.`, 'Editar meta', 'goal-edit', g.id);
    } else if (g.state === 'behind' && (g.rate !== null || g.fromPlan)) {
      const pace = g.fromPlan ? `com os ${eurShort(g.monthly)}/mês planeados` : `ao ritmo atual (${eurSignedShort(g.rate)}/mês)`;
      add(`behind:${g.id}:${now}`, 'warn', g.eta
        ? `${g.name}: ${pace} só chegas lá em ${monthLabel(g.eta)}; o prazo é ${monthLabel(g.deadline)}. Precisas de ${eurShort(g.perMonth)}/mês.`
        : `${g.name}: ${pace} não chegas lá; para o prazo de ${monthLabel(g.deadline)} precisas de ${eurShort(g.perMonth)}/mês.`,
        'Editar meta', 'goal-edit', g.id);
    }
    if (g.monthlyDue) {
      if (!g.monthlySource || !(findById('accounts', g.monthlySource) || findById('investments', g.monthlySource))) {
        add(`monthly:${g.id}:${now}`, 'warn', `${g.name}: a conta das reservas mensais foi apagada; escolhe outra.`, 'Editar meta', 'goal-edit', g.id);
      } else {
        add(`monthly:${g.id}:${now}`, 'info', `${g.name}: ainda não reservaste os ${eur(g.monthlyAmount)} deste mês (de ${sourceName(g.monthlySource)}).`,
          `Reservar ${eur(g.monthlyAmount)}`, 'goal-monthly', g.id);
      }
    }
  }

  const tight = budgetStatus(now, now).filter(b => b.state !== 'ok');
  if (tight.length) {
    add(`budget:${now}:${tight.map(b => b.category).join('|')}`, tight.some(b => b.state === 'over') ? 'bad' : 'warn',
      `Orçamentos de ${monthLabel(now)}: ${tight.map(b => b.state === 'over' ? `${b.category} ${eur(-b.left)} acima do limite`
        : `${b.category} a ${Math.round(b.ratio * 100)}%`).join(', ')}.`, 'Ver movimentos', 'mov');
  }

  const invs = D.investments.filter(i => !i.archived && (firstInvestmentMonth([i.id]) || now) < now && investmentSummary(i.id).value > 0)
    .map(i => ({ i, last: investmentSummary(i.id).lastValMonth })).filter(x => !x.last || x.last < prev);
  if (invs.length) {
    add(`inv:${prev}:${invs.map(x => x.i.id).join('|')}`, 'warn', `Investimentos sem o valor de ${monthLabel(prev)}: ${invs.map(x =>
      `${x.i.name} (${x.last ? `último: ${monthLabel(x.last)}` : 'nenhum valor'})`).join(', ')}.`, 'Atualizar mês', 'inv-month');
  }
  const loans = D.loans.filter(l => !l.archived && ymOf(l.start_date) < now && loanCurrent(l) > 0).map(l => ({ l,
    last: D.loan_balances.reduce((m, b) => (b.loan_id === l.id && b.month > m ? b.month : m), '') || null })).filter(x => !x.last || x.last < prev);
  if (loans.length) {
    add(`loan:${prev}:${loans.map(x => x.l.id).join('|')}`, 'warn', `Créditos sem o saldo de ${monthLabel(prev)}: ${loans.map(x =>
      `${x.l.name} (${x.last ? `último: ${monthLabel(x.last)}` : 'nenhum saldo'})`).join(', ')}.`, 'Atualizar mês', 'loan-month');
  }

  const drift = allocation().filter(a => a.target !== null && Math.abs(a.share * 100 - a.target) > 5);
  if (drift.length) {
    add(`alloc:${now}:${drift.map(a => a.type).join('|')}`, 'info', `Alocação dos investimentos fora do alvo: ${drift.map(a =>
      `${a.type} ${Math.round(a.share * 100)}% (alvo ${a.target}%)`).join(', ')}.`, 'Ver investimentos', 'inv');
  }
  for (const r of priceRises()) {
    add(`rise:${r.key}:${r.date}`, 'info', `${r.description}: passou de ${eur(r.from)} para ${eur(r.to)} (${eurSigned(round2(r.to - r.from))}/mês).`,
      'Ver despesas fixas', 'recurring');
  }
  const order = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
