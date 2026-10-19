# Ledger

App de finanças pessoais para ter num só sítio as contas, os investimentos, os créditos e os imóveis, com o património líquido logo na página inicial.

Corre na AWS: o site é estático, o login é feito com o Cognito, a API corre em Lambda, os dados ficam no DynamoDB e o backup diário vai por email com o SES. Cada utilizador só vê os seus dados.

## Entrar

Não há registo público, só convites. O convite chega por email com o endereço da app e uma password temporária que dura 7 dias (se não aparecer, vê no spam). Se expirar, pede ao administrador para o reenviar.

No primeiro login escolhes a tua password, com pelo menos 10 caracteres, maiúsculas, minúsculas e um número. Mais tarde podes mudá-la no botão Password, no topo.

A sessão só dura enquanto o separador estiver aberto. Num separador novo, ou depois de fechares o browser, tens de entrar outra vez. Recarregar a página não te tira da conta.

Os logins (quem entrou e quando) ficam guardados 90 dias e só o administrador os vê.

No telemóvel dá para pôr o Ledger no ecrã principal, com ícone próprio e sem a barra do browser. No Android, no Chrome, é no menu ⋮ e "Adicionar ao ecrã principal" (ou "Instalar app"). No iPhone, no Safari, é em Partilhar e "Adicionar ao ecrã principal". Continua a pedir a password sempre que a voltas a abrir.

O botão do tema, no topo, passa de automático (segue o telemóvel ou o computador) a claro e a escuro. A escolha fica guardada só nesse aparelho.

Se te esqueceres da password, fala com o administrador, que te dá uma temporária. No login seguinte escolhes uma nova.

## Separadores

Depois de entrar aparece a página inicial com o património líquido (contas + investimentos + imóveis − créditos), um cartão por separador, as metas de poupança e um gráfico com a evolução mês a mês. Carrega num cartão para abrir o separador. Lá dentro, "← Início" volta à página inicial e o nome do separador, no topo, abre um menu para saltar para outro. O botão de voltar do browser ou do telemóvel também leva à página inicial.

O que vai em cada um e o que fazer todos os meses:

- Movimentos: entradas, saídas e transferências entre contas. Registas os movimentos, ou só um total aproximado por categoria em "Histórico por mês".
- Investimentos: quanto investiste, quanto vale e quanto ganhaste ou perdeste. Em "Atualizar mês" pões o aporte e o valor de cada investimento.
- Créditos: quanto deves, quanto já pagaste e quanto foi juro. Em "Atualizar mês" pões o saldo em dívida, a prestação e a amortização extra, se houver.
- Património: casa, terreno, garagem e quanto valem. Atualizas o valor quando mudar, no ✎ do imóvel.

### Metas de poupança

Na página inicial, em "+ Meta", dizes quanto queres juntar (um fundo de emergência, a entrada da casa, umas férias) e, se quiseres, até que mês.

Não precisas de uma conta só para cada meta. Em "+ Reservar / tirar" pões de parte para a meta uma parte do saldo de uma conta ou do valor de um investimento. O dinheiro não sai da conta, só passa a ter destino. Várias metas podem ter dinheiro reservado na mesma conta, e por cima das metas aparece quanto ainda está livre em cada uma. Se gastares dinheiro que estava reservado, aparece um aviso para o tirares de alguma meta. Apagar uma meta apaga as reservas dela e o dinheiro fica livre.

Em vez de reservas, uma meta pode acompanhar o património líquido todo, por exemplo para chegar aos 100 mil.

Cada meta mostra quanto já tens, quanto falta e o ritmo, que é quanto reservaste (ou quanto o património subiu) por mês, em média, nos últimos 12 meses. O mês atual não conta e, nas metas com reservas, o primeiro mês com reservas também não, para o que reservaste ao criá-la não parecer ritmo. Com esse ritmo diz quando lá chegas. Se tiver prazo, diz também quanto precisas de juntar por mês, e a barra fica verde se o ritmo chega, laranja se não chega e vermelha se o prazo já passou.

As metas e as reservas, tal como os orçamentos, não entram no backup.

### Movimentos

A pesquisa procura na descrição, na categoria e no valor, sem ligar a maiúsculas nem acentos ("agua" encontra "Água"). Os totais e os gráficos passam a contar só o que foi encontrado. Nos filtros de entradas e de saídas podes escolher várias categorias. As transferências de e para outras pessoas vão para "Transferências in" e "Transferências out".

Para mudar a categoria de vários movimentos de uma vez, marca-os na tabela, escolhe a categoria na barra que aparece e carrega em "Mudar categoria". Só dá com entradas ou com saídas de cada vez, porque as categorias são diferentes.

