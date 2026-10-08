"""
Testes do backend. Correm contra um DynamoDB falso (biblioteca moto), por isso não
precisam de conta AWS nem de internet. O GitHub Actions corre-os antes de cada deploy.

    pip install -r requirements-dev.txt
    pytest -q
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
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
from botocore.exceptions import ClientError  # noqa: E402
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
        app._table = app._login_table = app._ses = app._cognito = None
        yield boto3.resource("dynamodb").Table("ledger-test")
        app._table = app._login_table = app._ses = app._cognito = None


def call(route, user="u1", body=None, path=None, email=None, verified=True):
    """Simula um pedido do API Gateway à Lambda (com o utilizador já autenticado) e devolve (código, corpo).

    Com email, o token traz também "email_verified" (o API Gateway entrega as claims como texto).
    """
    claims = {"sub": user, **({"email": email, "email_verified": "true" if verified else "false"} if email else {})}
    event = {"routeKey": route, "pathParameters": path,
             "body": json.dumps(body) if body is not None else None,
             "requestContext": {"authorizer": {"jwt": {"claims": claims}}}}
    r = app.handler(event, None)
    return r["statusCode"], (json.loads(r["body"]) if r["body"] else None)


def call_admin(groups=None, route="GET /admin/users"):
    """Simula um pedido ao separador Utilizadores (função admin), com os grupos na claim do token."""
    claims = {"sub": "admin-sub", **({"cognito:groups": groups} if groups is not None else {})}
    r = app.admin({"routeKey": route, "requestContext": {"authorizer": {"jwt": {"claims": claims}}}}, None)
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


def test_daily_backup_setting(table):
    """O backup diário começa desligado, liga-se e desliga-se por utilizador e não aparece nos dados."""
    boto3.client("sesv2").create_email_identity(EmailIdentity="eu@example.com")   # email já verificado no SES
    assert call("GET /settings") == (200, {"daily_backup": False})
    assert call("POST /settings", body={"daily_backup": True})[0] == 400              # conta sem email
    assert call("POST /settings", email="eu@example.com", body={"daily_backup": "sim"})[0] == 400
    assert call("POST /settings", email="eu@example.com", body={"daily_backup": True}) == (200, {"daily_backup": True})
    assert call("GET /settings") == (200, {"daily_backup": True})
    assert call("GET /settings", user="u2") == (200, {"daily_backup": False})
    _, d = call("GET /data")
    assert all(not v for v in d.values())
    assert call("POST /settings", email="eu@example.com", body={"daily_backup": False}) == (200, {"daily_backup": False})
    assert call("GET /settings") == (200, {"daily_backup": False})


def test_daily_backup_warns_if_the_email_cannot_receive(table, monkeypatch, capsys):
    """Ao ligar o backup diário, a resposta traz um aviso se o email ainda não pode receber os CSV
    (por verificar no Cognito ou no SES); o backup fica ligado na mesma e desligar nunca avisa."""
    sesv2 = boto3.client("sesv2")
    sesv2.create_email_identity(EmailIdentity="eu@example.com")     # o moto dá-o logo como verificado
    sesv2.create_email_identity(EmailIdentity="empresa.example")    # um domínio inteiro verificado também serve
    on = {"daily_backup": True}
    assert call("POST /settings", email="eu@example.com", body=on) == (200, {"daily_backup": True})
    assert call("POST /settings", email="ana@empresa.example", body=on) == (200, {"daily_backup": True})
    status, body = call("POST /settings", email="novo@example.com", body=on)        # nunca carregou no link do SES
    assert status == 200 and body["daily_backup"] is True and "link" in body["warning"]
    assert call("GET /settings") == (200, {"daily_backup": True})
    _, body = call("POST /settings", email="eu@example.com", verified=False, body=on)   # por verificar no Cognito
    assert "não está verificado" in body["warning"]
    assert call("POST /settings", email="novo@example.com", body={"daily_backup": False}) == (200, {"daily_backup": False})

    # se a consulta ao SES falhar por outro motivo: liga sem aviso, e o log só tem o código do erro (nunca o email)
    class BrokenSes:
        def get_email_identity(self, **kwargs):
            raise ClientError({"Error": {"Code": "AccessDeniedException", "Message": "novo@example.com"}}, "GetEmailIdentity")
    monkeypatch.setattr(app, "ses", lambda: BrokenSes())
    assert call("POST /settings", email="novo@example.com", body=on) == (200, {"daily_backup": True})
    logs = capsys.readouterr().out
    assert "AccessDeniedException" in logs and "@" not in logs


def test_backup_csv_headers_match_the_app():
    """Os cabeçalhos dos CSV do backup diário são iguais aos da app (FORMATS no csv.js), para o "Importar" os reconhecer."""
    js = (Path(__file__).resolve().parents[1] / "frontend" / "js" / "csv.js").read_text(encoding="utf-8")
    headers = [re.findall(r"'([^']*)'", h) for h in re.findall(r"header: \[([^\]]*)\]", js)]
    assert headers == list(app.BACKUP_FORMATS.values())


def test_backup_csv_neutralizes_formulas():
    """Texto começado por = + - @ leva uma ' à frente (o Excel não o corre como fórmula); os valores não mudam."""
    assert app.csv_cell("=HYPERLINK(\"x\")") == '"\'=HYPERLINK(""x"")"'
    assert [app.csv_cell(v) for v in ("+1", "-x", "@SUM(A1)", "\tx", "Renda", Decimal("-5"))] == \
        ["'+1", "'-x", "'@SUM(A1)", "'\tx", "Renda", "-5,00"]


