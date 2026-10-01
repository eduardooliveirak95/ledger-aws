// ── calc.js: todos os números que a app mostra são calculados aqui, a partir dos dados em bruto ──
// O backend só guarda e devolve os registos; saldos, ganhos e dívidas são calculados no browser.
// D = { accounts, transactions, investments, inv_moves, valuations, loans, loan_balances, properties }
// é a cópia local de tudo o que veio de GET /data (uma lista por tipo de item).

let D = emptyData();
function emptyData() {
  return { accounts: [], transactions: [], investments: [], inv_moves: [], valuations: [], loans: [], loan_balances: [], properties: [] };
}
// Tipo de item -> nome da lista em D (o mesmo mapa que existe no backend)
const COLLECTION_OF = {
  account: 'accounts', transaction: 'transactions', investment: 'investments', inv_move: 'inv_moves',
  valuation: 'valuations', loan: 'loans', loan_balance: 'loan_balances', property: 'properties',
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

// Movimentos entre os meses from e to, opcionalmente só de uma conta e/ou categoria
function filterTx({ from, to, account = '', category = '' }) {
  return D.transactions.filter(t => {
    const ym = ymOf(t.date);
    if (from && ym < from) return false;
    if (to && ym > to) return false;
    if (account && t.account_id !== account && t.to_account_id !== account) return false;
    if (category && t.category !== category) return false;
    return true;
  });
}

/** Totais de entradas e saídas. As transferências só contam quando se olha para uma conta.
 *  out = gasto real; invested = saídas para poupança (categoria Investimentos, por exemplo);
 *  net = variação do dinheiro (in − out − invested); saved = in − out (o que não foi gasto). */
function flowTotals(txs, account = '') {
  let inn = 0, out = 0, inv = 0;
  for (const t of txs) {
    const e = txEffect(t, account);
    if (e > 0) inn += e;
    else if (e < 0 && isSavingOut(t)) inv -= e;
    else out -= e;
  }
  return { in: round2(inn), out: round2(out), invested: round2(inv), net: round2(inn - out - inv), saved: round2(inn - out) };
}

// Como flowTotals, mas mês a mês (para o gráfico de barras de entradas/saídas)
function monthlyFlows(months, filters) {
  const idx = Object.fromEntries(months.map((m, i) => [m, i]));
  const inn = months.map(() => 0), out = months.map(() => 0), inv = months.map(() => 0);
  for (const t of filterTx({ ...filters, from: months[0], to: months[months.length - 1] })) {
    const i = idx[ymOf(t.date)];
    if (i === undefined) continue;
    const e = txEffect(t, filters.account);
    if (e > 0) inn[i] += e;
    else if (e < 0 && isSavingOut(t)) inv[i] -= e;
    else out[i] -= e;
  }
  return { in: inn.map(round2), out: out.map(round2), invested: inv.map(round2) };
}

/** Totais por categoria, do maior para o menor. As categorias de poupança ficam de fora das despesas. */
function categoryTotals(txs, direction = 'out') {
  const map = {};
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
// O número do topo da app: dinheiro nas contas + investimentos + imóveis − dívidas
function netWorth() {
  const accounts = totalAccountsBalance(todayISO());
  const investments = portfolioSummary().value;
  const properties = propertiesTotal();
  const debt = round2(D.loans.reduce((s, l) => s + loanCurrent(l), 0));
  return { accounts, investments, properties, debt, total: round2(accounts + investments + properties - debt) };
}
