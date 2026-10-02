// ── bank.js: importação de extratos bancários em PDF (CGD Caixadirecta) ──
// O comprovativo "Consultar saldos e movimentos" da Caixadirecta (à ordem ou poupança) é lido com
// o pdf.js (só carregado quando se escolhe um PDF). As colunas são encontradas pela posição das
// palavras do cabeçalho, e cada valor é conferido com o saldo impresso ao lado.

// Pasta do pdf.js dentro do site (vendor/); pdfjsLoading evita carregá-lo duas vezes
const PDFJS_DIR = 'vendor/pdfjs/';
let pdfjsLoading = null;

// Carrega o pdf.js a pedido (adiciona um <script> à página) e devolve a biblioteca.
// O "worker" é um segundo ficheiro que lê o PDF em segundo plano sem bloquear a página.
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  pdfjsLoading = pdfjsLoading || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_DIR + 'pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_DIR + 'pdf.worker.min.js'; resolve(window.pdfjsLib); };
    s.onerror = () => { pdfjsLoading = null; reject(new Error('Não consegui carregar o leitor de PDF')); };
    document.head.appendChild(s);
  });
  return pdfjsLoading;
}

/** PDF → páginas de pedaços de texto {str, x, y} com a posição de cada um (y cresce para baixo). */
async function pdfPages(buf, lib) {
  lib = lib || await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const h = page.getViewport({ scale: 1 }).height;
    const tc = await page.getTextContent();
    pages.push(tc.items.filter(i => i.str && i.str.trim())
      .map(i => ({ str: i.str.trim(), x: i.transform[4], y: h - i.transform[5] })));
  }
  return pages;
}

// Datas "dd-mm-aaaa" e valores "1.234,56" como aparecem no extrato
const DATE_RE = /^(\d{2})-(\d{2})-(\d{4})$/;
const MONEY_RE = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
// isoOf: "30-09-2026" -> "2026-09-30" · cents: euros -> cêntimos inteiros (compara sem erros de arredondamento)
const isoOf = s => { const m = String(s).match(DATE_RE); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const cents = n => Math.round(n * 100);
/** Descrição sem espaços nem pontuação: a CGD parte palavras em sítios aleatórios ("TRANSFERE NCIA"). */
const compactDesc = s => norm(s || '').replace(/[^a-z0-9]/g, '');

/** Junta os pedaços de texto em linhas (mesmo y, com 2 pontos de tolerância), cada uma ordenada da esquerda para a direita. */
function linesOf(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) < 2) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  lines.forEach(l => { l.items.sort((a, b) => a.x - b.x); l.text = l.items.map(i => i.str).join(' '); });
  return lines;
}

/**
 * Páginas de um comprovativo Caixadirecta → { bank, number, product, savings, from, to, rows, opening, closing, warnings }.
 * rows vêm do mais antigo para o mais recente: { date, description, cgdCategory, amount (com sinal), balance (depois dele) }.
  * Devolve null se o PDF não for um comprovativo da Caixadirecta.
 */
