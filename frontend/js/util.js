// ── util.js: pequenas funções auxiliares usadas por todos os outros ficheiros ──
// Os ficheiros JS são carregados por ordem no index.html (sem módulos nem build):
// tudo o que é declarado aqui fica global e disponível para os ficheiros seguintes.

// Atalhos para procurar elementos na página: $ devolve o primeiro, $$ devolve todos (como array)
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Categorias sugeridas nos formulários de movimentos, por tipo (saída / entrada)
const CATEGORIES = {
  out: ['Habitação', 'Supermercado', 'Restauração', 'Transportes', 'Combustível', 'Carro',
        'Saúde', 'Educação', 'Lazer', 'Compras', 'Roupa', 'Viagens', 'Subscrições',
        'Seguros', 'Impostos', 'Água / Luz / Gás', 'Telecomunicações', 'Animais', 'Presentes', 'Comissões bancárias', 'Levantamentos', 'Transferências', 'Investimentos', 'Outros'],
  in: ['Salário', 'Subsídios', 'Freelance', 'Juros / Dividendos', 'Rendas', 'Reembolsos', 'Presentes', 'Vendas', 'Transferências', 'Outros'],
};
// Categorias de saída que são dinheiro posto de lado, não gasto: saem da conta,
// mas contam para a taxa de poupança em vez de contarem como despesa.
// isSavingOut(t) -> true se o movimento t for uma dessas saídas.
const SAVING_CATEGORIES = ['investimento', 'investimentos'];
const isSavingOut = t => t.direction === 'out' && SAVING_CATEGORIES.includes(norm(t.category || ''));
// Listas de opções dos formulários e nomes em português
const ACCOUNT_TYPES = ['Conta à ordem', 'Poupança', 'Dinheiro', 'Cartão de refeição', 'Cartão de crédito', 'Outra'];
const INVESTMENT_TYPES = ['ETF', 'Ações', 'Fundo', 'PPR', 'Certificados de Aforro', 'Depósito a prazo',
                          'Obrigações', 'Cripto', 'Imobiliário', 'P2P', 'Outro'];
const LOAN_TYPES = ['Habitação', 'Automóvel', 'Pessoal', 'Cartão de crédito', 'Estudante', 'Outro'];
const PROPERTY_TYPES = ['Habitação própria', 'Arrendado', 'Férias', 'Terreno', 'Garagem', 'Loja / escritório', 'Outro'];
const DIRECTION_LABEL = { in: 'Entrada', out: 'Saída', transfer: 'Transferência' };
const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
                   'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// ── texto e números ──
// Escapa caracteres especiais de HTML. Usar SEMPRE antes de meter texto do utilizador
// em innerHTML, para evitar que um nome como "<script>" seja executado (proteção contra XSS).
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Formatadores de euros no formato português (1 234,56 €); EUR0 sem casas decimais
const EUR = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const EUR0 = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
// eur: 1 234,56 € · eurShort: 1 235 € · eurSigned: +12,00 € / −12,00 € (com sinal)
function eur(n) { return EUR.format(n || 0); }
function eurShort(n) { return EUR0.format(n || 0); }
function eurSigned(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + EUR.format(Math.abs(n || 0)); }
// Formata uma fração como percentagem com sinal (0.051 -> "+5,1%"); "—" se não for um número finito
function pct(n, digits = 1) {
  if (!isFinite(n)) return '—';
  return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n * 100).toFixed(digits).replace('.', ',') + '%';
}
// Classe CSS para pintar valores: 'pos' (verde), 'neg' (vermelho) ou '' (praticamente zero)
function signClass(n) { return n > 0.004 ? 'pos' : n < -0.004 ? 'neg' : ''; }
// Número -> texto para meter num campo de formulário, com vírgula decimal (12.5 -> "12,5")
function numInput(v) { return v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','); }
// Arredonda a 2 casas decimais (EPSILON corrige casos como 1.005 que em binário é 1.00499...)
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/**
 * Converte texto em número aceitando vários formatos:
 * "12.50", "12,50", "1.234,56", "1,234.56", "€ 1 234,56" → número (NaN se for inválido).
 * Quando há vírgula e ponto, o que aparece em último é o separador decimal.
 */
function parseNum(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[€\s ]/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
}