def test_backup_day_is_the_day_that_just_ended():
    """À meia-noite de Portugal (23:00 UTC no verão, 00:00 UTC no inverno) o backup é do dia anterior."""
    assert app.backup_day(datetime(2026, 10, 4, 23, 0, 5, tzinfo=timezone.utc)) == "2026-10-04"
    assert app.backup_day(datetime(2027, 1, 5, 0, 0, 5, tzinfo=timezone.utc)) == "2027-01-04"


def test_backup_csv_content(table):
    """Os CSV gerados no servidor têm as mesmas colunas e o mesmo formato que os do botão "Backup"."""
    s = save([{"kind": "account", "name": "Ordem", "opening_balance": 0, "opening_date": "2026-01-01"},
              {"kind": "account", "name": "Poupança", "opening_balance": 0, "opening_date": "2026-01-01"},
              {"kind": "investment", "name": "ETF", "inv_type": "ETF"},
              {"kind": "investment", "name": "Sem registos", "inv_type": "PPR", "notes": "nota"},
              {"kind": "loan", "name": "Casa", "loan_type": "Habitação", "principal": 1000, "start_date": "2026-01-01",
               "rate": "3.125", "payment": 50, "lender": "Banco"}])["saved"]
    acc, sav, etf, loan = s[0]["id"], s[1]["id"], s[2]["id"], s[4]["id"]
    save([{"kind": "transaction", "date": "2026-09-02", "account_id": acc, "direction": "out", "category": "Casa",
           "description": 'Renda; "set"', "amount": 1234.5},
          {"kind": "transaction", "date": "2026-09-01", "account_id": acc, "direction": "transfer", "to_account_id": sav, "amount": 10},
          {"kind": "inv_move", "date": "2026-09-05", "investment_id": etf, "move": "contribution", "amount": 200},
          {"kind": "valuation", "investment_id": etf, "month": "2026-09", "value": 204.5},
          {"kind": "loan_balance", "loan_id": loan, "month": "2026-09", "balance": 950, "extra": 20},
          {"kind": "property", "name": "Apartamento", "value": 100000, "loan_id": loan}])
    files = dict(app.backup_files("u1", "2026-10-04"))
    assert list(files) == ["ledger-contas-2026-10-04.csv", "ledger-movimentos-2026-10-04.csv", "ledger-investimentos-2026-10-04.csv",
                           "ledger-creditos-2026-10-04.csv", "ledger-patrimonio-2026-10-04.csv"]
    # as contas levam o tipo e o saldo inicial (ordenadas por nome)
    assert files["ledger-contas-2026-10-04.csv"].split("\r\n")[1:] == [
        "Ordem;Conta à ordem;0,00;2026-01-01", "Poupança;Conta à ordem;0,00;2026-01-01"]
    assert files["ledger-movimentos-2026-10-04.csv"].split("\r\n")[1:] == [
        "2026-09-01;Ordem;Transferência;Transferência;;10,00;Poupança;não",
        '2026-09-02;Ordem;Saída;Casa;"Renda; ""set""";1234,50;;não']
    assert files["ledger-investimentos-2026-10-04.csv"].split("\r\n")[1:] == [
        ";Sem registos;PPR;;;nota", "2026-09;ETF;ETF;Valor;204,50;", "2026-09-05;ETF;ETF;Aporte;200,00;"]
    assert files["ledger-creditos-2026-10-04.csv"].split("\r\n")[1:] == [
        "2026-09;Casa;Habitação;950,00;50,00;1000,00;2026-01-01;3,125;Banco;20,00;"]
    assert files["ledger-patrimonio-2026-10-04.csv"].split("\r\n")[1:] == ["Apartamento;Habitação própria;100000,00;;;Casa;"]
    assert app.backup_files("u2", "2026-10-04") == []   # sem dados, sem ficheiros


