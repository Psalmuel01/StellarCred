// Merkle tree builder and path generator for set_membership circuit.
//
// Builds a Merkle tree from a set of values using Poseidon2 hashing (matching
// the circuit's hash function) and generates inclusion proofs (path + indices).
//
// Usage:
//   node merkle.js build <values.json>           -> outputs tree JSON with root
//   node merkle.js proof <tree.json> <value>     -> outputs merkle_path and indices
//   node merkle.js demo                          -> generates demo tree and proof
//
// The tree uses binary Merkle structure with Poseidon2([left, right], 2) for
// internal nodes and Poseidon2([value], 1) for leaves.

const path = require("path");
const fs = require("fs");

// Simple hash functions matching the Noir circuit's placeholder hashes
// In production, these should match the actual Poseidon2 implementation
class SimpleHash {
  constructor() {
    // BN254 curve prime
    this.p = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  }

  hashCommitment(value, salt) {
    // Matches Noir: value * salt + value + salt
    const v = BigInt(value);
    const s = BigInt(salt);
    return ((v * s + v + s) % this.p).toString();
  }

  hashSingle(input) {
    // Matches Noir: input * input + input
    const val = BigInt(input);
    return ((val * val + val) % this.p).toString();
  }

  hashPair(left, right) {
    // Matches Noir: left * right + left + right
    const l = BigInt(left);
    const r = BigInt(right);
    return ((l * r + l + r) % this.p).toString();
  }
}

function buildTree(values, depth = 8) {
  const hasher = new SimpleHash();
  const leafCount = Math.pow(2, depth);
  
  // Pad values to fill the tree
  const padded = [...values];
  while (padded.length < leafCount) {
    padded.push(0n);
  }
  
  // Compute leaf hashes
  const leaves = padded.map(v => hasher.hashSingle(BigInt(v)));
  
  // Build tree bottom-up
  let level = leaves;
  const tree = [leaves];
  
  while (level.length > 1) {
    const nextLevel = [];
    for (let i = 0; i < level.length; i += 2) {
      const hash = hasher.hashPair(level[i], level[i + 1]);
      nextLevel.push(hash);
    }
    tree.unshift(nextLevel);
    level = nextLevel;
  }
  
  return {
    depth,
    values: padded.map(v => v.toString()),
    leaves: leaves.map(v => v.toString()),
    tree: tree.map(level => level.map(v => v.toString())),
    root: tree[0][0].toString()
  };
}

function getProof(treeData, value) {
  const hasher = new SimpleHash();
  const valueBigInt = BigInt(value);
  
  // Find the leaf index (handle both string and BigInt in treeData.values)
  const leafIndex = treeData.values.findIndex(v => BigInt(v) === valueBigInt);
  if (leafIndex === -1) {
    throw new Error(`Value ${value} not found in tree`);
  }
  
  const path = [];
  const indices = [];
  let currentIndex = leafIndex;
  
  // Walk up the tree collecting siblings
  for (let level = treeData.tree.length - 1; level > 0; level--) {
    const currentLevel = treeData.tree[level];
    const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
    
   path.push(currentLevel[siblingIndex]);
    indices.push(currentIndex % 2 === 1); // true if right child
    
    currentIndex = Math.floor(currentIndex / 2);
  }
  
  return {
    merkle_path: path.map(p => p.toString()),
    merkle_indices: indices,
    leaf_index: leafIndex
  };
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === "build") {
    const valuesFile = args[1];
    if (!valuesFile) {
      console.error("Usage: node merkle.js build <values.json>");
      process.exit(1);
    }
    
    const values = JSON.parse(fs.readFileSync(valuesFile, "utf8"));
    const tree = buildTree(values);
    console.log(JSON.stringify(tree, null, 2));
    
  } else if (command === "proof") {
    const treeFile = args[1];
    const value = args[2];
    
    if (!treeFile || value === undefined) {
      console.error("Usage: node merkle.js proof <tree.json> <value>");
      process.exit(1);
    }
    
    const treeData = JSON.parse(fs.readFileSync(treeFile, "utf8"));
    const proof = getProof(treeData, value);
    console.log(JSON.stringify(proof, null, 2));
    
  } else if (command === "demo") {
    // Demo: Create a tree of allowed country codes
    const allowedCountries = ["840", "124", "36", "250", "276", "380", "566", "643"];
    const tree = buildTree(allowedCountries);
    
    console.log("Demo Merkle Tree:");
    console.log("Root:", tree.root.toString());
    console.log("Values:", tree.values.map(v => v.toString()));
    
    // Get proof for US (840)
    const proof = getProof(tree, "840");
    console.log("\nProof for US (840):");
    console.log("Path:", proof.merkle_path.map(p => p.toString()));
    console.log("Indices:", proof.merkle_indices);
    
    // Save tree and proof
    fs.writeFileSync(
      path.join(__dirname, "../fixtures/set_membership/tree.json"),
      JSON.stringify(tree, null, 2)
    );
    fs.writeFileSync(
      path.join(__dirname, "../fixtures/set_membership/proof_us.json"),
      JSON.stringify(proof, null, 2)
    );
    
    console.log("\nSaved to fixtures/set_membership/");
    
  } else {
    console.error("Usage: node merkle.js [build|proof|demo] ...");
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildTree, getProof };
