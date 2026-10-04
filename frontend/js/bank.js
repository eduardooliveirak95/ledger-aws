// ── bank.js: importação de extratos bancários em CSV (Caixadirecta e outros bancos) ──
// Em «Consultar saldos e movimentos» (à ordem ou poupança), o ícone do Excel da versão web da
// Caixadirecta descarrega um CSV com ";" (em windows-1252) que começa com umas linhas sobre a conta:
//   Consultar saldos e movimentos à ordem - 04-10-2026
//   Conta ;<número> - EUR - Conta à ordem
//   Data de início ;27-09-2026
//   Data de fim ;04-10-2026
//   Data mov. ;Data valor ;Descrição ;Débito ;Crédito ;Saldo contabilístico ;Saldo disponível ;Categoria ;
//   04-10-2026;04-10-2026;<descrição> ;19,48;;1.329,52;1.324,92;Diversos ;
//   ...
//    ; ; ; ;Saldo contabilístico ;1.329,52 EUR ; ; ;
// Os movimentos vêm do mais recente para o mais antigo e cada valor é conferido com o saldo ao lado.
// Cada movimento passa a um movimento da app: data do movimento, descrição, entrada (Crédito) ou
// saída (Débito) e uma categoria adivinhada (ver categorize); a conta escolhe-se na pré-visualização.

