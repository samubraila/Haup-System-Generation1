import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Faengt abgelehnte Promises aus async-Handlern und leitet sie an den Error-Handler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export function paged<T>(items: T[], total: number, page: number, pageSize: number): Paged<T> {
  return {
    items,
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Liest page/pageSize aus der Query mit sinnvollen Grenzen. */
export function readPagination(req: Request, defaultPageSize = 25, maxPageSize = 200) {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  const rawSize = Number.parseInt(String(req.query.pageSize ?? defaultPageSize), 10) || defaultPageSize;
  const pageSize = Math.min(maxPageSize, Math.max(1, rawSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
