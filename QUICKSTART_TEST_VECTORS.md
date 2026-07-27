# Quick Start: Test Vectors Implementation

This guide helps you complete the test vectors implementation for issue #127.

## What Was Built

✅ **Test Vectors System**
- `circuits/testvectors/` directory for storing test vectors
- JSON format capturing witness, public inputs, and VK hash
- README documentation

✅ **Generation Scripts**
- PowerShell: `circuits/scripts/generate_testvectors.ps1`
- Bash: `circuits/scripts/generate_testvectors.sh`

✅ **Verification Scripts**
- PowerShell: `circuits/scripts/verify_testvectors.ps1`
- Bash: `circuits/scripts/verify_testvectors.sh`

✅ **CI Integration**
- New `circuits` job in `.github/workflows/ci.yml`
- Automatic verification on every push/PR
- Fails build if vectors drift

✅ **Documentation**
- `circuits/testvectors/README.md` - Test vector documentation
- `circuits/WINDOWS_SETUP.md` - Windows toolchain setup guide
- `circuits/README.md` - Updated with test vector section

## Steps to Complete

### 1. Fix Your nargo/bb PATH Issue (Windows)

You mentioned nargo isn't recognized in your terminal. Run this helper script:

```powershell
cd "c:\Users\FHCI-009\Desktop\ToluLabs issue 1\StellarCred\circuits"
.\scripts\setup_windows_path.ps1
```

This will:
- Find your nargo and bb installations
- Add them to your PATH permanently
- Verify they work

If that doesn't work, see the detailed troubleshooting in `circuits/WINDOWS_SETUP.md`.

### 2. Generate Test Vectors

Once nargo is accessible:

```powershell
cd circuits
.\scripts\generate_testvectors.ps1
```

This will create JSON files in `testvectors/` directory:
- `age_proof.json`
- `kyc_proof.json`
- `income_proof.json`
- `jurisdiction_proof.json`
- `funds_proof.json`
- `accreditation_proof.json`

### 3. Review Generated Vectors

Check the generated files:

```powershell
Get-ChildItem testvectors\*.json
Get-Content testvectors\age_proof.json
```

Verify:
- VK hashes are present (not "PLACEHOLDER...")
- Public inputs match expected count
- Witness values are correct

### 4. Verify Test Vectors

Test that verification works:

```powershell
.\scripts\verify_testvectors.ps1
```

You should see all circuits pass:
```
✓ PASS: age_proof
✓ PASS: kyc_proof
...
All test vectors verified successfully! ✓
```

### 5. Commit to Git

```powershell
cd ..
git add circuits/testvectors/*.json
git add circuits/scripts/*.ps1
git add circuits/scripts/*.sh
git add circuits/testvectors/README.md
git add circuits/WINDOWS_SETUP.md
git add QUICKSTART_TEST_VECTORS.md
git add .github/workflows/ci.yml

git commit -m "feat: Add deterministic test vectors for circuit regression testing

- Add test vector generation and verification scripts (PowerShell & Bash)
- Implement CI check for test vector verification
- Document test vector format and regeneration process
- Add Windows setup guide for nargo/bb toolchain

Resolves #127"
```

### 6. Push and Verify CI

```powershell
git push
```

Then check GitHub Actions to ensure the new `circuits` job passes.

## Troubleshooting

### nargo not found

**Problem**: `nargo : The term 'nargo' is not recognized...`

**Solutions**:
1. Run `.\scripts\setup_windows_path.ps1`
2. Or manually add to PATH:
   ```powershell
   $env:Path += ";$env:USERPROFILE\.nargo\bin"
   $env:Path += ";$env:USERPROFILE\.bb\bin"
   ```
3. See detailed guide: `circuits/WINDOWS_SETUP.md`

### Script execution policy error

**Problem**: `...cannot be loaded because running scripts is disabled...`

**Solution**:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### Generation fails on specific circuit

**Problem**: Generation fails with compilation error

**Solution**:
1. Check if the circuit has a `Prover.toml` file
2. Try compiling manually:
   ```powershell
   cd circuits\age_proof
   nargo compile
   ```
3. Fix any circuit issues before regenerating vectors

### CI fails after pushing

**Problem**: GitHub Actions `circuits` job fails

**Possible causes**:
1. **Test vectors not committed**: Ensure all `.json` files are in git
2. **Scripts not executable**: The bash scripts need +x permissions (already set)
3. **Toolchain version mismatch**: CI uses exact versions - check `.github/workflows/ci.yml`

## File Structure

```
StellarCred/
├── circuits/
│   ├── testvectors/
│   │   ├── README.md              # Test vector documentation
│   │   ├── .gitignore             # Ignore temp files
│   │   ├── age_proof.json         # Generated test vector
│   │   ├── kyc_proof.json         # Generated test vector
│   │   └── ...                    # More test vectors
│   ├── scripts/
│   │   ├── generate_testvectors.ps1   # Windows generation
│   │   ├── generate_testvectors.sh    # Linux/Mac generation
│   │   ├── verify_testvectors.ps1     # Windows verification
│   │   ├── verify_testvectors.sh      # Linux/Mac verification
│   │   └── setup_windows_path.ps1     # Windows PATH helper
│   ├── WINDOWS_SETUP.md           # Windows toolchain guide
│   └── README.md                  # Updated with test vectors
├── .github/
│   └── workflows/
│       └── ci.yml                 # Updated with circuits job
└── QUICKSTART_TEST_VECTORS.md     # This file
```

## Acceptance Criteria Checklist

- [ ] Test vectors committed for each circuit (6 JSON files)
- [ ] Re-derivation test compares against committed values (verify_testvectors scripts)
- [ ] CI fails on drift with message pointing to toolchain version (ci.yml updated)
- [ ] Documented how to regenerate vectors intentionally (README files)

## Next Steps After Completion

1. **Test a drift scenario**: 
   - Modify a circuit slightly
   - Run verification - it should fail
   - Regenerate vectors - it should pass

2. **Update PR description**:
   - Link to this implementation
   - Note CI now catches regressions
   - Mention Windows setup guide for contributors

3. **Wait for Greptile review**:
   - Address any feedback
   - Ensure confidence score is 4/5 or higher

## Questions?

Check these resources:
- `circuits/testvectors/README.md` - Detailed test vector docs
- `circuits/WINDOWS_SETUP.md` - Windows toolchain troubleshooting
- `circuits/README.md` - Circuit conventions and test vectors
- [Noir Documentation](https://noir-lang.org/)

## Manual Alternative (If Scripts Don't Work)

If the scripts fail, you can manually generate test vectors for one circuit:

```powershell
cd circuits\age_proof
nargo compile
nargo execute
bb write_vk --scheme ultra_honk --oracle_hash keccak --bytecode_path target\age_proof.json --output_path target
bb prove --scheme ultra_honk --oracle_hash keccak --bytecode_path target\age_proof.json --witness_path target\age_proof.gz --output_path target

# Read outputs and create JSON manually
Get-Content target\public_inputs
Get-FileHash target\vk -Algorithm SHA256
```

Then create the JSON file following the format in `testvectors/age_proof.json.example`.
