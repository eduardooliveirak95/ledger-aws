"""
Backend do Ledger - código das duas funções AWS Lambda:
    handler        API chamada pelo API Gateway (HTTP API, formato de evento v2)
    daily_backup   backup diário por email, chamado pelo EventBridge Scheduler à meia-noite (hora de Portugal)

Sem dependências externas: só usa a biblioteca padrão do Python + boto3
(que já vem incluído no runtime Python da Lambda, por isso não é preciso empacotar nada).

Todos os dados vivem numa ÚNICA tabela DynamoDB ("single-table design"):
    user_id (partition key) = "sub" do utilizador no Cognito -> cada utilizador só vê os seus dados
    sk      (sort key)      = "<TIPO>_..."                    -> o prefixo diz que tipo de item é

    ACC_<hex>                    conta bancária
    TX_<AAAA-MM-DD>_<hex>        movimento de dinheiro (entrada / saída / transferência entre contas)
    INV_<hex>                    investimento (ETF, PPR, cripto...)
    IMV_<AAAA-MM-DD>_<hex>       movimento de investimento (aporte / resgate)
    VAL_<invhex>_<AAAA-MM>       valor de um investimento no fim do mês (um por mês)
    LOAN_<hex>                   crédito / empréstimo
    LBAL_<loanhex>_<AAAA-MM>     saldo em dívida de um crédito no fim do mês (um por mês),
                                 com a prestação paga e a amortização extraordinária desse mês
    PROP_<hex>                   imóvel (casa, terreno...) com o valor atual
    BFMT_<hex>                   colunas escolhidas para os CSV de um banco (importar extratos)

Além das partições dos utilizadores há uma partição do sistema:
    user_id = "DAILY_BACKUP", sk = <sub>   um item por utilizador que ativou o backup diário por email

Como a data faz parte da sort key, uma Query com begins_with("TX_") devolve os
movimentos já ordenados por data, sem ser preciso ordenar no código.

Rotas:
    GET    /data          tudo o que pertence ao utilizador autenticado (os cálculos são feitos no browser)
    POST   /items         criar / atualizar muitos itens de uma vez  {"items": [...], "delete": [...]}
    DELETE /items/{id}    apagar um item (+ os "filhos" no caso de contas / investimentos / créditos)
    GET    /settings      definições do utilizador ({"daily_backup": true/false})
    POST   /settings      mudar as definições  {"daily_backup": true/false}
"""

import base64
import json
import os
import re
import traceback
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config

# ── LIMITES ──────────────────────────────────────────────────────────────────
MAX_ITEMS_PER_REQUEST = 300   # máximo de itens (gravar + apagar) num único POST /items
MAX_NAME = 60                 # comprimento máximo de nomes (conta, investimento, categoria...)
MAX_TEXT = 500                # comprimento máximo de descrições e notas
MAX_BACKUP_BYTES = 6_000_000  # tamanho total dos CSV num email (o SES aceita até 10 MB com os anexos)

# Partição do sistema com quem ativou o backup diário (sk = sub do utilizador; ver o início do ficheiro)
DAILY_BACKUP_PK = "DAILY_BACKUP"

# Tipo de item (nome usado pelo frontend) -> prefixo da sort key no DynamoDB
KIND_PREFIX = {
    "account": "ACC",
    "transaction": "TX",
    "investment": "INV",
    "inv_move": "IMV",
    "valuation": "VAL",
    "loan": "LOAN",
    "loan_balance": "LBAL",
    "property": "PROP",
    "bank_format": "BFMT",
}
# O mesmo mapa ao contrário: prefixo -> tipo (para descobrir o tipo a partir da sk)
PREFIX_KIND = {v: k for k, v in KIND_PREFIX.items()}
# Tipo de item -> nome da lista onde aparece na resposta de GET /data
COLLECTION = {
    "account": "accounts",
    "transaction": "transactions",
    "investment": "investments",
    "inv_move": "inv_moves",
    "valuation": "valuations",
    "loan": "loans",
    "loan_balance": "loan_balances",
    "property": "properties",
    "bank_format": "bank_formats",
}

# Expressões regulares que validam o formato de cada id (= sort key).
# O grupo ( ) captura o identificador hexadecimal de 12 caracteres.
HEX = r"[0-9a-f]{12}"
ID_RE = {
    "account": re.compile(rf"^ACC_({HEX})$"),
    "transaction": re.compile(rf"^TX_\d{{4}}-\d{{2}}-\d{{2}}_({HEX})$"),
    "investment": re.compile(rf"^INV_({HEX})$"),
    "inv_move": re.compile(rf"^IMV_\d{{4}}-\d{{2}}-\d{{2}}_({HEX})$"),
    "valuation": re.compile(rf"^VAL_({HEX})_\d{{4}}-\d{{2}}$"),
    "loan": re.compile(rf"^LOAN_({HEX})$"),
    "loan_balance": re.compile(rf"^LBAL_({HEX})_\d{{4}}-\d{{2}}$"),
    "property": re.compile(rf"^PROP_({HEX})$"),
    "bank_format": re.compile(rf"^BFMT_({HEX})$"),
}
# Formato das chaves da primeira versão da app ("AAAA-MM-DD_<16 hex>"), para as migrar
LEGACY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_[0-9a-f]{16}$")

# Ligação à tabela, criada só uma vez por contentor Lambda e reutilizada entre pedidos
_table = None
_ses = None
_cognito = None


