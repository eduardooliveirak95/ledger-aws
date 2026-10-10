// ── forms.js: uma única janela (modal), reutilizada por todos os formulários,
//    grelhas e ecrãs de importação ───────────────────────────────────────

// Controla a janela #modal do index.html.
// modal.open({title, body, footer, wide, onClose}) mostra-a com o conteúdo dado;
// footer é uma lista de botões ({label, cls, onClick, submit...}). modal.close() fecha-a.
const modal = {
  onClose: null,
  open({ title, body, footer = [], wide = false, onClose = null }) {
    $('#modal-title').textContent = title;
    const b = $('#modal-body');
    b.innerHTML = '';
    if (typeof body === 'string') b.innerHTML = body; else b.appendChild(body);
    const f = $('#modal-footer');
    f.innerHTML = '';
    for (const btn of footer) {
      const el = document.createElement('button');
      el.type = btn.submit ? 'submit' : 'button';
      el.className = 'btn ' + (btn.cls || '');
      el.textContent = btn.label;
      if (btn.id) el.id = btn.id;
      if (btn.form) el.setAttribute('form', btn.form);
      if (btn.style) el.style.cssText = btn.style;
      if (btn.onClick) el.addEventListener('click', btn.onClick);
      f.appendChild(el);
    }
    f.classList.toggle('hidden', !footer.length);
    $('#modal-box').classList.toggle('wide', wide);
    this.onClose = onClose;
    $('#modal').classList.add('open');
    // Põe o cursor no primeiro campo do formulário
    setTimeout(() => $('#modal-body input:not([type=hidden]), #modal-body select')?.focus(), 50);
  },
  close() {
    $('#modal').classList.remove('open');
    if (this.onClose) this.onClose();
    this.onClose = null;
  },
};
// Fecha a janela com o X, ao clicar fora dela ou com a tecla Escape
$('#modal-close').addEventListener('click', () => modal.close());
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') modal.close(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal').classList.contains('open')) modal.close(); });

// Contador para dar um id único a cada formulário criado
let formSeq = 0;

/**
 * Constrói um formulário a partir de uma lista de campos e mostra-o no modal:
 *   { name, label, type: text|password|money|number|date|month|select|suggest|pick|seg|check|textarea,
 *     options, required, hint, showIf(valores), half (dois por linha), placeholder }
 *
 * - showIf: função que decide se o campo aparece (ex.: "conta de destino" só em transferências)
 * - onChange / init: reagem a mudanças e preparam valores iniciais
 * - onSubmit(valores): chamado com os valores já validados e convertidos (dinheiro -> número);
 *   se lançar erro, a mensagem aparece no formulário e a janela fica aberta
 * Devolve api2, com funções para mudar sugestões, opções e valores depois de o formulário existir.
 */
