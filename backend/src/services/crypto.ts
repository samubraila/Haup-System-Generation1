import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config/index.js';

/**
 * Verschluesselung der OAuth-Tokens (AES-256-GCM).
 *
 * Tokens liegen niemals im Klartext in der Datenbank und werden nie an das
 * Frontend ausgeliefert. Nur die interne Worker-API gibt sie -- gegen
 * API-Key -- an den zustaendigen Publisher-Container weiter.
 *
 * Format: v1.<iv-base64>.<authTag-base64>.<ciphertext-base64>
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

const key = Buffer.from(config.ENCRYPTION_KEY, 'hex');
if (key.length !== 32) {
  throw new Error('ENCRYPTION_KEY muss 32 Byte (64 Hex-Zeichen) lang sein');
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Verschluesselter Wert hat ein unbekanntes Format');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64!, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64!, 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(dataB64!, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // Tritt auf, wenn ENCRYPTION_KEY nachtraeglich geaendert wurde.
    throw new Error(
      'Token konnte nicht entschluesselt werden. Wurde ENCRYPTION_KEY geaendert? ' +
        'Dann muessen die betroffenen Social-Media-Konten neu verbunden werden.',
    );
  }
}

export function maybeDecrypt(payload: string | null): string | null {
  if (!payload) return null;
  return decryptSecret(payload);
}

/** Zeitkonstanter Vergleich, z.B. fuer den internen API-Key. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
