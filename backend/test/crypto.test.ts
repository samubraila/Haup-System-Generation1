import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, maybeDecrypt, safeCompare } from '../src/services/crypto.js';

describe('Token-Verschluesselung', () => {
  it('stellt den Klartext wieder her', () => {
    const plain = 'ya29.a0AfH6SMB-beispiel-zugriffstoken';
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it('erzeugt fuer denselben Wert unterschiedliche Chiffren', () => {
    const plain = 'gleiches-token';
    expect(encryptSecret(plain)).not.toBe(encryptSecret(plain));
  });

  it('haelt das Versionsformat ein', () => {
    const parts = encryptSecret('x').split('.');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
  });

  it('lehnt manipulierte Daten ab', () => {
    const encrypted = encryptSecret('geheim');
    const parts = encrypted.split('.');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('boese').toString('base64')].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('lehnt ein unbekanntes Format ab', () => {
    expect(() => decryptSecret('v2.a.b.c')).toThrow('unbekanntes Format');
  });

  it('gibt null unveraendert zurueck', () => {
    expect(maybeDecrypt(null)).toBeNull();
  });

  it('vergleicht zeitkonstant', () => {
    expect(safeCompare('abc', 'abc')).toBe(true);
    expect(safeCompare('abc', 'abd')).toBe(false);
    expect(safeCompare('abc', 'abcd')).toBe(false);
  });
});
