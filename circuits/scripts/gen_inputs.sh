#!/usr/bin/env bash
# Regenerate Prover.toml for every credential circuit: compute the Poseidon2
# commitment (via the commit circuit) and the issuer's Schnorr signature over it
# (via sign.js), then write the circuit inputs. Run before circuits/scripts/build.sh.
set -euo pipefail
export PATH="$HOME/.nargo/bin:$HOME/.bb/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS="$ROOT/scripts"
COMMIT="$ROOT/commit"

# ── validation helpers ──────────────────────────────────────────────────────

# Print a field-named error to stderr and exit.
err() {
  echo "ERROR: $*" >&2
  exit 1
}

# Assert that $val is a non-empty string of decimal digits.
assert_numeric() {
  local label="$1" val="$2"
  [ -n "$val" ] || err "$label: value is empty or missing"
  [[ "$val" =~ ^[0-9]+$ ]] || err "$label: expected a decimal number, got '$val'"
}

# Assert that $val is a valid Noir Field element: a non-empty decimal string
# that fits in the bn254 scalar field.
assert_field() {
  local label="$1" val="$2"
  [ -n "$val" ] || err "$label: value is empty or missing"
  [[ "$val" =~ ^[0-9]+$ ]] || err "$label: expected a decimal Field element, got '$val'"
}

# Assert that $val is a TOML array literal with exactly $n bytes (0-255 each).
assert_byte_array() {
  local label="$1" val="$2" n="$3"
  [ -n "$val" ] || err "$label: value is empty or missing"
  # Strip outer brackets.
  local inner="${val#\[}"
  inner="${inner%\]}"
  [ "$inner" != "$val" ] || err "$label: expected a TOML array (missing brackets)"
  # Split on commas (handles spaces, newlines).
  local -a elems=()
  IFS=',' read -r -a elems <<< "$inner"
  [ "${#elems[@]}" -eq "$n" ] || err "$label: expected $n elements, got ${#elems[@]}"
  local i e trimmed
  for ((i = 0; i < n; i++)); do
    trimmed="$(printf '%s' "${elems[$i]}" | tr -d '[:space:]')"
    [[ "$trimmed" =~ ^[0-9]+$ ]] && [ "$trimmed" -ge 0 ] && [ "$trimmed" -le 255 ] \
      || err "$label: element $i is not a valid byte (0-255), got '$trimmed'"
  done
}

# Assert that $val is a TOML string array like '["840", "364", ...]' where every
# element is a non-empty decimal digit string, and the array has exactly $n elements.
assert_string_array_numeric() {
  local label="$1" val="$2" n="$3"
  [ -n "$val" ] || err "$label: value is empty or missing"
  local inner="${val#\[}"
  inner="${inner%\]}"
  [ "$inner" != "$val" ] || err "$label: expected a TOML array (missing brackets)"
  local -a elems=()
  IFS=',' read -r -a elems <<< "$inner"
  [ "${#elems[@]}" -eq "$n" ] || err "$label: expected $n elements, got ${#elems[@]}"
  local i e trimmed
  for ((i = 0; i < n; i++)); do
    trimmed="$(printf '%s' "${elems[$i]}" | tr -d '[:space:]')"
    # Strip surrounding double quotes.
    trimmed="${trimmed#\"}"
    trimmed="${trimmed%\"}"
    [[ "$trimmed" =~ ^[0-9]+$ ]] || err "$label: element $i is not a numeric string, got '$trimmed'"
  done
}

# Validate the three issuer–signature lines that sign.js emits.
# sign.js outputs: issuer_x = [62, 72, ...]
validate_sig_block() {
  local block="$1"
  while IFS= read -r line; do
    # Trim trailing whitespace (carriage returns from sign.js are fine).
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in
      issuer_x\ =*) assert_byte_array "issuer_x" "${line#issuer_x = }" 32 ;;
      issuer_y\ =*) assert_byte_array "issuer_y" "${line#issuer_y = }" 32 ;;
      sig\ =*)      assert_byte_array "sig"      "${line#sig = }"      64 ;;
      *)            err "unexpected line from sign.js: $line" ;;
    esac
  done <<< "$block"
}

