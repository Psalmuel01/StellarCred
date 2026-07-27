// frontend/lib/cryptos.ts

export async function encryptPayload(payload: Record<string, unknown>, passphrase: string): Promise<string> {
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);
  
  const key = await deriveKey(passphrase, salt.buffer as ArrayBuffer);
  
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, 
    key, 
    encoded.buffer as ArrayBuffer
  );
  
  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
  combined.set(salt);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

export async function decryptPayload(ciphertext: string, passphrase: string): Promise<Record<string, unknown>> {
  const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const data = combined.slice(28);
  
  const key = await deriveKey(passphrase, salt.buffer as ArrayBuffer);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, 
    key, 
    data.buffer as ArrayBuffer
  );
  
  return JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>;
}

async function deriveKey(passphrase: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', 
    enc.encode(passphrase).buffer as ArrayBuffer, 
    'PBKDF2', 
    false, 
    ['deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}