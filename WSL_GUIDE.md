# Complete WSL Guide for Test Vector Generation

## You Have WSL Already! ✓

Your system shows:
- ✅ WSL 2 installed (version 2.7.8.0)
- ✅ Ubuntu distribution available
- ✅ Ready to use

## Step-by-Step Instructions

### Step 1: Open Ubuntu (WSL)

**Method 1 - From Start Menu:**
1. Press Windows key
2. Type "Ubuntu"
3. Click "Ubuntu" app

**Method 2 - From PowerShell:**
```powershell
wsl
```

**Method 3 - Windows Terminal:**
1. Open Windows Terminal
2. Click dropdown (v) next to tabs
3. Select "Ubuntu"

You'll see a terminal prompt like:
```
username@computername:~$
```

### Step 2: Navigate to Your Project

In the Ubuntu terminal, run:

```bash
cd "/mnt/c/Users/FHCI-009/Desktop/ToluLabs issue 1/StellarCred"
```

**Note:** Windows drives are mounted under `/mnt/` in WSL:
- `C:\` becomes `/mnt/c/`
- Spaces in paths need quotes

Verify you're in the right place:
```bash
ls -la
# You should see: circuits/, contracts/, frontend/, etc.
```

### Step 3: Install the Toolchain

Run the installation script:

```bash
cd circuits
chmod +x scripts/install_toolchain_wsl.sh
./scripts/install_toolchain_wsl.sh
```

**What this does:**
1. Installs `noirup` (Noir installer)
2. Installs `nargo` version 1.0.0-beta.9
3. Installs `bbup` (Barretenberg installer)
4. Installs `bb` version 0.87.0
5. Verifies both tools work

**Expected output:**
```
=================================================================
   StellarCred Toolchain Installer (WSL/Linux)
=================================================================

Installing noirup...
Installing Noir 1.0.0-beta.9...
Installing bbup...
Installing Barretenberg 0.87.0...

=================================================================
Verification
=================================================================

[OK] nargo: nargo version = 1.0.0-beta.9
[OK] bb: barretenberg 0.87.0

SUCCESS! Toolchain installed
```

**If you see any errors** about `curl` not found:
```bash
sudo apt update
sudo apt install curl -y
```

### Step 4: Generate Test Vectors

Still in the Ubuntu terminal:

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Generate test vectors
./scripts/generate_testvectors.sh
```

**Expected output:**
```
Generating test vectors for StellarCred circuits...
Toolchain: Noir 1.0.0-beta.9, BB 0.87.0

=== Generating test vector for kyc_proof ===
  Compiling...
  Generating witness...
  Generating VK...
  Generating proof...
  ✓ Test vector saved to testvectors/kyc_proof.json
    VK hash: a1b2c3d4e5f6...
    Public inputs: 3 values

=== Generating test vector for age_proof ===
  ...

(Continues for all 6 circuits)

Test vector generation complete!
Vectors saved to: testvectors/
```

**This creates:**
- `testvectors/kyc_proof.json`
- `testvectors/age_proof.json`
- `testvectors/income_proof.json`
- `testvectors/jurisdiction_proof.json`
- `testvectors/funds_proof.json`
- `testvectors/accreditation_proof.json`

### Step 5: Verify Test Vectors

Still in Ubuntu terminal:

```bash
./scripts/verify_testvectors.sh
```

**Expected output:**
```
╔═══════════════════════════════════════════════════════════════╗
║          StellarCred Test Vector Verification                 ║
╚═══════════════════════════════════════════════════════════════╝

=== Verifying age_proof ===
✓ PASS: age_proof

=== Verifying kyc_proof ===
✓ PASS: kyc_proof

... (4 more)

═══════════════════════════════════════════════════════════════
SUMMARY
═══════════════════════════════════════════════════════════════
Passed: 6
Failed: 0

All test vectors verified successfully! ✓
```

### Step 6: Exit WSL and Commit (Back in Windows)

Close the Ubuntu terminal or type:
```bash
exit
```

Open PowerShell in your project directory:

