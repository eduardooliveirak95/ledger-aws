# Ledger

App de finanças pessoais: contas, investimentos, créditos e imóveis num só sítio, com o património líquido sempre à vista.

Corre na AWS (site estático, login com Cognito, API em Lambda e dados em DynamoDB). Cada utilizador só vê os seus próprios dados.

## Entrar

O acesso é feito por convite: não há registo público. Recebes um email e uma password temporária.

No primeiro login a app pede-te para escolheres uma password tua (mínimo 10 caracteres, com maiúsculas, minúsculas e um número). Para a mudares mais tarde, usa o botão **🔑 Password** no topo.

## Separadores

| Separador | Para quê | O que fazer todos os meses |
|---|---|---|
| **Movimentos** | Entradas, saídas e transferências entre contas | Registar os movimentos (ou um total aproximado por categoria em "Histórico por mês") |
| **Investimentos** | Quanto investiste, quanto vale e o ganho ou perda | "Atualizar mês": aporte do mês e valor de cada investimento |
| **Créditos** | Quanto deves, quanto já pagaste e quanto foi juro | "Atualizar mês": saldo em dívida, prestação e amortização extra, se houver |
| **Património** | Casa, terreno, garagem… e quanto valem | Atualizar o valor quando mudar (✎ no imóvel) |

No topo aparece o património líquido: contas + investimentos + imóveis − créditos.

### Créditos

- Os juros de cada mês são calculados a partir do saldo e da prestação que registas.
- Para saber quando acabas de pagar, preenche o **Fim do contrato** na ficha do crédito (✎).
- Para registar uma amortização antiga, abre "Atualizar mês", escolhe esse mês e preenche a **Amortização extra**.

### Património

Em **+ Imóvel** basta o nome e o valor atual. O preço de compra e o crédito associado são opcionais e servem para ver a valorização e a parte da casa que já é tua.

## Importar e fazer backup

- **⬇ Backup** (no topo) descarrega todos os teus dados em CSV. Faz isto de vez em quando.
- **⬆ Importar** (em cada separador) recupera um backup ou traz dados de outros sítios:
  - modelos CSV (descarregam-se na própria janela);
  - CSV do Excel;
  - exportações do DEGIRO;
  - extratos em PDF da Caixadirecta.
- Importar o mesmo ficheiro duas vezes não duplica nada.