// Datas "dd-mm-aaaa" como aparecem no extrato
const DATE_RE = /^(\d{2})-(\d{2})-(\d{4})$/;
// isoOf: "30-09-2026" -> "2026-09-30" · cents: euros -> cêntimos inteiros (compara sem erros de arredondamento)
const isoOf = s => { const m = String(s).trim().match(DATE_RE); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const cents = n => Math.round(n * 100);
/** Descrição sem espaços nem pontuação, para comparar descrições ("TRF  MBWAY" e "Trf MbWay" são iguais). */
const compactDesc = s => norm(s || '').replace(/[^a-z0-9]/g, '');

/** Posição da linha de cabeçalho dos movimentos (Data mov. / Descrição / Débito…) nas linhas de um CSV, ou -1. */
function cgdHeaderIndex(rows) {
  return rows.slice(0, 20).findIndex(r => {
    const h = r.map(norm);
    return h.some(c => c.startsWith('data mov')) && h.some(c => c.startsWith('descri'))
      && (h.some(c => c.startsWith('debito')) || h.some(c => c.startsWith('montante')));
  });
}

/**
 * Texto de um CSV da Caixadirecta → { bank, number, product, savings, from, to, rows, opening, closing, warnings }.
 * rows vêm do mais antigo para o mais recente: { date, description, cgdCategory, amount (com sinal), balance (depois dele) }.
 * Devolve null se o ficheiro não for um extrato da Caixadirecta (é então tratado como um CSV da app).
 */
function parseCgdCsv(text) {
  const rows = parseCSV(text, ';');
  const hi = cgdHeaderIndex(rows);
  if (hi < 0) return null;
  // Linhas de cima: "Conta ;<número> - EUR - <produto>", "Data de início ;dd-mm-aaaa"...
  const top = rows.slice(0, hi);
  const after = re => ((top.find(r => re.test(norm(r[0]))) || [])[1] || '').trim();
  const m = after(/^conta$/).match(/(\d{6,})\s*-\s*[A-Z]{3}\s*-\s*(.+)$/);
  if (!m) throw new Error('Encontrei um CSV de movimentos da Caixadirecta, mas sem o número da conta');
  const number = m[1], product = m[2].trim();
  const savings = /poupan/.test(norm(top[0]?.[0])) || /poupan|objetivo|prazo/.test(norm(product));

  // Colunas pelo nome (a conta poupança pode não ter todas). "Montante" seria um valor já com sinal.
  const h = rows[hi].map(norm);
  const col = (...names) => h.findIndex(c => names.some(n => c.startsWith(n)));
  const iDate = col('data mov'), iDesc = col('descri'), iDeb = col('debito'), iCred = col('credito'),
        iAmt = col('montante'), iBal = col('saldo contab') >= 0 ? col('saldo contab') : col('saldo'), iCat = col('categoria');
  // o saldo depois de cada movimento é preciso para conferir os valores e saber o saldo inicial
  if (iBal < 0) throw new Error('O extrato da Caixadirecta não tem a coluna do saldo');
  const money = s => { const v = parseNum(s); return isNaN(v) ? null : v; };

  const raw = []; // do mais recente para o mais antigo, como vem no ficheiro
  for (const r of rows.slice(hi + 1)) {
    const date = isoOf(r[iDate] || '');
    if (!date) continue; // linha final com o saldo, linhas vazias
    const debit = iDeb >= 0 ? money(r[iDeb]) : null, credit = iCred >= 0 ? money(r[iCred]) : null;
    const amount = iAmt >= 0 ? money(r[iAmt])
      : debit !== null || credit !== null ? round2(Math.abs(credit || 0) - Math.abs(debit || 0)) : null;
    raw.push({ date, description: (r[iDesc] || '').replace(/\s+/g, ' ').trim(), cgdCategory: iCat >= 0 ? (r[iCat] || '').trim() : '',
      amount, balance: iBal >= 0 ? money(r[iBal]) : null });
  }

  // Confere cada valor com a diferença para o saldo do movimento anterior (a linha de baixo).
  // Sem valor, usa essa diferença; se não baterem, fica um aviso para o utilizador.
  const warnings = [];
  raw.forEach((r, i) => {
    const older = raw[i + 1];
    if (older && r.balance !== null && older.balance !== null) {
      const diff = round2(r.balance - older.balance);
      if (r.amount === null) r.amount = diff;
      else if (cents(diff) !== cents(r.amount)) warnings.push(`${dateLabel(r.date)} ${r.description}: o valor (${eurSigned(r.amount)}) não bate com a diferença de saldos (${eurSigned(diff)})`);
    }
    if (r.amount === null) warnings.push(`${dateLabel(r.date)} ${r.description}: sem valor`);
  });
  const moves = raw.filter(r => r.amount).reverse();
  if (!moves.length) throw new Error(`Não encontrei movimentos no ficheiro da conta ${number}`);
  const oldest = moves[0];
  return {
    bank: 'CGD', number, product, savings,
    from: isoOf(after(/^data de in/)) || oldest.date, to: isoOf(after(/^data de fim/)) || moves[moves.length - 1].date,
    rows: moves, opening: round2((oldest.balance ?? 0) - oldest.amount), closing: moves[moves.length - 1].balance, warnings,
  };
}

// ── outros bancos: CSV genérico ──
// Para extratos de outros bancos, parecidos com o da Caixadirecta: umas linhas de título (opcionais),
// uma linha de cabeçalho e uma linha por movimento, com a data, a descrição e o valor (numa coluna
// com sinal, ou em Débito e Crédito) e, se houver, o saldo depois do movimento. As colunas são
// reconhecidas pelos nomes habituais, em português e em inglês (Revolut, N26...); na pré-visualização
// podem ser corrigidas, e a escolha fica guardada para esse formato de ficheiro (bank_format na API).

// Nomes de coluna habituais (sem acentos, em minúsculas), por ordem de preferência.
// Um nome serve se for igual ao da coluna ou se a coluna começar por ele ("descricao do movimento").
const BANK_COLUMNS = {
  date: ['data mov', 'data do mov', 'data lanc', 'data de lanc', 'data da oper', 'data oper', 'data trans', 'data contab',
         'booking date', 'transaction date', 'completed date', 'started date', 'date', 'data'],
  debit: ['debito', 'debit', 'saida', 'paid out', 'money out', 'levantamento'],
  credit: ['credito', 'credit', 'entrada', 'paid in', 'money in', 'deposito'],
  balance: ['saldo contab', 'saldo apos', 'saldo final', 'saldo atual', 'running balance', 'balance', 'saldo'],
  amount: ['montante', 'valor', 'amount', 'importancia', 'quantia'],
  desc: ['descricao', 'descritivo', 'description', 'detalhe', 'movimento', 'payee', 'merchant', 'beneficiario',
         'counterparty', 'contraparte', 'referencia', 'reference', 'payment reference', 'nome', 'texto', 'observac', 'narrative'],
};
// As colunas que se podem escolher na pré-visualização (as outras são só reconhecidas automaticamente)
const BANK_MAPPED = ['date', 'desc', 'amount', 'debit', 'credit', 'balance'];

/** Colunas de um cabeçalho: { date, desc, amount, debit, credit, balance, sign, fee, state, currency } (-1 = não há). */
function guessBankColumns(header) {
  const h = header.map(c => norm(c).replace(/\s+/g, ' '));
  const used = new Set();
  const take = (names, exact = false) => {
    for (const n of names) {
      const i = h.findIndex((c, j) => !used.has(j) && c && (c === n || (!exact && c.startsWith(n))));
      if (i >= 0) { used.add(i); return i; }
    }
    return -1;
  };
  // uma coluna "D/C" ou "Débito/Crédito" é o sinal, não o débito: fica reservada primeiro
  const sign = take(['d/c', 'debito/credito', 'credito/debito', 'natureza', 'sinal'], true);
  const cols = {};
  for (const role of ['date', 'debit', 'credit', 'balance', 'amount', 'desc']) cols[role] = take(BANK_COLUMNS[role]);
  cols.sign = sign >= 0 ? sign : take(['tipo de movimento', 'tipo', 'type'], true); // só conta se os valores forem D/C
  cols.fee = take(['fee'], true);                       // comissão à parte (Revolut)
  cols.state = take(['state', 'estado', 'status'], true); // pendente / anulado...
  cols.currency = take(['moeda', 'currency', 'divisa'], true);
  return cols;
}

/** Data num extrato: dd-mm-aaaa, dd/mm/aaaa, dd.mm.aaaa, dd/mm/aa, aaaa-mm-dd ou aaaa/mm/dd (com ou sem hora). */
function bankDate(s) {
  const t = String(s ?? '').trim().split(/[ T]/)[0];
  let m;
  if ((m = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/))) return parseDateFlexible(`${m[1]}-${m[2]}-${m[3]}`);
  if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/))) return parseDateFlexible(`${m[1]}/${m[2]}/20${m[3]}`);
  return parseDateFlexible(t);
}

