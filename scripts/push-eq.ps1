# push-eq.ps1 — safe git push helper for eq-solves-service
#
# Why this exists:
#   The working tree is touched by several processes — Cowork sessions,
#   coworkr-svc file sync, editors, occasional AV scans. Any of them can
#   leave .git/index.lock behind when they exit badly, and when a second
#   process pushes to origin while you're composing a commit locally, a
#   plain `git push` gets rejected ("fetch first").
#
#   This script wraps the add → commit → push flow with:
#     1. Stale-lock auto-clear (safe: only if no git.exe is actually running
#        AND the lock file is older than 3 seconds)
#     2. Auto pull --rebase if the remote has moved since your last fetch
#     3. Clear, loud errors when something genuinely needs your attention
#
# Usage:
#   .\scripts\push-eq.ps1 -Message "fix(auth): something" -Paths @(
#       'app/(auth)/auth/callback/route.ts',
#       'app/(auth)/auth/signin/page.tsx'
#   )
#
#   Or for a bare "push whatever's staged":
#   .\scripts\push-eq.ps1 -PushOnly
#
# Notes:
#   - Paths containing parens MUST be single-quoted in PowerShell or the
#     shell parses them as subexpressions. The script uses -Paths as a
#     string array to avoid this.
#   - Never runs `git push --force`. If the remote has diverged in a way
#     rebase can't handle, it stops and tells you.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Message,

    [Parameter(Mandatory = $false)]
    [string[]]$Paths = @(),

    [Parameter(Mandatory = $false)]
    [switch]$PushOnly,

    [Parameter(Mandatory = $false)]
    [string]$Remote = 'origin',

    [Parameter(Mandatory = $false)]
    [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$Text) Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-OK   { param([string]$Text) Write-Host "[ok] $Text" -ForegroundColor Green }
function Write-Warn { param([string]$Text) Write-Host "[warn] $Text" -ForegroundColor Yellow }
function Write-Err  { param([string]$Text) Write-Host "[error] $Text" -ForegroundColor Red }

function Clear-StaleLock {
    $lockPath = Join-Path (Get-Location) '.git\index.lock'
    if (-not (Test-Path $lockPath)) { return }

    # If a real git.exe is running, don't touch the lock — it's legitimately held.
    $gitProcs = Get-Process -Name git -ErrorAction SilentlyContinue
    if ($gitProcs) {
        Write-Warn "index.lock exists AND a git.exe process is running (PID $($gitProcs.Id -join ', ')). Waiting..."
        Start-Sleep -Seconds 3
        if (Test-Path $lockPath) {
            $gitProcs = Get-Process -Name git -ErrorAction SilentlyContinue
            if ($gitProcs) {
                throw "git.exe is still running (PID $($gitProcs.Id -join ', ')). Refusing to remove index.lock."
            }
        } else {
            return
        }
    }

    # No git process, but lock exists — check the age. If it's brand new (<2s)
    # some other tool may be writing; give it a moment.
    $lockFile = Get-Item $lockPath
    $ageSeconds = ((Get-Date) - $lockFile.LastWriteTime).TotalSeconds
    if ($ageSeconds -lt 2) {
        Start-Sleep -Seconds 2
        if (-not (Test-Path $lockPath)) { return }
    }

    Write-Warn "Removing stale .git/index.lock (age $([int]$ageSeconds)s, no git.exe running)"
    Remove-Item -Force $lockPath
    Write-OK 'Lock cleared.'
}

function Invoke-GitSafe {
    param([string[]]$Args)
    Clear-StaleLock
    & git @Args
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE"
    }
}

# -------------------- main --------------------

if (-not (Test-Path '.git')) {
    Write-Err 'Not inside a git repository. Run this from the repo root.'
    exit 1
}

try {
    Clear-StaleLock

    # 1. Fetch to see where the remote is
    Write-Step "Fetching $Remote/$Branch"
    Invoke-GitSafe @('fetch', $Remote, $Branch)

    # 2. If the remote is ahead, rebase local on top before touching anything
    $localHash  = (& git rev-parse "$Branch").Trim()
    $remoteHash = (& git rev-parse "$Remote/$Branch").Trim()
    $baseHash   = (& git merge-base $Branch "$Remote/$Branch").Trim()

    if ($remoteHash -ne $localHash -and $remoteHash -ne $baseHash) {
        Write-Step "Remote has moved — rebasing onto $Remote/$Branch"
        Invoke-GitSafe @('pull', '--rebase', $Remote, $Branch)
        Write-OK 'Rebase complete.'
    } else {
        Write-OK 'Local is up-to-date with remote (or ahead).'
    }

    # 3. Stage + commit (unless -PushOnly)
    if (-not $PushOnly) {
        if (-not $Message) {
            Write-Err 'Provide -Message (or use -PushOnly if everything is already committed).'
            exit 2
        }
        if ($Paths.Count -eq 0) {
            Write-Err 'Provide -Paths @("file1", "file2") to stage, or use -PushOnly.'
            exit 2
        }

        Write-Step "Staging $($Paths.Count) path(s)"
        $stageArgs = @('add') + $Paths
        Invoke-GitSafe $stageArgs

        # Only commit if something is actually staged
        $staged = (& git diff --cached --name-only)
        if (-not $staged) {
            Write-Warn 'Nothing staged after add — skipping commit.'
        } else {
            Write-Step 'Committing'
            Invoke-GitSafe @('commit', '-m', $Message)
            Write-OK 'Commit created.'
        }
    }

    # 4. Push
    Write-Step "Pushing to $Remote/$Branch"
    Invoke-GitSafe @('push', $Remote, $Branch)
    Write-OK 'Pushed.'
}
catch {
    Write-Err $_.Exception.Message
    Write-Host ''
    Write-Host 'If this is a merge conflict, resolve it manually in VS Code, then run:' -ForegroundColor Yellow
    Write-Host '    git add <resolved-files>' -ForegroundColor Yellow
    Write-Host '    git rebase --continue' -ForegroundColor Yellow
    Write-Host '    git push origin main' -ForegroundColor Yellow
    exit 1
}
