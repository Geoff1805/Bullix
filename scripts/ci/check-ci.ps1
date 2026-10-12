<#
.SYNOPSIS
    Supervise et inspecte les workflows GitHub Actions du dépôt Geoff1805/Bullix,
    y compris les sous-erreurs d'étapes (steps) et les annotations d'avertissement.

.DESCRIPTION
    Interroge l'API GitHub pour récupérer le statut détaillé des workflows et sous-étapes.
    Peut surveiller en continu (-Watch) jusqu'à terminaison de tous les runs et inspecter les logs.

.PARAMETER CommitSha
    SHA spécifique du commit à inspecter. Si non spécifié, prend le dernier commit de main.

.PARAMETER Watch
    Attend et interroge régulièrement jusqu'à ce que tous les workflows en cours soient terminés.

.PARAMETER ShowSubErrors
    Affiche le détail des sous-étapes ayant rencontré des erreurs ou des avertissements.

.PARAMETER TimeoutSeconds
    Délai maximal en secondes pour le mode Watch (défaut: 300s).

.PARAMETER IntervalSeconds
    Intervalle entre deux sondages en secondes (défaut: 15s).
#>

[CmdletBinding()]
param(
    [string]$CommitSha,
    [switch]$Watch,
    [switch]$ShowSubErrors = $true,
    [int]$TimeoutSeconds = 300,
    [int]$IntervalSeconds = 15
)

$repoOwner = "Geoff1805"
$repoName = "Bullix"

# Récupération du jeton GitHub
$token = $env:GITHUB_TOKEN
if (-not $token) {
    $token = $env:GH_TOKEN
}
if (-not $token) {
    $mcpConfigFile = "C:\Users\developer\.gemini\config\mcp_config.json"
    if (Test-Path $mcpConfigFile) {
        try {
            $mcpConfig = Get-Content $mcpConfigFile -Raw | ConvertFrom-Json
            $authHeader = $mcpConfig.mcpServers.'github-mcp-server'.headers.Authorization
            if ($authHeader -match "Bearer\s+(.+)") {
                $token = $matches[1]
            } elseif ($authHeader) {
                $token = $authHeader
            }
        } catch {
            Write-Warning "Impossible de lire le jeton depuis $mcpConfigFile : $_"
        }
    }
}

if (-not $token) {
    Write-Error "Aucun jeton GitHub trouvé. Définissez GITHUB_TOKEN ou configurez mcp_config.json."
    exit 1
}

$headers = @{
    "Authorization" = if ($token -match "^Bearer ") { $token } else { "Bearer $token" }
    "Accept"        = "application/vnd.github+json"
    "User-Agent"    = "Bullix-CI-Watcher"
}

# Déterminer le SHA cible si non fourni
if (-not $CommitSha) {
    try {
        $branchInfo = Invoke-RestMethod -Uri "https://api.github.com/repos/$repoOwner/$repoName/branches/main" -Headers $headers
        $CommitSha = $branchInfo.commit.sha
        Write-Host "Dernier commit sur 'main' : $CommitSha" -ForegroundColor Cyan
    } catch {
        Write-Warning "Impossible de récupérer le dernier commit : $_"
    }
}

function Get-CommitRuns {
    param([string]$sha)
    $uri = if ($sha) {
        "https://api.github.com/repos/$repoOwner/$repoName/actions/runs?head_sha=$sha"
    } else {
        "https://api.github.com/repos/$repoOwner/$repoName/actions/runs?branch=main&per_page=5"
    }
    $response = Invoke-RestMethod -Uri $uri -Headers $headers
    return $response.workflow_runs
}

function Show-RunDetails {
    param($run)
    $statusColor = switch ($run.conclusion) {
        "success"   { "Green" }
        "failure"   { "Red" }
        "cancelled" { "DarkYellow" }
        default     { if ($run.status -eq "in_progress") { "Yellow" } else { "Gray" } }
    }
    $conclusionText = if ($run.conclusion) { $run.conclusion } else { $run.status }
    Write-Host "  -> [$($conclusionText.ToUpper())] $($run.name) (Run ID: $($run.id))" -ForegroundColor $statusColor
    Write-Host "     URL: $($run.html_url)" -ForegroundColor DarkGray

    # Inspection détaillée des sous-étapes et annotations
    if ($run.status -eq "completed" -or $run.conclusion -eq "failure") {
        try {
            $jobsResponse = Invoke-RestMethod -Uri "https://api.github.com/repos/$repoOwner/$repoName/actions/runs/$($run.id)/jobs" -Headers $headers
            foreach ($job in $jobsResponse.jobs) {
                # Étapes en échec (y compris avec continue-on-error)
                $failedSteps = $job.steps | Where-Object { $_.conclusion -eq "failure" }
                if ($failedSteps) {
                    Write-Host "     [Sous-erreur Job: $($job.name)]" -ForegroundColor Red
                    foreach ($step in $failedSteps) {
                        Write-Host "       x Étape en échec : $($step.name)" -ForegroundColor Red
                    }
                }

                # Annotations GitHub (avertissements et erreurs de tooling)
                try {
                    $annotations = Invoke-RestMethod -Uri "https://api.github.com/repos/$repoOwner/$repoName/check-runs/$($job.id)/annotations" -Headers $headers
                    $warningsOrErrors = $annotations | Where-Object { $_.annotation_level -in @("warning", "failure") }
                    if ($warningsOrErrors) {
                        foreach ($ann in $warningsOrErrors) {
                            $levelColor = if ($ann.annotation_level -eq "failure") { "Red" } else { "DarkYellow" }
                            Write-Host "       ! [$($ann.annotation_level)] $($ann.message)" -ForegroundColor $levelColor
                        }
                    }
                } catch {}
            }
        } catch {
            Write-Warning "     Impossible de charger les jobs pour le run $($run.id) : $_"
        }
    }
}

$startTime = Get-Date

do {
    $runs = Get-CommitRuns -sha $CommitSha
    if (-not $runs -or $runs.Count -eq 0) {
        Write-Host "Aucun workflow déclenché pour l'instant pour $CommitSha..." -ForegroundColor DarkGray
    } else {
        $inProgress = $runs | Where-Object { $_.status -in @("in_progress", "queued", "waiting", "requested") }
        $failed = $runs | Where-Object { $_.conclusion -eq "failure" }

        Write-Host "`n--- Statut GitHub Actions ($(Get-Date -Format 'HH:mm:ss')) ---" -ForegroundColor White
        foreach ($r in $runs) {
            Show-RunDetails -run $r
        }

        if (-not $Watch) {
            if ($failed.Count -gt 0) { exit 1 } else { exit 0 }
        }

        if ($inProgress.Count -eq 0) {
            Write-Host "`nTous les workflows sont terminés." -ForegroundColor Cyan
            if ($failed.Count -gt 0) {
                Write-Host "ERREUR : $($failed.Count) workflow(s) en échec !" -ForegroundColor Red
                exit 1
            } else {
                Write-Host "SUCCÈS : Tous les workflows sont au vert !" -ForegroundColor Green
                exit 0
            }
        }
    }

    if ($Watch) {
        $elapsed = ((Get-Date) - $startTime).TotalSeconds
        if ($elapsed -ge $TimeoutSeconds) {
            Write-Error "Délai d'attente ($TimeoutSeconds s) dépassé."
            exit 2
        }
        Write-Host "En attente ($($inProgress.Count) en cours)... Prochain contrôle dans $IntervalSeconds s." -ForegroundColor DarkGray
        Start-Sleep -Seconds $IntervalSeconds
    }
} while ($Watch)
