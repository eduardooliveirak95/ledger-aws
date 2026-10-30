#!/usr/bin/env bash
# Ledger - dá (ou tira) a uma conta o papel de administrador, a partir de Linux / Mac / AWS CloudShell.
#
#   ./make-admin.sh o-teu-email@exemplo.com              # passa a administrador
#   ./make-admin.sh o-teu-email@exemplo.com --remover    # deixa de ser administrador
#
# Um administrador vê na app o selo "Admin" ao lado do email e o separador Utilizadores
# (todas as contas e quem entrou e quando). Não vê os dados financeiros de ninguém.
# A conta tem de existir (create-user.sh) e o deploy tem de estar feito (cria o grupo "admin").
# Para a mudança aparecer, a pessoa sai da app e volta a entrar. Ao remover, o separador
# desaparece no próximo login ou, no máximo, 1 hora depois (quando a sessão renova o token).
set -euo pipefail

EMAIL="${1:?Uso: ./make-admin.sh email@exemplo.com [--remover]}"
REMOVE=false
[ "${2:-}" = "--remover" ] && REMOVE=true
STACK_NAME="${STACK_NAME:-ledger}"
REGION="${REGION:-eu-west-1}"

# Id da user pool do Cognito, lido dos outputs da stack
POOL_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)

if [ "$REMOVE" = true ]; then
  aws cognito-idp admin-remove-user-from-group --user-pool-id "$POOL_ID" --username "$EMAIL" \
    --group-name admin --region "$REGION"
  echo "Feito. $EMAIL deixou de ser administrador (no próximo login ou, no máximo, dentro de 1 hora)."
else
  aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL_ID" --username "$EMAIL" \
    --group-name admin --region "$REGION"
  echo "Feito. $EMAIL é administrador: sai da app e volta a entrar para veres o separador Utilizadores."
fi