function parseCgdStatement(pages) {
  const all = pages.flatMap(linesOf);
  const full = all.map(l => l.text).join('\n');
  if (!/Caixadirecta/i.test(full) || !/movimentos/i.test(full)) return null;

  // Linha com "<número da conta> - EUR - <produto>"
  const accLine = all.find(l => /\b\d{9,}\s*-\s*EUR\s*-/.test(l.text));
  if (!accLine) throw new Error('Encontrei um comprovativo da Caixadirecta, mas sem o número da conta');
  const [, number, product] = accLine.text.match(/(\d{9,})\s*-\s*EUR\s*-\s*(.+)$/);
  const savings = /movimentos de poupan/i.test(full) || /poupan|objetivo|prazo/i.test(product);
  // Data que aparece na linha com um dado rótulo (ex.: "Data de início")
  const dateAfter = label => isoOf((all.find(l => new RegExp(label, 'i').test(l.text))?.text.match(/\d{2}-\d{2}-\d{4}/) || [])[0]);

  const raw = []; // do mais recente para o mais antigo, como vem impresso
  for (const items of pages) {
    const lines = linesOf(items);
    // Procura a linha de cabeçalho (tem "Débito" e "Crédito") e guarda a posição x de cada coluna
    const hi = lines.findIndex(l => l.items.some(i => /^D[ée]bito/i.test(i.str)) && l.items.some(i => /^Cr[ée]dito/i.test(i.str)));
    if (hi < 0) continue;
    const head = lines[hi].items;
    const colX = re => head.find(i => re.test(i.str))?.x;
    const xDate = colX(/^Data/), xDesc = colX(/^Descri/), xDeb = colX(/^D[ée]bito/), xCred = colX(/^Cr[ée]dito/), xBal = colX(/^Saldo/);
    if ([xDate, xDesc, xDeb, xCred, xBal].some(v => v === undefined)) continue;

    // Cada linha que começa por uma data na coluna Data é um movimento novo;
    // o texto de cada pedaço vai para a coluna em cuja faixa de x ele cai.
    let cur = null;
    for (const line of lines.slice(hi + 1)) {
      const first = line.items[0];
      if (Math.abs(first.x - xDate) < 5 && DATE_RE.test(first.str)) {
        cur = { date: isoOf(first.str), desc: [], debit: null, credit: null, balance: null, cgdCategory: '', y: line.y };
        raw.push(cur);
        for (const it of line.items.slice(1)) {
          if (it.x < xDesc - 3) continue; // coluna "data valor" (ignorada)
          if (it.x < xDeb - 3) { cur.desc.push(it.str); continue; }
          const tokens = it.str.split(/\s+/);
          if (it.x < xCred - 3) { if (MONEY_RE.test(tokens[0])) cur.debit = parseNum(tokens[0]); continue; }
          if (it.x < xBal - 3) { if (MONEY_RE.test(tokens[0])) cur.credit = parseNum(tokens[0]); continue; }
          if (cur.balance === null && MONEY_RE.test(tokens[0])) { cur.balance = parseNum(tokens[0]); continue; }
          if (!tokens.every(t => MONEY_RE.test(t))) cur.cgdCategory += (cur.cgdCategory ? ' ' : '') + it.str; // categoria da própria CGD (só na conta à ordem)
        }
      } else if (cur && line.y - cur.y < 45) {
        // linhas de continuação da descrição / categoria do mesmo movimento
        for (const it of line.items) {
          if (it.x >= xDesc - 3 && it.x < xDeb - 3) cur.desc.push(it.str);
          else if (it.x > xBal + 60 && !MONEY_RE.test(it.str)) cur.cgdCategory += it.str;
        }
      } else cur = null;
    }
  }
  if (!raw.length) throw new Error(`Não encontrei movimentos no comprovativo da conta ${number}`);

  // valores com sinal, conferidos com o saldo corrido (o saldo anterior é o da linha de baixo).
  // Se o valor lido não bater com a diferença de saldos, fica um aviso para o utilizador.
  const warnings = [];
  raw.forEach((r, i) => {
    let amount = r.credit != null ? r.credit : r.debit != null ? -r.debit : null;
    const older = raw[i + 1];
    if (older && r.balance != null && older.balance != null) {
      const diff = round2(r.balance - older.balance);
      if (amount === null || cents(Math.abs(diff)) === cents(Math.abs(amount))) amount = diff;
      else warnings.push(`${dateLabel(r.date)} ${r.desc.join(' ')}: o valor (${eur(Math.abs(amount))}) não bate com a diferença de saldos (${eur(diff)})`);
    }
    if (amount === null) warnings.push(`${dateLabel(r.date)} ${r.desc.join(' ')}: sem valor`);
    r.amount = amount;
  });
  const rows = raw.filter(r => r.amount).reverse().map(r => ({
    date: r.date, description: r.desc.join(' ').replace(/\s+/g, ' ').trim(), cgdCategory: r.cgdCategory.trim(),
    amount: r.amount, balance: r.balance,
  }));
  const last = raw[raw.length - 1];
  return {
    bank: 'CGD', number, product: product.trim(), savings,
    from: dateAfter('Data de in') || rows[0]?.date, to: dateAfter('Data de fim') || rows[rows.length - 1]?.date,
    rows, opening: round2((last.balance ?? 0) - (last.amount ?? 0)), closing: raw[0].balance, warnings,
  };
}

