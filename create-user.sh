#!/usr/bin/env bash
# Ledger - cria o teu login (ou muda a password) a partir de Linux / Mac / AWS CloudShell.
#
#   ./create-user.sh o-teu-email@exemplo.com                  # a tua conta: password definitiva
#   ./create-user.sh amigo@exemplo.com --temporaria           # conta de outra pessoa
#
# Regras da password: pelo menos 10 caracteres, com maiúsculas, minúsculas e um número.
# Sem --temporaria, o utilizador fica logo com password definitiva.
# Com --temporaria, a password que escreves só serve para o primeiro login: a app avisa a pessoa
# e obriga-a a escolher uma password dela (que tu deixas de saber). Depois pode mudá-la no botão 🔑.
set -euo pipefail

EMAIL="${1:?Uso: ./create-user.sh email@exemplo.com [--temporaria]}"
TEMPORARY=false
[ "${2:-}" = "--temporaria" ] && TEMPORARY=true
STACK_NAME="${STACK_NAME:-ledger}"
REGION="${REGION:-eu-west-1}"

# Id da user pool do Cognito, lido dos outputs da stack
POOL_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)

# Pede a password sem a mostrar no ecrã (-s)
read -rsp "Password para $EMAIL: " PASSWORD
echo

# Se o utilizador ainda não existe, cria-o (com o email já verificado e sem enviar email de convite)
if aws cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username "$EMAIL" --region "$REGION" > /dev/null 2>&1; then
  echo "O utilizador já existe, a mudar a password..."
else
  echo "A criar o utilizador $EMAIL..."
  aws cognito-idp admin-create-user --user-pool-id "$POOL_ID" --username "$EMAIL" --region "$REGION" \
    --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
    --message-action SUPPRESS > /dev/null
fi

if [ "$TEMPORARY" = true ]; then
  # Password temporária: no primeiro login a app pede à pessoa que escolha a dela
  aws cognito-idp admin-set-user-password --user-pool-id "$POOL_ID" --username "$EMAIL" \
    --password "$PASSWORD" --no-permanent --region "$REGION"
  echo "Feito. Dá a password a $EMAIL: no primeiro login a app pede-lhe que escolha uma nova."
else
  # Password definitiva: entra-se logo, sem passo extra
  aws cognito-idp admin-set-user-password --user-pool-id "$POOL_ID" --username "$EMAIL" \
    --password "$PASSWORD" --permanent --region "$REGION"
  echo "Feito. Já podes entrar com $EMAIL"
fi
