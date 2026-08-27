#!/usr/bin/env node
// Off-chain Merkle tree helper for the set_membership circuit.
//
// Builds a depth-8 binary Poseidon2 Merkle tree over an allowlist of u64
// values and outputs the root plus the inclusion path for any member.
//
// Hash spec (must match circuits/set_membership/src/main.nr exactly):
//   leaf(v)       = Poseidon2([v], 1)          -- 1-arity, value only
//   node(l, r)    = Poseidon2([l, r], 2)        -- 2-arity, left then right
//   zero_leaf     = Poseidon2([0], 1)            -- padding leaf
//   zero_node(h)  = node(zero_node(h-1), zero_node(h-1))  for h > 0
//
// The tree is always padded to exactly 2^DEPTH leaves with zero_leaf().
// Indices are 0-based, left-to-right.  Index bits: bit 0 of the leaf index
// is the selector at level 0 (0 = node is left child, 1 = right child).
//
// Usage:
//   node merkle_tree.js root   <v0> [v1 ...]          → prints merkle_root
//   node merkle_tree.js path   <v0> [v1 ...] --for <member_value>
//                                                      → prints Prover.toml lines
//   node merkle_tree.js tree   <v0> [v1 ...]          → prints full tree JSON
//   node merkle_tree.js verify <root> <v0> [v1 ...] --for <member_value>
//                                                      → exit 0 if valid, 1 if not
//
// Examples:
//   node circuits/scripts/merkle_tree.js root 840 276 566 356
//   node circuits/scripts/merkle_tree.js path 840 276 566 356 --for 840
//   node circuits/scripts/merkle_tree.js path 840 276 566 356 --for 566
//
// The "path" subcommand prints the four Prover.toml lines ready to paste:
//   merkle_root = "<decimal>"
//   path = ["<f0>", "<f1>", ..., "<f7>"]
//   indices = ["0", "1", ...]
//
// Integrating with gen_inputs.sh:
//   ROOT=$(node circuits/scripts/merkle_tree.js root "${VALUES[@]}")
//   read -r -d '' PATH_LINES < <(
//     node circuits/scripts/merkle_tree.js path "${VALUES[@]}" --for "$MEMBER"
//   )
//
// Depth and tree parameters:
//   DEPTH = 8  →  up to 256 members.  To extend to 16 bits (65 536 members)
//   change DEPTH below AND recompile the circuit (edit `global DEPTH: u32`);
//   the VK will change and must be redeployed.

"use strict";

const path  = require("path");
const fs    = require("fs");

// ── Poseidon2 over BN254 ─────────────────────────────────────────────────────
// We load the same @aztec/bb.js bundle the frontend uses when available,
// falling back to the lightweight poseidon-lite package.  Both expose the
// same interface we need.
//
// If neither is installed, the script prints an actionable error and exits.
function loadPoseidon2() {
  const candidates = [
    // frontend workspace (most likely when running from repo root)
    path.join(__dirname, "../../frontend/node_modules/@aztec/bb.js"),
    path.join(__dirname, "../../frontend/node_modules/poseidon-lite"),
    // root node_modules
    path.join(__dirname, "../../node_modules/@aztec/bb.js"),
    path.join(__dirname, "../../node_modules/poseidon-lite"),
    // circuits-local node_modules (least likely but checked for completeness)
    path.join(__dirname, "../node_modules/@aztec/bb.js"),
    path.join(__dirname, "../node_modules/poseidon-lite"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const mod = require(candidate);
      // @aztec/bb.js exposes poseidon2Hash(fields: bigint[]) → bigint
      if (mod.poseidon2Hash) return mod.poseidon2Hash;
      // poseidon-lite exposes { poseidon2 } where poseidon2(inputs) → bigint
      if (mod.poseidon2)     return (fields) => mod.poseidon2(fields);
    } catch (_) {
      // try next candidate
    }
  }

  console.error(
    "ERROR: Could not find a Poseidon2 implementation.\n" +
    "Install one of:\n" +
    "  cd frontend && npm install          # installs @aztec/bb.js\n" +
    "  npm install poseidon-lite           # lightweight alternative\n" +
    "Both must be present somewhere under ../../frontend/node_modules,\n" +
    "../../node_modules, or ../node_modules relative to this script.",
  );
  process.exit(1);
}