/** Valor num extrato: "1.234,56", "-12.50", "12,50 EUR", "€ 3,20", "(5,00)" ou "5,00-" (negativos). null se não houver. */
function bankMoney(s) {
  let t = String(s ?? '').trim().replace(/[−–]/g, '-');
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || /-$/.test(t);
  t = t.replace(/[^\d,.\-+]/g, '').replace(/-$/, '');
  if (!/\d/.test(t)) return null;
  const v = parseNum(t);
  return isNaN(v) ? null : neg ? -Math.abs(v) : v;
}

/**
 * Procura num CSV de um banco a linha de cabeçalho (nas primeiras 30) com data e valor, e as colunas.
 * Experimenta os separadores ; , e tab e fica com o que der mais colunas.
 * Devolve { rows, hi (posição do cabeçalho), header, cols, signature, number (conta/IBAN, se aparecer em cima) } ou null.
 */
function genericBankLayout(text) {
  let best = null;
  for (const delim of [';', ',', '\t']) {
    const rows = parseCSV(text, delim);
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      if (rows[i].filter(c => c.trim()).length < 3) continue;
      const cols = guessBankColumns(rows[i]);
      if (cols.date < 0 || (cols.amount < 0 && cols.debit < 0 && cols.credit < 0)) continue;
      if (!rows.slice(i + 1).some(r => bankDate(r[cols.date]))) continue; // tem de haver movimentos por baixo
      if (!best || rows[i].length > best.header.length) best = { rows, hi: i, header: rows[i], cols };
      break;
    }
  }
  if (!best) return null;
  // sem coluna de descrição reconhecida: a coluna de texto mais comprida que ainda não tem papel
  if (best.cols.desc < 0) {
    const taken = new Set(Object.values(best.cols));
    const data = best.rows.slice(best.hi + 1, best.hi + 51);
    let top = 0;
    best.header.forEach((_, j) => {
      if (taken.has(j)) return;
      const texts = data.map(r => (r[j] || '').trim()).filter(c => c && bankMoney(c) === null && !bankDate(c));
      const avg = texts.reduce((n, c) => n + c.length, 0) / Math.max(data.length, 1);
      if (avg > top) { top = avg; best.cols.desc = j; }
    });
  }
  best.signature = best.header.map(c => norm(c)).join('|').slice(0, 500);
  // número da conta ou IBAN nas linhas de cima (para juntar ficheiros da mesma conta e reconhecê-la)
  for (const cell of best.rows.slice(0, best.hi).flat()) {
    const m = cell.match(/\b[A-Z]{2}\d{2}(?: ?\d{4}){4,7}(?: ?\d{1,4})?\b/) || cell.match(/\b\d{9,}\b/);
    if (m) { best.number = m[0].replace(/ /g, ''); break; }
  }
  return best;
}

/**
 * Extrato de outro banco → o mesmo formato do parseCgdCsv, com as colunas escolhidas (cols) e o nome
 * da conta (name). Os valores vêm do Débito/Crédito ou da coluna com sinal (com uma coluna D/C, se houver);
 * linhas pendentes ou anuladas ficam de fora. Os saldos só se usam se baterem com os valores.
 */