function formModal({ title, fields, values = {}, submitLabel = 'Guardar', onSubmit, danger, intro }) {
  const formId = 'f' + (++formSeq);
  const form = document.createElement('form');
  form.id = formId;
  form.noValidate = true;
  form.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  if (intro) form.insertAdjacentHTML('beforeend', `<div class="modal-hint">${intro}</div>`);

  // state guarda o valor atual de cada campo; wrappers guarda o <div> de cada campo (para esconder/mostrar)
  const state = { ...values };
  const wrappers = {};
  const pickOptions = {};   // opções de cada campo "pick" (mudam com setSuggestions)
  let row = null;

  // Campo "pick": a mesma lista de caixas do filtro de categorias e da mudança em lote, com escolha única.
  // O resumo mostra a escolha; marcar uma caixa escolhe-a e fecha a lista; "Outra…" escreve uma nova.
  const renderPick = (f, el) => {
    const cur = state[f.name] || '';
    const opts = [...pickOptions[f.name]];
    if (cur && !opts.includes(cur)) opts.push(cur);   // categoria nova escrita à mão
    el.classList.toggle('pick-empty', !cur);
    el.innerHTML = `<summary>${esc(cur || f.placeholder || 'Escolher')}</summary>
      <div class="multi-panel">
        ${opts.map(o => `<label class="check"><input type="checkbox" value="${esc(o)}" ${o === cur ? 'checked' : ''}> ${esc(o)}</label>`).join('')}
        <input class="inline" data-newcat maxlength="60" placeholder="Outra… (Enter)">
      </div>`;
  };

  for (const f of fields) {
    const w = document.createElement('div');
    w.className = f.type === 'check' ? 'check' : 'field';
    wrappers[f.name] = w;
    const id = `${formId}-${f.name}`;
    const val = state[f.name] ?? f.default ?? '';
    state[f.name] = val;

    // Caixa de seleção (checkbox)
    if (f.type === 'check') {
      w.innerHTML = `<input type="checkbox" id="${id}" ${val ? 'checked' : ''}><label for="${id}">${esc(f.label)}</label>`;
      w.querySelector('input').addEventListener('change', e => { state[f.name] = e.target.checked; refresh(); });
    } else {
      w.innerHTML = `<label for="${id}">${esc(f.label)}${f.required ? '' : ' <span style="text-transform:none;letter-spacing:0">(opcional)</span>'}</label>`;
      let input;
      // Lista de opções (options pode ser texto ou {value, label})
      if (f.type === 'select') {
        input = document.createElement('select');
        for (const o of f.options) {
          const opt = document.createElement('option');
          opt.value = typeof o === 'string' ? o : o.value;
          opt.textContent = typeof o === 'string' ? o : o.label;
          input.appendChild(opt);
        }
        input.value = val;
        if (input.selectedIndex < 0 && input.options.length) { input.selectedIndex = 0; state[f.name] = input.value; }
      // "Botões segmentados": várias opções lado a lado, só uma ativa (ex.: Entrada / Saída / Transferência)
      } else if (f.type === 'seg') {
        input = document.createElement('div');
        input.className = 'seg-field';
        for (const o of f.options) {
          const b = document.createElement('button');
          b.type = 'button'; b.textContent = o.label; b.dataset.value = o.value;
          b.classList.toggle('active', o.value === val);
          b.addEventListener('click', () => {
            state[f.name] = o.value;
            input.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
            if (f.onChange) f.onChange(o.value, state, api2);
            refresh();
          });
          input.appendChild(b);
        }
      } else if (f.type === 'pick') {
        input = document.createElement('details');
        input.className = 'multi pick';
        pickOptions[f.name] = f.options || [];
        renderPick(f, input);
        const el = input;
        el.addEventListener('change', e => {
          if (e.target.type !== 'checkbox') return;
          state[f.name] = e.target.checked ? e.target.value : '';
          el.open = false; renderPick(f, el); refresh();
        });
        el.addEventListener('keydown', e => {
          if (e.key !== 'Enter' || !e.target.matches('[data-newcat]')) return;
          e.preventDefault();   // Enter aqui escolhe a categoria nova, não grava o formulário
          if (!e.target.value.trim()) return;
          state[f.name] = e.target.value.trim().slice(0, 60);
          el.open = false; renderPick(f, el); refresh();
        });
        // escrever uma categoria nova também conta ao gravar, mesmo sem carregar em Enter
        el.addEventListener('input', e => {
          const v = e.target.matches('[data-newcat]') && e.target.value.trim();
          if (!v) return;
          state[f.name] = v.slice(0, 60);
          el.querySelector('summary').textContent = state[f.name];
          el.classList.remove('pick-empty');
          el.querySelectorAll('input[type=checkbox]').forEach(c => { c.checked = false; });
        });
      } else if (f.type === 'textarea') {
        input = document.createElement('textarea');
        input.value = val;
      } else {
        input = document.createElement('input');
        // Dinheiro e números usam campo de texto (para aceitar vírgula decimal); datas e meses usam o seletor do browser
        input.type = { money: 'text', number: 'text', date: 'date', month: 'month', password: 'password' }[f.type] || 'text';
        if (f.autocomplete) input.autocomplete = f.autocomplete;   // ex.: 'new-password' (o browser sugere uma password forte)
        if (f.type === 'money' || f.type === 'number') { input.inputMode = 'decimal'; input.style.fontFamily = 'var(--font-num)'; }
        input.value = val === null || val === undefined ? '' : (f.type === 'money' || f.type === 'number') && val !== '' ? String(val).replace('.', ',') : val;
        // "suggest": campo de texto com sugestões (datalist), ex.: categorias já usadas
        if (f.type === 'suggest') {
          const dl = document.createElement('datalist');
          dl.id = id + '-list';
          w.appendChild(dl);
          input.setAttribute('list', dl.id);
          input.autocomplete = 'off';
        }
      }
      input.id = id;
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.type !== 'seg' && f.type !== 'pick') {
        input.addEventListener('input', e => { state[f.name] = e.target.value; if (f.onChange) f.onChange(e.target.value, state, api2); refresh(); });
        input.addEventListener('change', e => { state[f.name] = e.target.value; refresh(); });
      }
      w.appendChild(input);
      if (f.hint) w.insertAdjacentHTML('beforeend', `<div class="hint">${f.hint}</div>`);
    }

    // Campos "half" ficam dois a dois na mesma linha
    if (f.half) {
      if (!row) { row = document.createElement('div'); row.className = 'field-row'; form.appendChild(row); }
      row.appendChild(w);
      if (row.children.length === 2) row = null;
    } else {
      row = null;
      form.appendChild(w);
    }
  }
  const errBox = document.createElement('div');
  errBox.className = 'form-error';
  form.appendChild(errBox);

  // Funções devolvidas a quem criou o formulário, para o alterar depois de criado
  const api2 = {
    setSuggestions(name, list) {
      const pick = form.querySelector(`details.pick#${formId}-${name}`);
      if (pick) {
        // a escolha que vinha da lista anterior e não existe na nova (ex.: saídas → entradas) é limpa;
        // uma categoria escrita à mão fica
        if (state[name] && pickOptions[name].includes(state[name]) && !list.includes(state[name])) state[name] = '';
        pickOptions[name] = list;
        renderPick(fields.find(f => f.name === name), pick);
        return;
      }
      const dl = form.querySelector(`#${formId}-${name}-list`);
      if (dl) dl.innerHTML = list.map(x => `<option value="${esc(x)}">`).join('');
    },
    setOptions(name, options) {
      const sel = form.querySelector(`#${formId}-${name}`);
      const cur = sel.value;
      sel.innerHTML = options.map(o => `<option value="${esc(o.value ?? o)}">${esc(o.label ?? o)}</option>`).join('');
      sel.value = options.some(o => (o.value ?? o) === cur) ? cur : sel.options[0]?.value ?? '';
      state[name] = sel.value;
    },
    setValue(name, v) { const el = form.querySelector(`#${formId}-${name}`); if (el) el.value = v; state[name] = v; },
  };

  // Mostra/esconde campos conforme as regras showIf e os valores atuais
  function refresh() {
    for (const f of fields) if (f.showIf) wrappers[f.name].classList.toggle('hidden', !f.showIf(state));
  }

  // Ao gravar: valida os campos visíveis, converte números, chama onSubmit e fecha a janela.
  // O botão fica desativado ("A guardar…") enquanto espera pela API, para não gravar duas vezes.
  form.addEventListener('submit', async e => {
    e.preventDefault();
    errBox.textContent = '';
    const out = {};
    for (const f of fields) {
      if (f.showIf && !f.showIf(state)) continue;
      let v = state[f.name];
      if (typeof v === 'string') v = v.trim();
      if (f.type === 'money' || f.type === 'number') {
        if (v === '' || v === null || v === undefined) {
          if (f.required) return fail(`Preenche "${f.label}"`);
          v = null;
        } else {
          const n = f.type === 'money' ? parseMoney(v) : parseNum(v);
          if (isNaN(n)) return fail(`"${f.label}" não é um número válido`);
          if (f.positive && n <= 0) return fail(`"${f.label}" tem de ser maior que 0`);
          if (f.min !== undefined && n < f.min) return fail(`"${f.label}" não pode ser negativo`);
          v = n;
        }
      } else if (f.required && (v === '' || v === null || v === undefined)) {
        return fail(`Preenche "${f.label}"`);
      }
      out[f.name] = v;
    }
    const btn = $(`#modal-footer button[form="${formId}"]`);
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'A guardar…'; }
    try {
      await onSubmit(out);
      modal.close();
    } catch (err) {
      fail(err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }
    }
    function fail(msg) { errBox.textContent = msg; }
  });

  // Botões do fundo: [Apagar (opcional, à esquerda)] ... [Cancelar] [Guardar]
  const footer = [];
  if (danger) footer.push({ label: danger.label, cls: 'danger', style: 'margin-right:auto', onClick: danger.onClick });
  footer.push({ label: 'Cancelar', onClick: () => modal.close() });
  footer.push({ label: submitLabel, cls: 'primary', submit: true, form: formId });
  modal.open({ title, body: form, footer });
  refresh();
  for (const f of fields) if (f.init) f.init(state, api2);
  return api2;
}

// Janela de confirmação "Tens a certeza?". Devolve uma Promise: true se confirmar, false se cancelar
// ou fechar a janela. Uso: if (await confirmDialog('Apagar esta conta?')) { ... }
async function confirmDialog(message, okLabel = 'Apagar') {
  return new Promise(resolve => {
    let answered = false;
    modal.open({
      title: 'Confirmar',
      body: `<div class="modal-hint" style="font-size:14px;color:var(--text)">${message}</div>`,
      footer: [
        { label: 'Cancelar', onClick: () => { answered = true; modal.close(); resolve(false); } },
        { label: okLabel, cls: 'primary', onClick: () => { answered = true; modal.close(); resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}
