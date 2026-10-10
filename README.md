# Ledger

App de finanças pessoais: contas, investimentos, créditos e imóveis num só sítio, com o património líquido logo na página inicial.

Corre na AWS (site estático, login com Cognito, API em Lambda, dados em DynamoDB e backup diário por email com o SES). Cada utilizador só vê os seus próprios dados. O Cognito avisa uma Lambda a cada login, e o login fica registado para o administrador.

## Entrar

O acesso é feito por convite: não há registo público. Recebes um email de convite com o endereço da app e uma password temporária, válida 7 dias (vê também no spam). Se expirar, pede ao administrador para reenviar o convite.

No primeiro login a app pede-te para escolheres uma password tua (mínimo 10 caracteres, com maiúsculas, minúsculas e um número). Para a mudares mais tarde, usa o botão **🔑 Password** no topo.

Por segurança, a sessão só dura enquanto o separador estiver aberto: num separador novo ou ao reabrir o browser (mesmo com os separadores restaurados) tens de entrar outra vez. Recarregar a página não te tira da conta.

Cada login fica registado (quem entrou e quando) durante 90 dias. Só o administrador vê esse registo.

Se te esqueceres da password, o administrador repõe-na: dá-te uma password temporária e no login seguinte escolhes uma nova. O administrador também pode desativar uma conta (deixa de conseguir entrar, mas os dados ficam guardados) e voltar a ativá-la, ou, depois de a desativar, apagá-la de vez com todos os dados.

## Separadores

| Separador | Para quê | O que fazer todos os meses |
|---|---|---|
| **Movimentos** | Entradas, saídas e transferências entre contas | Registar os movimentos (ou um total aproximado por categoria em "Histórico por mês") |
| **Investimentos** | Quanto investiste, quanto vale e o ganho ou perda | "Atualizar mês": aporte do mês e valor de cada investimento |
| **Créditos** | Quanto deves, quanto já pagaste e quanto foi juro | "Atualizar mês": saldo em dívida, prestação e amortização extra, se houver |
| **Património** | Casa, terreno, garagem… e quanto valem | Atualizar o valor quando mudar (✎ no imóvel) |

Depois do login entras na **página inicial**: o património líquido (contas + investimentos + imóveis − créditos) e um cartão por separador, com o número principal de cada um. Carrega num cartão para abrir o separador. Lá dentro, **← Início** volta à página inicial e o nome do separador, no topo, abre um menu para saltar para outro. O botão de voltar do browser ou do telemóvel também te leva à página inicial.

Em **Movimentos**, os filtros **Entradas** e **Saídas** deixam escolher várias categorias de cada vez. As transferências de e para outras pessoas ficam em **Transferências in** e **Transferências out**.

Para mudar a categoria de vários movimentos de uma vez, marca-os na tabela (ou todos, no cabeçalho), escolhe a categoria na barra que aparece e carrega em **Mudar categoria**. Só dá para mudar entradas ou saídas de cada vez, porque têm categorias diferentes.

As saídas nas categorias **Investimentos** e **Amortizações** (ou outra começada por "Amortiza", como "Amortização casa") não contam como gasto: entram na taxa de poupança e aparecem à parte no gráfico.

### Créditos

- Os juros de cada mês são calculados a partir do saldo e da prestação que registas.
- Para saber quando acabas de pagar, preenche o **Fim do contrato** na ficha do crédito (✎).
- Para registar uma amortização antiga, abre "Atualizar mês", escolhe esse mês e preenche a **Amortização extra**.

### Património

Em **+ Imóvel** basta o nome e o valor atual. O preço de compra e o crédito associado são opcionais e servem para ver a valorização e a parte da casa que já é tua.

### Utilizadores (só administradores)

As contas de administrador têm o selo **Admin** ao lado do email e um separador a mais, **Utilizadores** (um cartão a mais na página inicial e no menu):

- todas as contas, com o estado (ativa, com password temporária ou desativada), a data em que foram criadas, o último login e quantos logins fizeram;
- os últimos 200 logins de todos, com a data e a hora de Portugal, e um filtro por utilizador;
- **+ Nova conta**: cria uma conta de utilizador normal e a pessoa recebe o convite por email;
- em cada conta, **Reenviar convite** (enquanto a pessoa não escolheu a password), **Desativar** / **Reativar** e **Repor password** (mostra uma password temporária, só dessa vez, para lhe dares);
- nas contas desativadas, **Apagar**: apaga de vez a conta e todos os dados dela (não se pode desfazer).

As contas de administrador não têm estas ações, e ninguém passa a administrador (nem deixa de o ser) pela app. O administrador não vê os dados financeiros de ninguém. Renovar a sessão sem pedir a password não conta como login, e os logins anteriores a esta funcionalidade não aparecem.

## Importar e fazer backup

- **⬇ Backup** (no topo) descarrega todos os teus dados em CSV: contas (com o tipo e o saldo inicial), movimentos, investimentos, créditos e património.
- **✉ Backup diário** (no topo; em ecrãs médios aparece como **✉ Diário**): marca a caixa para receberes no email da tua conta, todos os dias à meia-noite (hora de Portugal), os mesmos CSV ("BACKUP Ledger dia DD/MM/AAAA", com os dados até ao fim desse dia). Vem desligado; desmarca quando quiseres deixar de receber. Se ao ligar a app avisar que o email ainda não está confirmado, carrega no link do email que a Amazon Web Services te enviou quando a tua conta foi criada (vê também no spam); se não o encontrares, pede ao administrador para o enviar outra vez.
- **⬆ Importar** (em cada separador) recupera um backup ou traz dados de outros sítios:
  - modelos CSV (descarregam-se na própria janela);
  - CSV do Excel;
  - exportações do DEGIRO;
  - movimentos da Caixadirecta em CSV: em "Consultar saldos e movimentos" (à ordem ou poupança), descarrega o ficheiro no ícone do Excel;
  - movimentos de outros bancos em CSV: a app reconhece as colunas (data, descrição, valor ou débito/crédito, saldo) e mostra-tas para confirmares ou corrigires; da próxima vez lembra-se das colunas e da conta.

  Nos extratos podes importar vários ficheiros de uma vez, escolhes a conta da app e a categoria de cada movimento é adivinhada pela descrição (se mudares uma, os próximos iguais seguem-na).
- Para recuperar um backup, importa os ficheiros um a um (a ordem não importa: o das contas acerta o tipo e o saldo inicial das contas criadas pelos movimentos).
- Importar o mesmo ficheiro duas vezes não duplica nada.