function buildGenericStatement(layout, cols, name) {
  if (cols.date < 0) throw new Error('Escolhe a coluna da data');
  if (cols.amount < 0 && cols.debit < 0 && cols.credit < 0) throw new Error('Escolhe a coluna do valor (ou as do débito e do crédito)');
  const cell = (r, i) => (i >= 0 ? r[i] ?? '' : '');
  const data = layout.rows.slice(layout.hi + 1).filter(r => bankDate(cell(r, cols.date)));
  const signOf = v => {
    const n = norm(v);
    return ['d', 'db', 'deb', 'debito', 'debit', '-', 'saida'].includes(n) ? -1 : ['c', 'cr', 'cred', 'credito', 'credit', '+', 'entrada'].includes(n) ? 1 : 0;
  };
  const useSign = cols.sign >= 0 && data.length && data.every(r => signOf(cell(r, cols.sign)) !== 0);
  const warnings = [], currencies = new Set();
  let raw = [];
  for (const r of data) {
    if (cols.state >= 0 && /pend|revert|declin|fail|cancel|anulad|recusad/.test(norm(cell(r, cols.state)))) continue;
    const debit = bankMoney(cell(r, cols.debit)), credit = bankMoney(cell(r, cols.credit));
    let amount = debit !== null || credit !== null ? round2(Math.abs(credit || 0) - Math.abs(debit || 0)) : bankMoney(cell(r, cols.amount));
    if (amount !== null && useSign && debit === null && credit === null) amount = Math.abs(amount) * signOf(cell(r, cols.sign));
    if (amount !== null && cols.fee >= 0) amount = round2(amount - Math.abs(bankMoney(cell(r, cols.fee)) || 0));
    const cur = cell(r, cols.currency).trim().toUpperCase();
    if (cur && !['EUR', '€'].includes(cur)) currencies.add(cur);
    raw.push({ date: bankDate(cell(r, cols.date)), description: cell(r, cols.desc).replace(/\s+/g, ' ').trim(), cgdCategory: '',
      amount, balance: cols.balance >= 0 ? bankMoney(cell(r, cols.balance)) : null });
  }
  // do mais antigo para o mais recente (muitos bancos põem o mais recente em cima)
  if (raw.length > 1 && raw[0].date > raw[raw.length - 1].date) raw.reverse();
  // saldos: só se todas as linhas tiverem e se baterem com os valores (o "saldo disponível" muitas vezes não bate)
  if (raw.some(r => r.balance === null)) raw.forEach(r => { r.balance = null; });
  let checks = 0, wrong = [];
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].balance === null) break;
    const diff = round2(raw[i].balance - raw[i - 1].balance);
    checks++;
    if (raw[i].amount === null) raw[i].amount = diff;
    else if (cents(diff) !== cents(raw[i].amount)) wrong.push([raw[i], diff]);
  }
  if (checks && wrong.length > Math.max(1, checks * 0.1)) {
    raw.forEach(r => { r.balance = null; });
    warnings.push('Os saldos do ficheiro não batem com os valores (talvez seja o saldo disponível): não foram usados');
  } else {
    for (const [r, diff] of wrong) warnings.push(`${dateLabel(r.date)} ${r.description}: o valor (${eurSigned(r.amount)}) não bate com a diferença de saldos (${eurSigned(diff)})`);
  }
  for (const r of raw.filter(r => r.amount === null)) warnings.push(`${dateLabel(r.date)} ${r.description}: sem valor`);
  if (currencies.size) warnings.push(`Há movimentos em ${[...currencies].join(', ')}: os valores foram importados como estão, sem conversão para euros`);
  raw = raw.filter(r => r.amount);
  if (!raw.length) throw new Error('Não encontrei movimentos com data e valor nestas colunas');
  const first = raw[0], last = raw[raw.length - 1];
  return {
    bank: 'outro', number: layout.number || 'csv:' + norm(name), shownNumber: layout.number || '', product: name, accountName: name,
    savings: /poupan|saving/.test(norm(name)), from: first.date, to: last.date, rows: raw,
    opening: first.balance === null ? null : round2(first.balance - first.amount), closing: last.balance, warnings, signature: layout.signature,
  };
}

