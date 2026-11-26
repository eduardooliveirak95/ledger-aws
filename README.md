# Ledger

App de finanças pessoais para ter num só sítio as contas, os investimentos, os créditos e os imóveis, com o património líquido logo na página inicial.

Corre na AWS: o site é estático, o login é feito com o Cognito, a API corre em Lambda, os dados ficam no DynamoDB e o backup diário vai por email com o SES. Cada utilizador só vê os seus dados.

## Entrar

Não há registo público, só convites. O convite chega por email com o endereço da app e uma password temporária que dura 7 dias (se não aparecer, vê no spam). Se expirar, pede ao administrador para o reenviar.

No primeiro login escolhes a tua password, com pelo menos 10 caracteres, maiúsculas, minúsculas e um número. Mais tarde podes mudá-la no botão Password, na barra lateral. Se ficou uma sessão aberta noutro aparelho (o PC do trabalho, um emprestado), "Sair em todos" termina-a lá e aqui; nos outros aparelhos acaba em cerca de 1 minuto.

A sessão só dura enquanto o separador estiver aberto. Num separador novo, ou depois de fechares o browser, tens de entrar outra vez. Recarregar a página não te tira da conta.

Os logins (quem entrou e quando) ficam guardados 90 dias e só o administrador os vê. Ao entrares, aparece a data e a hora do teu acesso anterior (fica também por baixo do teu email, na barra lateral). Se não fores tu, carrega em "Não fui eu": muda a password e usa "Sair em todos".

No telemóvel dá para pôr o Ledger no ecrã principal, com ícone próprio e sem a barra do browser. No Android, no Chrome, é no menu ⋮ e "Adicionar ao ecrã principal" (ou "Instalar app"). No iPhone, no Safari, é em Partilhar e "Adicionar ao ecrã principal". Continua a pedir a password sempre que a voltas a abrir.

O botão do tema, na barra lateral, passa de automático (segue o telemóvel ou o computador) a claro e a escuro. A escolha fica guardada só nesse aparelho.

O botão 👁, ao lado, esconde todos os valores em euros (aparecem como ••• €) até voltares a carregar nele. Também se liga sozinho ao fim de 10 minutos sem mexeres na app. Dá jeito para abrir a app em público. Também fica guardado só nesse aparelho, e os ficheiros exportados continuam com os valores todos.

Se te esqueceres da password, fala com o administrador, que te dá uma temporária. No login seguinte escolhes uma nova.

## Separadores

Depois de entrar aparece a página inicial com o património líquido (contas + investimentos + imóveis − créditos), os avisos, o fecho do mês (no início de cada mês), um cartão por separador e o do resumo do ano, as metas de poupança e um gráfico com a evolução mês a mês. Carrega num cartão para abrir o separador. Em "✎ Personalizar a página inicial", no fim da página, escolhes o que aparece e por que ordem (o património líquido fica sempre no topo); fica guardado na tua conta, igual em todos os aparelhos, e "Repor" volta ao de origem. A barra lateral, à esquerda, tem a página inicial, todos os separadores e, em baixo, o backup, o tema e a conta. No telemóvel abre no ☰ do topo e mostra também o património líquido e o número principal de cada separador; o backup, o tema e a conta ficam em "⚙ Definições". O botão de voltar do browser ou do telemóvel leva de um separador à página inicial.

O que vai em cada um e o que fazer todos os meses:

- Movimentos: entradas, saídas e transferências entre contas. Registas os movimentos, ou só um total aproximado por categoria em "Histórico por mês".
- Investimentos: quanto investiste, quanto vale e quanto ganhaste ou perdeste. Em "Atualizar mês" pões o aporte e o valor de cada investimento.
- Créditos: quanto deves, quanto já pagaste e quanto foi juro. Em "Atualizar mês" pões o saldo em dívida, a prestação e a amortização extra, se houver.
- Património: casa, terreno, garagem e quanto valem. Atualizas o valor quando mudar, no ✎ do imóvel.

### Avisos

