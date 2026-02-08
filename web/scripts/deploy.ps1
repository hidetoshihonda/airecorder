# ===========================================
# AI Recorder πâçπâùπâ¡πéñπé╣πé»πâ¬πâùπâê
# ===========================================
# Σ╜┐τö¿µû╣µ│ò: .\scripts\deploy.ps1
# πé¬πâùπé╖πâºπâ│: 
#   -SkipBuild    πâôπâ½πâëπéÆπé╣πé¡πââπâù
#   -AutoFix      τÆ░σóâσñëµò░πéÆΦç¬σïòσÅûσ╛ùπâ╗Σ┐«µ¡ú
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
Write-Host " AI Recorder πâçπâùπâ¡πéñπé╣πé»πâ¬πâùπâê" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# -------------------------------------------
# Step 1: τÆ░σóâσñëµò░πâüπéºπââπé»
# -------------------------------------------
Write-Host "[1/4] τÆ░σóâσñëµò░πéÆπâüπéºπââπé»Σ╕¡..." -ForegroundColor Yellow

$envFile = ".env.local"
if (-not (Test-Path $envFile)) {
    Write-Host "  Γ¥î .env.local πüîΦªïπüñπüïπéèπü╛πü¢πéô" -ForegroundColor Red
    
    if ($AutoFix) {
        Write-Host "  ≡ƒöº Φç¬σïòτöƒµêÉπüùπü╛πüÖ..." -ForegroundColor Yellow
        Copy-Item ".env.example" $envFile
    } else {
        Write-Host "  ΓåÆ .env.example πéÆπé│πâöπâ╝πüùπüª .env.local πéÆΣ╜£µêÉπüùπüªπüÅπüáπüòπüä" -ForegroundColor Gray
        Write-Host "  ΓåÆ πü╛πüƒπü» -AutoFix πé¬πâùπé╖πâºπâ│πüºΦç¬σïòτöƒµêÉ" -ForegroundColor Gray
        exit 1
    }
}

# τÆ░σóâσñëµò░πü«Φ¬¡πü┐Φ╛╝πü┐
$envContent = Get-Content $envFile -Raw
$envVars = @{}
foreach ($line in (Get-Content $envFile)) {
    if ($line -match "^([^#][^=]+)=(.*)$") {
        $envVars[$matches[1].Trim()] = $matches[2].Trim()
    }
}

# σ┐àΘáêτÆ░σóâσñëµò░πü«πâüπéºπââπé»
$requiredVars = @(
    @{ Name = "NEXT_PUBLIC_AZURE_SPEECH_KEY"; Description = "Speech Services APIπé¡πâ╝" },
    @{ Name = "NEXT_PUBLIC_AZURE_SPEECH_REGION"; Description = "Speech Services πâ¬πâ╝πé╕πâºπâ│" },
    @{ Name = "NEXT_PUBLIC_AZURE_TRANSLATOR_KEY"; Description = "Translator APIπé¡πâ╝" },
    @{ Name = "NEXT_PUBLIC_AZURE_TRANSLATOR_REGION"; Description = "Translator πâ¬πâ╝πé╕πâºπâ│" },
    @{ Name = "NEXT_PUBLIC_API_URL"; Description = "API URL" }
)

$hasError = $false
$needsUpdate = $false

foreach ($var in $requiredVars) {
    $value = $envVars[$var.Name]
    
    if (-not $value -or $value -match "your-.*-here") {
        Write-Host "  Γ¥î $($var.Name) πüîµ£¬Φ¿¡σ«Ü" -ForegroundColor Red
        $hasError = $true
        $needsUpdate = $true
    } else {
        # σÇñπü«µñ£Φ¿╝
        if ($var.Name -eq "NEXT_PUBLIC_AZURE_TRANSLATOR_REGION" -and $value -ne "global") {
            Write-Host "  ΓÜá∩╕Å  $($var.Name) = $value (ΘÇÜσ╕╕πü» 'global')" -ForegroundColor Yellow
        } else {
            $displayValue = if ($value.Length -gt 20) { $value.Substring(0, 20) + "..." } else { $value }
            Write-Host "  Γ£à $($var.Name) = $displayValue" -ForegroundColor Green
        }
    }
}

