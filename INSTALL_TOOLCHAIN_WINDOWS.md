# Windows Toolchain Installation Guide

The noirup/bbup installers are bash scripts that don't work directly in PowerShell. Here's how to install the toolchain on Windows.

## Option 1: Use WSL (Recommended for Development)

If you have Windows Subsystem for Linux (WSL) installed:

```bash
# In WSL terminal
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
source ~/.bashrc
noirup -v 1.0.0-beta.9

curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install | bash
source ~/.bashrc
bbup -v 0.87.0

# Verify
nargo --version
bb --version
```

Then use WSL to generate test vectors:
```bash
cd /mnt/c/Users/FHCI-009/Desktop/ToluLabs\ issue\ 1/StellarCred/circuits
chmod +x scripts/*.sh
./scripts/generate_testvectors.sh
```

## Option 2: Download Pre-built Binaries (Quickest)

### Install Nargo (Noir)

1. Download the Windows binary:
   - Go to: https://github.com/noir-lang/noir/releases/tag/v1.0.0-beta.9
   - Download: `nargo-x86_64-pc-windows-msvc.zip`

2. Extract and install:
   ```powershell
   # Create nargo directory
   New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.nargo\bin"
   
   # Extract the downloaded zip to Downloads folder first, then:
   Copy-Item "$env:USERPROFILE\Downloads\nargo.exe" -Destination "$env:USERPROFILE\.nargo\bin\"
   
   # Add to PATH
   $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
   if ($currentPath -notlike "*$env:USERPROFILE\.nargo\bin*") {
       [Environment]::SetEnvironmentVariable("Path", "$currentPath;$env:USERPROFILE\.nargo\bin", "User")
   }
   
   # Refresh PATH for current session
   $env:Path += ";$env:USERPROFILE\.nargo\bin"
   
   # Verify
   nargo --version
   ```

### Install Barretenberg (bb)

1. Download the Windows binary:
   - Go to: https://github.com/AztecProtocol/aztec-packages/releases/tag/barretenberg-v0.87.0
   - Download: `barretenberg-x86_64-windows-gnu.tar.gz`

2. Extract and install:
   ```powershell
   # Create bb directory
   New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.bb\bin"
   
   # Extract the downloaded tar.gz (use 7-Zip or tar command), then:
   Copy-Item "$env:USERPROFILE\Downloads\bb.exe" -Destination "$env:USERPROFILE\.bb\bin\"
   
   # Add to PATH
   $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
   if ($currentPath -notlike "*$env:USERPROFILE\.bb\bin*") {
       [Environment]::SetEnvironmentVariable("Path", "$currentPath;$env:USERPROFILE\.bb\bin", "User")
   }
   
   # Refresh PATH for current session
   $env:Path += ";$env:USERPROFILE\.bb\bin"
   
   # Verify
   bb --version
   ```

## Option 3: Use Git Bash (If You Have Git for Windows)

If you have Git for Windows installed, you can use Git Bash:

```bash
# Open Git Bash
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
source ~/.bashrc
noirup -v 1.0.0-beta.9

curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install | bash
source ~/.bashrc
bbup -v 0.87.0

# Verify
nargo --version
bb --version
```

## Option 4: Manual PowerShell Download

I'll create a PowerShell script that downloads the binaries directly:

```powershell
# Run this in PowerShell
cd "c:\Users\FHCI-009\Desktop\ToluLabs issue 1\StellarCred\circuits"
.\scripts\download_toolchain_windows.ps1
```

## After Installation

Once nargo and bb are working:

```powershell
# Navigate to circuits directory
cd "c:\Users\FHCI-009\Desktop\ToluLabs issue 1\StellarCred\circuits"

# Generate test vectors
.\scripts\generate_testvectors.ps1

# Verify
.\scripts\verify_testvectors.ps1
```

## Troubleshooting

### "nargo is not recognized"

**Close and reopen PowerShell** - PATH changes require a new session.

Or temporarily add to current session:
```powershell
$env:Path += ";$env:USERPROFILE\.nargo\bin;$env:USERPROFILE\.bb\bin"
```

### Extract .tar.gz files on Windows

**Option A - Use tar (Windows 10+):**
```powershell
tar -xzf barretenberg-x86_64-windows-gnu.tar.gz
```

**Option B - Use 7-Zip:**
- Download from: https://www.7-zip.org/
- Right-click → 7-Zip → Extract

### Download Links Not Working

Check the latest releases:
- Noir: https://github.com/noir-lang/noir/releases
- Barretenberg: https://github.com/AztecProtocol/aztec-packages/releases

Look for version tags:
- `v1.0.0-beta.9` for Noir
- `barretenberg-v0.87.0` for Barretenberg

## Quick Check

Run this to see if tools are accessible:

```powershell
Write-Host "Checking nargo..." ; try { nargo --version } catch { Write-Host "NOT FOUND" -ForegroundColor Red }
Write-Host "Checking bb..." ; try { bb --version } catch { Write-Host "NOT FOUND" -ForegroundColor Red }
```

## Recommended Approach

**For this task, I recommend Option 1 (WSL)** if you have it, or **Option 2 (Direct binaries)** as it's the most reliable for Windows.

The noirup/bbup scripts are designed for Unix-like shells and won't work in PowerShell.
