import { describe, expect, it } from 'vitest';
import { emailSchema } from '../src/utils/validation.js';

describe('E-Mail-Pruefung', () => {
  it('erlaubt gewoehnliche Adressen', () => {
    expect(emailSchema.safeParse('samu@example.com').success).toBe(true);
  });

  it('erlaubt lokale Adressen ohne Top-Level-Domain', () => {
    expect(emailSchema.safeParse('admin@localhost').success).toBe(true);
  });

  it('lehnt Adressen ohne At-Zeichen ab', () => {
    expect(emailSchema.safeParse('adminlocalhost').success).toBe(false);
  });

  it('lehnt Adressen mit Leerzeichen ab', () => {
    expect(emailSchema.safeParse('admin @localhost').success).toBe(false);
  });
})