// ── categorias ──
// Regras para adivinhar a categoria pela descrição. Ganha a primeira que bater certo.
// São testadas na descrição sem espaços (ver compactDesc), em minúsculas e sem acentos.
// Cada regra é [expressão regular ou função(descrição, valor), categoria].
// Só palavras genéricas e marcas nacionais (o repositório é público: nada de lojas ou serviços que
// digam onde alguém costuma ir). O resto aprende-se: mudar a categoria de um movimento faz com que
// os próximos com a mesma descrição a sigam (ver learnedCategories).
const BANK_RULES = {
  out: [
    [/amortiza/, 'Amortizações'],                          // amortizações de crédito: poupança, não gasto
    [/cobrancaprestacao|prestacaohab|pagprestacao/, 'Habitação'],
    [/comissao|manutconta|impostodeselo|impselo|despesasmanut/, 'Comissões bancárias'],
    [/^atm|levantamento/, 'Levantamentos'],
    [/^edp|goldenergy|endesa|iberdrola|galpenergia|smas|aguasde/, 'Água / Luz / Gás'],
    [/cepsa|galp|repsol|^prio|^bp|shell|combustiv/, 'Combustível'],
    [/nowo|^meo|vodafone|^nos|digimobil/, 'Telecomunicações'],
    [/supermercado|hipermercado|continente|pingodoce|lidl|minipreco|intermarche|aldi|mercadona|auchan|^spar/, 'Supermercado'],
    [/^a\d{1,2}$|viaverde|brisa|ascendi|portagem|metro|comboio|autocarro|^bolt|^uber(?!eats)|taxi|estaciona/, 'Transportes'],
    [/restaur|burger|tasca|pizz|sushi|mcdonald|^kfc|glovo|ubereats|pastelaria|padaria|cafe|snack|churrasq|kebab|grill/, 'Restauração'],
    [/farmacia|clinica|hospital|^cuf|luzsaude|dentar|medic/, 'Saúde'],
    [/spotify|netflix|disney|hbomax|youtube|apple|icloud|googleplay|amazonprime|primevideo/, 'Subscrições'],
    [/udemy|coursera|escola|colegio|universidade|faculdade|propina/, 'Educação'],
    [/steam|playstation|nintendo|xbox|cinema|ticketline|fitness|ginasio/, 'Lazer'],
    [/fidelidade|seguro|tranquilidade|allianz|ageas|zurich|generali/, 'Seguros'],
    [/mbway|transfer|^trf|^tfi/, 'Transferências out'],
  ],
  in: [
    [/vencimento|ordenado|salario/, 'Salário'],
    [/juros/, 'Juros / Dividendos'],
    [/reembolso|devolucao|estorno/, 'Reembolsos'],
    [/mbway|transfer|^trf|^tfi/, 'Transferências in'],
  ],
};
// Categorias da própria CGD que também servem de pista
const CGD_CATEGORY = { seguros: 'Seguros', levantamentos: 'Levantamentos' };

/**
 * "Aprende" com o utilizador: para cada descrição de banco, a categoria que lhe deste da última vez.
 * Assim, se mudares um movimento de «Outros» para «Lazer», os próximos iguais seguem essa escolha.
 */
function learnedCategories() {
  const map = new Map();
  const txs = [...D.transactions].filter(t => t.direction !== 'transfer' && t.description && !['Outros', 'Transferência'].includes(t.category))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const t of txs) map.set(t.direction + '|' + compactDesc(t.description), t.category);
  return map;
}

// Categoria de um movimento importado: 1) a aprendida, 2) as regras BANK_RULES, 3) a da CGD, 4) «Outros»
function categorize(row, learned) {
  const dir = row.amount > 0 ? 'in' : 'out';
  const d = compactDesc(row.description);
  const known = learned.get(dir + '|' + d);
  if (known) return known;
  for (const [test, cat] of BANK_RULES[dir]) {
    if (typeof test === 'function' ? test(d, Math.abs(row.amount)) : test.test(d)) return cat;
  }
  return (dir === 'out' && CGD_CATEGORY[compactDesc(row.cgdCategory)]) || 'Outros';
}

// A descrição indica uma transferência?
const isTransferDesc = s => /^transfer/.test(compactDesc(s));

// ── plano de importação ──
// Nome sugerido para a conta na app, a partir do produto (ex.: "CGD à ordem")
// (os extratos de outros bancos trazem o nome escolhido na pré-visualização em accountName)
const bankAccountName = st => st.accountName || 'CGD ' + st.product.replace(/^conta\s+/i, '').replace(/^à\s+/i, 'à ');

/**
 * Extratos lidos → plano para o runBankImport (nada é gravado aqui: é só a pré-visualização).
  * choice: { [número da conta]: accountId | 'new' (criar conta) | 'skip' (não importar) },
 * fixOpening: { [número]: bool } acertar o saldo inicial. Quando faltam, usam-se valores por omissão.
  * O plano tem: contas (accounts), movimentos novos (items), alterações a existentes (updates)
  * e o número de repetidos ignorados (skipped).
 */
