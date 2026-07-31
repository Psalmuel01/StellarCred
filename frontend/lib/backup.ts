"use client";

import type { Credential } from "./credential";
import { loadCredentials, saveCredential } from "./credential";

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

export interface EncryptedBackup {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer.slice(0);
}

async function deriveKey(
  passphrase: string,
  salt: ArrayBuffer
): Promise<CryptoKey> {
  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function createEncryptedBackup(
  passphrase: string
): Promise<EncryptedBackup> {
  if (!passphrase) {
    throw new Error("Passphrase must not be empty");
  }
  const credentials = loadCredentials();
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));

  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const ivBytes = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const key = await deriveKey(passphrase, saltBytes.buffer.slice(0));

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ivBytes.buffer.slice(0),
    },
    key,
    plaintext
  );

  return {
    version: 1,
    salt: toBase64(saltBytes),
    iv: toBase64(ivBytes),
    ciphertext: toBase64(ciphertext),
  };
}

export async function decryptBackup(
  backup: EncryptedBackup,
  passphrase: string
): Promise<Credential[]> {
  if (backup.version !== 1) {
    throw new Error("Unsupported backup version");
  }

  const salt = fromBase64(backup.salt);
  const iv = fromBase64(backup.iv);
  const ciphertext = fromBase64(backup.ciphertext);

  const key = await deriveKey(passphrase, salt);

  let decrypted: ArrayBuffer;

  try {
    decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      ciphertext
    );
  } catch {
    throw new Error("Wrong passphrase or corrupted backup");
  }

  const parsed = JSON.parse(new TextDecoder().decode(decrypted));

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid backup contents");
  }

  // Validate each entry has required Credential fields
  for (const item of parsed) {
    if (
      !item ||
      typeof item !== "object" ||
      !item.type ||
      item.value === undefined ||
      !item.commitment ||
      !item.issuerId ||
      !item.sig
    ) {
      throw new Error("Invalid backup contents: malformed credential entry");
    }
  }

  return parsed as Credential[];
}

export function mergeCredentials(imported: Credential[]): Credential[] {
  let current = loadCredentials();

  for (const cred of imported) {
    current = saveCredential(cred);
  }

  return current;
}

export function downloadBackup(
  backup: EncryptedBackup,
  filename = "stellarcred-backup.json"
) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(() => URL.revokeObjectURL(url), 100);
}
