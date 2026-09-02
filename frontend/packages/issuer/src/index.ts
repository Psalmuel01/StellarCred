// @stellarcred/issuer — server-only credential issuance.
//
// Wraps the full StellarCred issuance pipeline: attribute -> circuit value,
// salt generation, Poseidon2 commitment (matching the Noir circuits and the
// on-chain verifier), and a secp256k1 signature over the raw commitment
// (prehash: false — Noir uses the 32-byte digest directly, no SHA-256
// pre-hash step).
//
// This module signs with a private key and must never run in a browser. The
// package.json "exports" field only defines a "node" condition, so bundlers
// that respect package exports will fail to resolve this import outside
// Node.js. This runtime check is defense-in-depth for older tooling that
// ignores exports conditions.
if (typeof window !== "undefined") {
  throw new Error(
    "@stellarcred/issuer must only be used server-side. It signs credentials " +
      "with a private key and must never run in a browser.",
  );
}

import { randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
// Copied from public/circuits/{commit,commit3}.json by scripts/sync-circuit.mjs (prebuild).
import commitCircuit from "./commit-circuit.json";
import commit3Circuit from "./commit3-circuit.json";

export const CREDENTIAL_TYPES = [
  "kyc",
  "age",
  "jurisdiction",
  "income",
  "funds",
  "accreditation",
  "employment",
] as const;

export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export interface ClaimParams {
  threshold_years?: string;
  threshold?: string;
  restricted?: string[];
  /** "0" = denylist/block (default), "1" = allowlist/allow */
  mode?: string;
}

export interface Credential {
  type: CredentialType;
  title: string;
  claim: string;
  issuer: string;
  issuerId: string;
  holder: string;
  value: string;
  salt: string;
  commitment: string;
  sig: number[];
  issuerPubX: number[];
  issuerPubY: number[];
  issuedAt: number;
  expiry: string;
  /**
   * Issuer-attested tenure (years), present on `employment` credentials so the
   * holder can prove `seniority >= min_seniority` against the issuer's signed
   * commitment. Absent for other credential types.
   */
  seniority?: string;
  claimParams?: ClaimParams;
}

export interface IssueParams {
  type: CredentialType;
  holder: string;
  issuerId: string;
  issuerName: string;
  /** Either a duration string ("90 days") or an absolute unix timestamp. */
  expiry: string | number;
  /** Type-specific attribute fields, e.g. { date_of_birth: "1990-01-01" }. */
  attribute: Record<string, string>;
  claimParams?: ClaimParams;
}

// ---------------------------------------------------------------------------
// IssuerSigner abstraction
// ---------------------------------------------------------------------------
// Pluggable signing backend so production issuers can delegate to a KMS/HSM
// instead of loading a raw private key into the process.  Two built-in
// implementations live in the app layer (lib/signer.ts):
//
//   - EnvSigner  — signs with a local secp256k1 private key (dev/mock only)
//   - KmsSigner  — delegates to AWS KMS via Sign(KeyId, Digest)
//
// The key never leaves the HSM; the KmsSigner holds only a key ID.
// prehash: false semantics are preserved: the KMS must sign the raw 32-byte
// digest directly, NOT re-hash it (use DIGEST message type, not RAW).
// ---------------------------------------------------------------------------

/**
 * Minimal signing interface that IssuerClient delegates to.  Implementations
 * live outside this package so the issuer SDK stays free of cloud SDK
 * dependencies.
 */
export interface IssuerSigner {
  /**
   * Sign a raw 32-byte commitment digest (prehash: false).
   * Returns the 64-byte compact signature (r ‖ s, each 32 bytes, big-endian)
   * as a number array — the form Noir's `std::ecdsa_secp256k1` verifier
   * expects.
   */
  sign(digest: Uint8Array): Promise<number[]>;

  /** The issuer's secp256k1 public key (x || y, each 32 bytes). */
  publicKey(): Promise<{ x: number[]; y: number[] }>;
}

export interface IssuerClientOptions {
  /**
   * 64-character hex secp256k1 private key. Server-side only — never
   * NEXT_PUBLIC_.  Used only when no `signer` is provided (legacy path).
   */
  privateKey?: string;

  /**
   * Pluggable signing backend (e.g. KmsSigner for production).  When
   * provided, `privateKey` is ignored and the raw key bytes never enter
   * the process.
   */
  signer?: IssuerSigner;
}

function be32(v: bigint): Uint8Array {
  const b = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    b[i] = Number(v & 255n);
    v >>= 8n;
  }
  return b;
}

