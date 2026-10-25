import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodError } from 'zod';

export interface ValidatedData<TBody = unknown, TQuery = unknown, TParams = unknown> {
  body?: TBody;
  query?: TQuery;
  params?: TParams;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      validated?: ValidatedData;
    }
  }
}

export interface ValidateSchemas {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
}

/**
 * Validation middleware using Zod schemas.
 * Validates body, query, and params without mutating read-only Express 5 request objects.
 * Parsed data is attached to `res.locals.validated`.
 */
export function validate(schemas: ValidateSchemas): RequestHandler {
  const schemaShape: Record<string, z.ZodTypeAny> = {};
  if (schemas.body) schemaShape['body'] = schemas.body;
  if (schemas.query) schemaShape['query'] = schemas.query;
  if (schemas.params) schemaShape['params'] = schemas.params;

  const compositeSchema = z.object(schemaShape);

  return (req: Request, res: Response, next: NextFunction): void => {
    const target: Record<string, unknown> = {};
    if (schemas.body !== undefined) target['body'] = req.body;
    if (schemas.query !== undefined) target['query'] = req.query;
    if (schemas.params !== undefined) target['params'] = req.params;

    try {
      const parsed = compositeSchema.parse(target) as ValidatedData;
      res.locals.validated = {
        ...(res.locals.validated || {}),
        ...parsed,
      };
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(err);
      } else {
        next(err);
      }
    }
  };
}