Por baixo do património líquido aparece "A ver", com o que precisa de atenção: investimentos sem o valor do mês passado, créditos sem o saldo do mês passado, orçamentos deste mês (nos anuais, desde janeiro) a 80% ou mais, gastos fora do normal (uma categoria sem orçamento que este mês já vai no dobro da média dos 6 meses antes, e pelo menos 50 € acima dela), uma taxa de esforço acima de 50%, despesas fixas que subiram de preço, metas que já não chegam a tempo ou cujo prazo passou, dinheiro reservado a mais numa conta, a reserva mensal de uma meta por fazer e a alocação dos investimentos a mais de 5 pontos do alvo. Cada aviso tem um botão para o resolver e um ✕ para o dispensar. Um aviso dispensado só volta se mudar, por exemplo no mês seguinte. Sem avisos, a secção não aparece.

### Fecho do mês

No início de cada mês aparece na página inicial o fecho do mês que acabou, com o que falta para o dar por fechado: marcar cada conta depois de importares o extrato e de o saldo no fim do mês bater com o do banco ("Conferir"), o valor dos investimentos e o saldo dos créditos desse mês, o "a receber" ainda por receber e os movimentos que ficaram na categoria "Outros". Cada coisa tem um botão para a resolver, e o que já está feito fica com ✓. Em "Resumo" vês as entradas, os gastos, a poupança e a taxa de poupança do mês, a comparação com a média dos meses anteriores, onde gastaste mais, o que fugiu do normal e os orçamentos que passaram. Quando acabares, "Fechar <mês>" tira-o da página inicial (se ainda faltar alguma coisa, pergunta primeiro). Nos Movimentos, "✓ Fecho do mês" abre o do mês que estás a ver (se já tiver acabado) ou o do mês passado, também para reabrir um mês fechado.

### Metas de poupança

Na página inicial, em "+ Meta", dizes quanto queres juntar (um fundo de emergência, a entrada da casa, umas férias) e, se quiseres, até que mês.

Não precisas de uma conta só para cada meta. Em "+ Reservar / tirar" pões de parte para a meta uma parte do saldo de uma conta ou do valor de um investimento. O dinheiro não sai da conta, só passa a ter destino. Várias metas podem ter dinheiro reservado na mesma conta, e por cima das metas aparece quanto ainda está livre em cada uma. Se gastares dinheiro que estava reservado, aparece um aviso para o tirares de alguma meta. Apagar uma meta apaga as reservas dela e o dinheiro fica livre.

Na meta podes pôr quanto queres reservar por mês e de onde. No início de cada mês, os avisos perguntam se queres fazer essa reserva, e basta um toque. Enquanto ainda não houver um mês completo de reservas, é com esse valor que a app calcula quando lá chegas.

Em vez de reservas, uma meta pode acompanhar o património líquido todo, por exemplo para chegar aos 100 mil.

Cada meta mostra quanto já tens, quanto falta e o ritmo, que é quanto reservaste (ou quanto o património subiu) por mês, em média, nos últimos 12 meses. O mês atual não conta e, nas metas com reservas, o primeiro mês com reservas também não, para o que reservaste ao criá-la não parecer ritmo. Com esse ritmo diz quando lá chegas. Se tiver prazo, diz também quanto precisas de juntar por mês, e a barra fica verde se o ritmo chega, laranja se não chega e vermelha se o prazo já passou.

Ao criar uma meta, a app sugere quanto juntar para um fundo de emergência: 3 a 6 meses dos teus gastos.

As metas e as reservas, tal como os orçamentos, os alvos da alocação, os filtros guardados dos Movimentos, a página inicial à tua medida e o fecho dos meses, não entram no backup.

### Simular o futuro

No gráfico da evolução do património, "Simular o futuro" mostra quanto podes ter daqui a uns anos. Começa com as tuas contas e investimentos de hoje, com o que poupaste em média por mês no último ano e com a rentabilidade da tua carteira, e podes mudar tudo. Mostra o valor no fim do prazo, também em euros de hoje (descontada a inflação), quanto disso é o que juntaste e quanto é o que rendeu. Se puseres um objetivo, diz quando lá chegas. Com os gastos por mês (vêm já preenchidos com a tua média), diz também quando chegas à independência financeira: 25 vezes os gastos de um ano, o que pela regra dos 4% chega para os pagar. Em "E se…" podes juntar uma compra grande (um carro, a entrada de uma casa) ou uma entrada pontual (uma herança) num mês à escolha: a simulação compara com o que terias sem ela, também no objetivo e na independência financeira, e avisa se nesse mês não tiveres dinheiro que chegue. A rentabilidade é igual todos os anos e não há impostos. É só uma simulação, não grava nada.

