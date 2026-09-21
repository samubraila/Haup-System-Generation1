import { z } from 'zod';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

export const emailSchema = z
  .string()
  .min(3)
  .max(254)
  .regex(EMAIL_PATTERN, 'Bitte eine gueltige E-Mail-Adresse angeben');
