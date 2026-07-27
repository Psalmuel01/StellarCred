# Quick setup script to add nargo and bb to Windows PATH
# Run this once to permanently configure your environment

param(
    [switch]$CurrentSessionOnly
)

$ErrorActionPreference = "Stop"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "         StellarCred Windows PATH Setup                        " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

# Common installation locations
$possiblePaths = @(
    "$env:USERPROFILE\.nargo\bin",
    "$env:USERPROFILE\.noirup\bin",
    "$env:LOCALAPPDATA\nargo\bin",
    "C:\nargo\bin"
)

$bbPossiblePaths = @(
    "$env:USERPROFILE\.bb\bin",
    "$env:LOCALAPPDATA\bb\bin",
    "C:\bb\bin"
)

# Find nargo
Write-Host "Searching for nargo installation..." -ForegroundColor Yellow
$nargoPath = $null
foreach ($path in $possiblePaths) {
    $nargoExe = Join-Path $path "nargo.exe"
    if (Test-Path $nargoExe) {
        $nargoPath = $path
        Write-Host "  [OK] Found nargo at: $nargoExe" -ForegroundColor Green
        break
    }
}

if (-not $nargoPath) {
    Write-Host "  [X] nargo not found in common locations" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install nargo first:" -ForegroundColor Yellow
    Write-Host '  iwr -useb https://raw.githubusercontent.com/noir-lang/noirup/main/install | iex'
    Write-Host '  noirup -v 1.0.0-beta.9'
    Write-Host ""
    $manual = Read-Host "Enter nargo.exe path manually, or press Enter to skip"
    if ($manual) {
        if (Test-Path $manual) {
            $nargoPath = Split-Path -Parent $manual
            Write-Host "  [OK] Using: $nargoPath" -ForegroundColor Green
        }
    }
}

# Find bb
Write-Host "Searching for bb (Barretenberg) installation..." -ForegroundColor Yellow
$bbPath = $null
foreach ($path in $bbPossiblePaths) {
    $bbExe = Join-Path $path "bb.exe"
    if (Test-Path $bbExe) {
        $bbPath = $path
        Write-Host "  [OK] Found bb at: $bbExe" -ForegroundColor Green
        break
    }
}

if (-not $bbPath) {
    Write-Host "  [X] bb not found in common locations" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install bb first:" -ForegroundColor Yellow
    Write-Host '  iwr -useb https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install | iex'
    Write-Host '  bbup -v 0.87.0'
    Write-Host ""
    $manual = Read-Host "Enter bb.exe path manually, or press Enter to skip"
    if ($manual) {
        if (Test-Path $manual) {
            $bbPath = Split-Path -Parent $manual
            Write-Host "  [OK] Using: $bbPath" -ForegroundColor Green
        }
    }
}

# Update PATH
Write-Host ""
if ($nargoPath -or $bbPath) {
    if ($CurrentSessionOnly) {
        Write-Host "Adding to PATH (current session only)..." -ForegroundColor Yellow
        if ($nargoPath) {
            $env:Path += ";$nargoPath"
            Write-Host "  [OK] Added: $nargoPath" -ForegroundColor Green
        }
        if ($bbPath) {
            $env:Path += ";$bbPath"
            Write-Host "  [OK] Added: $bbPath" -ForegroundColor Green
        }
        Write-Host ""
        Write-Host "PATH updated for this PowerShell session." -ForegroundColor Green
        Write-Host "Run this script without -CurrentSessionOnly to make it permanent." -ForegroundColor Yellow
    }
    else {
        Write-Host "Adding to PATH (permanent)..." -ForegroundColor Yellow
        
        $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
        $updated = $false
        
        if ($nargoPath -and $currentUserPath -notlike "*$nargoPath*") {
            [Environment]::SetEnvironmentVariable(
                "Path",
                "$currentUserPath;$nargoPath",
                "User"
            )
            $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
            $env:Path += ";$nargoPath"
            Write-Host "  [OK] Added permanently: $nargoPath" -ForegroundColor Green
            $updated = $true
        }
        elseif ($nargoPath) {
            Write-Host "  [-] Already in PATH: $nargoPath" -ForegroundColor Gray
        }
        
        if ($bbPath -and $currentUserPath -notlike "*$bbPath*") {
            [Environment]::SetEnvironmentVariable(
                "Path",
                "$currentUserPath;$bbPath",
                "User"
            )
            $env:Path += ";$bbPath"
            Write-Host "  [OK] Added permanently: $bbPath" -ForegroundColor Green
            $updated = $true
        }
        elseif ($bbPath) {
            Write-Host "  [-] Already in PATH: $bbPath" -ForegroundColor Gray
        }
        
        if ($updated) {
            Write-Host ""
            Write-Host "PATH updated permanently!" -ForegroundColor Green
            Write-Host "Changes are active in this session and will persist in new sessions." -ForegroundColor Green
        }
        else {
            Write-Host ""
            Write-Host "All paths already configured." -ForegroundColor Green
        }
    }
}
else {
    Write-Host "No tools found to add to PATH." -ForegroundColor Red
    exit 1
}

# Verify
Write-Host ""
Write-Host "Verifying installation..." -ForegroundColor Yellow

$nargoWorks = $false
$bbWorks = $false

try {
    $nargoVersion = & nargo --version 2>&1 | Out-String
    Write-Host "  [OK] nargo: $($nargoVersion.Trim())" -ForegroundColor Green
    $nargoWorks = $true
} catch {
    Write-Host "  [X] nargo: not accessible" -ForegroundColor Red
}

try {
    $bbVersion = & bb --version 2>&1 | Out-String
    Write-Host "  [OK] bb: $($bbVersion.Trim())" -ForegroundColor Green
    $bbWorks = $true
} catch {
    Write-Host "  [X] bb: not accessible" -ForegroundColor Red
}

Write-Host ""
if ($nargoWorks -and $bbWorks) {
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "SUCCESS! Your environment is ready." -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "You can now run:" -ForegroundColor Cyan
    Write-Host "  .\scripts\generate_testvectors.ps1"
    Write-Host "  .\scripts\verify_testvectors.ps1"
    exit 0
}
else {
    Write-Host "=================================================================" -ForegroundColor Red
    Write-Host "INCOMPLETE: Some tools are not working" -ForegroundColor Red
    Write-Host "=================================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Try:" -ForegroundColor Yellow
    Write-Host "  1. Close and reopen PowerShell"
    Write-Host "  2. Run: Get-Command nargo"
    Write-Host "  3. Check WINDOWS_SETUP.md for detailed troubleshooting"
    exit 1
}
