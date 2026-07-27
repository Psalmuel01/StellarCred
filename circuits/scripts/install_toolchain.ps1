# Install Noir toolchain (nargo) and Barretenberg (bb)
# This script downloads and installs the exact versions needed for StellarCred

param(
    [switch]$SkipNargo,
    [switch]$SkipBB
)

$ErrorActionPreference = "Stop"

$NOIR_VERSION = "1.0.0-beta.9"
$BB_VERSION = "0.87.0"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   StellarCred Toolchain Installer" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This will install:" -ForegroundColor Yellow
Write-Host "  - Noir (nargo) version $NOIR_VERSION"
Write-Host "  - Barretenberg (bb) version $BB_VERSION"
Write-Host ""

# Function to add to PATH
function Add-ToPath {
    param([string]$PathToAdd)
    
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    
    if ($currentPath -notlike "*$PathToAdd*") {
        Write-Host "  [+] Adding to PATH: $PathToAdd" -ForegroundColor Green
        [Environment]::SetEnvironmentVariable(
            "Path",
            "$currentPath;$PathToAdd",
            "User"
        )
        $env:Path += ";$PathToAdd"
        return $true
    } else {
        Write-Host "  [-] Already in PATH: $PathToAdd" -ForegroundColor Gray
        return $false
    }
}

# Install Noir (nargo)
if (-not $SkipNargo) {
    Write-Host "Step 1: Installing Noir (nargo)..." -ForegroundColor Yellow
    Write-Host ""
    
    try {
        # Download noirup installer
        Write-Host "  Downloading noirup installer..."
        $noirupScript = Invoke-WebRequest -Uri "https://raw.githubusercontent.com/noir-lang/noirup/main/install" -UseBasicParsing
        
        # Execute noirup installer
        Write-Host "  Running noirup installer..."
        Invoke-Expression $noirupScript.Content
        
        # Refresh PATH for current session
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
        
        # Add noirup to PATH if needed
        $noirupPath = "$env:USERPROFILE\.nargo\bin"
        Add-ToPath -PathToAdd $noirupPath
        
        # Install specific Noir version
        Write-Host "  Installing Noir $NOIR_VERSION..."
        $noirupExe = "$env:USERPROFILE\.nargo\bin\noirup.exe"
        if (-not (Test-Path $noirupExe)) {
            $noirupExe = "noirup"
        }
        
        & $noirupExe -v $NOIR_VERSION
        
        # Verify
        $nargoExe = "$env:USERPROFILE\.nargo\bin\nargo.exe"
        if (Test-Path $nargoExe) {
            $version = & $nargoExe --version 2>&1 | Out-String
            Write-Host "  [OK] Noir installed: $($version.Trim())" -ForegroundColor Green
        } else {
            Write-Host "  [WARNING] nargo.exe not found at expected location" -ForegroundColor Yellow
        }
        
    } catch {
        Write-Host "  [ERROR] Failed to install Noir: $_" -ForegroundColor Red
        Write-Host ""
        Write-Host "Manual installation steps:" -ForegroundColor Yellow
        Write-Host "  1. Open PowerShell"
        Write-Host "  2. Run: iwr -useb https://raw.githubusercontent.com/noir-lang/noirup/main/install | iex"
        Write-Host "  3. Close and reopen PowerShell"
        Write-Host "  4. Run: noirup -v $NOIR_VERSION"
    }
    
    Write-Host ""
} else {
    Write-Host "Skipping Noir installation (--SkipNargo)" -ForegroundColor Gray
    Write-Host ""
}

# Install Barretenberg (bb)
if (-not $SkipBB) {
    Write-Host "Step 2: Installing Barretenberg (bb)..." -ForegroundColor Yellow
    Write-Host ""
    
    try {
        # Download bbup installer
        Write-Host "  Downloading bbup installer..."
        $bbupScript = Invoke-WebRequest -Uri "https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install" -UseBasicParsing
        
        # Execute bbup installer
        Write-Host "  Running bbup installer..."
        Invoke-Expression $bbupScript.Content
        
        # Refresh PATH for current session
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
        
        # Add bbup to PATH if needed
        $bbPath = "$env:USERPROFILE\.bb\bin"
        Add-ToPath -PathToAdd $bbPath
        
        # Install specific BB version
        Write-Host "  Installing Barretenberg $BB_VERSION..."
        $bbupExe = "$env:USERPROFILE\.bb\bin\bbup.exe"
        if (-not (Test-Path $bbupExe)) {
            $bbupExe = "bbup"
        }
        
        & $bbupExe -v $BB_VERSION
        
        # Verify
        $bbExe = "$env:USERPROFILE\.bb\bin\bb.exe"
        if (Test-Path $bbExe) {
            $version = & $bbExe --version 2>&1 | Out-String
            Write-Host "  [OK] Barretenberg installed: $($version.Trim())" -ForegroundColor Green
        } else {
            Write-Host "  [WARNING] bb.exe not found at expected location" -ForegroundColor Yellow
        }
        
    } catch {
        Write-Host "  [ERROR] Failed to install Barretenberg: $_" -ForegroundColor Red
        Write-Host ""
        Write-Host "Manual installation steps:" -ForegroundColor Yellow
        Write-Host "  1. Open PowerShell"
        Write-Host "  2. Run: iwr -useb https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install | iex"
        Write-Host "  3. Close and reopen PowerShell"
        Write-Host "  4. Run: bbup -v $BB_VERSION"
    }
    
    Write-Host ""
} else {
    Write-Host "Skipping Barretenberg installation (--SkipBB)" -ForegroundColor Gray
    Write-Host ""
}

# Final verification
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Verification" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

$nargoWorks = $false
$bbWorks = $false

# Refresh PATH one more time
$env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")

try {
    $nargoVersion = & nargo --version 2>&1 | Out-String
    Write-Host "[OK] nargo: $($nargoVersion.Trim())" -ForegroundColor Green
    $nargoWorks = $true
} catch {
    Write-Host "[X] nargo: Not accessible" -ForegroundColor Red
    Write-Host "    Try closing and reopening PowerShell" -ForegroundColor Yellow
}

try {
    $bbVersion = & bb --version 2>&1 | Out-String
    Write-Host "[OK] bb: $($bbVersion.Trim())" -ForegroundColor Green
    $bbWorks = $true
} catch {
    Write-Host "[X] bb: Not accessible" -ForegroundColor Red
    Write-Host "    Try closing and reopening PowerShell" -ForegroundColor Yellow
}

Write-Host ""

if ($nargoWorks -and $bbWorks) {
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "SUCCESS! Toolchain installed and working" -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  cd circuits"
    Write-Host "  .\scripts\generate_testvectors.ps1"
    Write-Host ""
    exit 0
} else {
    Write-Host "=================================================================" -ForegroundColor Yellow
    Write-Host "Installation complete, but tools need PATH refresh" -ForegroundColor Yellow
    Write-Host "=================================================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "ACTION REQUIRED:" -ForegroundColor Yellow
    Write-Host "  1. Close this PowerShell window"
    Write-Host "  2. Open a NEW PowerShell window"
    Write-Host "  3. Run: nargo --version"
    Write-Host "  4. Run: bb --version"
    Write-Host ""
    Write-Host "If still not working, see circuits\WINDOWS_SETUP.md" -ForegroundColor Yellow
    Write-Host ""
    exit 0
}