def table():
    """Devolve o objeto da tabela DynamoDB (criado na primeira chamada e depois reutilizado).

    Criar o cliente fora de cada pedido poupa tempo: a Lambda reaproveita o mesmo
    contentor para vários pedidos seguidos ("warm start").
    As tentativas "adaptive" repetem automaticamente pedidos recusados por excesso de
    capacidade (a tabela tem só 25 unidades de leitura/escrita).
    O nome da tabela vem da variável de ambiente TABLE_NAME, definida no template.yaml.
    """
    global _table
    if _table is None:
        ddb = boto3.resource("dynamodb", config=Config(retries={"max_attempts": 10, "mode": "adaptive"}))
        _table = ddb.Table(os.environ["TABLE_NAME"])
    return _table


def ses():
    """Cliente do Amazon SES (envio de emails), criado na primeira chamada e depois reutilizado."""
    global _ses
    if _ses is None:
        _ses = boto3.client("sesv2")
    return _ses


def cognito():
    """Cliente do Cognito (lista de utilizadores, para o backup diário), criado na primeira chamada."""
    global _cognito
    if _cognito is None:
        _cognito = boto3.client("cognito-idp")
    return _cognito


# ── FUNÇÕES AUXILIARES ───────────────────────────────────────────────────────
class ApiError(Exception):
    """Erro "esperado" que deve chegar ao browser com um código HTTP (ex.: 400 pedido inválido)."""

    def __init__(self, status, detail):
        super().__init__(detail)
        self.status = status   # código HTTP a devolver
        self.detail = detail   # mensagem mostrada ao utilizador


def _json_default(o):
    """Ensina o json.dumps a converter Decimal (tipo numérico do DynamoDB) em número JSON."""
    if isinstance(o, Decimal):
        return float(o)
    raise TypeError(f"Not serializable: {type(o)}")


def response(status, body=None):
    """Monta a resposta no formato que o API Gateway espera (código, cabeçalhos e corpo em texto)."""
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": "" if body is None else json.dumps(body, default=_json_default),
    }


