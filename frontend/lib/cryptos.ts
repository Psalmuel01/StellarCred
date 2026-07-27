import CryptoJS from 'crypto-js';

/**
 * Encrypts a payload object using a user-provided passphrase.
 * Returns a Base64 encoded ciphertext string.
 */
export function encryptPayload(payload: Record<string, unknown>, passphrase: string): string {
  const jsonString = JSON.stringify(payload);
  return CryptoJS.AES.encrypt(jsonString, passphrase).toString();
}

/**
 * Decrypts a ciphertext string using a user-provided passphrase.
 * Throws an error if the passphrase is incorrect or data is corrupted.
 */
export function decryptPayload(ciphertext: string, passphrase: string): Record<string, unknown> {
  const bytes = CryptoJS.AES.decrypt(ciphertext, passphrase);
  const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
  
  if (!decryptedString) {
    throw new Error('Decryption failed. Invalid passphrase or corrupted data.');
  }
  
  return JSON.parse(decryptedString) as Record<string, unknown>;
}