# Φç¬σïòΣ┐«µ¡ú
if ($needsUpdate -and $AutoFix) {
    Write-Host ""
    Write-Host "  ≡ƒöº AzureπüïπéëΦ¿¡σ«ÜπéÆΦç¬σïòσÅûσ╛ùΣ╕¡..." -ForegroundColor Yellow
    
    try {
        # Speech Services
        $speechKey = (az cognitiveservices account keys list --name speech-airecorder-dev --resource-group rg-airecorder-dev 2>$null | ConvertFrom-Json).key1
        $speechRegion = az cognitiveservices account show --name speech-airecorder-dev --resource-group rg-airecorder-dev --query location -o tsv 2>$null
        
        # Translator
        $translatorKey = (az cognitiveservices account keys list --name translator-airecorder-dev --resource-group rg-airecorder-dev 2>$null | ConvertFrom-Json).key1
        $translatorRegion = az cognitiveservices account show --name translator-airecorder-dev --resource-group rg-airecorder-dev --query location -o tsv 2>$null
        
        # .env.local πéÆµ¢┤µû░
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
        Write-Host "  Γ£à .env.local πéÆµ¢┤µû░πüùπü╛πüùπüƒ" -ForegroundColor Green
        $hasError = $false
    } catch {
        Write-Host "  Γ¥î Φç¬σïòσÅûσ╛ùπü½σñ▒µòù: $_" -ForegroundColor Red
    }
}

if ($hasError) {
    Write-Host ""
    Write-Host "τÆ░σóâσñëµò░πüîµ¡úπüùπüÅΦ¿¡σ«Üπüòπéîπüªπüäπü╛πü¢πéôπÇé" -ForegroundColor Red
    Write-Host "-AutoFix πé¬πâùπé╖πâºπâ│πüºΦç¬σïòΦ¿¡σ«Üπüºπüìπü╛πüÖ: .\scripts\deploy.ps1 -AutoFix" -ForegroundColor Gray
    exit 1
}

Write-Host ""

# -------------------------------------------
# Step 2: πâôπâ½πâë
# -------------------------------------------
if (-not $SkipBuild) {
    Write-Host "[2/4] πâôπâ½πâëΣ╕¡..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Γ¥î πâôπâ½πâëπü½σñ▒µòùπüùπü╛πüùπüƒ" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Γ£à πâôπâ½πâëσ«îΣ║å" -ForegroundColor Green
} else {
    Write-Host "[2/4] πâôπâ½πâëπéÆπé╣πé¡πââπâù" -ForegroundColor Gray
}

Write-Host ""

# -------------------------------------------
# Step 3: πâçπâùπâ¡πéñπâêπâ╝πé»πâ│σÅûσ╛ù
# -------------------------------------------
Write-Host "[3/4] πâçπâùπâ¡πéñπâêπâ╝πé»πâ│πéÆσÅûσ╛ùΣ╕¡..." -ForegroundColor Yellow
$token = az staticwebapp secrets list --name swa-airecorder-dev --query "properties.apiKey" -o tsv
if (-not $token) {
    Write-Host "  Γ¥î πâêπâ╝πé»πâ│πü«σÅûσ╛ùπü½σñ▒µòùπüùπü╛πüùπüƒ" -ForegroundColor Red
    exit 1
}
Write-Host "  Γ£à πâêπâ╝πé»πâ│σÅûσ╛ùσ«îΣ║å" -ForegroundColor Green
Write-Host ""

# -------------------------------------------
# Step 4: πâçπâùπâ¡πéñ
# -------------------------------------------
Write-Host "[4/4] πâçπâùπâ¡πéñΣ╕¡..." -ForegroundColor Yellow
swa deploy out --env production --deployment-token $token

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host " Γ£à πâçπâùπâ¡πéñσ«îΣ║å!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "URL: https://proud-rock-06bba6200.2.azurestaticapps.net" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "  Γ¥î πâçπâùπâ¡πéñπü½σñ▒µòùπüùπü╛πüùπüƒ" -ForegroundColor Red
    exit 1
}
