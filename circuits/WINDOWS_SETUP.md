# Windows Setup Guide for StellarCred Circuits

This guide helps Windows developers set up the Noir toolchain to work with StellarCred circuits.

## Problem: nargo/bb not recognized in terminal

If you've installed `noirup` and `bbup` but get errors like:
```
nargo : The term 'nargo' is not recognized...
```

This means the tools aren't in your system PATH.

## Solution: Add nargo and bb to PATH

### Option 1: Temporary (Current PowerShell Session Only)

```powershell
# Add to PATH for current session
$env:Path += ";$env:USERPROFILE\.nargo\bin"
$env:Path += ";$env:USERPROFILE\.bb\bin"

# Verify it works
nargo --version
bb --version
```

### Option 2: Permanent (Recommended)

```powershell
# Add to user PATH permanently
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
$nargoPath = "$env:USERPROFILE\.nargo\bin"
$bbPath = "$env:USERPROFILE\.bb\bin"

# Only add if not already present
if ($currentPath -notlike "*$nargoPath*") {
    [Environment]::SetEnvironmentVariable(
        "Path",
        "$currentPath;$nargoPath",
        "User"
    )
}

if ($currentPath -notlike "*$bbPath*") {
    [Environment]::SetEnvironmentVariable(
        "Path",
        "$currentPath;$bbPath",
        "User"
    )
}

# Restart PowerShell or update current session
$env:Path = [Environment]::GetEnvironmentVariable("Path", "User")

# Verify
nargo --version
bb --version
```

### Option 3: Manual PATH Edit (Windows Settings)

1. Open Windows Settings
2. Search for "Environment Variables"
3. Click "Edit the system environment variables"
4. Click "Environment Variables..." button
5. Under "User variables", select "Path" and click "Edit"
6. Click "New" and add: `C:\Users\YOUR_USERNAME\.nargo\bin`
7. Click "New" again and add: `C:\Users\YOUR_USERNAME\.bb\bin`
8. Click "OK" on all dialogs
9. **Restart your terminal** for changes to take effect

## Verify Installation

After setting up PATH:

```powershell
# Check versions
nargo --version
# Should show: nargo version = 1.0.0-beta.9

bb --version
# Should show: barretenberg 0.87.0

# Test with a circuit
cd circuits\age_proof
nargo compile
```

## Common Installation Locations

If the above paths don't work, check these locations:

```powershell
# Check where nargo was installed
Get-Command nargo -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source

# Common locations:
# - C:\Users\YOUR_USERNAME\.nargo\bin\nargo.exe
# - C:\Users\YOUR_USERNAME\.noirup\bin\nargo.exe
# - C:\Program Files\nargo\bin\nargo.exe

# Find nargo manually
Get-ChildItem -Path $env:USERPROFILE -Filter "nargo.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName
```

## Installing Noir Toolchain

If you haven't installed the toolchain yet:

### Install noirup (Noir installer)

```powershell
# Download and run noirup installer
iwr -useb https://raw.githubusercontent.com/noir-lang/noirup/main/install | iex
```

### Install specific Noir version

```powershell
# Add to PATH first (see above)
$env:Path += ";$env:USERPROFILE\.nargo\bin"

# Install pinned version
noirup -v 1.0.0-beta.9
```

### Install bbup (Barretenberg installer)

```powershell
# Download and run bbup installer
iwr -useb https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install | iex
```

### Install specific BB version

```powershell
# Add to PATH first
$env:Path += ";$env:USERPROFILE\.bb\bin"

# Install pinned version
bbup -v 0.87.0
```

## Running Test Vector Scripts

Once PATH is set up correctly:

### Generate test vectors

```powershell
cd circuits
.\scripts\generate_testvectors.ps1
```

### Verify test vectors

```powershell
cd circuits
.\scripts\verify_testvectors.ps1
```

### Verbose output

```powershell
.\scripts\verify_testvectors.ps1 -Verbose
```

## Troubleshooting

### PowerShell Execution Policy

If you get execution policy errors:

```powershell
# Check current policy
Get-ExecutionPolicy

# Set policy for current user (run as user, not admin)
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### Still not working?

1. **Restart PowerShell** - PATH changes require a new session
2. **Check actual installation location**:
   ```powershell
   Test-Path "$env:USERPROFILE\.nargo\bin\nargo.exe"
   Test-Path "$env:USERPROFILE\.bb\bin\bb.exe"
   ```
3. **Use full path temporarily**:
   ```powershell
   & "$env:USERPROFILE\.nargo\bin\nargo.exe" --version
   ```
4. **Reinstall toolchain**:
   ```powershell
   Remove-Item -Recurse -Force $env:USERPROFILE\.nargo
   Remove-Item -Recurse -Force $env:USERPROFILE\.bb
   # Then reinstall
   ```

## Next Steps

Once setup is complete:

1. Generate test vectors: `.\scripts\generate_testvectors.ps1`
2. Review generated files in `testvectors/` directory
3. Commit test vectors to git
4. Run verification: `.\scripts\verify_testvectors.ps1`

## Additional Resources

- [Noir Documentation](https://noir-lang.org/)
- [Barretenberg Documentation](https://github.com/AztecProtocol/aztec-packages/tree/master/barretenberg)
- [StellarCred Circuits README](./README.md)
- [Test Vectors README](./testvectors/README.md)
