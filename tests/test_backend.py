"""
Testes do backend. Correm contra um DynamoDB falso (biblioteca moto), por isso não
precisam de conta AWS nem de internet. O GitHub Actions corre-os antes de cada deploy.

    pip install -r requirements-dev.txt
    pytest -q
"""
import json
import os
import sys
from decimal import Decimal
from pathlib import Path

import pytest

# Credenciais e região falsas (o moto não as verifica) e o nome da tabela que a app espera.
# Tem de ser feito ANTES de importar a app, que lê TABLE_NAME.
os.environ.update(AWS_DEFAULT_REGION="eu-west-1", AWS_ACCESS_KEY_ID="test",
                  AWS_SECRET_ACCESS_KEY="test", TABLE_NAME="ledger-test", SENDER_EMAIL="ledger@example.com")
# Permite fazer "import app" a partir da pasta backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

import app  # noqa: E402


@pytest.fixture()
def table():
    """Cria uma tabela DynamoDB falsa, igual à real (user_id + sk), para cada teste.

    Cada teste começa com a tabela vazia. app._table = None obriga a app a ligar-se
    a esta tabela nova em vez de reutilizar a do teste anterior.
    """
    with mock_aws():
        boto3.client("dynamodb").create_table(
            TableName="ledger-test",
            AttributeDefinitions=[{"AttributeName": "user_id", "AttributeType": "S"},
                                  {"AttributeName": "sk", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "user_id", "KeyType": "HASH"},
                       {"AttributeName": "sk", "KeyType": "RANGE"}],
            ProvisionedThroughput={"ReadCapacityUnits": 25, "WriteCapacityUnits": 25},
        )
        app._table = None
        app._ses = None
        yield boto3.resource("dynamodb").Table("ledger-test")
        app._table = None
        app._ses = None


def call(route, user="u1", body=None, path=None, email=None):
    """Simula um pedido do API Gateway à Lambda (com o utilizador já autenticado) e devolve (código, corpo)."""
    claims = {"sub": user, **({"email": email} if email else {})}
    event = {"routeKey": route, "pathParameters": path,
             "body": json.dumps(body) if body is not None else None,
             "requestContext": {"authorizer": {"jwt": {"claims": claims}}}}
    r = app.handler(event, None)
    return r["statusCode"], (json.loads(r["body"]) if r["body"] else None)


def save(items, user="u1", delete=None):
    """Atalho para POST /items que falha o teste se a resposta não for 200."""
    status, body = call("POST /items", user, {"items": items, "delete": delete or []})
    assert status == 200, body
    return body


def test_unauthenticated_request_is_rejected(table):
    """Um pedido sem as claims do JWT recebe 401."""
    assert app.handler({"routeKey": "GET /data"}, None)["statusCode"] == 401


def test_legacy_entries_are_migrated_once(table):
    """Os registos da versão antiga são convertidos no primeiro GET /data, e só uma vez."""
    for i, (d, t, a) in enumerate([("2026-08-01", "income", 1500), ("2026-08-03", "expense", 20.5),
                                   ("2026-08-05", "investment", 100)]):
        table.put_item(Item={"user_id": "u1", "sk": f"{d}_{i:016x}", "date": d, "type": t,
                             "category": "X", "description": "", "amount": Decimal(str(a))})
    _, d1 = call("GET /data")
    assert len(d1["accounts"]) == 1 and len(d1["transactions"]) == 2
    assert len(d1["investments"]) == 1 and len(d1["inv_moves"]) == 1
    _, d2 = call("GET /data")
    assert len(d2["transactions"]) == 2  # a segunda chamada não duplica nada


def test_users_only_see_their_own_data(table):
    """Isolamento: o utilizador u2 não vê a conta criada pelo u1."""
    save([{"kind": "account", "name": "Mine", "opening_balance": 0, "opening_date": "2026-01-01"}])
    _, other = call("GET /data", user="u2")
    assert other["accounts"] == []


def test_changing_a_date_moves_the_item(table):
    """Mudar a data de um movimento muda a sua chave: grava a nova e apaga a antiga."""
    acc = save([{"kind": "account", "name": "A", "opening_balance": 0, "opening_date": "2026-01-01"}])["saved"][0]["id"]
    tx = save([{"kind": "transaction", "date": "2026-09-01", "account_id": acc, "direction": "out",
                "category": "Food", "amount": 10}])["saved"][0]
    r = save([dict(tx, date="2026-09-15")])
    assert r["deleted"] == [tx["id"]]
    assert r["saved"][0]["id"].startswith("TX_2026-09-15_")


def test_one_valuation_per_month(table):
    """Gravar o valor do mesmo investimento no mesmo mês substitui o anterior (não duplica)."""
    inv = save([{"kind": "investment", "name": "ETF"}])["saved"][0]["id"]
    save([{"kind": "valuation", "investment_id": inv, "month": "2026-09", "value": 100}])
    save([{"kind": "valuation", "investment_id": inv, "month": "2026-09", "value": 120}])
    _, d = call("GET /data")
    assert [v["value"] for v in d["valuations"]] == [120]


