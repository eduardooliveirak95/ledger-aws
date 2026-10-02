// ── csv.js: exportação, modelos e importação de ficheiros CSV ─────────────
// Os ficheiros usam ";" e vírgula decimal para abrirem bem no Excel em português.
// A importação também aceita ficheiros com ",", datas dd/mm/aaaa e o formato da versão antiga da app.

// Lê o texto de um CSV e devolve uma lista de linhas (cada linha = lista de células).
// - tira o BOM do início (marca que o Excel põe nos ficheiros UTF-8)
// - descobre o separador (; , ou tab) pelo que aparece mais vezes na primeira linha
// - respeita aspas: "a;b" é uma só célula e "" dentro de aspas é uma aspa literal
// - ignora linhas vazias
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = [';', ',', '\t'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ';');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

// Monta o texto de um CSV com ";" (números com 2 casas e vírgula decimal;
// células com ; aspas ou quebras de linha vão entre aspas)
function toCSV(header, rows) {
  const cell = v => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : String(v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [header, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
}

// ── FORMATOS ──────────────────────────────────────────────────────────────
// Os quatro formatos próprios da app: cabeçalho das colunas e linhas de exemplo (usadas nos modelos)
const FORMATS = {
  mov: {
    label: 'Movimentos',
    header: ['Data', 'Conta', 'Tipo', 'Categoria', 'Descrição', 'Valor', 'Conta destino', 'Aproximado'],
    example: [
      ['2024-01-31', 'Conta principal', 'Saída', 'Supermercado', 'Total aproximado do mês', 320, '', 'sim'],
      ['2024-01-25', 'Conta principal', 'Entrada', 'Salário', '', 1450, '', 'não'],
      ['2024-02-01', 'Conta principal', 'Transferência', 'Transferência', 'Para poupança', 200, 'Poupança', 'não'],
    ],
  },
  inv: {
    label: 'Investimentos',
    header: ['Data', 'Investimento', 'Tipo de investimento', 'Operação', 'Valor', 'Descrição'],
    example: [
      ['2024-01-05', 'ETF Mundial', 'ETF', 'Aporte', 200, ''],
      ['2024-01', 'ETF Mundial', 'ETF', 'Valor', 204.5, 'valor no fim do mês'],
      ['2024-02-05', 'PPR', 'PPR', 'Aporte', 100, ''],
      ['2024-03-10', 'ETF Mundial', 'ETF', 'Resgate', 50, ''],
    ],
  },
  loan: {
    label: 'Créditos',
    header: ['Mês', 'Crédito', 'Tipo de crédito', 'Saldo em dívida', 'Prestação', 'Montante inicial', 'Data de início', 'Taxa (%)', 'Banco', 'Amortização extra', 'Fim do contrato'],
    example: [
      ['2024-01', 'Crédito habitação', 'Habitação', 148200, 650, 150000, '2023-06-15', 3.5, 'Banco X', '', '2063-06-15'],
      ['2024-02', 'Crédito habitação', 'Habitação', 142700, 650, 150000, '2023-06-15', 3.5, 'Banco X', 5000, '2063-06-15'],
    ],
  },
  prop: {
    label: 'Património',
    header: ['Imóvel', 'Tipo de imóvel', 'Valor atual', 'Preço de compra', 'Data de compra', 'Crédito associado', 'Notas'],
    example: [
      ['Casa', 'Habitação própria', 250000, 180000, '2023-06-15', 'Crédito habitação', ''],
    ],
  },
};

// Converte os dados da app em linhas de CSV para um formato ('mov', 'inv', 'loan' ou 'prop')
function exportRows(format) {
  if (format === 'mov') {
    return [...D.transactions].sort((a, b) => a.date.localeCompare(b.date)).map(t => [
      t.date, accountName(t.account_id), DIRECTION_LABEL[t.direction], t.category, t.description, t.amount,
      t.direction === 'transfer' ? accountName(t.to_account_id) : '', t.approx ? 'sim' : 'não',
    ]);
  }
  if (format === 'inv') {
    const typeOf = id => findById('investments', id)?.inv_type || '';
    const rows = D.inv_moves.map(x => [x.date, investmentName(x.investment_id), typeOf(x.investment_id),
      x.move === 'contribution' ? 'Aporte' : 'Resgate', x.amount, x.description]);
    rows.push(...D.valuations.map(v => [v.month, investmentName(v.investment_id), typeOf(v.investment_id), 'Valor', v.value, '']));
    // investimentos sem nenhum registo também são exportados, para não se perder nada
    for (const i of D.investments) if (!rows.some(r => r[1] === i.name)) rows.push(['', i.name, i.inv_type, '', null, i.notes]);
    return rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }
  if (format === 'loan') {
    const rows = [];
    for (const l of sortByName(D.loans)) {
      const meta = [l.principal, l.start_date, l.rate ?? '', l.lender];
      const bs = D.loan_balances.filter(b => b.loan_id === l.id).sort((a, b) => a.month.localeCompare(b.month));
      if (!bs.length) rows.push(['', l.name, l.loan_type, null, l.payment ?? null, ...meta, null, l.end_date || '']);
      for (const b of bs) rows.push([b.month, l.name, l.loan_type, b.balance, b.payment ?? l.payment ?? null, ...meta, b.extra || null, l.end_date || '']);
    }
    return rows;
  }
  if (format === 'prop') {
    return sortByName(D.properties).map(p => [p.name, p.prop_type, p.value, p.purchase_price ?? null, p.purchase_date || '',
      p.loan_id ? loanName(p.loan_id) : '', p.notes]);
  }
}

// Descarrega o CSV de um separador
function exportCSV(format) {
  const rows = exportRows(format);
  if (!rows.length) { toast('Ainda não há dados para exportar neste separador', true); return; }
  download(`ledger-${FORMATS[format].label.toLowerCase()}-${todayISO()}.csv`, toCSV(FORMATS[format].header, rows));
  toast(`${FORMATS[format].label}: ${rows.length} linhas exportadas`);
}

// Botão "Backup": descarrega os 4 CSV (movimentos, investimentos, créditos, património) de uma vez
function exportAll() {
  let n = 0;
  for (const f of ['mov', 'inv', 'loan', 'prop']) {
    const rows = exportRows(f);
    if (rows.length) { n++; download(`ledger-${FORMATS[f].label.toLowerCase()}-${todayISO()}.csv`, toCSV(FORMATS[f].header, rows)); }
  }
  toast(n ? `Backup: ${n} ficheiro(s) descarregado(s)` : 'Ainda não há dados', !n);
}

// Descarrega um modelo vazio (só com as linhas de exemplo) para preencher no Excel
function downloadTemplate(format) {
  download(`modelo-${FORMATS[format].label.toLowerCase()}.csv`, toCSV(FORMATS[format].header, FORMATS[format].example));
}

// ── IMPORTAR: transformar linhas de CSV em itens ─────────────────────────
// Descobre o formato do ficheiro pelas colunas do cabeçalho (sem acentos e em minúsculas).
// Devolve 'mov', 'inv', 'loan', 'prop', 'legacy' (app antiga), um dos formatos DEGIRO, ou null.
function detectFormat(header) {
  const h = header.map(norm);
  // Exportações do DEGIRO (interface em português)
  if (h.includes('isin') && h.includes('id da ordem') && h.includes('quantidade')) return 'degiro_tx';
  if (h.includes('isin') && h.some(x => x.startsWith('descri')) && h.some(x => x.startsWith('mudan')) && h.includes('saldo')) return 'degiro_account';
  if (h.includes('produto') && h.some(x => x.includes('isin')) && h.some(x => x.startsWith('valor')) && !h.includes('data')) return 'degiro_portfolio';
  if (h.includes('operacao') && h.includes('investimento')) return 'inv';
  if (h.includes('credito') && (h.includes('saldo em divida') || h.includes('mes'))) return 'loan';
  if (h.includes('imovel') && h.includes('valor atual')) return 'prop';
  if (h.includes('conta') && h.includes('tipo') && h.includes('valor')) return 'mov';
  if (h.includes('date') && h.includes('type') && h.some(x => x.startsWith('amount'))) return 'legacy';
  return null;
}

// Traduz o tipo escrito no CSV (Entrada, despesa, credito...) para 'in' / 'out' / 'transfer'
function directionOf(s) {
  const n = norm(s);
  if (['entrada', 'in', 'income', 'receita', 'credito'].includes(n)) return 'in';
  if (['saida', 'out', 'expense', 'despesa', 'debito'].includes(n)) return 'out';
  if (['transferencia', 'transfer'].includes(n)) return 'transfer';
  return null;
}
// Interpreta "sim", "s", "yes", "x"... como verdadeiro (coluna Aproximado)
const yes = s => ['sim', 's', 'yes', 'y', 'true', '1', 'x'].includes(norm(s));

/**
 * Lê o texto de um CSV e devolve um plano de importação (ainda não grava nada):
  *   { format, newAccounts, newInvestments, newLoans (os "pais" a criar), items, errors }
 *
 * Os itens "filhos" (movimentos, aportes...) referem os pais pelo NOME (_acc, _inv, _loan)
  * até se saber os ids, que só existem depois de os pais serem gravados (ver runImport).
  * Linhas com erro não travam o resto: ficam em errors com o número da linha.
 */
function planImport(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('O ficheiro está vazio ou só tem cabeçalho');
  const header = rows[0];
  const format = detectFormat(header);
  if (!format) throw new Error('Não reconheci o formato. Usa um dos modelos (cabeçalho: ' + header.slice(0, 5).join(', ') + ')');
  if (format === 'degiro_tx') return planDegiroTransactions(rows);
  if (format === 'degiro_portfolio') return planDegiroPortfolio(rows);
  if (format === 'degiro_account') {
    throw new Error('Este é o extrato de conta do DEGIRO ("Resumo da carteira"). Para os investimentos usa o ficheiro do separador "Transações": ' +
      'tem as mesmas compras e vendas, já com as comissões incluídas.');
  }
  // Encontra uma coluna pelo nome (ou pelo início do nome) e lê o valor dessa coluna numa linha
  const col = name => header.findIndex(h => norm(h) === norm(name) || norm(h).startsWith(norm(name)));
  const get = (r, name) => { const i = col(name); return i >= 0 ? (r[i] ?? '').trim() : ''; };

  const plan = { format, newAccounts: new Map(), newInvestments: new Map(), newLoans: new Map(), items: [], errors: [] };
  // Pais que já existem na app, por nome normalizado
  const accByName = new Map(D.accounts.map(a => [norm(a.name), a.id]));
  const invByName = new Map(D.investments.map(i => [norm(i.name), i.id]));
  const loanByName = new Map(D.loans.map(l => [norm(l.name), l.id]));
  // Regista que uma conta é precisa; se não existir, fica para criar (com a data mais antiga em que aparece)
  const needAccount = (name, date) => {
    name = name || 'Conta principal';
    if (!accByName.has(norm(name)) && !plan.newAccounts.has(norm(name))) plan.newAccounts.set(norm(name), { name, date });
    const cur = plan.newAccounts.get(norm(name));
    if (cur && date < cur.date) cur.date = date;
    return name;
  };
  // O mesmo para investimentos (o ISIN, se existir, fica nas notas)
  const needInvestment = (name, type, isin) => {
    if (!invByName.has(norm(name)) && !plan.newInvestments.has(norm(name))) {
      plan.newInvestments.set(norm(name), { name, type: type || 'Outro', notes: isin ? `ISIN: ${isin}` : '' });
    }
    return name;
  };

  // Processa cada linha de dados (a linha 1 é o cabeçalho, por isso a primeira de dados é a 2)
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const err = m => plan.errors.push(`Linha ${line}: ${m}`);

    // Movimentos (formato próprio ou da app antiga, onde "investment" vira aporte)
    if (format === 'mov' || format === 'legacy') {
      const date = parseDateFlexible(get(r, format === 'mov' ? 'Data' : 'Date'));
      if (!date) return err('data inválida');
      const amount = parseNum(get(r, format === 'mov' ? 'Valor' : 'Amount'));
      if (!(amount > 0)) return err('valor inválido');
      const type = get(r, format === 'mov' ? 'Tipo' : 'Type');
      if (format === 'legacy' && norm(type) === 'investment') {
        const inv = needInvestment('Investimentos (importado)', 'Outro');
        plan.items.push({ kind: 'inv_move', date, _inv: inv, move: 'contribution', amount, description: [get(r, 'Category'), get(r, 'Description')].filter(Boolean).join(': ') });
        return;
      }
      const direction = directionOf(type);
      if (!direction) return err(`tipo "${type}" desconhecido (Entrada, Saída ou Transferência)`);
      const acc = needAccount(format === 'mov' ? get(r, 'Conta') : '', date);
      const it = { kind: 'transaction', date, _acc: acc, direction, amount,
        category: get(r, format === 'mov' ? 'Categoria' : 'Category') || (direction === 'transfer' ? 'Transferência' : 'Outros'),
        description: get(r, format === 'mov' ? 'Descri' : 'Description'),
        approx: format === 'mov' && yes(get(r, 'Aproximado')) };
      if (direction === 'transfer') {
        const to = get(r, 'Conta destino');
        if (!to) return err('transferência sem "Conta destino"');
        if (norm(to) === norm(acc)) return err('transferência para a mesma conta');
        it._to = needAccount(to, date);
      }
      plan.items.push(it);
    }

    if (format === 'inv') {
      // Investimentos: cada linha é um Aporte, Resgate ou Valor (fim de mês)
      let name = get(r, 'Investimento');
      // coluna ISIN opcional: encontra o investimento mesmo que tenha mudado de nome na app
      const isin = (get(r, 'ISIN').toUpperCase().match(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/) || [])[0];
      const byIsin = isin && D.investments.find(i => (i.notes || '').includes(isin));
      if (byIsin) name = byIsin.name;
      if (!name) return err('falta o nome do investimento');
      if (!byIsin) needInvestment(name, get(r, 'Tipo de investimento'), isin);
      const op = norm(get(r, 'Opera'));
      if (!op) return; // linha que só declara o investimento (sem operação)
      const amount = parseNum(get(r, 'Valor'));
      if (op === 'valor') {
        const month = parseMonthFlexible(get(r, 'Data'));
        if (!month) return err('data/mês inválido');
        if (!(amount >= 0)) return err('valor inválido');
        plan.items.push({ kind: 'valuation', _inv: name, month, value: amount });
      } else if (op === 'aporte' || op === 'resgate') {
        const date = parseDateFlexible(get(r, 'Data')) || (parseMonthFlexible(get(r, 'Data')) && lastDayOf(parseMonthFlexible(get(r, 'Data'))));
        if (!date) return err('data inválida');
        if (!(amount > 0)) return err('valor inválido');
        plan.items.push({ kind: 'inv_move', _inv: name, date, move: op === 'aporte' ? 'contribution' : 'withdrawal', amount, description: get(r, 'Descri') });
      } else return err(`operação "${get(r, 'Opera')}" desconhecida (Aporte, Resgate ou Valor)`);
    }

    if (format === 'loan') {
      // Créditos: a primeira linha de cada crédito cria-o; cada linha com mês grava o saldo em dívida desse mês
      const name = get(r, 'Crédito') || get(r, 'Credito');
      if (!name) return err('falta o nome do crédito');
      if (!loanByName.has(norm(name)) && !plan.newLoans.has(norm(name))) {
        const principal = parseNum(get(r, 'Montante inicial'));
        const start = parseDateFlexible(get(r, 'Data de início')) || (parseMonthFlexible(get(r, 'Mês')) ? parseMonthFlexible(get(r, 'Mês')) + '-01' : todayISO());
        const bal = parseNum(get(r, 'Saldo em dívida'));
        plan.newLoans.set(norm(name), {
          kind: 'loan', name, loan_type: get(r, 'Tipo de crédito') || 'Outro', lender: get(r, 'Banco'),
          principal: principal >= 0 ? principal : (bal >= 0 ? bal : 0), start_date: start,
          rate: isNaN(parseNum(get(r, 'Taxa'))) ? null : parseNum(get(r, 'Taxa')),
          payment: isNaN(parseNum(get(r, 'Prestação'))) ? null : parseNum(get(r, 'Prestação')),
          end_date: parseDateFlexible(get(r, 'Fim do contrato')) || null,   // coluna opcional
        });
      }
      const monthRaw = get(r, 'Mês');
      if (!monthRaw) return;
      const month = parseMonthFlexible(monthRaw);
      if (!month) return err('mês inválido');
      const balance = parseNum(get(r, 'Saldo em dívida'));
      if (!(balance >= 0)) return err('saldo em dívida inválido');
      const payment = parseNum(get(r, 'Prestação'));
      // coluna opcional (ficheiros antigos não a têm)
      const extra = parseNum(get(r, 'Amortiza'));
      if (get(r, 'Amortiza') && !(extra >= 0)) return err('amortização extra inválida');
      plan.items.push({ kind: 'loan_balance', _loan: name, month, balance, payment: payment >= 0 ? payment : null, extra: extra > 0 ? extra : null });
    }

    if (format === 'prop') {
      // Património: uma linha por imóvel. Um imóvel com o mesmo nome é atualizado (não duplicado).
      const name = get(r, 'Imóvel') || get(r, 'Imovel');
      if (!name) return err('falta o nome do imóvel');
      const value = parseNum(get(r, 'Valor atual'));
      if (!(value >= 0)) return err('valor atual inválido');
      const price = parseNum(get(r, 'Preço de compra'));
      if (get(r, 'Preço de compra') && !(price >= 0)) return err('preço de compra inválido');
      const dateRaw = get(r, 'Data de compra');
      const date = parseDateFlexible(dateRaw);
      if (dateRaw && !date) return err('data de compra inválida');
      const loan = get(r, 'Crédito associado') || get(r, 'Credito associado');
      if (loan && !loanByName.has(norm(loan))) return err(`crédito "${loan}" não existe (importa primeiro os créditos)`);
      const existing = D.properties.find(p => norm(p.name) === norm(name));
      plan.items.push({ ...(existing || {}), kind: 'property', id: existing?.id, name, prop_type: get(r, 'Tipo de imóvel') || existing?.prop_type || 'Habitação própria',
        value, purchase_price: price >= 0 ? price : null, purchase_date: date || '', loan_id: loan ? loanByName.get(norm(loan)) : '', notes: get(r, 'Notas') });
    }
  });
  return plan;
}