### Resumo do ano

O cartão "Resumo do ano" (também na barra lateral) mostra o ano num relance: entradas, gastos, taxa de poupança e património líquido, comparados com o ano anterior, alguns destaques (o maior gasto, os meses com mais e menos gastos, as categorias que mais subiram e desceram), o património no início e no fim, o mês a mês, "Para onde foi o dinheiro" (um diagrama com o que entrou de um lado e, do outro, os gastos por categoria, o investido, o amortizado e o que ficou nas contas), os gastos e as entradas por categoria (com os orçamentos do ano), os investimentos e os créditos. Num ano que já acabou mostra o ano inteiro. No ano atual mostra de 1 de janeiro até hoje e compara com o mesmo período do ano anterior. As setas mudam de ano.

"Imprimir / PDF" abre a janela de impressão do browser, onde escolhes a impressora ou guardar em PDF. Sai só o resumo, sempre no tema claro.

### Movimentos

Quando fechas uma conta no banco, abre-a (✎ na lista das Contas) e marca "Conta fechada". Se ainda tiver dinheiro, a app propõe passá-lo para outra conta, com uma transferência de hoje, e a conta fica a 0 €. Deixa de aparecer ao registar movimentos e passa para "Contas fechadas", mas o histórico fica e continua a contar nos gráficos e no Resumo do ano. Para a reabrir, desmarca a opção. Uma conta com movimentos não se pode apagar, para não perderes o histórico por engano; só uma conta vazia (criada por engano, por exemplo) tem o botão "Apagar conta".