function planBankImport(statements, choice = {}, fixOpening = {}) {
  const plan = { format: 'bank', statements, accounts: [], items: [], updates: [], skipped: 0, errors: [] };
  const learned = learnedCategories();

  // uma entrada por conta bancária (vários ficheiros da mesma conta são juntos)
  const byNumber = new Map();
  for (const st of statements) {
    if (!byNumber.has(st.number)) byNumber.set(st.number, { number: st.number, shown: st.shownNumber ?? st.number, product: st.product,
      accountName: st.accountName, savings: st.savings, parts: [], warnings: [] });
    const acc = byNumber.get(st.number);
    acc.parts.push(st.rows);
    acc.warnings.push(...st.warnings);
  }
  for (const acc of byNumber.values()) {
    acc.noBalance = acc.parts.some(rows => rows.some(r => r.balance === null || r.balance === undefined));
    if (!acc.noBalance) {
      // o mesmo movimento em dois ficheiros sobrepostos tem a mesma data, valor e saldo depois dele: fica só um
      const seen = new Set();
      acc.rows = acc.parts.flat().filter(r => { const k = `${r.date}|${cents(r.amount)}|${cents(r.balance)}`; return seen.has(k) ? false : seen.add(k); });
    } else {
      // sem saldos, dois movimentos iguais no mesmo dia (dois cafés) só se distinguem pela quantidade:
      // fica, para cada data + valor + descrição, o ficheiro que tiver mais (ficheiros sobrepostos não duplicam)
      const best = new Map();
      for (const rows of acc.parts) {
        const mine = new Map();
        for (const r of rows) {
          const k = `${r.date}|${cents(r.amount)}|${compactDesc(r.description)}`;
          if (!mine.has(k)) mine.set(k, []);
          mine.get(k).push(r);
        }
        for (const [k, list] of mine) if (!best.has(k) || best.get(k).length < list.length) best.set(k, list);
      }
      acc.rows = [...best.values()].flat();
    }
    acc.rows.sort((a, b) => a.date.localeCompare(b.date));
    acc.from = acc.rows[0].date; acc.to = acc.rows[acc.rows.length - 1].date;
    if (acc.noBalance) {
      acc.opening = acc.closing = null; // sem saldos não se sabe o saldo inicial nem o final
    } else {
      // movimento mais antigo: aquele cujo saldo "antes" não é o saldo "depois" de outro do mesmo dia
      // (dá o saldo inicial; o mesmo raciocínio ao contrário dá o saldo final)
      const firstDay = acc.rows.filter(r => r.date === acc.from);
      const after = new Set(firstDay.map(r => cents(r.balance)));
      const oldest = firstDay.find(r => !after.has(cents(r.balance - r.amount))) || firstDay[0];
      acc.opening = round2(oldest.balance - oldest.amount);
      const lastDay = acc.rows.filter(r => r.date === acc.to);
      const before = new Set(lastDay.map(r => cents(r.balance - r.amount)));
      acc.closing = (lastDay.find(r => !before.has(cents(r.balance))) || lastDay[lastDay.length - 1]).balance;
    }

    // Conta da app a usar: a escolhida, ou a que tiver o nome sugerido, ou criar uma nova
    acc.defaultName = bankAccountName(acc);
    const byName = D.accounts.find(a => norm(a.name) === norm(acc.defaultName));
    acc.choice = choice[acc.number] || (byName ? byName.id : 'new');
    acc.key = acc.choice === 'new' ? 'new:' + acc.defaultName : acc.choice;
    // Para uma conta existente, compara o saldo da app com o do banco no dia antes do extrato;
    // se forem diferentes, propõe acertar o saldo inicial da conta.
    if (acc.choice !== 'new' && acc.choice !== 'skip' && acc.opening !== null) {
      const a = findById('accounts', acc.choice);
      const dayBefore = addDays(acc.from, -1);
      acc.appOpening = a && a.opening_date > dayBefore && !D.transactions.some(t => t.date <= dayBefore && (t.account_id === a.id || t.to_account_id === a.id))
        ? a.opening_balance : round2(accountBalance(acc.choice, dayBefore));
      acc.diff = round2(acc.opening - acc.appOpening);
      acc.fixOpening = fixOpening[acc.number] ?? true;
      if (acc.diff && acc.fixOpening && a) {
        plan.updates.push({ ...a, kind: 'account', opening_balance: round2(a.opening_balance + acc.diff),
          opening_date: a.opening_date < acc.from ? a.opening_date : acc.from });
      }
    }
    plan.accounts.push(acc);
  }
  const active = plan.accounts.filter(a => a.choice !== 'skip');

  // o que já existe na app, por conta e dia: { 'data|conta|cêntimos': quantidade }
  // (conta-se quantos há para que dois movimentos iguais no mesmo dia não se confundam)
  const existing = new Map();
  const bump = k => existing.set(k, (existing.get(k) || 0) + 1);
  for (const t of D.transactions) {
    if (t.direction === 'in') bump(`${t.date}|${t.account_id}|${cents(t.amount)}`);
    else if (t.direction === 'out') bump(`${t.date}|${t.account_id}|${cents(-t.amount)}`);
    else { bump(`${t.date}|${t.account_id}|${cents(-t.amount)}`); bump(`${t.date}|${t.to_account_id}|${cents(t.amount)}`); }
  }
  // take: consome um existente (true se havia) · has: ainda há algum por consumir?
  const take = k => { const n = existing.get(k) || 0; if (!n) return false; existing.set(k, n - 1); return true; };
  const has = k => (existing.get(k) || 0) > 0;

  // transferências entre duas das contas importadas (mesmo dia, mesmo valor, sinais contrários)
  const queue = active.flatMap(acc => acc.rows.map(r => ({ ...r, acc })));
  const pairOf = new Map();
  for (const out of queue.filter(r => r.amount < 0 && isTransferDesc(r.description))) {
    const inn = queue.find(r => r.amount === -out.amount && r.date === out.date && r.acc !== out.acc && !pairOf.has(r) && isTransferDesc(r.description));
    if (inn) { pairOf.set(out, inn); pairOf.set(inn, out); }
  }
  // …ou com um movimento importado antes da outra conta, ainda guardado como entrada/saída simples
  const usedExisting = new Set();
  const plainCounterpart = (r, accId) => D.transactions.find(t => !usedExisting.has(t.id) && t.date === r.date && t.account_id !== accId
    && t.direction === (r.amount < 0 ? 'in' : 'out') && cents(t.amount) === cents(Math.abs(r.amount)) && isTransferDesc(t.description));

  // Decide, movimento a movimento, se é repetido (ignora), transferência, atualização ou novo
  for (const r of queue.sort((a, b) => a.date.localeCompare(b.date))) {
    const accKey = r.acc.key, accRef = r.acc.choice === 'new' ? { _acc: r.acc.defaultName } : { account_id: r.acc.choice };
    const mine = `${r.date}|${accKey}|${cents(r.amount)}`;
    const pair = pairOf.get(r);
    if (pair) {
      if (r.amount > 0) continue; // tratado do lado da saída
      const theirs = `${r.date}|${pair.acc.key}|${cents(pair.amount)}`;
      if (has(mine) && has(theirs)) { take(mine); take(theirs); plan.skipped++; continue; }
      const from = r.acc.choice === 'new' ? { _acc: r.acc.defaultName } : { account_id: r.acc.choice };
      const to = pair.acc.choice === 'new' ? { _to: pair.acc.defaultName } : { to_account_id: pair.acc.choice };
      // um dos lados já está guardado como movimento simples: transforma-o na transferência
      const saved = [[r, pair.acc], [pair, r.acc]].map(([x, other]) => other.choice !== 'new' && D.transactions.find(t => !usedExisting.has(t.id)
        && t.date === x.date && t.account_id === other.choice && t.direction === (x.amount < 0 ? 'in' : 'out') && cents(t.amount) === cents(Math.abs(x.amount))))
        .find(Boolean);
      if (saved && !from._acc && !to._to) {
        usedExisting.add(saved.id); take(mine); take(theirs);
        plan.updates.push({ kind: 'transaction', id: saved.id, date: r.date, account_id: from.account_id, to_account_id: to.to_account_id,
          direction: 'transfer', amount: Math.abs(r.amount), category: 'Transferência', description: saved.description || r.description, approx: false });
        continue;
      }
      plan.items.push({ kind: 'transaction', date: r.date, ...from, ...to, direction: 'transfer', amount: Math.abs(r.amount),
        category: 'Transferência', description: r.description, approx: false });
      continue;
    }
    if (take(mine)) { plan.skipped++; continue; }
    if (isTransferDesc(r.description) && r.acc.choice !== 'new') {
      const t = plainCounterpart(r, r.acc.choice);
      if (t) {
        usedExisting.add(t.id);
        const [from, to] = r.amount < 0 ? [r.acc.choice, t.account_id] : [t.account_id, r.acc.choice];
        plan.updates.push({ kind: 'transaction', id: t.id, date: t.date, account_id: from, to_account_id: to, direction: 'transfer',
          amount: t.amount, category: 'Transferência', description: t.description, approx: false });
        continue;
      }
    }
    plan.items.push({ kind: 'transaction', date: r.date, ...accRef, direction: r.amount > 0 ? 'in' : 'out',
      amount: Math.abs(r.amount), category: categorize(r, learned), description: r.description, approx: false });
  }
  return plan;
}

