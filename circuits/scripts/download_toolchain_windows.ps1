# Download pre-built Noir and Barretenberg binaries for Windows
# This bypasses the bash-only noirup/bbup installers

param(
    [switch]$SkipNargo,
    [switch]$SkipBB
)

$ErrorActionPreference = "Stop"

$NOIR_VERSION = "1.0.0-beta.9"
$BB_VERSION = "0.87.0"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   Download StellarCred Toolchain for Windows" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This will download and install:" -ForegroundColor Yellow
Write-Host "  - Noir (nargo) v$NOIR_VERSION"
Write-Host "  - Barretenberg (bb) v$BB_VERSION"
Write-Host ""

# Create temp directory
$tempDir = Join-Path $env:TEMP "stellar_cred_toolchain"
if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir | Out-Null
}

# Download Nargo
if (-not $SkipNargo) {
    Write-Host "Step 1: Downloading Nargo..." -ForegroundColor Yellow
    
    $nargoUrl = "https://github.com/noir-lang/noir/releases/download/v$NOIR_VERSION/nargo-x86_64-pc-windows-msvc.zip"
    $nargoZip = Join-Path $tempDir "nargo.zip"
    $nargoExtract = Join-Path $tempDir "nargo"
    $nargoInstall = "$env:USERPROFILE\.nargo\bin"
    
    try {
        Write-Host "  Downloading from GitHub..."
        Invoke-WebRequest -Uri $nargoUrl -OutFile $nargoZip -UseBasicParsing
        
        Write-Host "  Extracting..."
        Expand-Archive -Path $nargoZip -DestinationPath $nargoExtract -Force
        
        Write-Host "  Installing to $nargoInstall..."
        if (-not (Test-Path $nargoInstall)) {
            New-Item -ItemType Directory -Path $nargoInstall -Force | Out-Null
        }
        
        # Find nargo.exe in extracted files
        $nargoExe = Get-ChildItem -Path $nargoExtract -Filter "nargo.exe" -Recurse | Select-Object -First 1
        if ($nargoExe) {
            Copy-Item $nargoExe.FullName -Destination $nargoInstall -Force
            Write-Host "  [OK] Nargo installed successfully" -ForegroundColor Green
        } else {
            Write-Host "  [ERROR] nargo.exe not found in download" -ForegroundColor Red
        }
        
        # Add to PATH
        $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($currentPath -notlike "*$nargoInstall*") {
            Write-Host "  Adding to PATH..."
            [Environment]::SetEnvironmentVariable("Path", "$currentPath;$nargoInstall", "User")
            $env:Path += ";$nargoInstall"
        }
        
    } catch {
        Write-Host "  [ERROR] Failed to download/install Nargo: $_" -ForegroundColor Red
        Write-Host ""
        Write-Host "Manual download:" -ForegroundColor Yellow
        Write-Host "  1. Go to: https://github.com/noir-lang/noir/releases/tag/v$NOIR_VERSION"
        Write-Host "  2. Download: nargo-x86_64-pc-windows-msvc.zip"
        Write-Host "  3. Extract and copy nargo.exe to: $nargoInstall"
    }
    
    Write-Host ""
}

