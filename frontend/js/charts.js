// ── charts.js: configuração do Chart.js partilhada por todos os gráficos ──
// As cores seguem uma ordem validada (azul, laranja, verde-água, amarelo),
// escolhida para se distinguir bem por daltónicos sobre o fundo escuro da app.

const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500'];
const GRID = '#252a36';
const INK = '#8a93ad';
const SURFACE = '#13161c';
// Gráficos já criados, por id do <canvas>, para serem atualizados em vez de recriados
const charts = {};

// Aspeto por omissão de todos os gráficos (letra, cores, tooltips, animação curta)
Chart.defaults.color = INK;
Chart.defaults.font.family = "'DM Mono', ui-monospace, monospace";
Chart.defaults.font.size = 11;
Chart.defaults.animation.duration = 250;
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.plugins.legend.labels.boxHeight = 10;
Chart.defaults.plugins.tooltip.backgroundColor = '#1a1e27';
Chart.defaults.plugins.tooltip.borderColor = '#2e3547';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.titleColor = '#e8ecf4';
Chart.defaults.plugins.tooltip.bodyColor = '#e8ecf4';
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.boxPadding = 4;

// Eixo de valores em euros (com grelha e rótulos compactos: 1,2k €)
function moneyAxis(extra = {}) {
  return {
    grid: { color: GRID, drawTicks: false },
    border: { display: false },
    ticks: { padding: 8, callback: v => compactEur(v), maxTicksLimit: 6 },
    ...extra,
  };
}
// Eixo de categorias/meses (sem grelha, rótulos na horizontal)
function catAxis(extra = {}) {
  return { grid: { display: false }, border: { color: GRID }, ticks: { maxRotation: 0, autoSkipPadding: 12 }, ...extra };
}
// Formato curto para eixos: 950 € · 1,2k € · 15k € · 1,3M €
function compactEur(v) {
  const a = Math.abs(v);
  const s = a >= 1e6 ? (a / 1e6).toFixed(1).replace('.', ',') + 'M' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.', ',') + 'k' : a.toFixed(0);
  return (v < 0 ? '−' : '') + s + ' €';
}
// Texto da tooltip: " Nome da série: 1 234,56 €"
function tooltipMoney(ctx) { return ` ${ctx.dataset.label}: ${eur(ctx.parsed.y ?? ctx.parsed.x)}`; }

/**
 * Cria ou atualiza o gráfico do <canvas> com este id.
 * Sem dados (tudo zero ou vazio), esconde o gráfico e mostra emptyMessage no lugar.
 * Se o gráfico já existir e for do mesmo tipo, só troca os dados (mais rápido, sem piscar).
 */
function drawChart(id, config, emptyMessage) {
  const canvas = document.getElementById(id);
  const box = canvas.parentElement;
  let empty = box.querySelector('.chart-empty');
  const hasData = config.data.datasets.some(ds => ds.data.some(v => (typeof v === 'number' ? v !== 0 : v != null)));
  if (!hasData) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    canvas.style.display = 'none';
    if (!empty) { empty = document.createElement('div'); empty.className = 'chart-empty'; box.appendChild(empty); }
    empty.textContent = emptyMessage || 'Ainda sem dados';
    return;
  }
  canvas.style.display = '';
  if (empty) empty.remove();
  config.options = { responsive: true, maintainAspectRatio: false, ...config.options };
  if (charts[id] && charts[id].config.type === config.type) {
    charts[id].data = config.data;
    charts[id].options = config.options;
    charts[id].update();
  } else {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(canvas, config);
  }
}

// Série de barras com o estilo da app (cantos arredondados, pequeno espaço entre barras)
function barDataset(label, data, color, extra = {}) {
  return {
    label, data, backgroundColor: color, hoverBackgroundColor: color,
    borderColor: SURFACE, borderWidth: { top: 0, left: 1, right: 1, bottom: 0 }, // 2px de espaço entre barras vizinhas
    borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28, ...extra,
  };
}
// Série de linha com o estilo da app (linha suave, pontos só ao passar o rato)
function lineDataset(label, data, color, extra = {}) {
  return {
    label, data, borderColor: color, backgroundColor: color, borderWidth: 2, tension: 0.25,
    pointRadius: 0, pointHoverRadius: 5, pointHoverBorderColor: SURFACE, pointHoverBorderWidth: 2,
    pointHitRadius: 12, ...extra,
  };
}
// Tooltip mostra todas as séries do mesmo mês ao passar o rato em qualquer ponto da vertical
const INDEX_HOVER = { mode: 'index', intersect: false };
