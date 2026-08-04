#!/usr/bin/env bash
# Regenerate Prover.toml for every credential circuit: compute the Poseidon2
# commitment (via the commit circuit) and the issuer's Schnorr signature over it
# (via sign.js), then write the circuit inputs. Run before circuits/scripts/build.sh.
set -euo pipefail
export PATH="$HOME/.nargo/bin:$HOME/.bb/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS="$ROOT/scripts"
COMMIT="$ROOT/commit"

commit() { # value salt -> canonical decimal commitment (2-arity)
  printf 'value = "%s"\nsalt = "%s"\n' "$1" "$2" > "$COMMIT/Prover.toml"
  local raw
  raw=$(cd "$COMMIT" && nargo execute 2>&1 | grep "Circuit output" | sed -E 's/.*Field\((-?[0-9]+)\).*/\1/')
  RAW="$raw" node -e 'const r=21888242871839275222246405745257275088548364400416034343698204186575808495617n;let x=BigInt(process.env.RAW);if(x<0n)x+=r;console.log(x.toString())'
}

commit3() { # value1 value2 salt -> canonical decimal commitment (3-arity, for employment)
  printf 'status = "%s"\nseniority = "%s"\nsalt = "%s"\n' "$1" "$2" "$3" > "$ROOT/commit3/Prover.toml"
  local raw
  raw=$(cd "$ROOT/commit3" && nargo execute 2>&1 | grep "Circuit output" | sed -E 's/.*Field\((-?[0-9]+)\).*/\1/')
  RAW="$raw" node -e 'const r=21888242871839275222246405745257275088548364400416034343698204186575808495617n;let x=BigInt(process.env.RAW);if(x<0n)x+=r;console.log(x.toString())'
}

echo "kyc_proof..."
C=$(commit 42 7)
CTX=1001
N=$(commit 7 "$CTX")
{ echo "secret = \"42\""; echo "salt = \"7\""; echo "commitment = \"$C\""; \
  echo "context_id = \"$CTX\""; echo "nullifier = \"$N\""; node "$SCRIPTS/sign.js" "$C"; } \
  > "$ROOT/kyc_proof/Prover.toml"

echo "age_proof..."
C=$(commit 3650 12345)
CTX=1002
N=$(commit 12345 "$CTX")
{ echo "date_of_birth = \"3650\""; echo "salt = \"12345\""; echo "commitment = \"$C\""; \
  echo "current_date = \"20000\""; echo "threshold_years = \"18\""; \
  echo "context_id = \"$CTX\""; echo "nullifier = \"$N\""; node "$SCRIPTS/sign.js" "$C"; } \
  > "$ROOT/age_proof/Prover.toml"

echo "income_proof..."
C=$(commit 250000 99)
CTX=1003
N=$(commit 99 "$CTX")
{ echo "income = \"250000\""; echo "salt = \"99\""; echo "commitment = \"$C\""; \
  echo "threshold = \"200000\""; echo "context_id = \"$CTX\""; echo "nullifier = \"$N\""; \
  node "$SCRIPTS/sign.js" "$C"; } \
  > "$ROOT/income_proof/Prover.toml"

echo "jurisdiction_proof..."
C=$(commit 566 77)
CTX=1004
N=$(commit 77 "$CTX")
{ echo "country_code = \"566\""; echo "salt = \"77\""; echo "commitment = \"$C\""; \
  echo "restricted = [\"840\", \"364\", \"408\", \"0\", \"0\", \"0\", \"0\", \"0\"]"; \
  echo "context_id = \"$CTX\""; echo "nullifier = \"$N\""; node "$SCRIPTS/sign.js" "$C"; } \
  > "$ROOT/jurisdiction_proof/Prover.toml"

echo "funds_proof..."
C=$(commit 500000 55)
CTX=1005
N=$(commit 55 "$CTX")
{ echo "balance = \"500000\""; echo "salt = \"55\""; echo "commitment = \"$C\""; \
  echo "threshold = \"100000\""; echo "context_id = \"$CTX\""; echo "nullifier = \"$N\""; \
  node "$SCRIPTS/sign.js" "$C"; } \
  > "$ROOT/funds_proof/Prover.toml"

echo "accreditation_proof..."
C=$(commit 2000000 88)
CTX=1006
N=$(commit 88 "$CTX")
{ echo "net_worth = \"2000000\""; echo "salt = \"88\""; echo "commitment = \"$C\""; \
  echo "threshold = \"1000000\""; echo "context_id = \"$CTX\""; echo "nullifier = \"$N\""; \
  node "$SCRIPTS/sign.js" "$C"; } \
  > "$ROOT/accreditation_proof/Prover.toml"

echo "employment_proof..."
# Commitment binds BOTH status (1=employed) AND the holder's specific
# seniority so the issuer's signature attests to tenure, not just the
# binary "is employed" tag.
C=$(commit3 1 5 11)
{ echo "employment_status = \"1\""; echo "seniority = \"5\""; echo "salt = \"11\""; \
  echo "commitment = \"$C\""; echo "min_seniority = \"3\""; node "$SCRIPTS/sign.js" "$C"; } \
  > "$ROOT/employment_proof/Prover.toml"

echo "done. demo issuer public key:"
node "$SCRIPTS/sign.js" --pubkey