// ── DEGIRO ────────────────────────────────────────────────────────────────
// O DEGIRO às vezes parte nomes de produto compridos numa linha extra com a data vazia:
//   02-08-2023,09:52,VANGUARD FTSE ALL-WORLD UCITS - (USD),IE00BK5BQT80,...
//   ,,ACCUMULATING ETF,,,,...
// Essas linhas são coladas à anterior. Os investimentos são identificados pelo ISIN
// (guardado nas notas do investimento), por isso mudar-lhes o nome na app não estraga nada.
const ISIN_RE = /\b[A-Z]{2}[A-Z0-9]{9}\d\b/;

// Posição da primeira coluna com um destes nomes (primeiro exatos, depois pelo início do nome); -1 se não houver
function colIndex(header, ...names) {
  const h = header.map(norm);
  for (const n of names) { const i = h.indexOf(norm(n)); if (i >= 0) return i; }
  for (const n of names) { const i = h.findIndex(x => x.startsWith(norm(n))); if (i >= 0) return i; }
  return -1;
}

// Junta as linhas partidas: linha sem valor na coluna iFirst mas com nome -> o nome vai para a linha anterior
function mergeWrappedRows(rows, iFirst, iName) {
  const out = [];
  for (const r of rows) {
    if (!String(r[iFirst] ?? '').trim() && String(r[iName] ?? '').trim() && out.length) {
      out[out.length - 1][iName] = (out[out.length - 1][iName] + ' ' + r[iName].trim()).trim();
    } else out.push([...r]);
  }
  return out;
}

