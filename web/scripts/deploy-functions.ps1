# ===========================================
# Azure Functions 手動デプロイスクリプト
# ===========================================
# 使用方法: .\scripts\deploy-functions.ps1
# オプション:
#   -SkipBuild    ビルドをスキップ
#   -CheckOnly    デプロイせずに事前チェックのみ実行
# ===========================================

param(
    [switch]$SkipBuild,
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$apiDir = Join-Path $rootDir "api"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Azure Functions デプロイスクリプト" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$FUNC_APP_NAME = "func-airecorder-dev"
$RESOURCE_GROUP = "rg-airecorder-dev"

# -------------------------------------------
# Step 1: Azure CLI ログイン確認
# -------------------------------------------
Write-Host "[1/5] Azure CLI ログイン確認..." -ForegroundColor Yellow

$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host "  ❌ Azure CLI にログインしていません" -ForegroundColor Red
    Write-Host "  → az login を実行してください" -ForegroundColor Gray
    exit 1
}
Write-Host "  ✅ サブスクリプション: $($account.name)" -ForegroundColor Green

# -------------------------------------------
# Step 2: Azure インフラ設定の事前チェック
# -------------------------------------------
Write-Host ""
Write-Host "[2/5] Azure インフラ設定チェック..." -ForegroundColor Yellow

$subscriptionId = $account.id
$hasInfraError = $false

# Check 2a: SCM Basic Auth
Write-Host "  SCM Basic Auth..." -NoNewline
try {
    $scmPolicy = az rest --method GET `
        --url "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/sites/$FUNC_APP_NAME/basicPublishingCredentialsPolicies/scm?api-version=2022-03-01" `
        2>$null | ConvertFrom-Json
    
    if ($scmPolicy.properties.allow -eq $true) {
        Write-Host " ✅ 有効" -ForegroundColor Green
    } else {
        Write-Host " ❌ 無効（CI/CDデプロイが失敗します）" -ForegroundColor Red
        $hasInfraError = $true
        
        Write-Host "    → 修正中..." -ForegroundColor Yellow
        $body = '{"properties":{"allow":true}}'
        Set-Content -Path "$env:TEMP\scm_body.json" -Value $body
        az rest --method PUT `
            --url "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/sites/$FUNC_APP_NAME/basicPublishingCredentialsPolicies/scm?api-version=2022-03-01" `
            --body "@$env:TEMP\scm_body.json" 2>$null | Out-Null
        Remove-Item "$env:TEMP\scm_body.json" -Force -ErrorAction SilentlyContinue
        Write-Host "    ✅ SCM Basic Auth を有効化しました" -ForegroundColor Green
        $hasInfraError = $false
    }
} catch {
    Write-Host " ⚠️ 確認できませんでした" -ForegroundColor Yellow
}

# Check 2b: EasyAuth
Write-Host "  EasyAuth..." -NoNewline
try {
    $healthResponse = Invoke-WebRequest -Uri "https://$FUNC_APP_NAME.azurewebsites.net/api/health" -Method GET -MaximumRedirection 0 -ErrorAction SilentlyContinue -SkipHttpErrorCheck
    
    if ($healthResponse.StatusCode -eq 200) {
        Write-Host " ✅ 無効（正常）" -ForegroundColor Green
    } elseif ($healthResponse.StatusCode -eq 302 -or $healthResponse.StatusCode -eq 401) {
        Write-Host " ❌ 有効化されています！全APIが認証要求されます" -ForegroundColor Red
        Write-Host "    → Azure Portal → Functions App → 認証 → 無効化してください" -ForegroundColor Yellow
        $hasInfraError = $true
    } else {
        Write-Host " ⚠️ HTTP $($healthResponse.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host " ⚠️ 確認できませんでした" -ForegroundColor Yellow
}

# Check 2c: Functions App の状態
Write-Host "  Functions App 状態..." -NoNewline
try {
    $appState = az functionapp show --name $FUNC_APP_NAME --resource-group $RESOURCE_GROUP --query "state" -o tsv 2>$null
    if ($appState -eq "Running") {
        Write-Host " ✅ Running" -ForegroundColor Green
    } else {
        Write-Host " ❌ $appState" -ForegroundColor Red
        $hasInfraError = $true
    }
} catch {
    Write-Host " ⚠️ 確認できませんでした" -ForegroundColor Yellow
}

if ($hasInfraError) {
    Write-Host ""
    Write-Host "🚨 インフラ設定に問題があります。上記のエラーを修正してください。" -ForegroundColor Red
    exit 1
}

if ($CheckOnly) {
    Write-Host ""
    Write-Host "✅ すべての事前チェックに合格しました（CheckOnlyモード）" -ForegroundColor Green
    exit 0
}

# -------------------------------------------
# Step 3: ビルド
# -------------------------------------------
Write-Host ""
Set-Location $apiDir

if (-not $SkipBuild) {
    Write-Host "[3/5] ビルド中..." -ForegroundColor Yellow
    npm ci
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ❌ npm ci に失敗しました" -ForegroundColor Red
        exit 1
    }
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ❌ ビルドに失敗しました" -ForegroundColor Red
        exit 1
    }
    Write-Host "  ✅ ビルド完了" -ForegroundColor Green
} else {
    Write-Host "[3/5] ビルドをスキップ" -ForegroundColor Gray
}

# -------------------------------------------
# Step 4: デプロイ
# -------------------------------------------
Write-Host ""
Write-Host "[4/5] デプロイ中..." -ForegroundColor Yellow
func azure functionapp publish $FUNC_APP_NAME --typescript
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ❌ デプロイに失敗しました" -ForegroundColor Red
    exit 1
}
Write-Host "  ✅ デプロイ完了" -ForegroundColor Green

# -------------------------------------------
# Step 5: デプロイ後のヘルスチェック
# -------------------------------------------
Write-Host ""
Write-Host "[5/5] デプロイ後ヘルスチェック..." -ForegroundColor Yellow
Write-Host "  30秒待機中..." -ForegroundColor Gray
Start-Sleep -Seconds 30

$maxRetries = 5
$retryCount = 0
$healthOk = $false

while ($retryCount -lt $maxRetries) {
    try {
        $response = Invoke-RestMethod -Uri "https://$FUNC_APP_NAME.azurewebsites.net/api/health" -Method GET
        if ($response.status -eq "healthy") {
            Write-Host "  ✅ ヘルスチェック成功" -ForegroundColor Green
            Write-Host "    Version: $($response.version)" -ForegroundColor Cyan
            Write-Host "    Timestamp: $($response.timestamp)" -ForegroundColor Cyan
            $healthOk = $true
            break
        }
    } catch {
        $retryCount++
        Write-Host "  ⏳ 試行 $retryCount/$maxRetries — リトライ中..." -ForegroundColor Yellow
        Start-Sleep -Seconds 15
    }
}

if (-not $healthOk) {
    Write-Host "  ❌ ヘルスチェックに失敗しました" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " ✅ Functions デプロイ完了!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "URL: https://$FUNC_APP_NAME.azurewebsites.net/api" -ForegroundColor Cyan
Write-Host ""