# O mesmo teste corre uma vez por cada item inválido desta lista
@pytest.mark.parametrize("bad", [
    {"kind": "transaction", "date": "not-a-date", "direction": "out", "amount": 1},
    {"kind": "transaction", "date": "2026-01-01", "direction": "sideways", "amount": 1},
    {"kind": "unknown"},
    {"kind": "valuation", "investment_id": "nope", "month": "2026-01", "value": 1},
])
def test_invalid_items_are_rejected(table, bad):
    """Itens inválidos dão 400 com uma mensagem de erro."""
    status, body = call("POST /items", body={"items": [bad]})
    assert status == 400 and body["detail"]


def test_deleting_parents_cascades(table):
    """Apagar conta, investimento e crédito apaga também movimentos, aportes, valores e saldos ligados."""
    s = save([{"kind": "account", "name": "A", "opening_balance": 0, "opening_date": "2026-01-01"},
              {"kind": "investment", "name": "ETF"},
              {"kind": "loan", "name": "Casa", "principal": 1000, "start_date": "2020-01-01"}])["saved"]
    acc, inv, loan = (x["id"] for x in s)
    save([{"kind": "transaction", "date": "2026-01-02", "account_id": acc, "direction": "in", "category": "S", "amount": 5},
          {"kind": "inv_move", "date": "2026-01-02", "investment_id": inv, "move": "contribution", "amount": 5},
          {"kind": "valuation", "investment_id": inv, "month": "2026-01", "value": 6},
          {"kind": "loan_balance", "loan_id": loan, "month": "2026-01", "balance": 900}])
    for pid in (acc, inv, loan):
        status, _ = call("DELETE /items/{id}", path={"id": pid})
        assert status == 200
    _, d = call("GET /data")
    assert all(not v for v in d.values())


def test_loan_balance_keeps_payment_and_extra(table):
    """O saldo mensal guarda a prestação e a amortização extraordinária; extra vazio ou 0 não é gravado."""
    loan = save([{"kind": "loan", "name": "Casa", "principal": 100000, "start_date": "2024-01-15"}])["saved"][0]["id"]
    save([{"kind": "loan_balance", "loan_id": loan, "month": "2026-07", "balance": 90000, "payment": 500},
          {"kind": "loan_balance", "loan_id": loan, "month": "2026-08", "balance": 84700, "payment": 500, "extra": 5000},
          {"kind": "loan_balance", "loan_id": loan, "month": "2026-09", "balance": 84400, "payment": 480, "extra": ""}])
    _, d = call("GET /data")
    by_month = {b["month"]: b for b in d["loan_balances"]}
    assert by_month["2026-08"]["extra"] == 5000
    assert "extra" not in by_month["2026-07"] and "extra" not in by_month["2026-09"]
    status, _ = call("POST /items", body={"items": [{"kind": "loan_balance", "loan_id": loan, "month": "2026-10",
                                                     "balance": 84000, "extra": -1}]})
    assert status == 400


def test_loan_contract_end_date(table):
    """O fim do contrato é opcional, tem de ser uma data válida e depois do início."""
    ok = save([{"kind": "loan", "name": "Casa", "principal": 1000, "start_date": "2024-02-15", "end_date": "2064-01-15"},
               {"kind": "loan", "name": "Carro", "principal": 1000, "start_date": "2024-02-15", "end_date": ""}])["saved"]
    assert ok[0]["end_date"] == "2064-01-15" and "end_date" not in ok[1]
    status, _ = call("POST /items", body={"items": [{"kind": "loan", "name": "X", "principal": 1,
                                                     "start_date": "2024-02-15", "end_date": "2020-01-01"}]})
    assert status == 400


def test_property_value_and_optional_fields(table):
    """Um imóvel guarda o valor atual; compra e crédito associado são opcionais. Editar mantém o mesmo id."""
    loan = save([{"kind": "loan", "name": "Casa", "principal": 150000, "start_date": "2023-06-15"}])["saved"][0]["id"]
    s = save([{"kind": "property", "name": "Casa", "value": 250000, "purchase_price": 180000,
               "purchase_date": "2023-06-15", "loan_id": loan},
              {"kind": "property", "name": "Terreno", "prop_type": "Terreno", "value": "30000",
               "purchase_price": "", "purchase_date": "", "loan_id": ""}])["saved"]
    casa, terreno = s
    assert casa["id"].startswith("PROP_") and casa["value"] == 250000 and casa["loan_id"] == loan
    assert casa["prop_type"] == "Habitação própria"
    assert not {"purchase_price", "purchase_date", "loan_id"} & set(terreno)
    edited = save([dict(casa, value=260000)])["saved"][0]
    assert edited["id"] == casa["id"]
    _, d = call("GET /data")
    assert sorted(p["value"] for p in d["properties"]) == [30000, 260000]
    for bad in ({"kind": "property", "name": "X", "value": -1},
                {"kind": "property", "name": "", "value": 1},
                {"kind": "property", "name": "X", "value": 1, "loan_id": "nope"}):
        status, _ = call("POST /items", body={"items": [bad]})
        assert status == 400
    status, _ = call("DELETE /items/{id}", path={"id": casa["id"]})
    assert status == 200
    _, d = call("GET /data")
    assert [p["name"] for p in d["properties"]] == ["Terreno"]