def test_daily_backup_emails_only_active_subscribers(table, monkeypatch, capsys):
    """O envio diário vai para o email do Cognito de quem ativou o backup; contas desativadas, sem dados
    ou com o email por verificar no Cognito são saltadas.

    Um email recusado pelo SES (por verificar) não trava os outros e o log não mostra o endereço.
    """
    cognito = boto3.client("cognito-idp")
    pool = cognito.create_user_pool(PoolName="ledger-test", UsernameAttributes=["email"])["UserPool"]["Id"]
    monkeypatch.setenv("USER_POOL_ID", pool)
    subs = {}
    for name in ("ativo", "vazio", "desativado", "desligado", "naoverificado", "emailnovo"):
        verified = "false" if name == "emailnovo" else "true"   # como fica depois de a pessoa mudar o email
        u = cognito.admin_create_user(UserPoolId=pool, Username=f"{name}@example.com",
                                      UserAttributes=[{"Name": "email", "Value": f"{name}@example.com"},
                                                      {"Name": "email_verified", "Value": verified}])["User"]
        subs[name] = next(a["Value"] for a in u["Attributes"] if a["Name"] == "sub")
    cognito.admin_disable_user(UserPoolId=pool, Username="desativado@example.com")
    sesv2 = boto3.client("sesv2")
    for addr in ("ledger@example.com", "ativo@example.com", "desativado@example.com", "desligado@example.com", "emailnovo@example.com"):
        sesv2.create_email_identity(EmailIdentity=addr)
    for name in ("ativo", "desativado", "desligado", "naoverificado", "emailnovo"):
        save([{"kind": "property", "name": "Casa", "value": 1}], user=subs[name])
    for name in ("ativo", "vazio", "desativado", "naoverificado", "emailnovo"):
        assert call("POST /settings", user=subs[name], email="token@example.com", body={"daily_backup": True})[0] == 200
    monkeypatch.setattr(app, "backup_day", lambda: "2026-10-04")
    # o SES do moto não verifica destinatários: simula a recusa de um email por verificar
    real_send = app.send_backup

    def send(sender, email, day, files):
        if email.startswith("naoverificado"):
            raise ClientError({"Error": {"Code": "MessageRejected", "Message": f"Email address is not verified: {email}"}}, "SendEmail")
        real_send(sender, email, day, files)
    monkeypatch.setattr(app, "send_backup", send)

    assert app.daily_backup({}, None) == {"sent": 1, "skipped": 3, "failed": 1}
    logs = capsys.readouterr().out
    assert "MessageRejected" in logs and "@" not in logs
    # teste à mão: só para um email (e só se for de quem ligou o backup); um evento estranho não estraga nada
    assert app.daily_backup({"only_email": " Ativo@Example.com "}, None) == {"sent": 1, "skipped": 0, "failed": 0}
    assert app.daily_backup({"only_email": "desligado@example.com"}, None) == {"sent": 0, "skipped": 0, "failed": 0}
    assert app.daily_backup("texto", None)["sent"] == 1
    from moto.core import DEFAULT_ACCOUNT_ID
    from moto.ses.models import ses_backends
    sent = ses_backends[DEFAULT_ACCOUNT_ID]["eu-west-1"].sent_messages
    assert len(sent) == 3   # o envio normal + o teste para um email + o evento estranho
    raw = sent[0].raw_data if hasattr(sent[0], "raw_data") else str(sent[0])
    assert "To: ativo@example.com" in raw and "BACKUP Ledger dia 04/10/2026" in raw
    assert "ledger-patrimonio-2026-10-04.csv" in raw