export { be32 };

function randomField(): string {
  // 31 bytes = 248 bits, always fits in BN254 scalar field.
  return "0x" + randomBytes(31).toString("hex");
}

// Derive the circuit `value` (preimage) for a credential type from the
// caller-supplied attribute fields.
function attributeToValue(type: CredentialType, attribute: Record<string, string>): string {
  switch (type) {
    case "kyc":
      // Binary claim — no attribute to commit, just a fresh random secret.
      return randomField();
    case "age": {
      const dob = attribute.date_of_birth;
      if (!dob) throw new Error("age credential requires attribute.date_of_birth");
      const days = Math.floor(new Date(dob).getTime() / 86_400_000);
      if (!Number.isFinite(days) || days < 0)
        throw new Error("Invalid date_of_birth: must be on or after 1970-01-01");
      return String(days);
    }
    case "income": {
      const income = parseInt(attribute.income ?? "", 10);
      if (!Number.isFinite(income) || income < 0) throw new Error("income credential requires a non-negative attribute.income");
      return String(income);
    }
    case "jurisdiction": {
      const country = parseInt(attribute.country_code ?? "", 10);
      if (!Number.isFinite(country)) throw new Error("jurisdiction credential requires attribute.country_code");
      return String(country);
    }
    case "funds": {
      const balance = parseInt(attribute.balance ?? "", 10);
      if (!Number.isFinite(balance)) throw new Error("funds credential requires attribute.balance");
      return String(balance);
    }
    case "accreditation": {
      const netWorth = parseInt(attribute.net_worth ?? "", 10);
      if (!Number.isFinite(netWorth)) throw new Error("accreditation credential requires attribute.net_worth");
      return String(netWorth);
    }
    case "employment": {
      // Binary "is employed" claim — the circuit constrains status != 0 so
      // the issuer only ever signs non-zero tags. Seniority is read separately
      // from attribute.seniority because it is a second preimage value for the
      // 3-arity Poseidon2 commitment.
      return "1";
    }
    default:
      throw new Error(`Unknown credential type: ${type as string}`);
  }
}

async function poseidonCommit(value: string, salt: string): Promise<string> {
  const { Noir } = await import("@noir-lang/noir_js");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noir = new Noir(commitCircuit as any);
  const { returnValue } = await noir.execute({ value, salt });
  return String(returnValue);
}

// 3-arity Poseidon2 commitment for employment: hash([status, seniority, salt]).
// Including seniority in the preimage is what binds the issuer's signature to
// the holder's specific tenure — otherwise a holder could self-select any
// seniority >= min_seniority and still satisfy the circuit constraint.
async function poseidonCommit3(
  status: string,
  seniority: string,
  salt: string,
): Promise<string> {
  const { Noir } = await import("@noir-lang/noir_js");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noir = new Noir(commit3Circuit as any);
  const { returnValue } = await noir.execute({ status, seniority, salt });
  return String(returnValue);
}

function issuerPublicKey(privateKey: Uint8Array): { x: number[]; y: number[] } {
  const p = secp256k1.getPublicKey(privateKey, false); // 0x04 || x || y
  return { x: Array.from(p.slice(1, 33)), y: Array.from(p.slice(33, 65)) };
}

function signCommitment(
  commitment: string,
  privateKey: Uint8Array,
): { sig: number[]; issuerX: number[]; issuerY: number[] } {
  const sig = secp256k1.sign(be32(BigInt(commitment)), privateKey, { prehash: false });
  const { x, y } = issuerPublicKey(privateKey);
  return { sig: Array.from(sig), issuerX: x, issuerY: y };
}

const TYPE_TITLE: Record<CredentialType, string> = {
  kyc: "KYC Complete",
  age: "Age Verified",
  income: "Accredited (Income)",
  jurisdiction: "Jurisdiction Eligible",
  funds: "Proof of Funds",
  accreditation: "Accredited Investor (Net Worth)",
  employment: "Employed",
};

