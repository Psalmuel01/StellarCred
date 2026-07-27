import CryptoJS from 'crypto-js';

const PBKDF2_ITERATIONS = 100000;
const KEY_SIZE = 256 / 32; // 256 bits in 32-bit words
const SALT_SIZE = 128 / 8; // 128 bits in bytes

/**
 * Encrypts a payload object using a user-provided passphrase.
 * Uses PBKDF2 with 100k iterations for strong key derivation.
 * Returns a JSON envelope with encrypted flag and Base64 ciphertext.
 */
export function encryptPayload(payload: Record<string, unknown>, passphrase: string): string {
  const jsonString = JSON.stringify(payload);
  
  // Generate random salt and IV
  const salt = CryptoJS.lib.WordArray.random(SALT_SIZE);
  const iv = CryptoJS.lib.WordArray.random(128 / 8);
  
  // Derive key using PBKDF2
  const key = CryptoJS.PBKDF2(passphrase, salt, {
    keySize: KEY_SIZE,
    iterations: PBKDF2_ITERATIONS
  });
  
  // Encrypt with derived key
  const encrypted = CryptoJS.AES.encrypt(jsonString, key, { iv });
  
  // Combine salt + iv + ciphertext
  const combined = salt.concat(iv).concat(encrypted.ciphertext);
  const ciphertext = CryptoJS.enc.Base64.stringify(combined);
  
  // Return structured JSON envelope
  return JSON.stringify({
    encrypted: true,
    ciphertext,
  });
}

/**
 * Decrypts a ciphertext string using a user-provided passphrase.
 * Accepts either a JSON envelope or raw Base64 for backward compatibility.
 * Throws an error if the passphrase is incorrect or data is corrupted.
 */
export function decryptPayload(input: string, passphrase: string): Record<string, unknown> {
  // Try to parse as JSON envelope first
  let ciphertext: string;
  try {
    const envelope = JSON.parse(input);
    if (envelope.encrypted && envelope.ciphertext) {
      ciphertext = envelope.ciphertext;
    } else {
      // Not our envelope format, treat as raw ciphertext
      ciphertext = input;
    }
  } catch {
    // Not valid JSON, treat as raw ciphertext
    ciphertext = input;
  }
  
  // Parse combined Base64 string
  const combined = CryptoJS.enc.Base64.parse(ciphertext);
  
  // Extract salt (first 16 bytes)
  const salt = CryptoJS.lib.WordArray.create(combined.words.slice(0, SALT_SIZE / 4));
  
  // Extract IV (next 16 bytes)
  const iv = CryptoJS.lib.WordArray.create(combined.words.slice(SALT_SIZE / 4, (SALT_SIZE + 16) / 4));
  
  // Extract ciphertext (remaining bytes)
  const ciphertextWords = combined.words.slice((SALT_SIZE + 16) / 4);
  const ciphertextObj = CryptoJS.lib.WordArray.create(ciphertextWords);
  
  // Derive key using same parameters
  const key = CryptoJS.PBKDF2(passphrase, salt, {
    keySize: KEY_SIZE,
    iterations: PBKDF2_ITERATIONS
  });
  
  // Decrypt
  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: ciphertextObj } as CryptoJS.lib.CipherParams,
    key,
    { iv }
  );
  
  const decryptedString = decrypted.toString(CryptoJS.enc.Utf8);
  
  if (!decryptedString) {
    throw new Error('Decryption failed. Invalid passphrase or corrupted data.');
  }
  
  return JSON.parse(decryptedString) as Record<string, unknown>;
}