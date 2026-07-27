# Verify that current circuit outputs match committed test vectors
# This catches regressions from circuit changes or toolchain updates

param(
    [string[]]$Circuits = @(),
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

$NOIR_VERSION = "1.0.0-beta.9"
$BB_VERSION = "0.87.0"

$ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$CIRCUITS_DIR = Join-Path $ROOT "circuits"
$TESTVECTORS_DIR = Join-Path $CIRCUITS_DIR "testvectors"

$global:failures = @()
$global:successes = 0

# Check for required tools
try {
    $null = & nargo --version 2>&1
} catch {
    Write-Error "nargo not found. Please install: noirup -v $NOIR_VERSION"
    exit 1
}

try {
    $null = & bb --version 2>&1
} catch {
    Write-Error "bb not found. Please install: bbup -v $BB_VERSION"
    exit 1
}

# Default circuits if none specified
if ($Circuits.Count -eq 0) {
    $Circuits = @(
        "kyc_proof",
        "age_proof",
        "income_proof",
        "jurisdiction_proof",
        "funds_proof",
        "accreditation_proof"
    )
}

function Get-FileHash-Safe {
    param([string]$Path)
    if (Test-Path $Path) {
        $hash = Get-FileHash -Path $Path -Algorithm SHA256
        return $hash.Hash.ToLower()
    }
    return $null
}

function Compare-Arrays {
    param(
        [array]$Expected,
        [array]$Actual
    )
    
    if ($Expected.Count -ne $Actual.Count) {
        return $false
    }
    
    for ($i = 0; $i -lt $Expected.Count; $i++) {
        if ($Expected[$i] -ne $Actual[$i]) {
            return $false
        }
    }
    
    return $true
}

function Verify-TestVector {
    param([string]$CircuitName)
    
    $circuitDir = Join-Path $CIRCUITS_DIR $CircuitName
    $vectorPath = Join-Path $TESTVECTORS_DIR "$CircuitName.json"
    
    if (-not (Test-Path $vectorPath)) {
        Write-Warning "No test vector found for $CircuitName (expected at testvectors/$CircuitName.json)"
        return
    }
    
    if (-not (Test-Path (Join-Path $circuitDir "Nargo.toml"))) {
        Write-Host "Skipping $CircuitName (no circuit found)"
        return
    }
    
    if (-not (Test-Path (Join-Path $circuitDir "Prover.toml"))) {
        Write-Host "Skipping $CircuitName (no Prover.toml)"
        return
    }
    
    Write-Host ""
    Write-Host "=== Verifying $CircuitName ===" -ForegroundColor Cyan
    
    # Load test vector
    $testVector = Get-Content $vectorPath -Raw | ConvertFrom-Json
    
    Push-Location $circuitDir
    try {
        # Clean previous builds
        if (Test-Path "target") {
            Remove-Item -Recurse -Force "target"
        }
        
        # Compile circuit
        if ($Verbose) { Write-Host "  Compiling..." }
        & nargo compile 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Compilation failed"
        }
        
        $bytecode = Join-Path "target" "$CircuitName.json"
        $witnessGz = Join-Path "target" "$CircuitName.gz"
        
        # Generate witness
        if ($Verbose) { Write-Host "  Generating witness..." }
        & nargo execute 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Witness generation failed"
        }
        
        # Generate VK
        if ($Verbose) { Write-Host "  Generating VK..." }
        & bb write_vk --scheme ultra_honk --oracle_hash keccak `
            --bytecode_path $bytecode `
            --output_path target --output_format bytes_and_fields 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "VK generation failed"
        }
        
        # Normalize VK path
        $vkPath = Join-Path "target" "vk"
        if (Test-Path (Join-Path "target" "vk" "vk")) {
            Move-Item (Join-Path "target" "vk" "vk") (Join-Path "target" "vk.tmp") -Force
            Remove-Item (Join-Path "target" "vk") -Recurse -Force
            Move-Item (Join-Path "target" "vk.tmp") $vkPath -Force
        }
        
        # Generate proof and public inputs
        if ($Verbose) { Write-Host "  Generating proof..." }
        & bb prove --scheme ultra_honk --oracle_hash keccak `
            --bytecode_path $bytecode `
            --witness_path $witnessGz `
            --output_path target --output_format bytes_and_fields 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Proof generation failed"
        }
        
        # Read actual public inputs
        $publicInputsPath = Join-Path "target" "public_inputs"
        $actualPublicInputs = @()
        if (Test-Path $publicInputsPath) {
            $actualPublicInputs = Get-Content $publicInputsPath | Where-Object { $_.Trim() -ne "" }
        }
        
        # Hash the VK
        $actualVkHash = Get-FileHash-Safe -Path $vkPath
        
        # Compare results
        $vkMatch = $testVector.expected_vk_hash -eq $actualVkHash
        $publicInputsMatch = Compare-Arrays -Expected $testVector.expected_public_inputs -Actual $actualPublicInputs
        
        if ($vkMatch -and $publicInputsMatch) {
            Write-Host "✓ PASS: $CircuitName" -ForegroundColor Green
            $global:successes++
        } else {
            $failure = @{
                circuit = $CircuitName
                vk_match = $vkMatch
                public_inputs_match = $publicInputsMatch
                expected_vk = $testVector.expected_vk_hash
                actual_vk = $actualVkHash
                expected_inputs = $testVector.expected_public_inputs
                actual_inputs = $actualPublicInputs
            }
            $global:failures += $failure
            
            Write-Host "✗ FAIL: $CircuitName" -ForegroundColor Red
            
            if (-not $vkMatch) {
                Write-Host "  VK hash mismatch:" -ForegroundColor Yellow
                Write-Host "    Expected: $($testVector.expected_vk_hash)"
                Write-Host "    Actual:   $actualVkHash"
            }
            
            if (-not $publicInputsMatch) {
                Write-Host "  Public inputs mismatch:" -ForegroundColor Yellow
                Write-Host "    Expected: $($testVector.expected_public_inputs.Count) values"
                Write-Host "    Actual:   $($actualPublicInputs.Count) values"
                
                if ($Verbose) {
                    Write-Host "    Expected values:"
                    $testVector.expected_public_inputs | ForEach-Object { Write-Host "      $_" }
                    Write-Host "    Actual values:"
                    $actualPublicInputs | ForEach-Object { Write-Host "      $_" }
                }
            }
        }
        
    } catch {
        Write-Host "✗ ERROR: $CircuitName - $_" -ForegroundColor Red
        $global:failures += @{
            circuit = $CircuitName
            error = $_.ToString()
        }
    } finally {
        Pop-Location
    }
}

# Header
Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║          StellarCred Test Vector Verification                 ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "Toolchain: Noir $NOIR_VERSION, BB $BB_VERSION"
Write-Host ""

# Verify each circuit
foreach ($circuit in $Circuits) {
    Verify-TestVector -CircuitName $circuit
}

# Summary
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Passed: $global:successes" -ForegroundColor Green
Write-Host "Failed: $($global:failures.Count)" -ForegroundColor $(if ($global:failures.Count -eq 0) { "Green" } else { "Red" })

if ($global:failures.Count -gt 0) {
    Write-Host ""
    Write-Host "FAILED CIRCUITS:" -ForegroundColor Red
    foreach ($failure in $global:failures) {
        Write-Host "  - $($failure.circuit)"
    }
    Write-Host ""
    Write-Host "This indicates that circuit output has changed!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Possible causes:" -ForegroundColor Yellow
    Write-Host "  1. Circuit logic was modified (check git diff)"
    Write-Host "  2. Toolchain version changed (check nargo/bb versions)"
    Write-Host "  3. Dependencies were updated"
    Write-Host ""
    Write-Host "If the change is intentional:" -ForegroundColor Yellow
    Write-Host "  1. Review the changes carefully"
    Write-Host "  2. Regenerate test vectors: .\scripts\generate_testvectors.ps1"
    Write-Host "  3. Update deployed contracts if VK changed"
    Write-Host "  4. Commit the new test vectors"
    Write-Host ""
    Write-Host "Current toolchain: Noir $NOIR_VERSION, BB $BB_VERSION" -ForegroundColor Cyan
    
    exit 1
}

Write-Host ""
Write-Host "All test vectors verified successfully! ✓" -ForegroundColor Green
exit 0