/**
 * Como parseNum, mas para valores em euros escritos à mão: "250.000" ou "1.250.000" (pontos a separar
 * milhares, como se escreve em Portugal) é 250 000 e não 250. Só nos formulários: nos CSV do banco ou
 * do DEGIRO um ponto com 3 casas pode ser mesmo decimal.
 */
function parseMoney(v) {
  const s = String(v ?? '').replace(/[€\s ]/g, '');
  return /^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s) ? parseFloat(s.replace(/\./g, '')) : parseNum(v);
}

// ── datas (sempre como texto: 'AAAA-MM-DD' e 'AAAA-MM') ──
// Trabalhar com texto em vez de objetos Date evita problemas de fuso horário
// e permite comparar datas diretamente com < e > (a ordem alfabética é a cronológica).
// pad: 5 -> "05" · todayISO: data de hoje (hora local) · thisMonth: mês atual · ymOf: "2026-09-30" -> "2026-09"
function pad(n) { return String(n).padStart(2, '0'); }
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function thisMonth() { return todayISO().slice(0, 7); }
function ymOf(date) { return String(date).slice(0, 7); }
// Soma (ou subtrai, se n < 0) meses a um "AAAA-MM", passando de ano quando é preciso
function addMonths(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${pad(m)}`;
}
// Lista de todos os meses entre from e to, inclusive (limite de 1200 = 100 anos, por segurança)
function monthRange(from, to) {
  const out = [];
  if (!from || !to || from > to) return out;
  for (let m = from; m <= to && out.length < 1200; m = addMonths(m, 1)) out.push(m);
  return out;
}
// Número de meses de a até b ("2026-01", "2026-04" -> 3)
function monthsDiff(a, b) {
  const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
// Último dia do mês ("2026-02" -> "2026-02-28"): o dia 0 do mês seguinte é o último deste
function lastDayOf(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(new Date(y, m, 0).getDate())}`;
}
// Nomes de meses para mostrar: "setembro 2026" / "set 26"
function monthLabel(ym) { const [y, m] = ym.split('-').map(Number); return `${MONTHS_PT[m - 1]} ${y}`; }
function monthShort(ym) { const [y, m] = ym.split('-').map(Number); return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`; }
// Soma dias a uma data (usa o meio-dia UTC para a mudança de hora não trocar o dia)
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// "2026-09-30" -> "30/09/2026"
function dateLabel(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }

/**
 * Lê uma data escrita de várias formas: 2026-09-30, 30/09/2026, 30-09-2026, 30.09.2026.
 * Devolve "AAAA-MM-DD", ou null se não for uma data real (ex.: 31/02/2026).
 */
function parseDateFlexible(s) {
  s = String(s ?? '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return valid(`${m[1]}-${pad(m[2])}-${pad(m[3])}`);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return valid(`${m[3]}-${pad(m[2])}-${pad(m[1])}`);
  return null;
  function valid(iso) {
    const d = new Date(iso + 'T12:00:00');
    return !isNaN(d) && d.toISOString().slice(0, 10) === iso ? iso : null;
  }
}
// Lê um mês: 2026-09, 09/2026, ou uma data completa (fica só o mês). Devolve "AAAA-MM" ou null.
function parseMonthFlexible(s) {
  s = String(s ?? '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) return +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${pad(m[2])}` : null;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{4})$/))) return +m[1] >= 1 && +m[1] <= 12 ? `${m[2]}-${pad(m[1])}` : null;
  const d = parseDateFlexible(s);
  return d ? d.slice(0, 7) : null;
}

// ── mensagens e indicadores no ecrã ──
// Mostra uma mensagem temporária no fundo do ecrã (3 s; os erros ficam 6 s e a vermelho)
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 6000 : 3000);
}
// Barra de "a carregar" no topo. Conta os pedidos em curso: só desaparece quando todos acabam.
let loadingCount = 0;
function loading(on) {
  loadingCount = Math.max(0, loadingCount + (on ? 1 : -1));
  $('#loading-bar').classList.toggle('active', loadingCount > 0);
}

// Faz o browser descarregar um ficheiro de texto (usado nos CSV de backup/exportação).
// O primeiro caractere é um BOM (marca UTF-8) para o Excel mostrar bem os acentos.
function download(filename, text) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Normaliza texto para comparações: minúsculas, sem espaços nas pontas e sem acentos
// ("Saúde " -> "saude"). normalize('NFD') separa as letras dos acentos, que depois são removidos.
function norm(s) {
  return String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