As saídas em "Investimentos" e "Amortizações" (ou noutra categoria começada por "Amortiza") não contam como gasto. Entram na taxa de poupança e aparecem à parte no gráfico.

Por baixo dos cartões das entradas, dos gastos, do saldo e da taxa de poupança aparece a comparação com a média dos meses anteriores e com o mesmo mês do ano passado (num ano, com o mesmo período do ano anterior). No mês atual só se comparam os dias que já passaram. Passando o rato por cima vês com que meses está a comparar.

Em "Orçamentos" defines quanto queres gastar no máximo por mês em cada categoria, com a média do que gastaste ao lado. Os orçamentos aparecem por baixo dos cartões, para o período escolhido e em todas as contas, com uma barra que fica laranja aos 80% e vermelha quando passa do limite.

"Despesas fixas" mostra as saídas que se repetem todos os meses (renda, luz, ginásio, subscrições...) nos últimos 12 meses, com quanto somam por mês e por ano. As que mudam de valor, como a luz, aparecem com ≈. Carregando numa vês esses movimentos na tabela.

### Investimentos

Ao lado do ganho em percentagem aparece a rentabilidade por ano, que conta com a data de cada aporte e resgate (ganhar 10% num ano não é o mesmo que ganhar 10% em cinco). Só aparece quando há um valor registado e já passou pelo menos um ano desde o primeiro aporte.

### Créditos

Os juros de cada mês saem do saldo e da prestação que registas. Para saber quando acabas de pagar, preenche o fim do contrato na ficha do crédito. Para registar uma amortização antiga, abre "Atualizar mês", escolhe esse mês e preenche a amortização extra.

Em "Simular amortização" escreves quanto queres amortizar (e a comissão, se houver) e vês quanto poupas em juros a reduzir a prestação ou a reduzir o prazo. Precisa da taxa e da prestação ou do fim do contrato. É só uma simulação, não grava nada.

### Património

Para juntar um imóvel basta o nome e o valor atual. O preço de compra e o crédito associado são opcionais e servem para ver a valorização e quanto da casa já é teu.

### Utilizadores (só para administradores)

As contas de administrador têm o selo Admin ao lado do email e um separador a mais, Utilizadores. Lá aparecem todas as contas, com o estado, a data de criação, o último login e o número de logins, e os últimos 200 logins de toda a gente (hora de Portugal), com um filtro por utilizador.

Também é aí que se criam contas novas (a pessoa recebe o convite por email), se reenvia o convite enquanto a pessoa ainda não escolheu a password, se desativa ou reativa uma conta e se repõe a password, que aparece só uma vez para a dares à pessoa. Uma conta desativada deixa de conseguir entrar, mas os dados ficam guardados. Depois de desativada pode ser apagada de vez, com todos os dados, e isso não se desfaz.

Estas ações não existem para contas de administrador, e pela app ninguém passa a administrador nem deixa de o ser. O administrador também não vê os dados financeiros de ninguém. Renovar a sessão sem pôr a password não conta como login.

## Backup e importar

O botão Backup, no topo, descarrega todos os teus dados em CSV: contas (com o tipo e o saldo inicial), movimentos, investimentos, créditos e património.

Se marcares "Backup diário" (em ecrãs médios aparece só "Diário"), recebes os mesmos CSV no email da tua conta todos os dias à meia-noite, hora de Portugal, com o assunto "BACKUP Ledger dia DD/MM/AAAA". Vem desligado e podes desmarcar quando quiseres. Se ao ligar a app disser que o email ainda não está confirmado, carrega no link do email que a Amazon Web Services te mandou quando a conta foi criada (vê também no spam). Se não o encontrares, pede ao administrador para o enviar outra vez.

O botão Importar, em cada separador, serve para recuperar um backup ou trazer dados de outro lado: os modelos CSV (descarregam-se na própria janela), CSV do Excel, exportações do DEGIRO e movimentos da Caixadirecta ou de outros bancos em CSV. Na Caixadirecta, o ficheiro descarrega-se no ícone do Excel em "Consultar saldos e movimentos" (à ordem ou poupança). Com os outros bancos, a app reconhece as colunas (data, descrição, valor ou débito/crédito, saldo) e mostra-tas para confirmares ou corrigires. Da próxima vez já se lembra das colunas e da conta.

Nos extratos podes importar vários ficheiros de uma vez e escolher a conta da app. A categoria de cada movimento é adivinhada pela descrição, e se mudares uma, os próximos iguais passam a seguir essa.

Para recuperar um backup, importa os ficheiros um a um, com o dos créditos antes do do património (a casa fica ligada ao crédito). Importar o mesmo ficheiro duas vezes não duplica nada.
