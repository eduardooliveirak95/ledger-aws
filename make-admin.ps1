<#
  Ledger - dá (ou tira) a uma conta o papel de administrador, no Windows / PowerShell.

  .\make-admin.ps1 -Email tu@exemplo.com             # passa a administrador
  .\make-admin.ps1 -Email tu@exemplo.com -Remover    # deixa de ser administrador

  Um administrador vê na app o selo "Admin" ao lado do email e o separador Utilizadores
  (todas as contas e quem entrou e quando). Não vê os dados financeiros de ninguém.
  A conta tem de existir (create-user.ps1) e o deploy tem de estar feito (cria o grupo "admin").
  Para a mudança aparecer, a pessoa sai da app e volta a entrar. Ao remover, o separador
  desaparece no próximo login ou, no máximo, 1 hora depois (quando a sessão renova o token).
#>

# Parâmetros da linha de comandos: -Email é obrigatório; os outros têm valores por omissão
param(
    [Parameter(Mandatory = $true)][string]$Email,
    [string]$StackName = "ledger",
    [string]$Region = "eu-west-1",
    [switch]$Remover
)

# Qualquer erro do PowerShell pára o script
$ErrorActionPreference = "Stop"

# Id da user pool do Cognito, lido dos outputs da stack
$poolId = aws cloudformation describe-stacks --stack-name $StackName --region $Region `
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text
if ($LASTEXITCODE -ne 0 -or -not $poolId) { throw "Could not find the stack '$StackName'. Run deploy.ps1 first." }

if ($Remover) {
    aws cognito-idp admin-remove-user-from-group --user-pool-id $poolId --username $Email `
        --group-name admin --region $Region
    if ($LASTEXITCODE -ne 0) { throw "Could not remove $Email from the admin group (does the user exist?)" }
    Write-Host "Done. $Email is no longer an admin (on the next login, or within 1 hour)." -ForegroundColor Green
} else {
    aws cognito-idp admin-add-user-to-group --user-pool-id $poolId --username $Email `
        --group-name admin --region $Region
    if ($LASTEXITCODE -ne 0) { throw "Could not add $Email to the admin group (does the user exist? is the deploy done?)" }
    Write-Host "Done. $Email is now an admin: log out of the app and log in again." -ForegroundColor Green
}
