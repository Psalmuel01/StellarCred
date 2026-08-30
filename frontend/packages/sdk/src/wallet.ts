// @stellarcred/sdk — shared wallet/address helpers.
//
// Single home for address normalization + validation, so both the claim-read
// path (`index.ts`) and the subscription path (`subscribe.ts`) share one
// implementation instead of duplicating the StrKey check.

/** Error thrown for malformed Stellar addresses. */
export class InvalidAddressError extends Error {
  constructor(message = "Invalid Stellar address") {
    super(message);
    this.name = "InvalidAddressError";
  }
}

type StellarSDK = typeof import("@stellar/stellar-sdk");
let _sdk: Promise<StellarSDK> | null = null;
function getSdk(): Promise<StellarSDK> {
  if (!_sdk) _sdk = import("@stellar/stellar-sdk");
  return _sdk;
}

/**
 * Trim and validate a Stellar ed25519 public address (G…/M…). Throws
 * {@link InvalidAddressError} on empty input or an unreadable address. Async
 * because it lazily loads the Stellar SDK's `StrKey`.
 */
export async function normalizeAndValidateWallet(
  wallet: string,
): Promise<string> {
  const normalized = wallet.trim();

  if (!normalized) {
    throw new InvalidAddressError("Invalid Stellar address: address is empty");
  }

  const { StrKey } = await getSdk();

  if (!StrKey.isValidEd25519PublicKey(normalized)) {
    throw new InvalidAddressError("Invalid Stellar address");
  }

  return normalized;
}