function buildClaimLabel(type: CredentialType, claimParams?: ClaimParams): string {
  switch (type) {
    case "age":
      return `age ≥ ${claimParams?.threshold_years ?? "18"}`;
    case "income": {
      const t = Number(claimParams?.threshold ?? "200000");
      return `income > $${t.toLocaleString("en-US")}`;
    }
    case "funds": {
      const t = Number(claimParams?.threshold ?? "10000");
      return `balance > $${t.toLocaleString("en-US")}`;
    }
    case "accreditation": {
      const t = Number(claimParams?.threshold ?? "1000000");
      return `net worth ≥ $${t.toLocaleString("en-US")}`;
    }
    case "employment": {
      const t = claimParams?.threshold ?? "3";
      return `employed, seniority ≥ ${t} yrs`;
    }
    case "jurisdiction":
      return claimParams?.mode === "1" ? "country in allowed list" : "country not restricted";
    case "kyc":
    default:
      return "identity verified";
  }
}

// Normalize expiry to the "N days" string convention every Credential uses.
// A caller-supplied duration string passes through unchanged; a unix
// timestamp is converted relative to issuedAt.
function normalizeExpiry(expiry: string | number, issuedAt: number): string {
  if (typeof expiry === "string") return expiry;
  const days = Math.max(1, Math.round((expiry - issuedAt) / 86_400));
  return `${days} days`;
}

function parsePrivateKey(privateKey: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error(
      "IssuerClient requires a 64-character hex secp256k1 private key (set ISSUER_PRIVATE_KEY server-side, never NEXT_PUBLIC_)",
    );
  }
  return Uint8Array.from(Buffer.from(privateKey, "hex"));
}

export class IssuerClient {
  private readonly privateKey: Uint8Array | null;
  private readonly signer: IssuerSigner | null;

  constructor(opts: IssuerClientOptions) {
    if (opts.signer) {
      this.signer = opts.signer;
      this.privateKey = null;
    } else if (opts.privateKey) {
      this.privateKey = parsePrivateKey(opts.privateKey);
      this.signer = null;
    } else {
      throw new Error(
        "IssuerClient requires either a signer or a 64-character hex secp256k1 private key",
      );
    }
  }

  /**
   * The issuer's secp256k1 public key — register this with IssuerRegistry.
   * When using a signer (e.g. KmsSigner), this is async because the public
   * key must be fetched from the KMS.
   */
  async publicKey(): Promise<{ x: number[]; y: number[] }> {
    if (this.signer) {
      return this.signer.publicKey();
    }
    return issuerPublicKey(this.privateKey!);
  }

  /**
   * Issue one credential. Every call produces its own independent
   * preimage/salt/commitment/signature — nothing is shared across calls but
   * the issuer key.
   */
  async issue(params: IssueParams): Promise<Credential> {
    const { type, holder, issuerId, issuerName, expiry, attribute, claimParams } = params;
    if (!CREDENTIAL_TYPES.includes(type)) {
      throw new Error(`Unknown credential type: ${type as string}`);
    }
    const issuedAt = Math.floor(Date.now() / 1000);
    const value = attributeToValue(type, attribute);
    const salt = randomField();
    // Employment uses a 3-arity commitment that also binds the holder's
    // specific seniority. The seniority comes from attribute.seniority (set by
    // the issuer page) and is stored on the credential so the witness route can
    // rebuild the preimage when generating a proof.
    const commitment =
      type === "employment"
        ? await poseidonCommit3(value, attribute.seniority ?? "0", salt)
        : await poseidonCommit(value, salt);

    let sig: number[];
    let issuerX: number[];
    let issuerY: number[];

    if (this.signer) {
      // Delegate signing to the pluggable signer (e.g. KMS).
      // The digest is the raw 32-byte big-endian commitment — prehash: false.
      const digest = be32(BigInt(commitment));
      sig = await this.signer.sign(digest);
      const pub = await this.signer.publicKey();
      issuerX = pub.x;
      issuerY = pub.y;
    } else {
      // Legacy path: sign with the in-process private key.
      const result = signCommitment(commitment, this.privateKey!);
      sig = result.sig;
      issuerX = result.issuerX;
      issuerY = result.issuerY;
    }

    const employmentExtra =
      type === "employment" && attribute.seniority
        ? { seniority: attribute.seniority }
        : {};
    return {
      type,
      title: TYPE_TITLE[type],
      claim: buildClaimLabel(type, claimParams),
      issuer: issuerName,
      issuerId,
      holder,
      value,
      salt,
      commitment,
      sig,
      issuerPubX: issuerX,
      issuerPubY: issuerY,
      issuedAt,
      expiry: normalizeExpiry(expiry, issuedAt),
      ...employmentExtra,
      ...(claimParams && Object.values(claimParams).some((v) => v !== undefined) ? { claimParams } : {}),
    };
  }
}
