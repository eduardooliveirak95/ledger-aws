<#
  Ledger - faz deploy de tudo para a AWS (backend + site), no Windows / PowerShell.
  Faz o mesmo que o deploy.sh (que o GitHub Actions corre em cada push).

  Primeira vez:     .\deploy.ps1 -AlertEmail tu@exemplo.com
  Vezes seguintes:  .\deploy.ps1 -AlertEmail tu@exemplo.com

  Precisa de: AWS CLI v2 e AWS SAM CLI instalados, e "aws configure" feito.

  Atenção: o normal é publicar com git push. Se usares este script sem fazer push,
  o próximo deploy do GitHub Actions publica a versão do GitHub por cima da tua.
#>

# Parâmetros da linha de comandos: -AlertEmail é obrigatório
param(
    [Parameter(Mandatory = $true)][string]$AlertEmail,
    [string]$StackName = "ledger",
    [string]$Region = "eu-west-1"
)

# Qualquer erro do PowerShell pára o script; trabalha sempre a partir da pasta do projeto
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Os comandos externos (aws, sam) não param o script sozinhos quando falham:
# Check lê o código de saída do último comando e lança um erro se não for 0
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" } }

# 1) Cria/atualiza a stack a partir do template.yaml (infraestrutura + código da Lambda).
#    --resolve-s3: o SAM usa um bucket próprio para enviar o código
#    --capabilities CAPABILITY_IAM: autoriza a criação de roles IAM
#    --no-fail-on-empty-changeset: não falha se não houver nada para mudar
Write-Host "`n[1/4] Deploying backend (DynamoDB, Cognito, API, Lambda, CloudFront)..." -ForegroundColor Cyan
sam deploy `
    --template-file template.yaml `
    --stack-name $StackName `
    --region $Region `
    --resolve-s3 `
    --capabilities CAPABILITY_IAM `
    --no-confirm-changeset `
    --no-fail-on-empty-changeset `
    --parameter-overrides "AlertEmail=$AlertEmail"
Check "sam deploy"

# 2) Lê os outputs da stack (secção Outputs do template.yaml)
Write-Host "`n[2/4] Reading stack outputs..." -ForegroundColor Cyan
$raw = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].Outputs" --output json
Check "describe-stacks"
$outputs = $raw | ConvertFrom-Json
# Out NOME -> valor desse output
function Out($key) { ($outputs | Where-Object { $_.OutputKey -eq $key }).OutputValue }

$apiUrl   = Out "ApiUrl"
$clientId = Out "UserPoolClientId"
$bucket   = Out "FrontendBucketName"
$distId   = Out "DistributionId"
$siteUrl  = Out "WebsiteUrl"

# 3) Gera o config.js (onde está a API e qual é o cliente Cognito) e envia o site para o S3.
#    sync envia só o que mudou; --delete apaga do bucket o que já não existe em frontend\
Write-Host "`n[3/4] Uploading website..." -ForegroundColor Cyan
$config = "window.LEDGER_CONFIG = { apiUrl: '$apiUrl', region: '$Region', clientId: '$clientId' };"
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot "frontend\config.js"), $config)
# --cache-control no-cache: o browser confirma sempre se há uma versão nova do site
aws s3 sync frontend "s3://$bucket" --delete --region $Region --cache-control "no-cache"
Check "s3 sync"

# 4) Invalidação: obriga o CloudFront a ir buscar os ficheiros novos em vez de servir os da cache
Write-Host "`n[4/4] Refreshing CloudFront cache..." -ForegroundColor Cyan
aws cloudfront create-invalidation --distribution-id $distId --paths "/*" --output text | Out-Null
Check "cloudfront invalidation"

Write-Host "`nDone!" -ForegroundColor Green
Write-Host "Website: $siteUrl"
Write-Host "(the first time, CloudFront can take ~5 minutes to be ready)"
Write-Host "No user yet? Run:  .\create-user.ps1 -Email tu@exemplo.com"