# Download Barretenberg
if (-not $SkipBB) {
    Write-Host "Step 2: Downloading Barretenberg..." -ForegroundColor Yellow
    
    # Note: BB Windows binaries may not be available for all versions
    # Check available assets at the release page
    $bbUrl = "https://github.com/AztecProtocol/aztec-packages/releases/download/barretenberg-v$BB_VERSION/barretenberg-x86_64-windows-gnu.tar.gz"
    $bbTar = Join-Path $tempDir "bb.tar.gz"
    $bbExtract = Join-Path $tempDir "bb"
    $bbInstall = "$env:USERPROFILE\.bb\bin"
    
    try {
        Write-Host "  Downloading from GitHub..."
        Invoke-WebRequest -Uri $bbUrl -OutFile $bbTar -UseBasicParsing
        
        Write-Host "  Extracting tar.gz..."
        # Use tar command (available in Windows 10+)
        tar -xzf $bbTar -C $tempDir
        
        Write-Host "  Installing to $bbInstall..."
        if (-not (Test-Path $bbInstall)) {
            New-Item -ItemType Directory -Path $bbInstall -Force | Out-Null
        }
        
        # Find bb.exe in extracted files
        $bbExe = Get-ChildItem -Path $tempDir -Filter "bb.exe" -Recurse | Select-Object -First 1
        if ($bbExe) {
            Copy-Item $bbExe.FullName -Destination $bbInstall -Force
            Write-Host "  [OK] Barretenberg installed successfully" -ForegroundColor Green
        } else {
            Write-Host "  [WARNING] bb.exe not found in download" -ForegroundColor Yellow
            Write-Host "  You may need to manually download the Windows binary" -ForegroundColor Yellow
        }
        
        # Add to PATH
        $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($currentPath -notlike "*$bbInstall*") {
            Write-Host "  Adding to PATH..."
            [Environment]::SetEnvironmentVariable("Path", "$currentPath;$bbInstall", "User")
            $env:Path += ";$bbInstall"
        }
        
    } catch {
        Write-Host "  [ERROR] Failed to download/install Barretenberg: $_" -ForegroundColor Red
        Write-Host ""
        Write-Host "Manual download:" -ForegroundColor Yellow
        Write-Host "  1. Go to: https://github.com/AztecProtocol/aztec-packages/releases/tag/barretenberg-v$BB_VERSION"
        Write-Host "  2. Look for Windows binary (may be tar.gz or zip)"
        Write-Host "  3. Extract and copy bb.exe to: $bbInstall"
        Write-Host ""
        Write-Host "Note: Windows binaries may not be available for all BB versions." -ForegroundColor Yellow
        Write-Host "Consider using WSL (Windows Subsystem for Linux) as an alternative." -ForegroundColor Yellow
    }
    
    Write-Host ""
}

# Cleanup
Write-Host "Cleaning up temporary files..."
Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue

# Verification
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Verification" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

# Refresh PATH
$env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")

$nargoWorks = $false
$bbWorks = $false

try {
    $nargoVersion = & nargo --version 2>&1 | Out-String
    Write-Host "[OK] nargo: $($nargoVersion.Trim())" -ForegroundColor Green
    $nargoWorks = $true
} catch {
    Write-Host "[X] nargo: Not accessible" -ForegroundColor Red
}

try {
    $bbVersion = & bb --version 2>&1 | Out-String
    Write-Host "[OK] bb: $($bbVersion.Trim())" -ForegroundColor Green
    $bbWorks = $true
} catch {
    Write-Host "[X] bb: Not accessible" -ForegroundColor Red
}

Write-Host ""

if ($nargoWorks -and $bbWorks) {
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "SUCCESS! Toolchain installed and ready" -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  cd circuits"
    Write-Host "  .\scripts\generate_testvectors.ps1"
    Write-Host ""
} elseif (-not $nargoWorks -or -not $bbWorks) {
    Write-Host "=================================================================" -ForegroundColor Yellow
    Write-Host "Installation may need PATH refresh or manual steps" -ForegroundColor Yellow
    Write-Host "=================================================================" -ForegroundColor Yellow
    Write-Host ""
    
    if (-not $nargoWorks) {
        Write-Host "Nargo not accessible. Try:" -ForegroundColor Yellow
        Write-Host "  1. Close and reopen PowerShell"
        Write-Host "  2. Or add manually: `$env:Path += ';$env:USERPROFILE\.nargo\bin'"
        Write-Host "  3. Check: Test-Path '$env:USERPROFILE\.nargo\bin\nargo.exe'"
        Write-Host ""
    }
    
    if (-not $bbWorks) {
        Write-Host "Barretenberg not accessible. Try:" -ForegroundColor Yellow
        Write-Host "  1. Close and reopen PowerShell"
        Write-Host "  2. Or add manually: `$env:Path += ';$env:USERPROFILE\.bb\bin'"
        Write-Host "  3. Check: Test-Path '$env:USERPROFILE\.bb\bin\bb.exe'"
        Write-Host ""
        Write-Host "Alternative: Use WSL for full toolchain support" -ForegroundColor Cyan
        Write-Host "  See: INSTALL_TOOLCHAIN_WINDOWS.md" -ForegroundColor Cyan
    }
}
