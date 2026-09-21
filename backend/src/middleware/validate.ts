import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodSchema } from 'zod';

/**
 * Validiert Body, Query oder Parameter gegen ein Zod-Schema und ersetzt den
 * Rohwert durch die geparste, typsichere Fassung.
 */
export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(result.error);
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(result.error);
      return;
    }
    // req.query ist in Express 4 ein Getter -- Werte einzeln uebernehmen.
    Object.assign(req.query, result.data);
    (req as Request & { validatedQuery?: T }).validatedQuery = result.data;
    next();
  };
}

/** Liest die von validateQuery geprueften Werte typsicher aus. */
export function validated<T>(req: Request): T {
  return (req as Request & { validatedQuery?: T }).validatedQuery as T;
}
