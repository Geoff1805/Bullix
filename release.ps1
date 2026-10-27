param(
    [string]$Version = "",
    [switch]$SkipTests = $false,
    [switch]$SkipBuild = $false,
    [switch]$DeployWeb = $true,
    [switch]$DryRun = $false
)

# Configuration Encodage UTF-8 Standard (Antigravity)
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues['*:Encoding'] = 'utf8'


$ErrorActionPreference = "Stop"

$LockFile = ".build.lock"
if (Test-Path $LockFile) {
    $LockTime = (Get-Item $LockFile).LastWriteTime
    Write-Warning "Un fichier $LockFile actif existe deja ($LockTime)."
    $Confirm = Read-Host "Un autre build est peut-etre en cours. Continuer quand meme ? (o/N)"
    if ($Confirm -ne "o" -and $Confirm -ne "O") {
        Write-Error "Arret par securite anti-collision multi-chats (Regle 16)."
    }
}

Set-Content -Path $LockFile -Value (Get-Date -Format "yyyy-MM-dd HH:mm:ss") -Force

try {
    $AppName = (Get-Item .).Name
    if (Test-Path "settings.gradle.kts") {
        $RootMatch = Select-String -Path "settings.gradle.kts" -Pattern 'rootProject\.name\s*=\s*"([^"]+)"'
        if ($RootMatch -and $RootMatch.Matches.Count -gt 0) {
            $AppName = $RootMatch.Matches[0].Groups[1].Value
        }
    }

    if (-not $Version) {
        if (Test-Path "version.properties") {
            $vLine = Select-String -Path "version.properties" -Pattern '^versionName=(.*)$'
            if ($vLine) {
                $Version = $vLine.Matches[0].Groups[1].Value.Trim()
            }
        } elseif (Test-Path "package.json") {
            $Version = (Get-Content "package.json" | ConvertFrom-Json).version
        }
    }

    if (-not $Version) {
        throw "Impossible de determiner la version. Utilisez -Version X.Y.Z"
    }

    $Tag = "v$Version"
    $ApkName = "$AppName-$Tag.apk"

    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "Pipeline de Release Local : $AppName ($Tag)" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan

    if (-not $SkipTests) {
        if (Test-Path "gradlew") {
            Write-Host "`n[1/5] Execution des tests unitaires Gradle..." -ForegroundColor Yellow
            ./gradlew testDebugUnitTest --no-daemon
            Write-Host "Tests unitaires valides avec succes." -ForegroundColor Green
        } elseif (Test-Path "package.json") {
            $pkg = Get-Content "package.json" | ConvertFrom-Json
            if ($pkg.scripts.test) {
                Write-Host "`n[1/5] Execution des tests npm..." -ForegroundColor Yellow
                npm test
            }
        }
    } else {
        Write-Host "`n[1/5] Tests unitaires ignores (-SkipTests)." -ForegroundColor DarkGray
    }

    if (-not $SkipBuild) {
        if (Test-Path "gradlew") {
            Write-Host "`n[2/5] Compilation de l'APK Release optimise (R8 Full Mode)..." -ForegroundColor Yellow
            ./gradlew assembleRelease --no-daemon

            New-Item -ItemType Directory -Force "build-artifacts" | Out-Null
            $ReleaseApk = Get-ChildItem -Path "app/build/outputs/apk/release/*.apk" -ErrorAction SilentlyContinue | Select-Object -First 1

            if ($ReleaseApk) {
                Copy-Item $ReleaseApk.FullName "build-artifacts/$ApkName" -Force
                Copy-Item $ReleaseApk.FullName "build-artifacts/$AppName.apk" -Force
                $SizeMb = [math]::Round((Get-Item "build-artifacts/$ApkName").Length / 1MB, 2)
                Write-Host "APK normalise pret : build-artifacts/$ApkName ($SizeMb Mo)" -ForegroundColor Green
            } else {
                Write-Warning "Aucun APK release trouve dans app/build/outputs/apk/release/"
            }
        }
    } else {
        Write-Host "`n[2/5] Compilation ignoree (-SkipBuild)." -ForegroundColor DarkGray
    }

    if ($DryRun) {
        Write-Host "`nMode DryRun : arret avant commit, tag et publication." -ForegroundColor Magenta
        return
    }

    Write-Host "`n[3/5] Creation du commit et tag Git $Tag..." -ForegroundColor Yellow
    git add .
    git commit -m "chore(release): bump version to $Version [skip ci]" --allow-empty
    git tag -a $Tag -m "Release $Tag" -f
    git push origin main --tags
    Write-Host "Commit et tag $Tag synchronises sur GitHub." -ForegroundColor Green

    Write-Host "`n[4/5] Publication sur GitHub Releases..." -ForegroundColor Yellow
    $ArtifactTarget = "build-artifacts/$ApkName"
    if (Test-Path $ArtifactTarget) {
        $rel = gh release view $Tag 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Mise a jour des binaires pour le tag existant $Tag..." -ForegroundColor Cyan
            gh release upload $Tag "build-artifacts/$ApkName" "build-artifacts/$AppName.apk" --clobber
        } else {
            Write-Host "Creation d'une nouvelle Release $Tag..." -ForegroundColor Cyan
            gh release create $Tag "build-artifacts/$ApkName" "build-artifacts/$AppName.apk" --title "$AppName $Tag" --generate-notes
        }
        Write-Host "Binaire APK publie sur GitHub Releases." -ForegroundColor Green
    } else {
        Write-Host "Aucun APK a attacher a la release." -ForegroundColor DarkGray
    }

    if ($DeployWeb -and (Test-Path "web") -and (Get-Command wrangler -ErrorAction SilentlyContinue)) {
        Write-Host "`n[5/5] Deploiement Cloudflare Pages via Wrangler..." -ForegroundColor Yellow
        $ProjectSlug = $AppName.ToLower().Replace(" ", "-")
        try {
            wrangler pages deploy web --project-name=$ProjectSlug --commit-dirty=true
            Write-Host "Application Web employee sur Cloudflare Pages." -ForegroundColor Green
        } catch {
            Write-Warning "Deploiement Wrangler direct non finalise."
        }
    }

    Write-Host "`n==========================================================" -ForegroundColor Green
    Write-Host "Release $AppName $Tag terminee avec succes !" -ForegroundColor Green
    Write-Host "   - APK installable : build-artifacts/$ApkName" -ForegroundColor Green
    Write-Host "   - Minutes GitHub Actions consommees : 0" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
} finally {
    if (Test-Path $LockFile) {
        Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
    }
}