const poseidon2Raw = loadPoseidon2();

// Wrap so we always work with BigInt and return BigInt.
// poseidon2Raw accepts an array of BigInt (or Number for small values).
function poseidon2(fields) {
  return BigInt(poseidon2Raw(fields.map(BigInt)));
}

// ── Tree parameters ──────────────────────────────────────────────────────────
const DEPTH = 8;
const TREE_SIZE = 1 << DEPTH; // 256

// ── Hash primitives (must match main.nr) ─────────────────────────────────────

// Leaf node: Poseidon2([value], 1)  — 1-arity call.
function leafHash(value) {
  return poseidon2([BigInt(value)]);
}

// Internal node: Poseidon2([left, right], 2).
function nodeHash(left, right) {
  return poseidon2([left, right]);
}

// ── Zero-hash cache ───────────────────────────────────────────────────────────
// zero[0] = leafHash(0)
// zero[h] = nodeHash(zero[h-1], zero[h-1])
const ZERO = (() => {
  const z = new Array(DEPTH + 1);
  z[0] = leafHash(0n);
  for (let h = 1; h <= DEPTH; h++) z[h] = nodeHash(z[h - 1], z[h - 1]);
  return z;
})();

// ── Tree construction ─────────────────────────────────────────────────────────
//
// Returns the full tree as a 2D array: tree[level][index].
//   tree[0]     = leaf hashes (length TREE_SIZE, zero-padded)
//   tree[DEPTH] = [root]
//
function buildTree(values) {
  if (values.length > TREE_SIZE) {
    throw new Error(`Too many values (${values.length}); max for DEPTH=${DEPTH} is ${TREE_SIZE}`);
  }

  // Level 0: leaves
  const leaves = new Array(TREE_SIZE);
  for (let i = 0; i < TREE_SIZE; i++) {
    leaves[i] = i < values.length ? leafHash(values[i]) : ZERO[0];
  }

  const tree = [leaves];
  let current = leaves;

  for (let level = 1; level <= DEPTH; level++) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(nodeHash(current[i], current[i + 1]));
    }
    tree.push(next);
    current = next;
  }

  return tree; // tree[DEPTH][0] is the root
}

// ── Merkle path ───────────────────────────────────────────────────────────────
//
// Returns { path: Field[DEPTH], indices: u1[DEPTH] } for leaf at `leafIndex`.
//   path[i]    = sibling hash at level i (0 = leaf level)
//   indices[i] = 0 if the prover's node is the LEFT child at level i,
//                1 if it is the RIGHT child
//
// The index bits are simply the bits of `leafIndex` from LSB to MSB:
//   bit 0 of leafIndex → indices[0]  (leaf vs its immediate sibling)
//   bit 1 of leafIndex → indices[1]  (pair node vs its sibling pair)
//   …
//
function merklePathForIndex(tree, leafIndex) {
  const pathHashes  = [];
  const pathIndices = [];
  let idx = leafIndex;

  for (let level = 0; level < DEPTH; level++) {
    const isRight = idx & 1;       // 1 if this node is the right child
    const sibIdx  = isRight ? idx - 1 : idx + 1;
    pathHashes.push(tree[level][sibIdx]);
    pathIndices.push(isRight);
    idx = idx >> 1;
  }

  return { path: pathHashes, indices: pathIndices };
}

