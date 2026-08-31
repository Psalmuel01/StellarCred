# fixtures/set_membership

Binary UltraHonk artifacts for the `set_membership` circuit
(Noir 1.0.0-beta.9 + Barretenberg bb v0.87.0).

| File | Description |
|------|-------------|
| `vk` | Verification key — deploy into `CredentialVerifier.set_vk("set_membership", 1, vk)` |
| `proof` | Sample UltraHonk proof for the Prover.toml witness |
| `public_inputs` | Corresponding public inputs blob |

The `.gitkeep` file holds the directory in git until the first real artifacts
are generated.  Replace it (or just leave it alongside the artifacts) once
the build runs.

---

## Generating artifacts

### Prerequisites

```sh
noirup -v 1.0.0-beta.9   # install / pin Noir
bbup   -v 0.87.0          # install / pin Barretenberg
cd frontend && npm install # provides @aztec/bb.js (Poseidon2 for the tree helper)
```

### 1. Build the Merkle tree and Prover inputs

The `merkle_tree.js` script builds a depth-8 binary Poseidon2 tree over any
list of `u64` values.  The sample set used for the fixture is:

```
[840, 276, 566, 356]   # US, Germany, Nigeria, Israel (ISO 3166-1 numeric)
```

The prover claims membership for value `840` (US, leaf index 0).

```sh
# Inspect the tree
node circuits/scripts/merkle_tree.js tree 840 276 566 356

# Print the public root
node circuits/scripts/merkle_tree.js root 840 276 566 356

# Print the Prover.toml Merkle lines for a given member
node circuits/scripts/merkle_tree.js path 840 276 566 356 --for 840
```

Example output of `path`:
```toml
merkle_root = "12345678..."
path = ["<sibling_0>", "<sibling_1>", ..., "<sibling_7>"]
indices = ["0", "0", "0", "0", "0", "0", "0", "0"]
```

`gen_inputs.sh` does all of the above automatically:

```sh
bash circuits/scripts/gen_inputs.sh
```

This writes `circuits/set_membership/Prover.toml` with the commitment, ECDSA
signature (demo key), and the full Merkle path.

### 2. Compile and prove

```sh
bash circuits/scripts/build.sh set_membership
```

This runs `nargo compile`, `bb write_vk`, `nargo execute`, and `bb prove`,
then copies the three artifacts (`vk`, `proof`, `public_inputs`) here.

### 3. Run the contract test

```sh
cargo test -p credential_verifier verifies_set_membership
```

The test loads all three artifacts via the `fixture!` macro at compile time.

---

## Off-chain tree helper API

`circuits/scripts/merkle_tree.js` can also be used programmatically:

```js
const { buildTree, merklePathForIndex, verifyPath, DEPTH } = require("./merkle_tree");

const values = [840n, 276n, 566n, 356n];
const tree   = buildTree(values);
const root   = tree[DEPTH][0];

// Path for leaf at index 2 (value 566)
const { path, indices } = merklePathForIndex(tree, 2);

console.log("root   :", root.toString());
console.log("path   :", path.map(String));
console.log("indices:", indices);

// Sanity-check
console.log("valid  :", verifyPath(root, 566n, path, indices)); // true
```

### Hash spec

These must match `circuits/set_membership/src/main.nr` exactly.  If you change
the circuit's hash function you must update `merkle_tree.js` to match and
regenerate all artifacts.

| Operation | Formula |
|-----------|---------|
| Leaf | `Poseidon2([value], 1)` — 1-arity |
| Internal node | `Poseidon2([left, right], 2)` — 2-arity |
| Zero leaf | `Poseidon2([0], 1)` |
| Zero node at height h | `node(zero(h-1), zero(h-1))` |

### Index bit convention

Bit `i` of the leaf's 0-based index (reading from LSB) is `indices[i]`:
- `0` → the prover's node is the **left** child at level `i`
- `1` → the prover's node is the **right** child at level `i`

Leaf 0 (`840`) has index `00000000₂`, so all index bits are `0`.  
Leaf 2 (`566`) has index `00000010₂`, so `indices[1] = 1` and all others `0`.

### Extending the set size

`DEPTH = 8` supports up to 256 members.  To handle larger sets:

1. Edit `global DEPTH: u32 = 8;` in `circuits/set_membership/src/main.nr`.
2. Edit `const DEPTH = 8;` in `circuits/scripts/merkle_tree.js`.
3. Recompile the circuit and regenerate the VK — the existing deployed VK will
   no longer match.
