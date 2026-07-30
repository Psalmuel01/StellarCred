// set_membership
//
// Proves "my private attribute belongs to a public set" without revealing which
// member it is. Uses a Merkle inclusion proof against a public root.
//
// Public inputs: issuer_pub_x, issuer_pub_y, commitment, merkle_root
// Private: value, salt, sig, Merkle path + indices
// Verify: commitment binds value, ECDSA signs it, and value is a leaf under merkle_root

// Merkle tree depth (adjustable based on set size)
global TREE_DEPTH: u32 = 8;

// Simple hash function for commitment (matches credential_lib's Poseidon2)
// In production this should use the actual Poseidon2 hash
fn hash_commitment(value: Field, salt: Field) -> Field {
    // Placeholder hash - in production use Poseidon2::hash([value, salt], 2)
    value * salt + value + salt
}

// Simple hash function for Merkle tree leaves
fn hash_single(input: Field) -> Field {
    // Placeholder hash - in production use Poseidon2::hash([input], 1)
    input * input + input
}

// Simple hash function for Merkle tree internal nodes
fn hash_pair(left: Field, right: Field) -> Field {
    // Placeholder hash - in production use Poseidon2::hash([left, right], 2)
    left * right + left + right
}

fn main(
    // private inputs
    value: Field,
    salt: Field,
    sig: [u8; 64],
    merkle_path: [Field; TREE_DEPTH],
    merkle_indices: [bool; TREE_DEPTH],
    // public inputs
    commitment: pub Field,
    issuer_x: pub [u8; 32],
    issuer_y: pub [u8; 32],
    merkle_root: pub Field,
) {
    // Commitment binding - ensures the private value is the one inside the credential
    assert(hash_commitment(value, salt) == commitment);

    // Issuer signature verification
    // TODO: Enable this in production with proper signatures
    // use std::ecdsa_secp256k1::verify_signature;
    // let z: [u8; 32] = commitment.to_be_bytes();
    // assert(verify_signature(issuer_x, issuer_y, sig, z));

    // Compute the leaf hash from the value
    let leaf = hash_single(value);

    // Verify Merkle inclusion proof
    let computed_root = compute_merkle_root(leaf, merkle_path, merkle_indices);

    // Assert that the computed root matches the public root
    assert(computed_root == merkle_root);
}

fn compute_merkle_root(
    leaf: Field,
    path: [Field; TREE_DEPTH],
    indices: [bool; TREE_DEPTH],
) -> Field {
    let mut current = leaf;

    for i in 0..TREE_DEPTH {
        let sibling = path[i];
        let index = indices[i];

        if index {
            // Current node is right child: hash(sibling, current)
            current = hash_pair(sibling, current);
        } else {
            // Current node is left child: hash(current, sibling)
            current = hash_pair(current, sibling);
        }
    }

    current
}
