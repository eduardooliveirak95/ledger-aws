// ── theme.js: tema claro ou escuro ──
// Carregado no <head>, antes de a página aparecer, para nunca se ver o tema errado ao abrir.
// Há três escolhas, guardadas só neste aparelho (localStorage "ledger.theme"): 'auto' (segue o modo do
// telemóvel ou do PC), 'light' (sempre claro) e 'dark' (sempre escuro). O tema em uso fica em
// <html data-theme="light|dark">, que o style.css usa para as cores. Quando muda, avisa o resto da app
// com o evento "ledger-theme" (o app.js redesenha os gráficos com as cores novas).

const THEME_KEY = 'ledger.theme';
const THEME_CHOICES = ['auto', 'light', 'dark'];
// Ícone, texto e explicação do botão do topo para cada escolha (no telemóvel só aparece o ícone)
const THEME_LABELS = { auto: ['◐', 'Auto'], light: ['☀', 'Claro'], dark: ['🌙', 'Escuro'] };
const THEME_TITLES = {
  auto: 'Tema automático: segue o modo do telemóvel ou do PC. Carrega para mudar',
  light: 'Tema sempre claro. Carrega para mudar',
  dark: 'Tema sempre escuro. Carrega para mudar',
};
const systemDark = matchMedia('(prefers-color-scheme: dark)');

// A escolha guardada (sem nada guardado, ou sem acesso ao armazenamento, é 'auto')
let themeChoiceNow = (() => {
  try { const v = localStorage.getItem(THEME_KEY); return THEME_CHOICES.includes(v) ? v : 'auto'; } catch { return 'auto'; }
})();
const themeChoice = () => themeChoiceNow;

// O tema em uso: o escolhido ou, em 'auto', o do telemóvel ou do PC
function effectiveTheme(choice, systemIsDark) {
  return choice === 'auto' ? (systemIsDark ? 'dark' : 'light') : choice;
}
// A escolha seguinte, a cada toque no botão: automático → claro → escuro → automático
function nextThemeChoice(choice) {
  return THEME_CHOICES[(THEME_CHOICES.indexOf(choice) + 1) % THEME_CHOICES.length];
}

// Põe o tema em uso na página e a cor da barra do browser no telemóvel; avisa a app se mudou
function applyTheme() {
  const root = document.documentElement;
  const theme = effectiveTheme(themeChoiceNow, systemDark.matches);
  const changed = root.dataset.theme !== theme;
  root.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (changed) document.dispatchEvent(new Event('ledger-theme'));
}

// Guarda uma escolha nova (se o browser não deixar guardar, vale só até fechar a página) e aplica-a
function setThemeChoice(choice) {
  themeChoiceNow = THEME_CHOICES.includes(choice) ? choice : 'auto';
  try { localStorage.setItem(THEME_KEY, themeChoiceNow); } catch { /* sem armazenamento: fica só em memória */ }
  applyTheme();
}

applyTheme();
// Em 'auto', acompanha o telemóvel ou o PC quando mudam de modo com a página aberta
systemDark.addEventListener('change', applyTheme);
