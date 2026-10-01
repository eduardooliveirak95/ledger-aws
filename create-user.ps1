<#
  Ledger - cria o teu login (ou muda a password), no Windows / PowerShell.

  .\create-user.ps1 -Email tu@exemplo.com                  # a tua conta: password definitiva
  .\create-user.ps1 -Email amigo@exemplo.com -Temporaria   # conta de outra pessoa

  Regras da password: pelo menos 10 caracteres, com maiúsculas, minúsculas e um número.
  Sem -Temporaria, o utilizador fica logo com password definitiva.
  Com -Temporaria, a password que escreves só serve para o primeiro login: a app avisa a pessoa
  e obriga-a a escolher uma password dela (que tu deixas de saber). Depois pode mudá-la no botão 🔑.
#>

# Parâmetros da linha de comandos: -Email é obrigatório; os outros têm valores por omissão
param(
    [Parameter(Mandatory = $true)][string]$Email,
    [string]$StackName = "ledger",
    [string]$Region = "eu-west-1",
    [switch]$Temporaria
)

# Qualquer erro do PowerShell pára o script
$ErrorActionPreference = "Stop"

# Id da user pool do Cognito, lido dos outputs da stack
$poolId = aws cloudformation describe-stacks --stack-name $StackName --region $Region `
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text
if ($LASTEXITCODE -ne 0 -or -not $poolId) { throw "Could not find the stack '$StackName'. Run deploy.ps1 first." }

# Pede a password sem a mostrar no ecrã e converte-a em texto para a passar à AWS CLI
$secure = Read-Host "Password for $Email" -AsSecureString
$password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

# Cria o utilizador só se ainda não existir.
# ("Continue" durante a verificação: um utilizador inexistente dá erro, e aqui isso é normal)
$ErrorActionPreference = "Continue"
aws cognito-idp admin-get-user --user-pool-id $poolId --username $Email --region $Region 2>$null | Out-Null
$exists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = "Stop"

if (-not $exists) {
    Write-Host "Creating user $Email..." -ForegroundColor Cyan
    # Email já marcado como verificado; SUPPRESS = não enviar o email de convite do Cognito
    aws cognito-idp admin-create-user --user-pool-id $poolId --username $Email --region $Region `
        --user-attributes Name=email,Value=$Email Name=email_verified,Value=true `
        --message-action SUPPRESS | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "admin-create-user failed" }
} else {
    Write-Host "User already exists, updating password..." -ForegroundColor Cyan
}

# Password definitiva (--permanent) ou temporária (--no-permanent: a app pede uma nova no primeiro login)
$permanentFlag = if ($Temporaria) { "--no-permanent" } else { "--permanent" }
aws cognito-idp admin-set-user-password --user-pool-id $poolId --username $Email `
    --password $password $permanentFlag --region $Region
if ($LASTEXITCODE -ne 0) { throw "Setting the password failed (check the password rules)" }

if ($Temporaria) {
    Write-Host "Done. Give the password to $Email; on the first login the app asks for a new one." -ForegroundColor Green
} else {
    Write-Host "Done. You can now log in with $Email" -ForegroundColor Green
}