// ── categorias ──
// Regras para adivinhar a categoria pela descrição. Ganha a primeira que bater certo.
// São testadas na descrição sem espaços (ver compactDesc), em minúsculas e sem acentos.
// Cada regra é [expressão regular ou função(descrição, valor), categoria].
const BANK_RULES = {
  out: [
    [/amortiza/, 'Amortizações'],                          // amortizações de crédito: poupança, não gasto
    [/cobrancaprestacao|prestacaohab|pagprestacao/, 'Habitação'],
    [/comissao|manutconta|impostodeselo|impselo|despesasmanut/, 'Comissões bancárias'],
    [/^atm|levantamento/, 'Levantamentos'],
    [/^edp|goldenergy|endesa|iberdrola|galpenergia|smas|epal|aguasde|indaqua/, 'Água / Luz / Gás'],
    [/cepsa|galp|repsol|^prio|^bp|shell|alvesbandeira/, 'Combustível'],
    [/nowo|^meo|vodafone|^nos|digimobil/, 'Telecomunicações'],
    [/continente|pingodoce|lidl|minipreco|intermarche|aldi|mercadona|auchan|^spar|meusuper|froiz/, 'Supermercado'],
    [/^a\d{1,2}$|viaverde|brisa|ascendi|metropo|carris|fertagus|tvm$|^rne$|^bolt|^uber(?!eats)|navegante|emel|telpark|empark/, 'Transportes'],
    [/restaur|burger|tasquinha|tasca|cantinho|^bares|pizz|sushi|mcdonald|^kfc|^h3|glovo|ubereats|pastelaria|padaria|grelha|cafe|snack|churrasq|kebab/, 'Restauração'],
    [/farmacia|multimedi|clinica|hospital|^cuf|luzsaude|dentar/, 'Saúde'],
    [/spotify|netflix|disney|hbomax|youtube|apple|icloud|googleplay|amazonprime|onlyfans|patreon|openai|anthropic/, 'Subscrições'],
    [/certiverse|pearson|examvue|udemy|coursera|academy/, 'Educação'],
    [/xsolla|steam|playstation|nintendo|cinema|ticketline|solinca|fitness|ginasio/, 'Lazer'],
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
const bankAccountName = st => 'CGD ' + st.product.replace(/^conta\s+/i, '').replace(/^à\s+/i, 'à ');

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
    if (!byNumber.has(st.number)) byNumber.set(st.number, { number: st.number, product: st.product, savings: st.savings, rows: [], warnings: [] });
    const acc = byNumber.get(st.number);
    acc.rows.push(...st.rows);
    acc.warnings.push(...st.warnings);
  }
  for (const acc of byNumber.values()) {
    // o mesmo movimento em dois ficheiros sobrepostos tem a mesma data, valor e saldo depois dele: fica só um
    const seen = new Set();
    acc.rows = acc.rows.filter(r => { const k = `${r.date}|${cents(r.amount)}|${cents(r.balance)}`; return seen.has(k) ? false : seen.add(k); })
      .sort((a, b) => a.date.localeCompare(b.date));
    // movimento mais antigo: aquele cujo saldo "antes" não é o saldo "depois" de outro do mesmo dia
    // (dá o saldo inicial; o mesmo raciocínio ao contrário dá o saldo final)
    const first = acc.rows[0].date;
    const firstDay = acc.rows.filter(r => r.date === first);
    const after = new Set(firstDay.map(r => cents(r.balance)));
    const oldest = firstDay.find(r => !after.has(cents(r.balance - r.amount))) || firstDay[0];
    acc.opening = round2(oldest.balance - oldest.amount);
    acc.from = first; acc.to = acc.rows[acc.rows.length - 1].date;
    const lastDay = acc.rows.filter(r => r.date === acc.to);
    const before = new Set(lastDay.map(r => cents(r.balance - r.amount)));
    acc.closing = (lastDay.find(r => !before.has(cents(r.balance))) || lastDay[lastDay.length - 1]).balance;

    // Conta da app a usar: a escolhida, ou a que tiver o nome sugerido, ou criar uma nova
    acc.defaultName = bankAccountName(acc);
    const byName = D.accounts.find(a => norm(a.name) === norm(acc.defaultName));
    acc.choice = choice[acc.number] || (byName ? byName.id : 'new');
    acc.key = acc.choice === 'new' ? 'new:' + acc.defaultName : acc.choice;
    // Para uma conta existente, compara o saldo da app com o do banco no dia antes do extrato;
    // se forem diferentes, propõe acertar o saldo inicial da conta.
    if (acc.choice !== 'new' && acc.choice !== 'skip') {
      const a = findById('accounts', acc.choice);
      const dayBefore = addDays(acc.from, -1);
      acc.appOpening = a && a.opening_date > dayBefore && !D.transactions.some(t => t.date <= dayBefore && (t.account_id === a.id || t.to_account_id === a.id))
        ? a.opening_balance : round2(accountBalance(acc.choice, dayBefore));
      acc.diff = round2(acc.opening - acc.appOpening);
      acc.fixOpening = fixOpening[acc.number] ?? true;
      if (acc.diff && acc.fixOpening && a) {
        plan.updates.push({ kind: 'account', id: a.id, name: a.name, acc_type: a.acc_type,
          opening_balance: round2(a.opening_balance + acc.diff), opening_date: a.opening_date < acc.from ? a.opening_date : acc.from });
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
      opening_balance: a.opening, opening_date: a.from }))));
  }
  const accId = name => D.accounts.find(a => norm(a.name) === norm(name))?.id;
  const items = plan.items.map(raw => {
    const it = { ...raw };
    if (it._acc) it.account_id = accId(it._acc);
    if (it._to) it.to_account_id = accId(it._to);
    delete it._acc; delete it._to;
    return it;
  });
  const res = await api.save([...plan.updates, ...items], [], onProgress);
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
      <b>${esc(acc.product)}</b> · ${esc(acc.number)} · ${dateLabel(acc.from)} a ${dateLabel(acc.to)} · ${acc.rows.length} movimentos<br>
      <div class="field" style="margin:6px 0;max-width:320px"><label>Conta na app</label><select data-bank-acc="${esc(acc.number)}">${accOpts(acc)}</select></div>
      ${acc.choice === 'new' ? `Saldo inicial: <b>${eur(acc.opening)}</b> a ${dateLabel(acc.from)}, saldo no fim: ${eur(acc.closing)}`
        : acc.choice === 'skip' ? '' : acc.diff
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
