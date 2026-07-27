#!/usr/bin/env bash
# Install Noir toolchain in WSL for StellarCred test vector generation
# Run this script in Ubuntu/WSL terminal

set -e

NOIR_VERSION="1.0.0-beta.9"
BB_VERSION="0.87.0"

echo "================================================================="
echo "   StellarCred Toolchain Installer (WSL/Linux)"
echo "================================================================="
echo ""
echo "This will install:"
echo "  - Noir (nargo) version $NOIR_VERSION"
echo "  - Barretenberg (bb) version $BB_VERSION"
echo ""

# Install noirup
echo "Step 1: Installing noirup (Noir installer)..."
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash

# Source bashrc to get noirup in PATH
export PATH="$HOME/.nargo/bin:$PATH"

# Install specific Noir version
echo ""
echo "Step 2: Installing Noir $NOIR_VERSION..."
noirup -v $NOIR_VERSION

# Install bbup
echo ""
echo "Step 3: Installing bbup (Barretenberg installer)..."
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install | bash

# Source to get bbup in PATH
export PATH="$HOME/.bb/bin:$PATH"

# Install specific BB version
echo ""
echo "Step 4: Installing Barretenberg $BB_VERSION..."
bbup -v $BB_VERSION

# Verify installation
echo ""
echo "================================================================="
echo "Verification"
echo "================================================================="
echo ""

if command -v nargo &> /dev/null; then
    echo "[OK] nargo: $(nargo --version)"
else
    echo "[X] nargo: Not found"
    exit 1
fi

if command -v bb &> /dev/null; then
    echo "[OK] bb: $(bb --version)"
else
    echo "[X] bb: Not found"
    exit 1
fi

echo ""
echo "================================================================="
echo "SUCCESS! Toolchain installed"
echo "================================================================="
echo ""
echo "Next steps:"
echo "  cd circuits"
echo "  chmod +x scripts/*.sh"
echo "  ./scripts/generate_testvectors.sh"
echo ""