# ── commit helper ───────────────────────────────────────────────────────────

commit() {
  assert_numeric "commit.value" "$1"
  assert_numeric "commit.salt" "$2"
commit() { # value salt -> canonical decimal commitment (2-arity)
  printf 'value = "%s"\nsalt = "%s"\n' "$1" "$2" > "$COMMIT/Prover.toml"
  local raw
  raw=$(cd "$COMMIT" && nargo execute 2>&1 | grep "Circuit output" | sed -E 's/.*Field\((-?[0-9]+)\).*/\1/')
  [ -n "$raw" ] || err "commit: nargo did not produce a Circuit output line"
  assert_numeric "commit computation" "$raw"
  RAW="$raw" node -e 'const r=21888242871839275222246405745257275088548364400416034343698204186575808495617n;let x=BigInt(process.env.RAW);if(x<0n)x+=r;console.log(x.toString())'
}

# ── circuit Prover.toml generation ──────────────────────────────────────────
commit3() { # value1 value2 salt -> canonical decimal commitment (3-arity, for employment)
  printf 'status = "%s"\nseniority = "%s"\nsalt = "%s"\n' "$1" "$2" "$3" > "$ROOT/commit3/Prover.toml"
  local raw
  raw=$(cd "$ROOT/commit3" && nargo execute 2>&1 | grep "Circuit output" | sed -E 's/.*Field\((-?[0-9]+)\).*/\1/')
  RAW="$raw" node -e 'const r=21888242871839275222246405745257275088548364400416034343698204186575808495617n;let x=BigInt(process.env.RAW);if(x<0n)x+=r;console.log(x.toString())'
}

echo "kyc_proof..."
C=$(commit 42 7)
sig_block="$(node "$SCRIPTS/sign.js" "$C")"
validate_sig_block "$sig_block"
{
  echo "secret = \"42\""
  echo "salt = \"7\""
  echo "commitment = \"$C\""
  echo "$sig_block"
} > "$ROOT/kyc_proof/Prover.toml"
echo "  -> circuits/kyc_proof/Prover.toml"

echo "age_proof..."
C=$(commit 3650 12345)
sig_block="$(node "$SCRIPTS/sign.js" "$C")"
validate_sig_block "$sig_block"
{
  echo "date_of_birth = \"3650\""
  echo "salt = \"12345\""
  echo "commitment = \"$C\""
  echo "current_date = \"20000\""
  echo "threshold_years = \"18\""
  echo "$sig_block"
} > "$ROOT/age_proof/Prover.toml"
echo "  -> circuits/age_proof/Prover.toml"

echo "income_proof..."
C=$(commit 250000 99)
sig_block="$(node "$SCRIPTS/sign.js" "$C")"
validate_sig_block "$sig_block"
{
  echo "income = \"250000\""
  echo "salt = \"99\""
  echo "commitment = \"$C\""
  echo "threshold = \"200000\""
  echo "$sig_block"
} > "$ROOT/income_proof/Prover.toml"
echo "  -> circuits/income_proof/Prover.toml"

echo "jurisdiction_proof..."
C=$(commit 566 77)
sig_block="$(node "$SCRIPTS/sign.js" "$C")"
validate_sig_block "$sig_block"
{
  echo "country_code = \"566\""
  echo "salt = \"77\""
  echo "commitment = \"$C\""
  echo "restricted = [\"840\", \"364\", \"408\", \"0\", \"0\", \"0\", \"0\", \"0\"]"
  echo "$sig_block"
} > "$ROOT/jurisdiction_proof/Prover.toml"
echo "  -> circuits/jurisdiction_proof/Prover.toml"

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
