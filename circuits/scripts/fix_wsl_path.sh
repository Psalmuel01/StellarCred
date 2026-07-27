#!/usr/bin/env bash
# Fix PATH and complete installation

echo "Refreshing PATH and completing installation..."
echo ""

# Source bashrc to get updated PATH
source ~/.bashrc

# Manually add to PATH for current session
export PATH="$HOME/.nargo/bin:$HOME/.bb/bin:$PATH"

# Check if bbup exists
if [ -f "$HOME/.bb/bin/bbup" ]; then
    echo "[OK] bbup found at $HOME/.bb/bin/bbup"
    
    # Install Barretenberg
    echo "Installing Barretenberg 0.87.0..."
    "$HOME/.bb/bin/bbup" -v 0.87.0
    
elif command -v bbup &> /dev/null; then
    echo "[OK] bbup is in PATH"
    
    # Install Barretenberg
    echo "Installing Barretenberg 0.87.0..."
    bbup -v 0.87.0
    
else
    echo "[ERROR] bbup not found"
    echo "Try running the installation script again or manually:"
    echo "  curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install | bash"
    echo "  source ~/.bashrc"
    echo "  bbup -v 0.87.0"
    exit 1
fi

# Verify both tools
echo ""
echo "Verification:"

if command -v nargo &> /dev/null; then
    echo "[OK] nargo: $(nargo --version)"
else
    echo "[X] nargo not found"
fi

if command -v bb &> /dev/null; then
    echo "[OK] bb: $(bb --version)"
else
    echo "[X] bb not found"
fi

echo ""
echo "Done! You can now run: ./scripts/generate_testvectors.sh"