// Executa o plano: cria as contas novas, liga os movimentos a essas contas e grava tudo na API.
// Devolve contagens para a mensagem final (gravados, atualizados, ignorados, contas criadas).
async function runBankImport(plan, onProgress) {
  const news = plan.accounts.filter(a => a.choice === 'new');
  if (news.length) {
    applyChanges(await api.save(news.map(a => ({ kind: 'account', name: a.defaultName, acc_type: a.savings ? 'Poupança' : 'Conta à ordem',
      opening_balance: a.opening ?? 0, opening_date: a.from }))));
  }
  const accId = name => D.accounts.find(a => norm(a.name) === norm(name))?.id;
  // colunas escolhidas para cada formato de outro banco (e a conta da app), para a próxima vez
  const formats = (plan.formats || []).map(f => {
    const acc = plan.accounts.find(a => a.number === f.number);
    const account = !acc || acc.choice === 'skip' ? null : acc.choice === 'new' ? accId(acc.defaultName) : acc.choice;
    return { kind: 'bank_format', id: f.id, name: f.name, signature: f.signature, columns: f.columns, ...(account ? { account_id: account } : {}) };
  });
  const items = plan.items.map(raw => {
    const it = { ...raw };
    if (it._acc) it.account_id = accId(it._acc);
    if (it._to) it.to_account_id = accId(it._to);
    delete it._acc; delete it._to;
    return it;
  });
  const res = await api.save([...plan.updates, ...formats, ...items], [], onProgress);
  applyChanges(res);
  return { saved: items.length, updated: plan.updates.filter(u => u.kind === 'transaction').length, skipped: plan.skipped, parents: news.length };
}