def test_bank_formats_are_saved_and_validated(table):
    """As colunas escolhidas para os CSV de um banco ficam guardadas; colunas inválidas dão erro."""
    acc = save([{"kind": "account", "name": "Banco X", "opening_balance": 0, "opening_date": "2026-01-01"}])["saved"][0]["id"]
    cols = {"date": 0, "desc": 2, "amount": 3, "debit": -1, "credit": -1, "balance": 4}
    f = save([{"kind": "bank_format", "name": "Banco X", "signature": "data|data valor|descricao|montante|saldo",
               "columns": cols, "account_id": acc}])["saved"][0]
    assert f["id"].startswith("BFMT_") and f["columns"] == cols and f["account_id"] == acc
    _, d = call("GET /data")
    assert [x["name"] for x in d["bank_formats"]] == ["Banco X"]
    # atualizar mantém o id
    assert save([dict(f, name="Banco Y")])["saved"][0]["id"] == f["id"]
    for bad in ({"date": -1, "amount": 3}, {"date": 0}, {"date": "0", "amount": 1}, {"date": 0, "amount": 100}, {"date": 0, "amount": True}, "x"):
        status, _ = call("POST /items", body={"items": [{"kind": "bank_format", "name": "B", "signature": "s", "columns": bad}]})
        assert status == 400, bad
    # o backup não inclui os formatos (não são dados financeiros)
    assert not any("Banco Y" in content for _, content in app.backup_files("u1", "2026-10-04"))


def test_request_size_limit(table):
    """Mais de 300 itens num pedido dá 400."""
    acc = save([{"kind": "account", "name": "A", "opening_balance": 0, "opening_date": "2026-01-01"}])["saved"][0]["id"]
    items = [{"kind": "transaction", "date": "2019-01-28", "account_id": acc, "direction": "out",
              "category": "C", "amount": i + 1} for i in range(301)]
    status, _ = call("POST /items", body={"items": items})
    assert status == 400


def login_event(sub, email):
    """Evento que o Cognito envia ao trigger "Post authentication" (só os campos que a app usa)."""
    return {"version": "1", "triggerSource": "PostAuthentication_Authentication", "userName": sub,
            "request": {"userAttributes": {"sub": sub, "email": email, "email_verified": "true"}}, "response": {}}


def test_logins_are_recorded(table):
    """Cada login fica na partição LOGIN (com prazo de 90 dias) e soma 1 na LAST_LOGIN; o Cognito recebe o evento de volta."""
    ev = login_event("u1", "ana@example.com")
    assert app.post_login(ev, None) is ev
    [login] = app.query_all(app.LOGIN_PK)
    assert login["sub"] == "u1" and login["email"] == "ana@example.com" and login["sk"] == f"{login['at']}_u1"
    days = (int(login["expires"]) - datetime.now(timezone.utc).timestamp()) / 86400
    assert 89.9 < days <= 90
    app.record_login("u1", "ana@example.com", datetime(2099, 1, 1, tzinfo=timezone.utc))
    assert len(app.query_all(app.LOGIN_PK)) == 2
    last = table.get_item(Key={"user_id": app.LAST_LOGIN_PK, "sk": "u1"})["Item"]
    assert last["logins"] == 2 and last["email"] == "ana@example.com" and last["at"] == "2099-01-01T00:00:00+00:00"
    # os logins não aparecem nos dados de ninguém
    assert call("GET /data", user="u1")[1]["transactions"] == []