Para registar depressa, escreve na caixa "Registo rápido", por cima da tabela, o que gastaste e o valor, por exemplo "almoço 12,5 revolut #trabalho", e carrega em Enter: abre o formulário já preenchido, confirmas e gravas. Além do valor, percebe a conta (o início do nome dela), o dia ("ontem", "anteontem" ou "21/11"; sem dia, é hoje) e as etiquetas (com #). Com "+" à frente do valor é uma entrada ("+1800 ordenado"). O resto fica a descrição, e a categoria é a sugerida por ela.

Ao registar um movimento, a descrição sugere as que já usaste e a categoria fica logo escolhida com a que costumas dar a essa descrição (escreves "mercearia" e fica "Supermercado"); podes sempre escolher outra. As etiquetas, o "A receber" e o "Valor aproximado" estão em "Mais opções". Se apagares alguma coisa por engano, a mensagem "… apagado" traz um "Anular" durante uns segundos, que põe tudo como estava.

A pesquisa procura na descrição, na categoria e no valor, sem ligar a maiúsculas nem acentos ("agua" encontra "Água"). Os totais e os gráficos passam a contar só o que foi encontrado. Nos filtros de entradas e de saídas podes escolher várias categorias. As transferências de e para outras pessoas vão para "Transferências in" e "Transferências out". Cada movimento pode ter até 5 etiquetas (por exemplo "férias 2026"), separadas por vírgulas: pesquisa "#férias" (ou carrega numa etiqueta) para ver os movimentos dela, de qualquer categoria, com os totais.

Para voltar depressa a uma combinação de filtros (a conta, as categorias e a pesquisa), escolhe-a e, em "★ Filtros", carrega em "Guardar o filtro atual…" e dá-lhe um nome. Depois, carregar no nome volta a pôr esses filtros, no mês ou no ano que estiver escolhido (o período não fica guardado). O ✕ apaga o filtro. Os filtros ficam guardados na tua conta, por isso aparecem no PC e no telemóvel.

Num gasto que pagaste por inteiro (a conta do jantar, por exemplo), põe em "A receber" a parte dos outros; "Dividir por" faz a conta (num jantar de 80 € a quatro, ficam 60 € a receber) e em "De quem" escreves quem te deve. O painel "A receber" mostra o que te devem, junto por pessoa; quando o dinheiro chegar (por MB WAY, por exemplo), regista a entrada (ou importa o extrato) e carrega em "Recebido": escolhes a entrada, ou várias se cada pessoa mandou a sua parte, ou "Recebi sem movimento" se foi em mão. As entradas que trazem o nome de quem te deve aparecem primeiro. O "Já recebi" do formulário é só para quando te pagam em mão: com ele marcado, o gasto sai do painel. A entrada associada deixa de contar como entrada e abate ao gasto, na categoria dele (o jantar de 80 € em que te devolveram 60 € conta 20 € nos gastos, nos orçamentos e no resumo do ano); o saldo da conta não muda.

Para mudar a categoria de vários movimentos de uma vez, marca-os na tabela, escolhe a categoria na barra que aparece e carrega em "Mudar categoria". Só dá com entradas ou com saídas de cada vez, porque as categorias são diferentes.

Para juntar vários movimentos no mesmo filtro (as despesas de umas férias ou de umas obras, por exemplo), marca-os na tabela e carrega em "# Etiqueta…" na barra que aparece: escreves uma etiqueta e ficam todos com ela, entradas e saídas de qualquer categoria. Por omissão, a app guarda também o filtro "#etiqueta" em "★ Filtros" e mostra logo esses movimentos. Os que já têm 5 etiquetas ficam sem ela.

As saídas em "Investimentos" e "Amortizações" (ou noutra categoria começada por "Amortiza") não contam como gasto. Entram na taxa de poupança e aparecem à parte no gráfico.

Por baixo dos cartões das entradas, dos gastos, do saldo e da taxa de poupança aparece a comparação com a média dos meses anteriores e com o mesmo mês do ano passado (num ano, com o mesmo período do ano anterior). No mês atual só se comparam os dias que já passaram. Passando o rato por cima vês com que meses está a comparar.

Em "Orçamentos" defines quanto queres gastar no máximo em cada categoria, por mês ou por ano, com a média do que gastaste ao lado. O orçamento por ano serve para gastos que vêm de uma vez, como férias ou seguros: num mês, conta o que gastaste desde janeiro. Os orçamentos aparecem por baixo dos cartões, para o período escolhido e em todas as contas, com uma barra que fica laranja aos 80% e vermelha quando passa do limite.

No mês atual aparece também a previsão para o fim do mês: o saldo de hoje, mais o que já registaste para os próximos dias, mais as entradas habituais que ainda não chegaram (o ordenado, por exemplo), menos as saídas habituais que ainda não saíram (a renda, as subscrições, os aportes), menos o que costumas gastar no dia a dia e ainda não gastaste este mês. É uma estimativa, para a conta escolhida no filtro ou para todas. No cartão dos Movimentos da página inicial aparece esse valor e para quantos meses dos teus gastos dá o dinheiro nas contas.

"Despesas fixas" mostra as saídas que se repetem todos os meses (renda, luz, ginásio, subscrições...) nos últimos 12 meses, com quanto somam por mês e por ano. As que mudam de valor, como a luz, aparecem com ≈. Carregando numa vês esses movimentos na tabela.

"Calendário" mostra o mês atual com as entradas e saídas que se repetem todos os meses no dia em que costumam acontecer (o ordenado, a renda, as subscrições) e, por baixo de cada dia, o saldo previsto no fim desse dia. Assim vês o dia em que a conta fica mais apertada. Conta com a conta escolhida no filtro, ou com todas. No telemóvel aparece em lista, só com os dias que têm alguma coisa.

Em "Conferir saldo", nas Contas, escreves o saldo que o banco mostra num dia e a app diz se bate com o dela. Se não bater, falta algum movimento, há algum repetido ou o saldo inicial está errado. Daí podes ir ver os movimentos desse mês ou acertar o saldo inicial.

### Investimentos

Na carteira completa, "Alocação por tipo" mostra quanto pesa cada tipo de investimento (ETF, PPR, cripto...). Em "Alvos" dizes que percentagem queres em cada um (têm de somar 100%), e a app mostra quanto falta ou sobra em cada tipo para lá chegar. Assim sabes onde pôr os próximos aportes. Se um tipo se afastar mais de 5 pontos do alvo, aparece um aviso na página inicial.

Na tabela dos investimentos, o botão € simula uma venda: quanto recebes se venderes hoje (tudo ou uma parte), já sem o imposto sobre o ganho (28% por omissão, podes mudar). É uma estimativa e não grava nada.

Ao lado do ganho em percentagem aparece a rentabilidade por ano, que conta com a data de cada aporte e resgate (ganhar 10% num ano não é o mesmo que ganhar 10% em cinco). Só aparece quando há um valor registado e já passou pelo menos um ano desde o primeiro aporte.

### Créditos

No cartão "Prestações mensais" aparece a taxa de esforço: quanto das tuas entradas vai para as prestações, com a média das entradas dos últimos 12 meses completos. Até 35% é confortável; acima de 50% (o limite que o Banco de Portugal usa nos créditos novos), aparece também um aviso em "A ver".

Os juros de cada mês saem do saldo e da prestação que registas. Para saber quando acabas de pagar, preenche o fim do contrato na ficha do crédito. Para registar uma amortização antiga, abre "Atualizar mês", escolhe esse mês e preenche a amortização extra.

Em "Simular amortização" escreves quanto queres amortizar (e a comissão, se houver) e vês quanto poupas em juros a reduzir a prestação ou a reduzir o prazo. Precisa da taxa e da prestação ou do fim do contrato. É só uma simulação, não grava nada.

No mesmo sítio dá para comparar com investir esse dinheiro: escreves a rentabilidade por ano e vês quanto rendia durante o prazo que falta, já com o imposto de 28% sobre o ganho, e o que compensa mais. A app diz também a partir de que rentabilidade investir passa a compensar. Amortizar é garantido; investir tem risco.

Por baixo, "E se a taxa subir?": escreves a taxa nova (ou carregas em +0,5%, +1% ou +2%, que somam à taxa de hoje) e vês a prestação nova com o mesmo prazo, como o banco faz numa revisão da taxa, quanto pagas a mais por mês e de juros até ao fim, e a taxa de esforço com essa prestação. Também dá para uma taxa mais baixa.

### Património

Para juntar um imóvel basta o nome e o valor atual. O preço de compra e o crédito associado são opcionais e servem para ver a valorização e quanto da casa já é teu.

### Utilizadores (só para administradores)

As contas de administrador têm o selo Admin ao lado do email e um separador a mais, Utilizadores. Lá aparecem todas as contas, com o estado, a data de criação, o último login e o número de logins, e os últimos 200 logins de toda a gente (hora de Portugal), com um filtro por utilizador.

Também é aí que se criam contas novas (a pessoa recebe o convite por email), se reenvia o convite enquanto a pessoa ainda não escolheu a password, se desativa ou reativa uma conta e se repõe a password, que aparece só uma vez para a dares à pessoa. Uma conta desativada deixa de conseguir entrar, mas os dados ficam guardados. Depois de desativada pode ser apagada de vez, com todos os dados, e isso não se desfaz.

Estas ações não existem para contas de administrador, e pela app ninguém passa a administrador nem deixa de o ser. Pela app, o administrador também não vê os dados financeiros de ninguém. Renovar a sessão sem pôr a password não conta como login.

## Backup e importar

O botão Backup, na barra lateral, descarrega todos os teus dados em CSV: contas (com o tipo e o saldo inicial), movimentos, investimentos, créditos e património.

Se ligares o "Backup diário", recebes os mesmos CSV no email da tua conta todos os dias à meia-noite, hora de Portugal, com o assunto "BACKUP Ledger dia DD/MM/AAAA". Vem desligado e podes desligá-lo quando quiseres. Se ao ligar a app disser que o email ainda não está confirmado, carrega no link do email que a Amazon Web Services te mandou quando a conta foi criada (vê também no spam). Se não o encontrares, pede ao administrador para o enviar outra vez.

O botão Importar, em cada separador, serve para recuperar um backup ou trazer dados de outro lado: os modelos CSV (descarregam-se na própria janela), CSV do Excel, exportações de uma corretora (transações e portefólio, com o ISIN) e movimentos do banco em CSV. Se o banco puser os dados da conta antes dos movimentos, a app lê o ficheiro sozinha. Com os outros, reconhece as colunas (data, descrição, valor ou débito/crédito, saldo) e mostra-tas para confirmares ou corrigires. Da próxima vez já se lembra das colunas e da conta.

Nos extratos podes importar vários ficheiros de uma vez e escolher a conta da app. A categoria de cada movimento é adivinhada pela descrição, e se mudares uma, os próximos iguais passam a seguir essa. Se o extrato tiver saldos, a app confere no fim se o saldo do último dia bate com o dela e avisa se não bater.

Para recuperar um backup, importa os ficheiros um a um, com o dos créditos antes do do património (a casa fica ligada ao crédito). Importar o mesmo ficheiro duas vezes não duplica nada.