def read_body(event):
    """Lê o corpo JSON de um pedido (o API Gateway pode enviá-lo codificado em base64). Tem de ser um objeto."""
    raw_body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw_body = base64.b64decode(raw_body).decode("utf-8")
    try:
        body = json.loads(raw_body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ApiError(400, "O corpo do pedido tem de ser JSON")
    if not isinstance(body, dict):
        raise ApiError(400, "O corpo do pedido tem de ser um objeto JSON")
    return body


def now_iso():
    """Data e hora atuais em UTC, formato ISO (ex.: 2026-09-30T09:00:00+00:00). Vai para "updated_at"."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_hex():
    """Gera um identificador aleatório de 12 caracteres hexadecimais (a parte única de cada id)."""
    return uuid.uuid4().hex[:12]


def kind_of(sk):
    """Descobre o tipo de item pelo prefixo da sort key ("TX_2026-..." -> "transaction"). None se não conhecer."""
    return PREFIX_KIND.get(sk.split("_", 1)[0])


def hex_of(item_id, kind):
    """Extrai a parte hexadecimal de um id do tipo indicado ("INV_ab12..." -> "ab12..."). None se não bater certo."""
    m = ID_RE[kind].match(item_id or "")
    return m.group(1) if m else None


# ── VALIDADORES ──────────────────────────────────────────────────────────────
# Cada v_* recebe um valor vindo do browser e devolve-o limpo e no tipo certo,
# ou lança ValueError com uma mensagem em português que chega ao utilizador.

def v_date(value, field="date"):
    """Valida uma data no formato AAAA-MM-DD (rejeita, por exemplo, 2026-02-30)."""
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d").strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        raise ValueError(f"{field}: data inválida '{value}' (use AAAA-MM-DD)")


def v_month(value, field="month"):
    """Valida um mês no formato AAAA-MM."""
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m").strftime("%Y-%m")
    except (ValueError, TypeError):
        raise ValueError(f"{field}: mês inválido '{value}' (use AAAA-MM)")


def v_num(value, field, minimum=None, positive=False, optional=False):
    """Valida um valor em euros e arredonda-o a 2 casas decimais.

    Usa Decimal (e não float) porque o DynamoDB exige Decimal e porque evita erros
    de arredondamento com dinheiro (0.1 + 0.2 != 0.3 em float).
      minimum  -> valor mínimo permitido (ex.: 0 para saldos)
      positive -> tem de ser maior que zero (ex.: montante de um movimento)
      optional -> campo vazio devolve None em vez de dar erro
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        if optional:
            return None
        raise ValueError(f"{field}: valor em falta")
    # Em Python, True/False também são números (1/0): rejeitar explicitamente
    if isinstance(value, bool):
        raise ValueError(f"{field}: valor inválido")
    try:
        d = Decimal(str(value).strip()).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        raise ValueError(f"{field}: valor inválido '{value}'")
    # Recusa infinito/NaN e valores absurdos (mais de mil milhões)
    if not d.is_finite() or abs(d) > Decimal("1000000000"):
        raise ValueError(f"{field}: valor inválido '{value}'")
    if positive and d <= 0:
        raise ValueError(f"{field}: tem de ser maior que 0")
    if minimum is not None and d < minimum:
        raise ValueError(f"{field}: tem de ser >= {minimum}")
    return d


def v_rate(value):
    """Valida uma taxa de juro em % (0 a 100, 3 casas decimais). Vazio devolve None (taxa opcional)."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        d = Decimal(str(value).strip()).quantize(Decimal("0.001"))
    except (InvalidOperation, ValueError):
        raise ValueError(f"rate: taxa inválida '{value}'")
    if not d.is_finite() or d < 0 or d > 100:
        raise ValueError("rate: taxa entre 0 e 100")
    return d


def v_text(value, field, max_len, required=False):
    """Limpa um texto (tira espaços nas pontas) e corta-o ao comprimento máximo. required -> não pode ficar vazio."""
    s = str(value if value is not None else "").strip()[:max_len]
    if required and not s:
        raise ValueError(f"{field}: obrigatório")
    return s


def v_ref(value, kind, field):
    """Valida uma referência a outro item (ex.: account_id de um movimento tem de ser um id ACC_ válido)."""
    if not ID_RE[kind].match(str(value or "")):
        raise ValueError(f"{field}: referência inválida")
    return str(value)


def v_choice(value, field, choices):
    """Valida que o valor é uma das opções permitidas (ex.: direction em "in", "out", "transfer")."""
    v = str(value or "").strip()
    if v not in choices:
        raise ValueError(f"{field}: tem de ser {', '.join(choices)}")
    return v


# ── CONSTRUÇÃO / VALIDAÇÃO DE ITENS ──────────────────────────────────────────
def build(user, raw):
    """Valida um item enviado pelo browser e converte-o no formato guardado no DynamoDB.

    Devolve (item_dynamodb, id_antigo_a_apagar_ou_None).

    O id_antigo existe porque a data faz parte da sort key: se editares a data de um
    movimento, a chave muda (TX_2026-01-01_x -> TX_2026-01-05_x), por isso grava-se o
    item novo e apaga-se o antigo. O mesmo hex é mantido para o id continuar reconhecível.
    O user_id vem sempre do token (parâmetro user), nunca do que o browser envia.
    """
    if not isinstance(raw, dict):
        raise ValueError("item inválido")
    kind = raw.get("kind")
    if kind not in KIND_PREFIX:
        raise ValueError(f"kind desconhecido '{kind}'")
    old_id = raw.get("id") or None
    if old_id is not None and not ID_RE[kind].match(str(old_id)):
        raise ValueError("id inválido")
    # Ao editar, reaproveita o hex do id existente; ao criar, gera um novo.
    # (valuation e loan_balance não têm hex próprio: a chave é o investimento/crédito + o mês)
    h = hex_of(old_id, kind) if old_id and kind in ("account", "transaction", "investment", "inv_move", "loan", "property", "bank_format") else None
    h = h or new_hex()

    item = {"user_id": user, "updated_at": now_iso()}

    if kind == "account":
        # Conta bancária: nome, tipo, saldo inicial e data a partir da qual o saldo conta
        item.update(
            sk=f"ACC_{h}",
            name=v_text(raw.get("name"), "name", MAX_NAME, required=True),
            acc_type=v_text(raw.get("acc_type") or "Conta à ordem", "acc_type", 30),
            opening_balance=v_num(raw.get("opening_balance", 0), "opening_balance"),
            opening_date=v_date(raw.get("opening_date"), "opening_date"),
            archived=bool(raw.get("archived", False)),
        )
    elif kind == "transaction":
        # Movimento: entrada, saída ou transferência entre duas contas
        date = v_date(raw.get("date"))
        direction = v_choice(raw.get("direction"), "direction", ("in", "out", "transfer"))
        item.update(
            sk=f"TX_{date}_{h}",
            date=date,
            account_id=v_ref(raw.get("account_id"), "account", "account_id"),
            direction=direction,
            category=v_text(raw.get("category") or ("Transferência" if direction == "transfer" else "Outros"), "category", MAX_NAME),
            description=v_text(raw.get("description"), "description", MAX_TEXT),
            amount=v_num(raw.get("amount"), "amount", positive=True),
            approx=bool(raw.get("approx", False)),   # True = total aproximado ("Histórico por mês")
        )
        if direction == "transfer":
            # Uma transferência precisa da conta de destino, diferente da de origem
            item["to_account_id"] = v_ref(raw.get("to_account_id"), "account", "to_account_id")
            if item["to_account_id"] == item["account_id"]:
                raise ValueError("transferência: as contas têm de ser diferentes")
    elif kind == "investment":
        # Investimento (o ISIN, se existir, fica guardado nas notas: "ISIN: ...")
        item.update(
            sk=f"INV_{h}",
            name=v_text(raw.get("name"), "name", MAX_NAME, required=True),
            inv_type=v_text(raw.get("inv_type") or "Outro", "inv_type", 30),
            notes=v_text(raw.get("notes"), "notes", MAX_TEXT),
            archived=bool(raw.get("archived", False)),
        )
    elif kind == "inv_move":
        # Aporte (dinheiro que entra no investimento) ou resgate (dinheiro que sai)
        date = v_date(raw.get("date"))
        item.update(
            sk=f"IMV_{date}_{h}",
            date=date,
            investment_id=v_ref(raw.get("investment_id"), "investment", "investment_id"),
            move=v_choice(raw.get("move"), "move", ("contribution", "withdrawal")),
            amount=v_num(raw.get("amount"), "amount", positive=True),
            description=v_text(raw.get("description"), "description", MAX_TEXT),
            approx=bool(raw.get("approx", False)),
        )
    elif kind == "valuation":
        # Valor de mercado de um investimento no fim de um mês.
        # A chave é investimento + mês, por isso gravar o mesmo mês outra vez substitui o valor.
        inv = v_ref(raw.get("investment_id"), "investment", "investment_id")
        month = v_month(raw.get("month"))
        item.update(
            sk=f"VAL_{hex_of(inv, 'investment')}_{month}",
            investment_id=inv,
            month=month,
            value=v_num(raw.get("value"), "value", minimum=0),
        )
    elif kind == "loan":
        # Crédito: montante inicial, taxa e prestação (estes dois são opcionais)
        item.update(
            sk=f"LOAN_{h}",
            name=v_text(raw.get("name"), "name", MAX_NAME, required=True),
            loan_type=v_text(raw.get("loan_type") or "Outro", "loan_type", 30),
            lender=v_text(raw.get("lender"), "lender", MAX_NAME),
            principal=v_num(raw.get("principal"), "principal", minimum=0),
            start_date=v_date(raw.get("start_date"), "start_date"),
            notes=v_text(raw.get("notes"), "notes", MAX_TEXT),
            archived=bool(raw.get("archived", False)),
        )
        rate = v_rate(raw.get("rate"))
        payment = v_num(raw.get("payment"), "payment", minimum=0, optional=True)
        # Os campos opcionais só são gravados se tiverem valor
        if rate is not None:
            item["rate"] = rate
        if payment is not None:
            item["payment"] = payment
        # Data da última prestação prevista no contrato (opcional). Com taxa variável, o banco ajusta
        # a prestação para manter este prazo, por isso é a melhor resposta a "quando acabo de pagar?"
        if str(raw.get("end_date") or "").strip():
            item["end_date"] = v_date(raw.get("end_date"), "end_date")
            if item["end_date"] <= item["start_date"]:
                raise ValueError("end_date: o fim do contrato tem de ser depois do início")
    elif kind == "loan_balance":
        # Saldo em dívida de um crédito no fim de um mês (chave = crédito + mês, tal como VAL_)
        loan = v_ref(raw.get("loan_id"), "loan", "loan_id")
        month = v_month(raw.get("month"))
        item.update(
            sk=f"LBAL_{hex_of(loan, 'loan')}_{month}",
            loan_id=loan,
            month=month,
            balance=v_num(raw.get("balance"), "balance", minimum=0),
        )
        # Prestação paga nesse mês e amortização extraordinária (ambas opcionais).
        # Com a prestação, o saldo anterior e a amortização extra, o browser calcula os juros do mês.
        payment = v_num(raw.get("payment"), "payment", minimum=0, optional=True)
        if payment is not None:
            item["payment"] = payment
        extra = v_num(raw.get("extra"), "extra", minimum=0, optional=True)
        if extra:   # 0 ou vazio não se grava
            item["extra"] = extra
    elif kind == "property":
        # Imóvel: valor atual (conta para o património líquido) e, opcionalmente, compra e crédito associado
        item.update(
            sk=f"PROP_{h}",
            name=v_text(raw.get("name"), "name", MAX_NAME, required=True),
            prop_type=v_text(raw.get("prop_type") or "Habitação própria", "prop_type", 30),
            value=v_num(raw.get("value"), "value", minimum=0),
            notes=v_text(raw.get("notes"), "notes", MAX_TEXT),
            archived=bool(raw.get("archived", False)),
        )
        # Os campos opcionais só são gravados se tiverem valor
        purchase_price = v_num(raw.get("purchase_price"), "purchase_price", minimum=0, optional=True)
        if purchase_price is not None:
            item["purchase_price"] = purchase_price
        if str(raw.get("purchase_date") or "").strip():
            item["purchase_date"] = v_date(raw.get("purchase_date"), "purchase_date")
        # Crédito que financiou o imóvel: serve para mostrar quanto da casa já é teu (valor − dívida)
        if str(raw.get("loan_id") or "").strip():
            item["loan_id"] = v_ref(raw.get("loan_id"), "loan", "loan_id")

    elif kind == "bank_format":
        # Colunas de um formato de CSV de outro banco (a assinatura é o cabeçalho do ficheiro, normalizado).
        # columns: posição de cada coluna (0, 1, 2...) ou -1 se não houver; é preciso a data e um valor.
        raw_cols = raw.get("columns")
        if not isinstance(raw_cols, dict):
            raise ValueError("columns: inválido")
        cols = {}
        for k in ("date", "desc", "amount", "debit", "credit", "balance"):
            v = raw_cols.get(k, -1)
            if isinstance(v, bool) or not isinstance(v, int) or not -1 <= v <= 99:
                raise ValueError(f"columns.{k}: inválido")
            cols[k] = v
        if cols["date"] < 0 or max(cols["amount"], cols["debit"], cols["credit"]) < 0:
            raise ValueError("columns: falta a data ou o valor")
        item.update(
            sk=f"BFMT_{h}",
            name=v_text(raw.get("name"), "name", MAX_NAME, required=True),
            signature=v_text(raw.get("signature"), "signature", MAX_TEXT, required=True),
            columns=cols,
        )
        # Conta da app onde estes extratos foram importados da última vez (para a escolher sozinha)
        if str(raw.get("account_id") or "").strip():
            item["account_id"] = v_ref(raw.get("account_id"), "account", "account_id")

    # Se o id mudou (ex.: nova data), o antigo tem de ser apagado
    stale = old_id if old_id and old_id != item["sk"] else None
    return item, stale


def to_public(item):
    """Converte um item do DynamoDB no formato enviado ao browser: tira o user_id, "sk" passa a "id" e junta "kind"."""
    out = {k: v for k, v in item.items() if k != "user_id"}
    out["id"] = out.pop("sk")
    out["kind"] = kind_of(out["id"])
    return out


def empty_collections():
    """Resposta vazia de GET /data: uma lista vazia por cada tipo de item."""
    return {c: [] for c in COLLECTION.values()}


# ── ACESSO AOS DADOS ─────────────────────────────────────────────────────────
def query_all(user, prefix=None):
    """Lê todos os itens de um utilizador (opcionalmente só os que começam por um prefixo, ex.: "TX_").

    Usa Query (e não Scan): só lê a partição deste utilizador, por isso é rápido e barato.
    O DynamoDB devolve no máximo 1 MB por resposta; quando há mais, vem "LastEvaluatedKey"
    e o ciclo pede a página seguinte a partir daí (paginação).
    """
    cond = Key("user_id").eq(user)
    if prefix:
        cond = cond & Key("sk").begins_with(prefix)
    kwargs = {"KeyConditionExpression": cond}
    items = []
    while True:
        r = table().query(**kwargs)
        items.extend(r["Items"])
        if not r.get("LastEvaluatedKey"):
            return items
        kwargs["ExclusiveStartKey"] = r["LastEvaluatedKey"]


def write_and_delete(user, puts, deletes):
    """Grava e apaga muitos itens de uma vez com o batch_writer do boto3.

    O batch_writer agrupa os pedidos em lotes de 25 (limite do DynamoDB) e repete
    automaticamente os que não foram processados. overwrite_by_pkeys evita erros se a
    mesma chave aparecer duas vezes no mesmo lote.
    """
    with table().batch_writer(overwrite_by_pkeys=["user_id", "sk"]) as bw:
        for it in puts:
            bw.put_item(Item=it)
        for sk in deletes:
            bw.delete_item(Key={"user_id": user, "sk": sk})


# ── MIGRAÇÃO DOS DADOS ANTIGOS (registos da primeira versão da app) ─────────
def migrate_legacy(user, items):
    """Converte automaticamente os registos da versão antiga da app para o modelo atual.

    Corre em cada GET /data, mas só faz alguma coisa se existirem chaves no formato antigo.
    - despesas e receitas -> movimentos (TX_) numa conta "Conta principal" (criada se não houver contas)
    - investimentos      -> aportes (IMV_) num investimento "Investimentos (importado)"
    No fim apaga os registos antigos e devolve a lista de itens já atualizada.
    """
    legacy = [i for i in items if LEGACY_RE.match(i["sk"])]
    if not legacy:
        return items

    accounts = [i for i in items if i["sk"].startswith("ACC_")]
    investments = [i for i in items if i["sk"].startswith("INV_")]
    puts = []

    # Conta de destino: a primeira que já exista, ou uma nova "Conta principal"
    if accounts:
        acc_id = accounts[0]["sk"]
    else:
        first_date = min(i["date"] for i in legacy)
        acc = {"user_id": user, "sk": f"ACC_{new_hex()}", "name": "Conta principal",
               "acc_type": "Conta à ordem", "opening_balance": Decimal("0.00"),
               "opening_date": first_date, "archived": False, "updated_at": now_iso()}
        puts.append(acc)
        acc_id = acc["sk"]

    # Investimento de destino, só criado se houver registos antigos do tipo "investment"
    inv_id = None
    if any(i.get("type") == "investment" for i in legacy):
        inv = {"user_id": user, "sk": f"INV_{new_hex()}", "name": "Investimentos (importado)",
               "inv_type": "Outro", "notes": "Criado automaticamente a partir da versão antiga",
               "archived": False, "updated_at": now_iso()}
        puts.append(inv)
        inv_id = inv["sk"]

    for i in legacy:
        amount = Decimal(i["amount"]).quantize(Decimal("0.01"))
        desc = i.get("description", "") or ""
        if i.get("type") == "investment":
            # A categoria antiga passa para o início da descrição (ex.: "ETF: compra mensal")
            if i.get("category"):
                desc = f"{i['category']}: {desc}".strip(": ").strip()
            puts.append({"user_id": user, "sk": f"IMV_{i['date']}_{new_hex()}", "date": i["date"],
                         "investment_id": inv_id, "move": "contribution", "amount": amount,
                         "description": desc, "approx": False, "updated_at": now_iso()})
        else:
            # "income" vira entrada; tudo o resto (despesa) vira saída
            puts.append({"user_id": user, "sk": f"TX_{i['date']}_{new_hex()}", "date": i["date"],
                         "account_id": acc_id, "direction": "in" if i.get("type") == "income" else "out",
                         "category": i.get("category") or "Outros", "description": desc,
                         "amount": amount, "approx": False, "updated_at": now_iso()})

    write_and_delete(user, puts, [i["sk"] for i in legacy])
    legacy_keys = {i["sk"] for i in legacy}
    return [i for i in items if i["sk"] not in legacy_keys] + puts


def _plain(s):
    """Texto em minúsculas e sem acentos ("Transferências" -> "transferencias")."""
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn").lower().strip()


def migrate_transfer_categories(user, items):
    """Entradas e saídas na categoria "Transferências" passam a "Transferências in" / "Transferências out".

    As transferências entre contas próprias (direction "transfer") ficam como estão.
    Corre em cada GET /data, mas só grava alguma coisa se ainda houver categorias antigas.
    """
    puts = []
    for i in items:
        if i["sk"].startswith("TX_") and i.get("direction") in ("in", "out") \
                and _plain(i.get("category")) in ("transferencia", "transferencias"):
            i["category"] = "Transferências in" if i["direction"] == "in" else "Transferências out"
            i["updated_at"] = now_iso()
            puts.append(i)
    if puts:
        write_and_delete(user, puts, [])
    return items


# ── ROTAS ────────────────────────────────────────────────────────────────────
def get_data(user):
    """GET /data: devolve todos os itens do utilizador, agrupados por tipo ({"accounts": [...], ...})."""
    items = migrate_transfer_categories(user, migrate_legacy(user, query_all(user)))
    out = empty_collections()
    for i in items:
        kind = kind_of(i["sk"])
        if kind:   # ignora itens com prefixos desconhecidos
            out[COLLECTION[kind]].append(to_public(i))
    return out


def post_items(user, event):
    """POST /items: valida e grava vários itens, e apaga os ids pedidos em "delete".

    Tudo ou nada na validação: se algum item for inválido, não se grava nenhum e o
    browser recebe um 400 com (até 10) mensagens de erro.
    """
    body = read_body(event)
    raw_items = body.get("items") or []
    raw_deletes = body.get("delete") or []
    if not isinstance(raw_items, list) or not isinstance(raw_deletes, list):
        raise ApiError(400, "items e delete têm de ser listas")
    if len(raw_items) + len(raw_deletes) > MAX_ITEMS_PER_REQUEST:
        raise ApiError(400, f"Máximo de {MAX_ITEMS_PER_REQUEST} itens por pedido")

    # Valida tudo primeiro, juntando os erros (numerados a partir de 1, como as linhas de um CSV)
    puts, deletes, errors = [], set(), []
    for n, raw in enumerate(raw_items):
        try:
            item, stale = build(user, raw)
            puts.append(item)
            if stale:
                deletes.add(stale)
        except ValueError as e:
            errors.append(f"Item {n + 1}: {e}")
    for d in raw_deletes:
        if not isinstance(d, str) or not kind_of(d) or not ID_RE[kind_of(d)].match(d):
            errors.append(f"delete: id inválido '{d}'")
        else:
            deletes.add(d)
    if errors:
        raise ApiError(400, "; ".join(errors[:10]))

    # Nunca apagar uma chave que vai ser gravada neste mesmo pedido
    put_keys = {p["sk"] for p in puts}
    deletes -= put_keys
    # Remove repetidos com a mesma chave (fica o último)
    unique = {p["sk"]: p for p in puts}
    write_and_delete(user, list(unique.values()), sorted(deletes))
    return {"saved": [to_public(p) for p in unique.values()], "deleted": sorted(deletes)}


def delete_item(user, item_id):
    """DELETE /items/{id}: apaga um item e, em cascata, os itens que dependem dele.

    conta        -> também os movimentos dessa conta (como origem ou destino)
    investimento -> também os aportes/resgates e os valores mensais
    crédito      -> também os saldos mensais
    (um imóvel não tem filhos; se o crédito associado for apagado, o imóvel fica sem crédito)
    """
    kind = kind_of(item_id or "")
    if not kind or not ID_RE[kind].match(item_id):
        raise ApiError(400, "id inválido")

    to_delete = {item_id}
    if kind == "account":
        for t in query_all(user, "TX_"):
            if t.get("account_id") == item_id or t.get("to_account_id") == item_id:
                to_delete.add(t["sk"])
    elif kind == "investment":
        h = hex_of(item_id, "investment")
        to_delete.update(m["sk"] for m in query_all(user, "IMV_") if m.get("investment_id") == item_id)
        to_delete.update(v["sk"] for v in query_all(user, f"VAL_{h}_"))
    elif kind == "loan":
        h = hex_of(item_id, "loan")
        to_delete.update(b["sk"] for b in query_all(user, f"LBAL_{h}_"))

    write_and_delete(user, [], sorted(to_delete))
    return {"deleted": sorted(to_delete)}


def get_settings(user):
    """GET /settings: definições do utilizador. Por agora só uma: se o backup diário por email está ativo."""
    r = table().get_item(Key={"user_id": DAILY_BACKUP_PK, "sk": user})
    return {"daily_backup": "Item" in r}


def post_settings(user, email, event):
    """POST /settings: ativa ou desativa o backup diário por email  {"daily_backup": true/false}.

    Ativar grava um item na partição DAILY_BACKUP (com o sub do utilizador); desativar apaga-o.
    O email não é guardado: o backup diário vai sempre para o email atual da conta no Cognito.
    """
    body = read_body(event)
    daily = body.get("daily_backup")
    if not isinstance(daily, bool):
        raise ApiError(400, "daily_backup: tem de ser true ou false")
    if daily:
        if not email:
            raise ApiError(400, "A tua conta não tem email associado")
        table().put_item(Item={"user_id": DAILY_BACKUP_PK, "sk": user, "since": now_iso()})
    else:
        table().delete_item(Key={"user_id": DAILY_BACKUP_PK, "sk": user})
    return {"daily_backup": daily}


# ── BACKUP DIÁRIO POR EMAIL ──────────────────────────────────────────────────
# Os mesmos 5 CSV do botão "Backup" da app (exportRows/toCSV no frontend/js/csv.js), gerados aqui
# a partir do DynamoDB. Os cabeçalhos têm de ser iguais aos do FORMATS do csv.js (há um teste que
# o confirma), para o backup se poder recuperar com "Importar".
BACKUP_FORMATS = {
    "contas": ["Conta", "Tipo de conta", "Saldo inicial", "Data do saldo inicial"],
    "movimentos": ["Data", "Conta", "Tipo", "Categoria", "Descrição", "Valor", "Conta destino", "Aproximado"],
    "investimentos": ["Data", "Investimento", "Tipo de investimento", "Operação", "Valor", "Descrição"],
    "creditos": ["Mês", "Crédito", "Tipo de crédito", "Saldo em dívida", "Prestação", "Montante inicial",
                 "Data de início", "Taxa (%)", "Banco", "Amortização extra", "Fim do contrato"],
    "patrimonio": ["Imóvel", "Tipo de imóvel", "Valor atual", "Preço de compra", "Data de compra",
                   "Crédito associado", "Notas"],
}
DIRECTION_LABEL = {"in": "Entrada", "out": "Saída", "transfer": "Transferência"}


def csv_cell(v):
    """Uma célula do CSV: valores (Decimal) com 2 casas e vírgula decimal; ; aspas ou quebras de linha vão entre aspas.

    Um texto começado por = + - @ (ou tab) seria lido pelo Excel como fórmula: leva uma ' à frente,
    que o Excel não mostra e que o "Importar" da app tira (como o toCSV/parseCSV do csv.js).
    """
    if v is None:
        return ""
    s = f"{v:.2f}".replace(".", ",") if isinstance(v, Decimal) else str(v)
    if not isinstance(v, Decimal) and re.match(r"[=+\-@\t\r]", s):
        s = "'" + s
    return '"' + s.replace('"', '""') + '"' if re.search(r'[";\n\r]', s) else s


def to_csv(header, rows):
    """Texto de um CSV com ";" (como o toCSV do frontend, para abrir bem no Excel em português)."""
    return "\r\n".join(";".join(csv_cell(c) for c in r) for r in [header, *rows])


def rate_text(rate):
    """Taxa de juro sem zeros a mais e com vírgula (3.125 -> "3,125"; 3.500 -> "3,5"); vazio se não houver."""
    return "" if rate is None else format(Decimal(rate).normalize(), "f").replace(".", ",")


def backup_rows(items):
    """Itens de um utilizador (como vêm do DynamoDB) -> {formato: linhas}, como o exportRows do csv.js."""
    by = {}
    for i in items:
        by.setdefault(kind_of(i["sk"]), []).append(i)
    names = {k: {x["sk"]: x.get("name", "") for x in by.get(k, [])} for k in ("account", "investment", "loan")}

    def by_name(xs):   # ordem alfabética sem ligar a acentos nem maiúsculas (como o sortByName do calc.js)
        return sorted(xs, key=lambda x: (_plain(x.get("name")), x.get("name", "")))

    def acc(i):
        return names["account"].get(i, "(conta apagada)")

    def inv(i):
        return names["investment"].get(i, "(apagado)")

    # contas: tipo e saldo inicial (os movimentos só têm o nome da conta)
    accounts = [[a.get("name", ""), a.get("acc_type", ""), a.get("opening_balance"), a.get("opening_date", "")]
                for a in by_name(by.get("account", []))]

    mov = [[t["date"], acc(t.get("account_id")), DIRECTION_LABEL.get(t.get("direction"), ""), t.get("category", ""),
            t.get("description", ""), t.get("amount"), acc(t.get("to_account_id")) if t.get("direction") == "transfer" else "",
            "sim" if t.get("approx") else "não"]
           for t in sorted(by.get("transaction", []), key=lambda t: t["date"])]

    inv_type = {x["sk"]: x.get("inv_type", "") for x in by.get("investment", [])}
    invs = [[m["date"], inv(m.get("investment_id")), inv_type.get(m.get("investment_id"), ""),
             "Aporte" if m.get("move") == "contribution" else "Resgate", m.get("amount"), m.get("description", "")]
            for m in by.get("inv_move", [])]
    invs += [[v["month"], inv(v.get("investment_id")), inv_type.get(v.get("investment_id"), ""), "Valor", v.get("value"), ""]
             for v in by.get("valuation", [])]
    # investimentos sem nenhum registo também são exportados, para não se perder nada
    used = {r[1] for r in invs}
    invs += [["", i.get("name", ""), i.get("inv_type", ""), "", None, i.get("notes", "")]
             for i in by.get("investment", []) if i.get("name", "") not in used]
    invs.sort(key=lambda r: str(r[0]))

    loans = []
    for l in by_name(by.get("loan", [])):
        meta = [l.get("principal"), l.get("start_date", ""), rate_text(l.get("rate")), l.get("lender", "")]
        bs = sorted((b for b in by.get("loan_balance", []) if b.get("loan_id") == l["sk"]), key=lambda b: b["month"])
        if not bs:
            loans.append(["", l.get("name", ""), l.get("loan_type", ""), None, l.get("payment"), *meta, None, l.get("end_date", "")])
        for b in bs:
            loans.append([b["month"], l.get("name", ""), l.get("loan_type", ""), b.get("balance"),
                          b.get("payment", l.get("payment")), *meta, b.get("extra") or None, l.get("end_date", "")])

    props = [[p.get("name", ""), p.get("prop_type", ""), p.get("value"), p.get("purchase_price"), p.get("purchase_date", ""),
              names["loan"].get(p["loan_id"], "(apagado)") if p.get("loan_id") else "", p.get("notes", "")]
             for p in by_name(by.get("property", []))]
    return {"contas": accounts, "movimentos": mov, "investimentos": invs, "creditos": loans, "patrimonio": props}


def backup_files(user, day):
    """Os CSV do backup de um utilizador: [(nome do ficheiro, texto)], só dos formatos com dados."""
    rows = backup_rows(query_all(user))
    return [(f"ledger-{fmt}-{day}.csv", to_csv(BACKUP_FORMATS[fmt], rows[fmt])) for fmt in BACKUP_FORMATS if rows[fmt]]


def backup_day(now=None):
    """Dia a que o backup diz respeito: o que acabou de terminar quando o envio corre à meia-noite.

    Meia-noite em Portugal é 23:00 UTC no verão e 00:00 UTC no inverno; recuar 12 horas dá sempre
    o dia anterior, sem precisar de tabelas de fusos horários.
    """
    return ((now or datetime.now(timezone.utc)) - timedelta(hours=12)).strftime("%Y-%m-%d")


def send_backup(sender, email, day, files):
    """Envia um email com os CSV em anexo (com BOM, para o Excel abrir bem os acentos)."""
    if sum(len(c.encode("utf-8")) for _, c in files) > MAX_BACKUP_BYTES:
        raise ValueError("backup demasiado grande para enviar por email")
    shown = datetime.strptime(day, "%Y-%m-%d").strftime("%d/%m/%Y")
    msg = MIMEMultipart()
    msg["Subject"] = f"BACKUP Ledger dia {shown}"
    msg["From"] = f"Ledger <{sender}>"
    msg["To"] = email
    names = "\n".join(f"  - {name}" for name, _ in files)
    msg.attach(MIMEText(
        f"Backup automático dos teus dados do Ledger, até ao fim do dia {shown}.\n\nFicheiros em anexo:\n{names}\n\n"
        "Para recuperar os dados, usa \"Importar\" no separador certo da app.\n"
        "Para deixares de receber este email, desliga o \"Backup diário\" no topo da app.\n", "plain", "utf-8"))
    for name, content in files:
        part = MIMEApplication(("\ufeff" + content).encode("utf-8"), _subtype="csv")
        part.add_header("Content-Disposition", "attachment", filename=name)
        msg.attach(part)
    ses().send_email(FromEmailAddress=sender, Destination={"ToAddresses": [email]},
                     Content={"Raw": {"Data": msg.as_bytes()}})


def account_emails():
    """{sub: email} dos utilizadores ativos do Cognito com o email verificado (uma só listagem, de 60 em 60).

    Só emails verificados: o create-user cria as contas já com email_verified=true, e se alguém mudar
    o email da própria conta no Cognito, o novo fica por verificar e o backup deixa de ir para lá.
    """
    out = {}
    kwargs = {"UserPoolId": os.environ["USER_POOL_ID"], "AttributesToGet": ["sub", "email", "email_verified"]}
    while True:
        r = cognito().list_users(**kwargs)
        for u in r["Users"]:
            attrs = {a["Name"]: a["Value"] for a in u.get("Attributes", [])}
            if u.get("Enabled", True) and attrs.get("sub") and attrs.get("email") and attrs.get("email_verified") == "true":
                out[attrs["sub"]] = attrs["email"]
        if not r.get("PaginationToken"):
            return out
        kwargs["PaginationToken"] = r["PaginationToken"]


def daily_backup(event=None, context=None):
    """Função Lambda do backup diário (configurada como "app.daily_backup" no template.yaml).

    O EventBridge Scheduler chama-a todos os dias à meia-noite, hora de Portugal. Para cada
    utilizador que ativou o backup diário, gera os CSV e envia-os para o email da conta no Cognito.
    Contas apagadas ou desativadas no Cognito e contas sem dados são saltadas.
    Um erro num utilizador não impede os outros. Os logs só têm contagens (nem emails nem dados).

    Teste à mão (workflow "Test daily backup" no GitHub): o evento {"only_email": "..."} envia só para
    esse email, e só se for de alguém que ativou o backup. O agendamento não manda nada no evento.
    """
    only = str(event.get("only_email") or "").strip().lower() if isinstance(event, dict) else ""
    subs, kwargs = [], {"KeyConditionExpression": Key("user_id").eq(DAILY_BACKUP_PK)}
    while True:
        r = table().query(**kwargs)
        subs.extend(i["sk"] for i in r["Items"])
        if not r.get("LastEvaluatedKey"):
            break
        kwargs["ExclusiveStartKey"] = r["LastEvaluatedKey"]
    result = {"sent": 0, "skipped": 0, "failed": 0}
    if subs:
        sender, emails, day = os.environ["SENDER_EMAIL"], account_emails(), backup_day()
        if only:
            subs = [sub for sub in subs if emails.get(sub, "").lower() == only]
        for sub in subs:
            try:
                files = backup_files(sub, day) if sub in emails else []
                if not files:
                    result["skipped"] += 1
                    continue
                send_backup(sender, emails[sub], day, files)
                result["sent"] += 1
            except Exception as e:
                # só o tipo de erro (ex.: MessageRejected = email por verificar no SES): a mensagem pode ter o email
                print(json.dumps({"daily_backup_error": getattr(e, "response", {}).get("Error", {}).get("Code") or type(e).__name__}))
                result["failed"] += 1
    print(json.dumps({"daily_backup": result}))
    return result


# ── PONTO DE ENTRADA ─────────────────────────────────────────────────────────
def handler(event, context):
    """Função que a Lambda chama em cada pedido (configurada como "app.handler" no template.yaml).

    1. Lê o "sub" do utilizador das claims do JWT. O API Gateway já validou o token antes de
       chamar a Lambda, por isso este valor é de confiança (o browser não o consegue falsificar).
    2. Encaminha para a função certa conforme a rota ("routeKey", ex.: "GET /data").
    3. Converte erros em respostas HTTP: ApiError -> o código indicado; qualquer outro erro -> 500
       (e o traceback vai para os logs do CloudWatch).
    """
    try:
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        user = claims["sub"]
    except (KeyError, TypeError):
        return response(401, {"detail": "Unauthorized"})

    route = event.get("routeKey", "")
    path = event.get("pathParameters") or {}
    try:
        if route == "GET /data":
            return response(200, get_data(user))
        if route == "POST /items":
            return response(200, post_items(user, event))
        if route == "DELETE /items/{id}":
            return response(200, delete_item(user, path.get("id")))
        if route == "GET /settings":
            return response(200, get_settings(user))
        if route == "POST /settings":
            return response(200, post_settings(user, claims.get("email"), event))
        return response(404, {"detail": f"Rota desconhecida: {route}"})
    except ApiError as e:
        return response(e.status, {"detail": e.detail})
    except Exception:
        traceback.print_exc()   # aparece no CloudWatch Logs
        return response(500, {"detail": "Erro interno do servidor"})