def test_transfer_categories_are_renamed(table):
    """Entradas e saídas em "Transferências" passam a "Transferências in/out"; as transferências entre contas não mudam."""
    s = save([{"kind": "account", "name": "A", "opening_balance": 0, "opening_date": "2026-01-01"},
              {"kind": "account", "name": "B", "opening_balance": 0, "opening_date": "2026-01-01"}])["saved"]
    a, b = s[0]["id"], s[1]["id"]
    save([{"kind": "transaction", "date": "2026-09-01", "account_id": a, "direction": "in", "category": "Transferências", "amount": 10},
          {"kind": "transaction", "date": "2026-09-02", "account_id": a, "direction": "out", "category": "transferencia", "amount": 5},
          {"kind": "transaction", "date": "2026-09-03", "account_id": a, "direction": "transfer", "to_account_id": b, "amount": 7},
          {"kind": "transaction", "date": "2026-09-04", "account_id": a, "direction": "out", "category": "Supermercado", "amount": 3}])
    _, d = call("GET /data")
    cats = {t["amount"]: t["category"] for t in d["transactions"]}
    assert cats == {10: "Transferências in", 5: "Transferências out", 7: "Transferência", 3: "Supermercado"}
    _, d2 = call("GET /data")   # a segunda leitura não muda nada
    assert {t["amount"]: t["category"] for t in d2["transactions"]} == cats


def test_backup_is_emailed_to_the_account_only(table):
    """O backup vai para o email do token (não para um email vindo do browser), com os CSV em anexo."""
    sesv2 = boto3.client("sesv2")
    for addr in ("ledger@example.com", "eu@example.com"):
        sesv2.create_email_identity(EmailIdentity=addr)
    files = [{"name": "ledger-movimentos-2026-10-03.csv", "content": "Data;Valor\r\n2026-10-01;10,00"}]
    status, body = call("POST /backup", email="eu@example.com",
                        body={"date": "2026-10-03", "files": files, "to": "outro@example.com"})
    assert status == 200 and body == {"sent_to": "eu@example.com", "files": 1}
    from moto.core import DEFAULT_ACCOUNT_ID
    from moto.ses.models import ses_backends
    sent = ses_backends[DEFAULT_ACCOUNT_ID]["eu-west-1"].sent_messages
    raw = sent[-1].raw_data if hasattr(sent[-1], "raw_data") else str(sent[-1])
    assert "BACKUP Ledger dia 03/10/2026" in raw and "ledger-movimentos-2026-10-03.csv" in raw
    # o contador do limite diário não aparece nos dados da app
    _, d = call("GET /data")
    assert all(not v for v in d.values())


def test_backup_limits_and_validation(table):
    """Sem email na conta, ficheiros inválidos ou mais de 10 envios por dia dão erro."""
    boto3.client("sesv2").create_email_identity(EmailIdentity="ledger@example.com")
    boto3.client("sesv2").create_email_identity(EmailIdentity="eu@example.com")
    ok = {"date": "2026-10-03", "files": [{"name": "a.csv", "content": "x"}]}
    assert call("POST /backup", body=ok)[0] == 400                                  # conta sem email
    for bad in ({"date": "2026-10-03", "files": []},
                {"date": "2026-10-03", "files": [{"name": "../x.exe", "content": "x"}]},
                {"date": "ontem", "files": [{"name": "a.csv", "content": "x"}]}):
        assert call("POST /backup", email="eu@example.com", body=bad)[0] == 400
    for _ in range(app.MAX_BACKUPS_PER_DAY):
        assert call("POST /backup", email="eu@example.com", body=ok)[0] == 200
    assert call("POST /backup", email="eu@example.com", body=ok)[0] == 429         # limite do dia
    assert call("POST /backup", email="eu@example.com", body={**ok, "date": "2026-10-04"})[0] == 200


def test_request_size_limit(table):
    """Mais de 300 itens num pedido dá 400."""
    acc = save([{"kind": "account", "name": "A", "opening_balance": 0, "opening_date": "2026-01-01"}])["saved"][0]["id"]
    items = [{"kind": "transaction", "date": "2019-01-28", "account_id": acc, "direction": "out",
              "category": "C", "amount": i + 1} for i in range(301)]
    status, _ = call("POST /items", body={"items": items})
    assert status == 400
