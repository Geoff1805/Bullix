<#
.SYNOPSIS
    Script tout-en-un pour executer le scraping de Bullix depuis votre PC personnel (IP residentielle).
    Permet d'extraire BDtheque et BDvore sans blocage WAF / Cloudflare 403, 
    d'envoyer les images vers Cloudflare R2 et d'injecter la base dans Cloudflare D1.

.DESCRIPTION
    1. Verifie la presence de Node.js et installe les dependances si necessaire.
    2. Lance le scraping via votre connexion internet (IP residentielle).
    3. Transfere directement les jaquettes vers Cloudflare R2 (bullix-images).
    4. Injecte le batch SQL resultant dans Cloudflare D1 (bullix-db).
#>

[CmdletBinding()]
param(
    [ValidateSet("all", "bdtheque", "bdovore")]
    [string]$Source = "all",

    [int]$MaxPerCategory = 10,

    [string]$Categories = "BD,Manga,Comics",

    [int]$Page = 0,

    [switch]$Reset,

    [switch]$NoAdvance,

    [switch]$SkipUploadR2,

    [switch]$SkipD1
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   [BULLIX] - Scraping Local & Injection Cloudflare     " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verification de Node.js
Write-Host "[1/5] Verification de l'environnement local..." -ForegroundColor Yellow

if (Test-Path "C:\Program Files\nodejs\node.exe") {
    $env:PATH = "C:\Program Files\nodejs;$env:PATH"
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue

if (-not $nodeCmd) {
    Write-Warning "Node.js n'est pas detecte dans votre variable d'environnement PATH."
    Write-Host "Voulez-vous installer Node.js LTS automatiquement via winget ? (O/N) : " -ForegroundColor Cyan -NoNewline
    $rep = Read-Host
    if ($rep -eq "O" -or $rep -eq "o") {
        Write-Host "Installation de Node.js LTS en cours..." -ForegroundColor Green
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        Write-Host "Veuillez redemarrer votre terminal PowerShell pour recharger le PATH, puis relancez ce script." -ForegroundColor Yellow
        exit 0
    } else {
        Write-Error "Node.js est necessaire pour executer le moteur de scraping. Rendez-vous sur https://nodejs.org pour l'installer."
        exit 1
    }
} else {
    $nodeVersion = node -v
    Write-Host "  -> Node.js detecte : $nodeVersion" -ForegroundColor Green
}

# 2. Verification des dependances node_modules
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $projectRoot

if (-not (Test-Path "node_modules")) {
    Write-Host ""
    Write-Host "[2/5] Installation des dependances npm..." -ForegroundColor Yellow
    npm install --legacy-peer-deps
} else {
    Write-Host ""
    Write-Host "[2/5] Dependances locales pretes." -ForegroundColor Green
}

# 3. Recuperation des Identifiants Cloudflare
Write-Host ""
Write-Host "[3/5] Detection des identifiants Cloudflare..." -ForegroundColor Yellow
$envFile = Join-Path $projectRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$") {
            $k = $matches[1]
            $v = $matches[2].Trim('"' , "'")
            [System.Environment]::SetEnvironmentVariable($k, $v, "Process")
        }
    }
}

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
    Write-Host "Entrez votre Cloudflare API Token (ou appuyez sur Entree pour passer l'envoi cloud) : " -ForegroundColor Cyan -NoNewline
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

# 4. Execution du Scraping
Write-Host ""
Write-Host "[4/5] Demarrage du scraping residentiel..." -ForegroundColor Yellow
Write-Host "  Source : $Source | Max par categorie : $MaxPerCategory | Categories : $Categories" -ForegroundColor DarkGray

$scrapeArgs = @(
    "tsx",
    "scripts/scraping/index.ts",
    "--source=$Source",
    "--max=$MaxPerCategory",
    "--categories=$Categories",
    "--output=scraped_data.json",
    "--sql=generated_seed.sql"
)

if ($Page -gt 0) {
    $scrapeArgs += "--page=$Page"
}
if ($Reset) {
    $scrapeArgs += "--reset"
}
if ($NoAdvance) {
    $scrapeArgs += "--no-advance"
}

npx @scrapeArgs

if ($LASTEXITCODE -ne 0) {
    Write-Error "Le scraping a rencontre une erreur."
    exit $LASTEXITCODE
}

# 5. Injection directe dans Cloudflare D1 & Delegation du transfert d'images
if (-not $SkipD1) {
    Write-Host ""
    Write-Host "[5/5] Injection des metadonnees dans Cloudflare D1 (bullix-db)..." -ForegroundColor Yellow
    $incSql = Join-Path $projectRoot "incremental_seed.sql"
    if (Test-Path $incSql) {
        $content = Get-Content $incSql -Raw
        if ($content -match "INSERT OR IGNORE") {
            Write-Host "  -> Injection des nouveaux albums dans Cloudflare D1..." -ForegroundColor Yellow
            npx wrangler d1 execute bullix-db --remote --file=incremental_seed.sql -y
        } else {
            Write-Host "  -> Base Cloudflare D1 deja a jour (aucun nouvel album a inserer)." -ForegroundColor Green
        }
        Remove-Item -Path $incSql -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "  -> Injection du batch complet dans Cloudflare D1..." -ForegroundColor Yellow
        npx wrangler d1 execute bullix-db --remote --file=generated_seed.sql -y
    }
    Write-Host "  ✅ Metadonnees injectees dans D1 avec succes !" -ForegroundColor Green
    Write-Host "  ℹ️ Les jaquettes seront automatiquement rapatriees et mises en cache dans R2" -ForegroundColor Cyan
    Write-Host "     a la volee par Cloudflare Edge (zero consommation reseau locale)." -ForegroundColor Cyan
}

if (-not $SkipUploadR2 -and $env:CLOUDFLARE_API_TOKEN -and $env:CLOUDFLARE_ACCOUNT_ID) {
    Write-Host ""
    Write-Host "[Optionnel] Transfert local force vers R2 (-SkipUploadR2 pour desactiver)..." -ForegroundColor DarkGray
    npx tsx scripts/scraping/upload_covers_to_r2.ts scraped_data.json generated_seed.sql
}

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "   Operation terminee avec succes !                    " -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
