# ===========================================
# AI Recorder デプロイスクリプト
# ===========================================
# 使用方法: .\scripts\deploy.ps1
# オプション: 
#   -SkipBuild    ビルドをスキップ
#   -AutoFix      環境変数を自動取得・修正
# ===========================================

param(
    [switch]$SkipBuild,
    [switch]$AutoFix
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$webDir = Split-Path -Parent $scriptDir

Set-Location $webDir

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " AI Recorder デプロイスクリプト" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# -------------------------------------------
# Step 1: 環境変数チェック
# -------------------------------------------
Write-Host "[1/4] 環境変数をチェック中..." -ForegroundColor Yellow

$envFile = ".env.local"
if (-not (Test-Path $envFile)) {
    Write-Host "  ❌ .env.local が見つかりません" -ForegroundColor Red
    
    if ($AutoFix) {
        Write-Host "  🔧 自動生成します..." -ForegroundColor Yellow
        Copy-Item ".env.example" $envFile
    } else {
        Write-Host "  → .env.example をコピーして .env.local を作成してください" -ForegroundColor Gray
        Write-Host "  → または -AutoFix オプションで自動生成" -ForegroundColor Gray
        exit 1
    }
}

# 環境変数の読み込み
$envContent = Get-Content $envFile -Raw
$envVars = @{}
foreach ($line in (Get-Content $envFile)) {
    if ($line -match "^([^#][^=]+)=(.*)$") {
        $envVars[$matches[1].Trim()] = $matches[2].Trim()
    }
}

# 必須環境変数のチェック
$requiredVars = @(
    @{ Name = "NEXT_PUBLIC_AZURE_SPEECH_KEY"; Description = "Speech Services APIキー" },
    @{ Name = "NEXT_PUBLIC_AZURE_SPEECH_REGION"; Description = "Speech Services リージョン" },
    @{ Name = "NEXT_PUBLIC_AZURE_TRANSLATOR_KEY"; Description = "Translator APIキー" },
    @{ Name = "NEXT_PUBLIC_AZURE_TRANSLATOR_REGION"; Description = "Translator リージョン" },
    @{ Name = "NEXT_PUBLIC_API_URL"; Description = "API URL" }
)

$hasError = $false
$needsUpdate = $false

foreach ($var in $requiredVars) {
    $value = $envVars[$var.Name]
    
    if (-not $value -or $value -match "your-.*-here") {
        Write-Host "  ❌ $($var.Name) が未設定" -ForegroundColor Red
        $hasError = $true
        $needsUpdate = $true
    } else {
        # 値の検証
        if ($var.Name -eq "NEXT_PUBLIC_AZURE_TRANSLATOR_REGION" -and $value -ne "global") {
            Write-Host "  ⚠️  $($var.Name) = $value (通常は 'global')" -ForegroundColor Yellow
        } else {
            $displayValue = if ($value.Length -gt 20) { $value.Substring(0, 20) + "..." } else { $value }
            Write-Host "  ✅ $($var.Name) = $displayValue" -ForegroundColor Green
        }
    }
}

# 自動修正
if ($needsUpdate -and $AutoFix) {
    Write-Host ""
    Write-Host "  🔧 Azureから設定を自動取得中..." -ForegroundColor Yellow
    
    try {
        # Speech Services
        $speechKey = (az cognitiveservices account keys list --name speech-airecorder-dev --resource-group rg-airecorder-dev 2>$null | ConvertFrom-Json).key1
        $speechRegion = az cognitiveservices account show --name speech-airecorder-dev --resource-group rg-airecorder-dev --query location -o tsv 2>$null
        
        # Translator
        $translatorKey = (az cognitiveservices account keys list --name translator-airecorder-dev --resource-group rg-airecorder-dev 2>$null | ConvertFrom-Json).key1
        $translatorRegion = az cognitiveservices account show --name translator-airecorder-dev --resource-group rg-airecorder-dev --query location -o tsv 2>$null
        
        # .env.local を更新
        $newEnvContent = @"
# Azure Speech Services
NEXT_PUBLIC_AZURE_SPEECH_KEY=$speechKey
NEXT_PUBLIC_AZURE_SPEECH_REGION=$speechRegion

# Azure Translator
NEXT_PUBLIC_AZURE_TRANSLATOR_KEY=$translatorKey
NEXT_PUBLIC_AZURE_TRANSLATOR_REGION=$translatorRegion

# API URL (Azure Functions)
NEXT_PUBLIC_API_URL=https://func-airecorder-dev.azurewebsites.net/api
"@
        $newEnvContent | Out-File -FilePath $envFile -Encoding utf8
        Write-Host "  ✅ .env.local を更新しました" -ForegroundColor Green
        $hasError = $false
    } catch {
        Write-Host "  ❌ 自動取得に失敗: $_" -ForegroundColor Red
    }
}

if ($hasError) {
    Write-Host ""
    Write-Host "環境変数が正しく設定されていません。" -ForegroundColor Red
    Write-Host "-AutoFix オプションで自動設定できます: .\scripts\deploy.ps1 -AutoFix" -ForegroundColor Gray
    exit 1
}

Write-Host ""

# -------------------------------------------
# Step 2: ビルド
# -------------------------------------------
if (-not $SkipBuild) {
    Write-Host "[2/4] ビルド中..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ❌ ビルドに失敗しました" -ForegroundColor Red
        exit 1
    }
    Write-Host "  ✅ ビルド完了" -ForegroundColor Green
} else {
    Write-Host "[2/4] ビルドをスキップ" -ForegroundColor Gray
}

Write-Host ""

# -------------------------------------------
# Step 3: デプロイトークン取得
# -------------------------------------------
Write-Host "[3/4] デプロイトークンを取得中..." -ForegroundColor Yellow
$token = az staticwebapp secrets list --name swa-airecorder-dev --query "properties.apiKey" -o tsv
if (-not $token) {
    Write-Host "  ❌ トークンの取得に失敗しました" -ForegroundColor Red
    exit 1
}
Write-Host "  ✅ トークン取得完了" -ForegroundColor Green
Write-Host ""

# -------------------------------------------
# Step 4: デプロイ
# -------------------------------------------
Write-Host "[4/4] デプロイ中..." -ForegroundColor Yellow
swa deploy out --env production --deployment-token $token

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host " ✅ デプロイ完了!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "URL: https://proud-rock-06bba6200.2.azurestaticapps.net" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "  ❌ デプロイに失敗しました" -ForegroundColor Red
    exit 1
}
