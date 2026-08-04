"use client";

// Passphrase-based encryption for credential-transfer QR payloads. AES-256-GCM
// with a PBKDF2-SHA256-derived key, via WebCrypto only — no new crypto
// dependency. Iteration count follows OWASP's password-storage guidance for
// PBKDF2-HMAC-SHA256: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const VERSION = 1;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export class DecryptionError extends Error {
  constructor(message = "Wrong passphrase, or the code is corrupted.") {
    super(message);
    this.name = "DecryptionError";
  }
}

/**
 * Encrypts `plaintext` with a key derived from `passphrase`. Output is a
 * single URL-safe string: `[version][salt][iv][ciphertext+tag]`, base64url
 * encoded — compact enough to embed directly in a QR code / query param.
 */
export async function encryptWithPassphrase(plaintext: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(plaintext)),
  );

  const envelope = new Uint8Array(1 + SALT_BYTES + IV_BYTES + ciphertext.length);
  envelope[0] = VERSION;
  envelope.set(salt, 1);
  envelope.set(iv, 1 + SALT_BYTES);
  envelope.set(ciphertext, 1 + SALT_BYTES + IV_BYTES);
  return toBase64Url(envelope);
}

/** Reverses encryptWithPassphrase. Throws DecryptionError on a wrong passphrase or malformed payload. */
export async function decryptWithPassphrase(payload: string, passphrase: string): Promise<string> {
  let envelope: Uint8Array;
  try {
    envelope = fromBase64Url(payload);
  } catch {
    throw new DecryptionError("Not a valid transfer code.");
  }
  if (envelope.length < 1 + SALT_BYTES + IV_BYTES + 1 || envelope[0] !== VERSION) {
    throw new DecryptionError("Not a valid transfer code.");
  }

  const salt = envelope.slice(1, 1 + SALT_BYTES);
  const iv = envelope.slice(1 + SALT_BYTES, 1 + SALT_BYTES + IV_BYTES);
  const ciphertext = envelope.slice(1 + SALT_BYTES + IV_BYTES);
  const key = await deriveKey(passphrase, salt);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    // AES-GCM authentication failure — wrong passphrase or a tampered
    // payload are indistinguishable by design (that's the point of the tag).
    throw new DecryptionError();
  }
}
