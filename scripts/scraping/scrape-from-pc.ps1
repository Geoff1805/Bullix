<#
.SYNOPSIS
    Script tout-en-un pour exécuter le scraping de Bullix depuis votre PC personnel (IP résidentielle).
    Permet d'extraire BDthèque et BDvore sans blocage WAF / Cloudflare 403, 
    d'envoyer les images vers Cloudflare R2 et d'injecter la base dans Cloudflare D1.

.DESCRIPTION
    1. Vérifie la présence de Node.js et installe les dépendances si nécessaire.
    2. Lance le scraping via votre connexion internet (IP résidentielle).
    3. Transfère directement les jaquettes vers Cloudflare R2 (bullix-images).
    4. Injecte le batch SQL résultant dans Cloudflare D1 (bullix-db).
#>

[CmdletBinding()]
param(
    [ValidateSet("all", "bdtheque", "bdovore")]
    [string]$Source = "all",

    [int]$MaxPerCategory = 10,

    [string]$Categories = "BD,Manga,Comics",

    [switch]$SkipUploadR2,

    [switch]$SkipD1
)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "   📚 BULLIX — Scraping Local & Injection Cloudflare    " -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. Vérification de Node.js
Write-Host "🔍 [1/5] Vérification de l'environnement local..." -ForegroundColor Yellow
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue

if (-not $nodeCmd) {
    Write-Warning "Node.js n'est pas détecté dans votre variable d'environnement PATH."
    Write-Host "Voulez-vous installer Node.js LTS automatiquement via winget ? (O/N) " -ForegroundColor Cyan -NoNewline
    $rep = Read-Host
    if ($rep -eq "O" -or $rep -eq "o") {
        Write-Host "Installation de Node.js LTS en cours..." -ForegroundColor Green
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        Write-Host "Veuillez redémarrer votre terminal PowerShell pour recharger le PATH, puis relancez ce script." -ForegroundColor Yellow
        exit 0
    } else {
        Write-Error "Node.js est nécessaire pour exécuter le moteur de scraping. Rendez-vous sur https://nodejs.org pour l'installer."
        exit 1
    }
} else {
    $nodeVersion = node -v
    Write-Host "  -> Node.js détecté : $nodeVersion" -ForegroundColor Green
}

# 2. Vérification des dépendances node_modules
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $projectRoot

if (-not (Test-Path "node_modules")) {
    Write-Host "`n📦 [2/5] Installation des dépendances npm..." -ForegroundColor Yellow
    npm install --legacy-peer-deps
} else {
    Write-Host "`n📦 [2/5] Dépendances locales prêtes." -ForegroundColor Green
}

# 3. Récupération des Identifiants Cloudflare
Write-Host "`n🔑 [3/5] Détection des identifiants Cloudflare..." -ForegroundColor Yellow
$apiToken = $env:CLOUDFLARE_API_TOKEN
$accountId = $env:CLOUDFLARE_ACCOUNT_ID

if (-not $apiToken -or -not $accountId) {
    $manualInfoPath = Join-Path $projectRoot "infos manuelles.txt"
    if (Test-Path $manualInfoPath) {
        $content = Get-Content $manualInfoPath -Raw
        if ($content -match "Account ID\s*:\s*([a-f0-9]+)") {
            $accountId = $matches[1]
        }
    }
}

if (-not $apiToken) {
    Write-Host "Entrez votre Cloudflare API Token (ou appuyez sur Entrée pour passer l'envoi cloud) : " -ForegroundColor Cyan -NoNewline
    $inputToken = Read-Host
    if ($inputToken) { $apiToken = $inputToken }
}

if (-not $accountId) {
    Write-Host "Entrez votre Cloudflare Account ID : " -ForegroundColor Cyan -NoNewline
    $inputAccountId = Read-Host
    if ($inputAccountId) { $accountId = $inputAccountId }
}

if ($apiToken) { $env:CLOUDFLARE_API_TOKEN = $apiToken }
if ($accountId) { $env:CLOUDFLARE_ACCOUNT_ID = $accountId }

# 4. Exécution du Scraping
Write-Host "`n🚀 [4/5] Démarrage du scraping résidentiel..." -ForegroundColor Yellow
Write-Host "  Source : $Source | Max par catégorie : $MaxPerCategory | Catégories : $Categories" -ForegroundColor DarkGray

npx tsx scripts/scraping/index.ts `
    --source="$Source" `
    --max="$MaxPerCategory" `
    --categories="$Categories" `
    --output="scraped_data.json" `
    --sql="generated_seed.sql"

if ($LASTEXITCODE -ne 0) {
    Write-Error "Le scraping a rencontré une erreur."
    exit $LASTEXITCODE
}

# 5. Transfert Cloudflare R2 & D1
if (-not $SkipUploadR2 -and $env:CLOUDFLARE_API_TOKEN -and $env:CLOUDFLARE_ACCOUNT_ID) {
    Write-Host "`n☁️ [5/5] Transfert direct des jaquettes vers Cloudflare R2..." -ForegroundColor Yellow
    npx tsx scripts/scraping/upload_covers_to_r2.ts scraped_data.json generated_seed.sql

    if (-not $SkipD1) {
        Write-Host "`n🗄️ Application du schéma et injection dans Cloudflare D1 (bullix-db)..." -ForegroundColor Yellow
        npx wrangler d1 execute bullix-db --remote --file=schema.sql
        npx wrangler d1 execute bullix-db --remote --file=generated_seed.sql
    }
} else {
    Write-Host "`n⚠️ Envoi Cloudflare ignoré (jetons non configurés ou option -SkipUploadR2 activée)." -ForegroundColor DarkYellow
    Write-Host "Les fichiers locaux scraped_data.json et generated_seed.sql sont prêts." -ForegroundColor Green
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "   ✅ Opération terminée avec succès !                 " -ForegroundColor Green
Write-Host "========================================================`n" -ForegroundColor Green