// ── Verification (sanity-check) ───────────────────────────────────────────────
function verifyPath(root, value, pathHashes, pathIndices) {
  let current = leafHash(value);
  for (let i = 0; i < DEPTH; i++) {
    const sibling = pathHashes[i];
    const index   = pathIndices[i];
    const left    = index ? sibling  : current;
    const right   = index ? current  : sibling;
    current = nodeHash(left, right);
  }
  return current === root;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const subcmd = args[0];
  const forIdx = args.indexOf("--for");
  let member = null;
  let valueArgs = args.slice(1);

  if (forIdx !== -1) {
    member = BigInt(args[forIdx + 1]);
    valueArgs = args.slice(1, forIdx);
  }

  const values = valueArgs.map(BigInt);
  return { subcmd, values, member };
}

function main() {
  const { subcmd, values, member } = parseArgs();

  if (!subcmd || values.length === 0) {
    console.error(
      "Usage:\n" +
      "  node merkle_tree.js root   <v0> [v1 ...]                        → merkle_root\n" +
      "  node merkle_tree.js path   <v0> [v1 ...] --for <member_value>   → Prover.toml lines\n" +
      "  node merkle_tree.js tree   <v0> [v1 ...]                        → full tree JSON\n" +
      "  node merkle_tree.js verify <root> <v0> [v1 ...] --for <member>  → exit 0/1",
    );
    process.exit(2);
  }

  if (subcmd === "root") {
    const tree = buildTree(values);
    console.log(tree[DEPTH][0].toString());
    return;
  }

  if (subcmd === "path") {
    if (member === null) {
      console.error("ERROR: --for <member_value> is required for 'path' subcommand");
      process.exit(2);
    }

    const leafIndex = values.findIndex((v) => v === member);
    if (leafIndex === -1) {
      console.error(`ERROR: value ${member} is not in the provided set`);
      process.exit(1);
    }

    const tree = buildTree(values);
    const root = tree[DEPTH][0];
    const { path: pathHashes, indices: pathIndices } = merklePathForIndex(tree, leafIndex);

    // Verify locally before printing so we catch any hash-spec mismatches.
    if (!verifyPath(root, member, pathHashes, pathIndices)) {
      console.error("INTERNAL ERROR: generated path does not verify — please file a bug");
      process.exit(1);
    }

    const fmt = (arr) => "[" + arr.map((v) => `"${v.toString()}"`).join(", ") + "]";
    console.log(`merkle_root = "${root.toString()}"`);
    console.log(`path = ${fmt(pathHashes)}`);
    console.log(`indices = ${fmt(pathIndices)}`);
    return;
  }

  if (subcmd === "tree") {
    const tree = buildTree(values);
    const serialisable = tree.map((level) => level.map((h) => h.toString()));
    console.log(JSON.stringify({ depth: DEPTH, values: values.map(String), tree: serialisable }, null, 2));
    return;
  }

  if (subcmd === "verify") {
    // argv layout: verify <root> <v0> [v1 ...] --for <member>
    // `values` above already sliced off "verify", but <root> is the first element.
    const root   = values[0];
    const set    = values.slice(1);
    if (member === null) {
      console.error("ERROR: --for <member_value> is required for 'verify' subcommand");
      process.exit(2);
    }

    const leafIndex = set.findIndex((v) => v === member);
    if (leafIndex === -1) {
      console.error(`${member} is NOT in the set`);
      process.exit(1);
    }

    const tree = buildTree(set);
    const computedRoot = tree[DEPTH][0];
    if (computedRoot !== root) {
      console.error(`Root mismatch: expected ${root}, computed ${computedRoot}`);
      process.exit(1);
    }

    const { path: pathHashes, indices: pathIndices } = merklePathForIndex(tree, leafIndex);
    if (verifyPath(root, member, pathHashes, pathIndices)) {
      console.log(`OK: ${member} is a member of the set (leaf index ${leafIndex})`);
    } else {
      console.error(`FAIL: path verification failed for ${member}`);
      process.exit(1);
    }
  }
}

main();

// ── Module exports (for use from gen_inputs.sh via inline node -e) ────────────
module.exports = { buildTree, merklePathForIndex, verifyPath, leafHash, nodeHash, DEPTH, ZERO };