// "VANGUARD FTSE ALL-WORLD UCITS" -> "Vanguard FTSE All-World UCITS" (mantém siglas em maiúsculas)
function prettyProduct(name) {
  const KEEP = new Set(['ETF', 'UCITS', 'MSCI', 'FTSE', 'USD', 'EUR', 'GBP', 'S&P', 'ESG', 'SRI', 'EM', 'ACWI', 'IMI', 'REIT', 'II', 'III', 'PLC', 'SA', 'AG', 'NV']);
  return name.trim().split(/\s+/).map(w => {
    const core = w.replace(/[()]/g, '').toUpperCase();
    if (KEEP.has(core)) return w.toUpperCase();
    return w.toLowerCase().replace(/(^|[-(])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase());
  }).join(' ');
}

// Devolve uma função (isin, nomeProduto) -> nome do investimento na app.
// Usa o investimento que já tenha esse ISIN nas notas; senão prepara um novo (com nome único).
function degiroInvestmentResolver(plan) {
  return (isin, productName) => {
    const existing = D.investments.find(i => (i.notes || '').includes(isin));
    if (existing) return existing.name;
    const key = 'isin:' + isin;
    if (!plan.newInvestments.has(key)) {
      let name = prettyProduct(productName).slice(0, 60) || isin;
      const taken = n => D.investments.some(i => norm(i.name) === norm(n)) ||
        [...plan.newInvestments.values()].some(x => norm(x.name) === norm(n));
      if (taken(name)) name = `${name.slice(0, 45)} (${isin})`;
      plan.newInvestments.set(key, { name, type: /\bETF\b/i.test(productName) ? 'ETF' : 'Ações', notes: `ISIN: ${isin} · DEGIRO` });
    }
    return plan.newInvestments.get(key).name;
  };
}

// Ficheiro "Transações" do DEGIRO -> aportes (compras) e resgates (vendas).
// Usa a coluna Total EUR, que já inclui as comissões.
function planDegiroTransactions(rows) {
  const header = rows[0];
  const i = {
    date: colIndex(header, 'Data'), product: colIndex(header, 'Produto'), isin: colIndex(header, 'ISIN'),
    qty: colIndex(header, 'Quantidade'), price: colIndex(header, 'Preços', 'Preço'),
    total: colIndex(header, 'Total EUR', 'Total'), order: colIndex(header, 'ID da Ordem'),
  };
  const plan = { format: 'degiro_tx', newAccounts: new Map(), newInvestments: new Map(), newLoans: new Map(), items: [], errors: [] };
  const data = mergeWrappedRows(rows.slice(1), i.date, i.product);

  // nome mais comprido visto para cada ISIN (os nomes partidos às vezes vêm incompletos)
  const names = {};
  for (const r of data) {
    const isin = (r[i.isin] || '').trim();
    if (isin && (r[i.product] || '').length > (names[isin] || '').length) names[isin] = r[i.product].trim();
  }
  const resolve = degiroInvestmentResolver(plan);

  data.forEach((r, n) => {
    const err = m => plan.errors.push(`Linha ${n + 2}: ${m}`);
    const date = parseDateFlexible(r[i.date]);
    if (!date) return err('data inválida');
    const isin = (r[i.isin] || '').trim();
    if (!ISIN_RE.test(isin)) return err('ISIN em falta');
    const qty = parseNum(r[i.qty]), total = parseNum(r[i.total]);
    if (!qty || isNaN(qty)) return err('quantidade inválida');
    if (isNaN(total) || total === 0) return err('total inválido');
    const price = parseNum(r[i.price]);
    const buy = qty > 0;
    plan.items.push({
      kind: 'inv_move', date, _inv: resolve(isin, names[isin]),
      move: buy ? 'contribution' : 'withdrawal', amount: round2(Math.abs(total)),
      description: `${buy ? 'Compra' : 'Venda'} ${Math.abs(qty)} × ${isNaN(price) ? '?' : String(price).replace('.', ',')} € (DEGIRO${r[i.order] ? ' ' + r[i.order].slice(0, 8) : ''})`,
    });
  });
  return plan;
}

// Ficheiro "Portefólio" do DEGIRO -> valor de cada investimento num mês.
// O ficheiro não diz a data, por isso needsMonth faz a janela perguntar o mês.
function planDegiroPortfolio(rows) {
  const header = rows[0];
  const h = header.map(norm);
  const iProd = colIndex(header, 'Produto');
  const iIsin = h.findIndex(x => x.includes('isin'));
  let iVal = h.findIndex(x => x.startsWith('valor') && x.includes('eur'));
  if (iVal < 0) iVal = h.map((x, k) => (x.startsWith('valor') ? k : -1)).filter(k => k >= 0).pop();
  const plan = { format: 'degiro_portfolio', needsMonth: true, newAccounts: new Map(), newInvestments: new Map(), newLoans: new Map(), items: [], errors: [] };
  const resolve = degiroInvestmentResolver(plan);
  const byIsin = {};
  mergeWrappedRows(rows.slice(1), iProd, iProd).forEach(r => {
    const isin = (String(r[iIsin] || '').match(ISIN_RE) || [])[0];
    if (!isin) return; // as linhas de dinheiro (cash) não têm ISIN
    const v = parseNum(r[iVal]);
    if (isNaN(v)) return plan.errors.push(`${r[iProd]}: valor inválido`);
    byIsin[isin] = byIsin[isin] || { name: r[iProd] || isin, value: 0 };
    byIsin[isin].value += v;
  });
  for (const [isin, x] of Object.entries(byIsin)) {
    plan.items.push({ kind: 'valuation', _inv: resolve(isin, x.name), month: null, value: round2(x.value) });
  }
  return plan;
}

/**
 * "Impressão digital" de um item (data, conta, tipo, valor...) para reconhecer repetidos,
 * de forma a que importar o mesmo ficheiro duas vezes não duplique nada.
 */
function fingerprint(it) {
  const a = n => Number(n).toFixed(2);
  if (it.kind === 'transaction') return ['t', it.date, it.account_id, it.direction, it.to_account_id || '', norm(it.category), a(it.amount)].join('|');
  if (it.kind === 'inv_move') return ['m', it.date, it.investment_id, it.move, a(it.amount)].join('|');
  return null; // valores e saldos são "um por mês": importar substitui-os, não duplica
}

// Executa um plano de importação de CSV em 3 passos e devolve contagens para a mensagem final
async function runImport(plan, skipDuplicates, onProgress) {
  // 1) cria os pais que faltam (contas, investimentos, créditos) e fica a saber os ids deles
  const parents = [
    ...[...plan.newAccounts.values()].map(a => ({ kind: 'account', name: a.name, acc_type: 'Conta à ordem', opening_balance: 0, opening_date: a.date })),
    ...[...plan.newInvestments.values()].map(i => ({ kind: 'investment', name: i.name, inv_type: i.type, notes: i.notes || '' })),
    ...plan.newLoans.values(),
  ];
  if (parents.length) applyChanges(await api.save(parents));

  const accId = name => D.accounts.find(a => norm(a.name) === norm(name))?.id;
  const invId = name => D.investments.find(i => norm(i.name) === norm(name))?.id;
  const loanId = name => D.loans.find(l => norm(l.name) === norm(name))?.id;

  // 2) troca nomes por ids e salta os repetidos
  // conta quantos há (não é só um conjunto): duas linhas iguais no mesmo dia (dois cafés de 2,40 €) são ambas reais
  const existing = new Map();
  for (const fp of [...D.transactions, ...D.inv_moves].map(fingerprint)) if (fp) existing.set(fp, (existing.get(fp) || 0) + 1);
  const items = [];
  let skipped = 0;
  for (const raw of plan.items) {
    const it = { ...raw };
    if (it._acc) it.account_id = accId(it._acc);
    if (it._to) it.to_account_id = accId(it._to);
    if (it._inv) it.investment_id = invId(it._inv);
    if (it._loan) it.loan_id = loanId(it._loan);
    delete it._acc; delete it._to; delete it._inv; delete it._loan;
    const fp = fingerprint(it);
    if (skipDuplicates && fp && existing.get(fp) > 0) { existing.set(fp, existing.get(fp) - 1); skipped++; continue; }
    items.push(it);
  }

  // 3) grava em blocos (ver api.save)
  const res = await api.save(items, [], onProgress);
  applyChanges(res);
  return { saved: res.saved.length, skipped, parents: parents.length };
}

// Abre a janela "Importar": escolher/arrastar ficheiros, pré-visualizar o plano e confirmar.
// CSV -> planImport/runImport · PDF da Caixadirecta -> parseCgdStatement/planBankImport/runBankImport
function openImport(defaultFormat) {
  let plan = null;
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="modal-hint">
      Importa dados antigos, um backup ou os PDFs da Caixadirecta («Consultar saldos e movimentos», à ordem ou poupança;
      podes largar vários de uma vez). Reconheço automaticamente o tipo de ficheiro
      (Movimentos, Investimentos, Créditos, Património, DEGIRO ou o formato da versão antiga). Aceita separador <b>;</b> ou <b>,</b>,
      datas <b>AAAA-MM-DD</b> ou <b>DD/MM/AAAA</b> e valores como <b>1.234,56</b>.
    </div>
    <div class="templates">
      <span class="modal-hint">Descarregar modelo:</span>
      <button class="link-btn" data-t="mov">Movimentos</button>
      <button class="link-btn" data-t="inv">Investimentos</button>
      <button class="link-btn" data-t="loan">Créditos</button>
      <button class="link-btn" data-t="prop">Património</button>
    </div>
    <div class="drop-zone" id="imp-drop">
      <input type="file" accept=".csv,text/csv,.pdf,application/pdf" id="imp-file" multiple>
      Arrasta um ficheiro <strong>.csv</strong> ou PDFs do banco, ou clica para escolher
      <div class="drop-filename" id="imp-name"></div>
    </div>
    <label class="check"><input type="checkbox" id="imp-skip" checked> Ignorar linhas repetidas (já existentes)</label>
    <div class="preview-box hidden" id="imp-preview"></div>`;
  body.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => downloadTemplate(b.dataset.t)));

  // Lê um ou vários PDFs do banco e mostra a pré-visualização; mudar uma opção volta a calcular o plano
  const readBankPdfs = async files => {
    const box = $('#imp-preview', body);
    box.classList.remove('hidden');
    box.innerHTML = 'A ler os PDFs…';
    $('#imp-go').disabled = true;
    try {
      const statements = [];
      for (const f of files) {
        const st = parseCgdStatement(await pdfPages(await f.arrayBuffer()));
        if (!st) throw new Error(`«${f.name}» não parece um comprovativo de movimentos da Caixadirecta`);
        statements.push(st);
      }
      const choice = {}, fix = {};
      const render = () => {
        plan = planBankImport(statements, choice, fix);
        box.innerHTML = `<b>Formato:</b> CGD Caixadirecta (PDF)<br>` + bankPreviewHTML(plan);
        box.querySelectorAll('[data-bank-acc]').forEach(sel => sel.addEventListener('change', () => { choice[sel.dataset.bankAcc] = sel.value; render(); }));
        box.querySelectorAll('[data-bank-fix]').forEach(cb => cb.addEventListener('change', () => { fix[cb.dataset.bankFix] = cb.checked; render(); }));
        $('#imp-go').disabled = !plan.items.length && !plan.updates.length && !plan.accounts.some(a => a.choice === 'new');
      };
      render();
    } catch (e) {
      plan = null;
      box.innerHTML = `<span class="err">${esc(e.message)}</span>`;
    }
  };

  // Ficheiros escolhidos: se houver PDFs, trata-os como extratos; senão lê o primeiro como CSV
  const readFiles = async list => {
    const files = [...(list || [])];
    if (!files.length) return;
    $('#imp-name', body).textContent = '✓ ' + files.map(f => f.name).join(', ');
    const pdfs = files.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    $('#imp-skip', body).closest('label').classList.toggle('hidden', pdfs.length > 0);
    if (pdfs.length) return readBankPdfs(pdfs);
    return readFile(files[0]);
  };

  // Lê um CSV (tenta UTF-8; se falhar, usa windows-1252, o formato antigo do Excel) e mostra o resumo
  const readFile = async file => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { text = new TextDecoder('windows-1252').decode(buf); }
    const box = $('#imp-preview', body);
    box.classList.remove('hidden');
    try {
      plan = planImport(text);
      const counts = {};
      for (const it of plan.items) counts[it.kind] = (counts[it.kind] || 0) + 1;
      const label = { transaction: 'movimentos', inv_move: 'aportes/resgates', valuation: 'valores mensais', loan_balance: 'saldos de crédito', property: 'imóveis' };
      const newP = [
        plan.newAccounts.size && `${plan.newAccounts.size} conta(s) nova(s): ${[...plan.newAccounts.values()].map(a => esc(a.name)).join(', ')}`,
        plan.newInvestments.size && `${plan.newInvestments.size} investimento(s) novo(s): ${[...plan.newInvestments.values()].map(a => esc(a.name)).join(', ')}`,
        plan.newLoans.size && `${plan.newLoans.size} crédito(s) novo(s): ${[...plan.newLoans.values()].map(a => esc(a.name)).join(', ')}`,
      ].filter(Boolean);
      const formatLabel = { legacy: 'versão antiga da app', degiro_tx: 'DEGIRO: transações (compras e vendas)',
        degiro_portfolio: 'DEGIRO: portefólio numa data' }[plan.format] || FORMATS[plan.format].label;
      const monthField = plan.needsMonth ? `<div class="field" style="margin:8px 0;max-width:240px"><label>Este portefólio é do fim de que mês?</label>
        <input type="month" id="imp-month" value="${addMonths(thisMonth(), -1)}"></div>` : '';
      box.innerHTML = `<b>Formato:</b> ${formatLabel}<br>${monthField}
        ${Object.entries(counts).map(([k, v]) => `${v} ${label[k]}`).join(' · ') || 'Nenhuma linha com dados'}<br>
        ${newP.map(x => '+ ' + x).join('<br>')}
        ${plan.errors.length ? `<div class="err" style="margin-top:6px">${plan.errors.length} linha(s) com erro, serão ignoradas:<br>${plan.errors.slice(0, 8).map(esc).join('<br>')}${plan.errors.length > 8 ? '<br>…' : ''}</div>` : ''}`;
      $('#imp-go').disabled = !plan.items.length && !plan.newAccounts.size && !plan.newInvestments.size && !plan.newLoans.size;
    } catch (e) {
      plan = null;
      box.innerHTML = `<span class="err">${esc(e.message)}</span>`;
      $('#imp-go').disabled = true;
    }
  };
  // Escolher ficheiro no botão ou arrastá-lo para a zona tracejada
  $('#imp-file', body).addEventListener('change', e => readFiles(e.target.files));
  const dz = $('#imp-drop', body);
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); readFiles(e.dataTransfer.files); });

  modal.open({
    title: 'Importar',
    body,
    footer: [
      { label: 'Cancelar', onClick: () => modal.close() },
      { label: 'Importar', cls: 'primary', id: 'imp-go', onClick: async e => {
        if (!plan) return;
        if (plan.needsMonth) {
          const m = $('#imp-month', body)?.value;
          if (!m) return toast('Escolhe o mês do portefólio', true);
          plan.items.forEach(it => { it.month = m; });
        }
        const btn = e.target;
        btn.disabled = true;
        if (plan.format === 'bank') {
          try {
            const r = await runBankImport(plan, (d, t) => { btn.textContent = `A importar… ${Math.round(d / t * 100)}%`; });
            modal.close();
            toast(`Importado: ${r.saved} movimentos${r.updated ? `, ${r.updated} transferências ligadas` : ''}${r.skipped ? `, ${r.skipped} repetidos ignorados` : ''}${r.parents ? `, ${r.parents} conta(s) criada(s)` : ''}`);
          } catch (err) {
            toast(err.message, true);
            btn.disabled = false; btn.textContent = 'Importar';
          }
          renderAll();
          return;
        }
        try {
          const r = await runImport(plan, $('#imp-skip', body).checked, (d, t) => { btn.textContent = `A importar… ${Math.round(d / t * 100)}%`; });
          modal.close();
          toast(`Importado: ${r.saved} registos${r.skipped ? `, ${r.skipped} repetidos ignorados` : ''}${r.parents ? `, ${r.parents} contas/investimentos/créditos criados` : ''}`);
          renderAll();
        } catch (err) {
          toast(err.message, true);
          btn.disabled = false; btn.textContent = 'Importar';
          renderAll();
        }
      } },
    ],
  });
  $('#imp-go').disabled = true;
}
