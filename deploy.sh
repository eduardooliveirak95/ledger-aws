#!/usr/bin/env bash
# Ledger - faz deploy de tudo para a AWS a partir de Linux / Mac / AWS CloudShell.
# É também o script que o GitHub Actions corre em cada push para main.
#
#   ./deploy.sh o-teu-email@exemplo.com
#
# Opcional: STACK_NAME=ledger REGION=eu-west-1 ./deploy.sh email
#
# Passos: 1) sam deploy (infraestrutura + código da Lambda)  2) ler os outputs da stack
#         3) gerar o config.js e enviar o site para o S3      4) limpar a cache do CloudFront

# -e: pára no primeiro erro · -u: erro se usar uma variável que não existe · pipefail: erros em pipes contam
set -euo pipefail
# Trabalha sempre a partir da pasta deste script (a raiz do projeto)
cd "$(dirname "$0")"

# O email é obrigatório (1.º argumento); o resto tem valores por omissão
ALERT_EMAIL="${1:?Uso: ./deploy.sh o-teu-email@exemplo.com}"
STACK_NAME="${STACK_NAME:-ledger}"
REGION="${REGION:-eu-west-1}"

# No GitHub Actions os logs são públicos: esconde o que não precisa de lá estar.
# quiet COMANDO... -> corre o comando e tira da saída a tabela de outputs da stack (ids do Cognito,
# tabela, API, CloudFront) e as linhas com nomes de buckets. No PC, mostra tudo como antes.
quiet() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    "$@" 2>&1 | awk '/CloudFormation outputs from deployed stack/ { skip = 1 }
                     /Successfully created\/updated stack/      { skip = 0 }
                     !skip && !/[Ss]3 bucket/ { print; fflush() }'
  else
    "$@"
  fi
}

echo -e "\n[1/4] A fazer deploy do backend (DynamoDB, Cognito, API, Lambda, CloudFront)..."
# --resolve-s3: o SAM cria/usa um bucket próprio para enviar o código da Lambda
# --capabilities CAPABILITY_IAM: autoriza a stack a criar roles IAM (a da Lambda)
# --no-confirm-changeset: aplica sem perguntar · --no-fail-on-empty-changeset: não falha se nada mudou
quiet sam deploy \
  --template-file template.yaml \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --parameter-overrides "AlertEmail=$ALERT_EMAIL"

echo -e "\n[2/4] A ler os outputs da stack..."
# out NOME -> valor de um output da stack (secção Outputs do template.yaml)
out() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
API_URL=$(out ApiUrl)
CLIENT_ID=$(out UserPoolClientId)
BUCKET=$(out FrontendBucketName)
DIST_ID=$(out DistributionId)
SITE_URL=$(out WebsiteUrl)

echo -e "\n[3/4] A enviar o site..."
# config.js diz ao site onde está a API e qual é o cliente do Cognito (não vai para o GitHub)
printf "window.LEDGER_CONFIG = { apiUrl: '%s', region: '%s', clientId: '%s' };\n" "$API_URL" "$REGION" "$CLIENT_ID" > frontend/config.js
# sync envia só o que mudou; --delete apaga do bucket o que já não existe em frontend/
# (no GitHub, --only-show-errors não lista os ficheiros, que mostrariam o nome do bucket)
# --cache-control no-cache: o browser confirma sempre se há uma versão nova (resposta curta "304"
# quando não há), em vez de guardar os .js antigos durante dias depois de um deploy
aws s3 sync frontend "s3://$BUCKET" --delete --region "$REGION" --cache-control "no-cache" ${GITHUB_ACTIONS:+--only-show-errors}

echo -e "\n[4/4] A limpar a cache do CloudFront..."
# Invalidação: obriga o CloudFront a ir buscar os ficheiros novos em vez de servir os da cache
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" --output text > /dev/null

echo -e "\nFeito!"
echo "Site: $SITE_URL"
echo "Ainda sem utilizador? Corre:  ./create-user.sh o-teu-email@exemplo.com"
