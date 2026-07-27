# Generate deterministic test vectors for all StellarCred circuits
# This script compiles circuits, generates proofs, and captures expected outputs
# Test vectors are used to detect regressions in circuit logic or toolchain changes

param(
    [string[]]$Circuits = @()
)

$ErrorActionPreference = "Stop"

$NOIR_VERSION = "1.0.0-beta.9"
$BB_VERSION = "0.87.0"

$ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$CIRCUITS_DIR = Join-Path $ROOT "circuits"
$TESTVECTORS_DIR = Join-Path $CIRCUITS_DIR "testvectors"

# Ensure test vectors directory exists
if (-not (Test-Path $TESTVECTORS_DIR)) {
    New-Item -ItemType Directory -Path $TESTVECTORS_DIR | Out-Null
    Write-Host "Created testvectors directory"
}

# Check for required tools
Write-Host "Checking toolchain..."
try {
    $nargoVersion = & nargo --version 2>&1 | Out-String
    Write-Host "Found: $nargoVersion"
} catch {
    Write-Error "nargo not found. Please install: noirup -v $NOIR_VERSION"
    Write-Host ""
    Write-Host "To fix PATH issues, run:"
    Write-Host '  $env:Path += ";$env:USERPROFILE\.nargo\bin"'
    Write-Host '  [Environment]::SetEnvironmentVariable("Path", $env:Path, "User")'
    exit 1
}

try {
    $bbVersion = & bb --version 2>&1 | Out-String
    Write-Host "Found: $bbVersion"
} catch {
    Write-Error "bb not found. Please install: bbup -v $BB_VERSION"
    Write-Host ""
    Write-Host "To fix PATH issues, run:"
    Write-Host '  $env:Path += ";$env:USERPROFILE\.bb\bin"'
    Write-Host '  [Environment]::SetEnvironmentVariable("Path", $env:Path, "User")'
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

function Parse-ProverToml {
    param([string]$Path)
    
    $witness = @{}
    $content = Get-Content $Path -Raw
    
    # Simple TOML parser for our use case
    $lines = $content -split "`n"
    foreach ($line in $lines) {
        $line = $line.Trim()
        if ($line -match '^(\w+)\s*=\s*"([^"]+)"$') {
            $witness[$matches[1]] = $matches[2]
        }
        elseif ($line -match '^(\w+)\s*=\s*\[(.+)\]$') {
            $arrayContent = $matches[2]
            $values = $arrayContent -split ',' | ForEach-Object { $_.Trim() }
            $witness[$matches[1]] = $values
        }
    }
    
    return $witness
}

function Generate-TestVector {
    param([string]$CircuitName)
    
    $circuitDir = Join-Path $CIRCUITS_DIR $CircuitName
    $proverToml = Join-Path $circuitDir "Prover.toml"
    
    if (-not (Test-Path (Join-Path $circuitDir "Nargo.toml"))) {
        Write-Host "Skipping $CircuitName (no Nargo.toml)"
        return
    }
    
    if (-not (Test-Path $proverToml)) {
        Write-Warning "Skipping $CircuitName (no Prover.toml - cannot generate proof)"
        return
    }
    
    Write-Host ""
    Write-Host "=== Generating test vector for $CircuitName ===" -ForegroundColor Cyan
    
    Push-Location $circuitDir
    try {
        # Clean previous builds
        if (Test-Path "target") {
            Remove-Item -Recurse -Force "target"
        }
        
        # Compile circuit
        Write-Host "Compiling..."
        & nargo compile | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Compilation failed"
        }
        
        $bytecode = Join-Path "target" "$CircuitName.json"
        $witnessGz = Join-Path "target" "$CircuitName.gz"
        
        # Generate witness
        Write-Host "Generating witness..."
        & nargo execute | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Witness generation failed"
        }
        
        # Generate VK
        Write-Host "Generating verification key..."
        & bb write_vk --scheme ultra_honk --oracle_hash keccak `
            --bytecode_path $bytecode `
            --output_path target --output_format bytes_and_fields | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "VK generation failed"
        }
        
        # Normalize VK path (bb may create vk/vk subdirectory)
        $vkPath = Join-Path "target" "vk"
        if (Test-Path (Join-Path "target" "vk" "vk")) {
            Move-Item (Join-Path "target" "vk" "vk") (Join-Path "target" "vk.tmp") -Force
            Remove-Item (Join-Path "target" "vk") -Recurse -Force
            Move-Item (Join-Path "target" "vk.tmp") $vkPath -Force
        }
        
        # Generate proof
        Write-Host "Generating proof..."
        & bb prove --scheme ultra_honk --oracle_hash keccak `
            --bytecode_path $bytecode `
            --witness_path $witnessGz `
            --output_path target --output_format bytes_and_fields | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Proof generation failed"
        }
        
        # Read witness from Prover.toml
        $witness = Parse-ProverToml -Path $proverToml
        
        # Read public inputs
        $publicInputsPath = Join-Path "target" "public_inputs"
        $publicInputs = @()
        if (Test-Path $publicInputsPath) {
            $publicInputs = Get-Content $publicInputsPath | Where-Object { $_.Trim() -ne "" }
        }
        
        # Hash the VK
        $vkHash = Get-FileHash-Safe -Path $vkPath
        
        # Create test vector
        $testVector = @{
            circuit_name = $CircuitName
            toolchain_version = $NOIR_VERSION
            bb_version = $BB_VERSION
            witness = $witness
            expected_public_inputs = $publicInputs
            expected_vk_hash = $vkHash
            generated_at = (Get-Date -Format "o")
        }
        
        # Write to JSON
        $outputPath = Join-Path $TESTVECTORS_DIR "$CircuitName.json"
        $testVector | ConvertTo-Json -Depth 10 | Set-Content -Path $outputPath -Encoding UTF8
        
        Write-Host "✓ Test vector saved to testvectors/$CircuitName.json" -ForegroundColor Green
        Write-Host "  VK hash: $vkHash"
        Write-Host "  Public inputs: $($publicInputs.Count) values"
        
    } catch {
        Write-Error "Failed to generate test vector for $CircuitName : $_"
    } finally {
        Pop-Location
    }
}

# Generate test vectors for each circuit
Write-Host "Generating test vectors for StellarCred circuits..." -ForegroundColor Yellow
Write-Host "Toolchain: Noir $NOIR_VERSION, BB $BB_VERSION"

foreach ($circuit in $Circuits) {
    Generate-TestVector -CircuitName $circuit
}

Write-Host ""
Write-Host "Test vector generation complete!" -ForegroundColor Green
Write-Host "Vectors saved to: $TESTVECTORS_DIR"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Review the generated vectors"
Write-Host "  2. Commit them to version control"
Write-Host "  3. Run .\scripts\verify_testvectors.ps1 to verify"