def test_login_trigger_never_fails(table, monkeypatch, capsys):
    """Se o registo falhar, o login continua (o evento volta ao Cognito) e o log não mostra o email."""
    def broken(sub, email, now=None):
        raise ClientError({"Error": {"Code": "ProvisionedThroughputExceededException", "Message": email}}, "PutItem")
    monkeypatch.setattr(app, "record_login", broken)
    ev = login_event("u1", "ana@example.com")
    assert app.post_login(ev, None) is ev
    assert app.post_login({}, None) == {}   # evento estranho: não faz nada
    logs = capsys.readouterr().out
    assert "ProvisionedThroughputExceededException" in logs and "@" not in logs


@pytest.mark.parametrize("groups,expected", [
    ("[admin]", True), ("[outro admin]", True), ("outro,admin", True), (["admin"], True), ('["admin"]', True),
    ("[outro]", False), ("[administrators]", False), ("", False), (None, False), ([], False),
])
def test_admin_group_claim_formats(groups, expected):
    """O grupo vem no token como lista ou como texto (o API Gateway muda o formato); só "admin" conta."""
    assert app.is_admin({"cognito:groups": groups}) is expected


def test_admin_page_only_for_admins(table, monkeypatch):
    """Sem token: 401. Fora do grupo admin: 403. No grupo: lista os utilizadores e os logins."""
    cognito = boto3.client("cognito-idp")
    pool = cognito.create_user_pool(PoolName="ledger-test", UsernameAttributes=["email"])["UserPool"]["Id"]
    monkeypatch.setenv("USER_POOL_ID", pool)
    cognito.create_group(GroupName="admin", UserPoolId=pool)
    subs = {}
    for name in ("chefe", "ana", "bruno"):
        u = cognito.admin_create_user(UserPoolId=pool, Username=f"{name}@example.com", MessageAction="SUPPRESS",
                                      UserAttributes=[{"Name": "email", "Value": f"{name}@example.com"}])["User"]
        subs[name] = next(a["Value"] for a in u["Attributes"] if a["Name"] == "sub")
    cognito.admin_add_user_to_group(UserPoolId=pool, Username="chefe@example.com", GroupName="admin")
    cognito.admin_disable_user(UserPoolId=pool, Username="bruno@example.com")
    app.record_login(subs["ana"], "ana@example.com", datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc))
    app.record_login(subs["chefe"], "chefe@example.com", datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc))
    app.record_login(subs["ana"], "ana@example.com", datetime(2026, 10, 3, 9, 0, tzinfo=timezone.utc))
    app.record_login("apagado", "antigo@example.com", datetime(2026, 9, 30, 9, 0, tzinfo=timezone.utc))

    assert app.admin({"routeKey": "GET /admin/users"}, None)["statusCode"] == 401
    assert call_admin()[0] == 403
    assert call_admin("[outro]")[0] == 403
    assert call_admin("[admin]", route="GET /admin/nada")[0] == 404
    status, body = call_admin("[admin]")
    assert status == 200
    users = {u["email"]: u for u in body["users"]}
    assert [u["email"] for u in body["users"]] == ["ana@example.com", "bruno@example.com", "chefe@example.com"]
    assert users["chefe@example.com"]["admin"] and not users["ana@example.com"]["admin"]
    assert users["ana@example.com"]["logins"] == 2 and users["ana@example.com"]["last_login"].startswith("2026-10-03T09:00")
    assert users["bruno@example.com"]["enabled"] is False and users["bruno@example.com"]["last_login"] is None
    assert users["ana@example.com"]["status"] == "FORCE_CHANGE_PASSWORD" and users["ana@example.com"]["created"]
    assert "sub" not in json.dumps(body)
    # mais recente primeiro; a conta apagada fica com o email que tinha
    assert [(x["at"][:10], x["email"]) for x in body["logins"]] == [
        ("2026-10-03", "ana@example.com"), ("2026-10-02", "chefe@example.com"),
        ("2026-10-01", "ana@example.com"), ("2026-09-30", "antigo@example.com")]


def test_normal_api_has_no_admin_routes(table):
    """A API normal não responde às rotas de administração (são de outra função, com outras permissões)."""
    assert call("GET /admin/users")[0] == 404