```powershell
cd "c:\Users\FHCI-009\Desktop\ToluLabs issue 1\StellarCred"

# Check what was created
ls circuits\testvectors\*.json

# Stage all changes
git add circuits/testvectors/*.json
git add circuits/scripts/*.sh
git add circuits/scripts/*.ps1
git add circuits/testvectors/README.md
git add circuits/WINDOWS_SETUP.md
git add circuits/README.md
git add .github/workflows/ci.yml
git add *.md

# Commit
git commit -m "feat: Add deterministic test vectors for circuit regression testing

Implements #127

Changes:
- Add test vector generation and verification scripts
- Implement CI job to verify test vectors on every push
- Document test vector format and regeneration process
- Add comprehensive Windows and WSL setup guides
- Generate test vectors for all 6 circuits (kyc, age, income, jurisdiction, funds, accreditation)

Test vectors ensure:
- Circuit logic changes are detected
- Toolchain updates that alter proof output are caught
- VK hashes remain stable for deployed contracts
- Public inputs match expected values for known witnesses

Acceptance criteria:
✅ Test vectors committed for each circuit
✅ Re-derivation test compares against committed values
✅ CI fails on drift with message pointing to toolchain version
✅ Documented how to regenerate vectors intentionally

Resolves #127"

# Push to GitHub
git push
```

### Step 7: Verify CI Passes

1. Go to your GitHub repository
2. Click "Actions" tab
3. Find your latest commit
4. Verify all jobs pass (contracts, **circuits**, frontend)

---

## Troubleshooting

### WSL is slow to start
First time WSL starts can be slow. Wait a minute and it should open.

### "No such file or directory"
Make sure you used quotes around the path with spaces:
```bash
cd "/mnt/c/Users/FHCI-009/Desktop/ToluLabs issue 1/StellarCred"
```

### "Permission denied" when running scripts
Make them executable first:
```bash
chmod +x scripts/*.sh
```

### curl not found
Install it:
```bash
sudo apt update
sudo apt install curl -y
```

### Circuit compilation fails
Check if you're in the right directory:
```bash
pwd
# Should show: /mnt/c/Users/FHCI-009/Desktop/ToluLabs issue 1/StellarCred/circuits
```

---

## Quick Command Summary

Copy these commands into Ubuntu terminal:

```bash
# Navigate to project
cd "/mnt/c/Users/FHCI-009/Desktop/ToluLabs issue 1/StellarCred/circuits"

# Install toolchain
chmod +x scripts/install_toolchain_wsl.sh
./scripts/install_toolchain_wsl.sh

# Generate test vectors
chmod +x scripts/*.sh
./scripts/generate_testvectors.sh

# Verify (optional)
./scripts/verify_testvectors.sh

# Exit WSL
exit
```

Then in PowerShell:

```powershell
cd "c:\Users\FHCI-009\Desktop\ToluLabs issue 1\StellarCred"
git add .
git commit -m "feat: Add deterministic test vectors for circuit regression testing"
git push
```

---

## Why WSL is Easiest

✅ **Native Linux environment** - All tools work perfectly  
✅ **No PATH issues** - Installers handle everything  
✅ **Files accessible in Windows** - Generated files appear in File Explorer  
✅ **Fast** - Linux tools run at native speed  
✅ **You already have it** - No additional installation needed  

---

## What Happens Behind the Scenes

1. **noirup/bbup installers** run in bash (they're Linux scripts)
2. **Tools install** to `~/.nargo/bin` and `~/.bb/bin` in WSL
3. **Scripts compile circuits** using nargo
4. **Scripts generate proofs** using bb
5. **JSON files are created** in `testvectors/` directory
6. **Files appear in Windows** at `C:\Users\FHCI-009\...\testvectors\`
7. **You commit from Windows** as normal with git

---

## Need Help?

If anything goes wrong:
1. Read the error message carefully
2. Check you're in the right directory (`pwd`)
3. Verify WSL is working (`wsl --version`)
4. Try the troubleshooting steps above

The process is straightforward - WSL makes this easy!