/** Resumo em HTML para a janela de importação: contas, saldos, avisos e totais por categoria. */
function bankPreviewHTML(plan) {
  const accOpts = acc => [
    `<option value="new" ${acc.choice === 'new' ? 'selected' : ''}>Criar «${esc(acc.defaultName)}»</option>`,
    ...sortByName(D.accounts).map(a => `<option value="${esc(a.id)}" ${acc.choice === a.id ? 'selected' : ''}>${esc(a.name)}</option>`),
    `<option value="skip" ${acc.choice === 'skip' ? 'selected' : ''}>Não importar</option>`,
  ].join('');
  const accounts = plan.accounts.map(acc => `
    <div style="margin-bottom:10px">
      <b>${esc(acc.product)}</b>${acc.shown ? ` · ${esc(acc.shown)}` : ''} · ${dateLabel(acc.from)} a ${dateLabel(acc.to)} · ${acc.rows.length} movimentos<br>
      <div class="field" style="margin:6px 0;max-width:320px"><label>Conta na app</label><select data-bank-acc="${esc(acc.number)}">${accOpts(acc)}</select></div>
      ${acc.choice === 'skip' ? '' : acc.opening === null
        ? (acc.choice === 'new' ? 'O ficheiro não tem saldos: a conta nova começa com saldo inicial 0 (podes acertá-lo depois em ✎).'
          : 'O ficheiro não tem saldos: não dá para conferir o saldo da conta com o do banco.')
        : acc.choice === 'new' ? `Saldo inicial: <b>${eur(acc.opening)}</b> a ${dateLabel(acc.from)}, saldo no fim: ${eur(acc.closing)}`
        : acc.diff
        ? `<label class="check"><input type="checkbox" data-bank-fix="${esc(acc.number)}" ${acc.fixOpening ? 'checked' : ''}>
           Acertar o saldo: a app tem ${eur(acc.appOpening)} antes de ${dateLabel(acc.from)}, o banco ${eur(acc.opening)} (${eurSigned(acc.diff)})</label>`
        : `Saldo antes de ${dateLabel(acc.from)} bate com o banco (${eur(acc.opening)}) ✓`}
      ${acc.warnings.length ? `<div class="err" style="margin-top:4px">${acc.warnings.slice(0, 5).map(esc).join('<br>')}</div>` : ''}
    </div>`).join('');

  const tx = plan.items;
  const transfers = tx.filter(t => t.direction === 'transfer').length + plan.updates.filter(u => u.kind === 'transaction').length;
  const cats = {};
  for (const t of tx.filter(t => t.direction === 'out')) (cats[t.category] = cats[t.category] || { n: 0, v: 0 }, cats[t.category].n++, cats[t.category].v += t.amount);
  const other = {};
  for (const t of tx.filter(t => t.category === 'Outros')) other[t.description] = (other[t.description] || 0) + 1;
  const top = Object.entries(other).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return `${accounts}
    <b>${tx.length} movimentos novos</b>${transfers ? ` · ${transfers} transferência(s) entre as tuas contas` : ''}${plan.skipped ? ` · ${plan.skipped} já existiam (ignorados)` : ''}<br>
    <span class="modal-hint">Saídas por categoria: ${Object.entries(cats).sort((a, b) => b[1].v - a[1].v).map(([c, x]) => `${esc(c)} ${eurShort(x.v)}`).join(' · ') || '—'}</span>
    ${top.length ? `<br><span class="modal-hint">Ficam em «Outros» (${Object.values(other).reduce((s, n) => s + n, 0)}): ${top.map(([d, n]) => `${esc(d)}${n > 1 ? ' ×' + n : ''}`).join(', ')}.
      Se mudares a categoria de um, os próximos com o mesmo descritivo seguem-na.</span>` : ''}`;
}
