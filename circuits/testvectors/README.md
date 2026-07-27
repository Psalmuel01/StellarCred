# Test Vectors for StellarCred Circuits

This directory contains deterministic test vectors for all StellarCred circuits to catch regressions caused by circuit changes or toolchain updates.

## Purpose

Test vectors ensure that:
- Circuit logic changes are intentional and detected
- Toolchain updates that alter proof output are caught
- VK hashes remain stable for deployed contracts
- Public inputs match expected values for known witnesses

## Structure

Each circuit has a JSON file containing:
- `witness`: Known input values (private + public)
- `expected_public_inputs`: Expected public outputs
- `expected_vk_hash`: SHA-256 hash of the verification key
- `toolchain_version`: Noir/nargo version used to generate this vector
- `bb_version`: Barretenberg version used

## Regenerating Test Vectors

Test vectors should only be regenerated when:
1. Circuit logic is intentionally changed
2. Toolchain is upgraded (and contracts are redeployed)
3. Initial setup of a new circuit

### Prerequisites

```bash
# Install exact versions
noirup -v 1.0.0-beta.9
bbup -v 0.87.0
```

### Windows (PowerShell)

```powershell
cd circuits
.\scripts\generate_testvectors.ps1
```

### Linux/Mac (Bash)

```bash
cd circuits
./scripts/generate_testvectors.sh
```

This will:
1. Compile each circuit with nargo
2. Generate proofs using bb
3. Extract public inputs
4. Hash the VK
5. Write test vectors to `testvectors/<circuit_name>.json`

## Verifying Test Vectors

### In CI

The CI workflow automatically verifies test vectors on every push:

```bash
cd circuits
./scripts/verify_testvectors.sh  # Linux/Mac
.\scripts\verify_testvectors.ps1  # Windows
```

If vectors drift, CI will fail with a message indicating which circuit changed and the current toolchain version.

### Locally

Run the same verification scripts locally before committing:

```bash
# After making circuit changes
cd circuits
./scripts/verify_testvectors.sh
```

## Test Vector Format

```json
{
  "circuit_name": "age_proof",
  "toolchain_version": "1.0.0-beta.9",
  "bb_version": "0.87.0",
  "witness": {
    "date_of_birth": "3650",
    "salt": "12345",
    "commitment": "11185694688759005258749044191511340074461101343013798358401867479146160036531",
    "current_date": "20000",
    "threshold_years": "18",
    "issuer_x": [62, 72, 233, ...],
    "issuer_y": [7, 217, 196, ...],
    "sig": [6, 105, 8, ...]
  },
  "expected_public_inputs": [
    "11185694688759005258749044191511340074461101343013798358401867479146160036531",
    "0x3e48e98b0178c25ba63e442b4fe89c5b59a528537d5ae808e477113bc44820fb",
    "0x07d9c458677511c8a8f9eac3bc2f170d00a8587dd538be209078d3f4aa3761e5",
    "20000",
    "18"
  ],
  "expected_vk_hash": "a1b2c3d4e5f6...",
  "generated_at": "2024-01-15T10:30:00Z"
}
```

## Troubleshooting

### PATH Issues (Windows)

If `nargo` is not recognized:

```powershell
# Find where nargo is installed
Get-Command nargo -ErrorAction SilentlyContinue

# If not found, add to PATH (adjust path as needed)
$env:Path += ";$env:USERPROFILE\.nargo\bin"
$env:Path += ";$env:USERPROFILE\.bb\bin"

# Or permanently add to user PATH
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:USERPROFILE\.nargo\bin", "User")
```

### Verification Failures

If test vectors fail verification:

1. **Check if circuit logic changed**: If intentional, regenerate vectors
2. **Check toolchain version**: Run `nargo --version` and `bb --version`
3. **Compare output**: The script will show what changed (public inputs or VK hash)
4. **Review the diff**: Understand why the output changed before regenerating

### Manual Verification

```bash
# Generate fresh outputs
cd circuits/age_proof
nargo compile
bb write_vk --scheme ultra_honk --oracle_hash keccak --bytecode_path target/age_proof.json --output_path target

# Compare VK hash
sha256sum target/vk
# Compare with expected_vk_hash in testvectors/age_proof.json
```
