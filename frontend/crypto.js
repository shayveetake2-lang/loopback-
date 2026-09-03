// crypto.js
// Provides E2E encryption utilities using the Web Crypto API

// Helper to convert base64 to Uint8Array
export function base64ToArrayBuffer(base64) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

// Helper to convert Uint8Array to base64
export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Generate RSA-OAEP Key Pair for the user
export async function generateRSAKeyPair() {
  return await window.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true, // extractable
    ["encrypt", "decrypt"]
  );
}

// Export Public Key to JWK
export async function exportPublicKey(key) {
  return await window.crypto.subtle.exportKey("jwk", key);
}

// Import Public Key from JWK
export async function importPublicKey(jwk) {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSA-OAEP",
      hash: "SHA-256"
    },
    true,
    ["encrypt"]
  );
}

// Export Private Key to JWK (to be encrypted)
export async function exportPrivateKey(key) {
  return await window.crypto.subtle.exportKey("jwk", key);
}

// Import Private Key from JWK
export async function importPrivateKey(jwk) {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSA-OAEP",
      hash: "SHA-256"
    },
    true,
    ["decrypt"]
  );
}

// Derive AES-GCM Key from Password using PBKDF2
export async function deriveKeyFromPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  return await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(salt), // We can use the user's email or UID as salt
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

// Encrypt Private Key (JWK object converted to string)
export async function encryptPrivateKey(privateKeyJwk, passwordKey) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    passwordKey,
    enc.encode(JSON.stringify(privateKeyJwk))
  );
  return {
    encryptedKey: arrayBufferToBase64(encrypted),
    iv: arrayBufferToBase64(iv)
  };
}

// Decrypt Private Key
export async function decryptPrivateKey(encryptedKeyBase64, ivBase64, passwordKey) {
  const encryptedBuffer = base64ToArrayBuffer(encryptedKeyBase64);
  const ivBuffer = base64ToArrayBuffer(ivBase64);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(ivBuffer) },
    passwordKey,
    encryptedBuffer
  );
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(decrypted));
}

// Generate a random AES-GCM Message Key for a single message
export async function generateMessageKey() {
  return await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

// Encrypt the Message Key with an RSA Public Key
export async function encryptMessageKey(messageKey, publicKey) {
  const exportedMessageKey = await window.crypto.subtle.exportKey("raw", messageKey);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    exportedMessageKey
  );
  return arrayBufferToBase64(encrypted);
}

// Decrypt the Message Key with the RSA Private Key
export async function decryptMessageKey(encryptedMessageKeyBase64, privateKey) {
  const encryptedBuffer = base64ToArrayBuffer(encryptedMessageKeyBase64);
  const decryptedRaw = await window.crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    encryptedBuffer
  );
  return await window.crypto.subtle.importKey(
    "raw",
    decryptedRaw,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"]
  );
}

// Encrypt message text
export async function encryptMessageText(text, messageKey) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    messageKey,
    enc.encode(text)
  );
  return {
    ciphertext: arrayBufferToBase64(encrypted),
    iv: arrayBufferToBase64(iv)
  };
}

// Decrypt message text
export async function decryptMessageText(ciphertextBase64, ivBase64, messageKey) {
  const ciphertextBuffer = base64ToArrayBuffer(ciphertextBase64);
  const ivBuffer = base64ToArrayBuffer(ivBase64);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(ivBuffer) },
    messageKey,
    ciphertextBuffer
  );
  const dec = new TextDecoder();
  return dec.decode(decrypted);
}

