import { z, ZodError } from 'zod';
/**
 * Validation middleware using Zod schemas.
 * Validates body, query, and params without mutating read-only Express 5 request objects.
 * Parsed data is attached to `res.locals.validated`.
 */
export function validate(schemas) {
    const schemaShape = {};
    if (schemas.body)
        schemaShape['body'] = schemas.body;
    if (schemas.query)
        schemaShape['query'] = schemas.query;
    if (schemas.params)
        schemaShape['params'] = schemas.params;
    const compositeSchema = z.object(schemaShape);
    return (req, res, next) => {
        const target = {};
        if (schemas.body !== undefined)
            target['body'] = req.body;
        if (schemas.query !== undefined)
            target['query'] = req.query;
        if (schemas.params !== undefined)
            target['params'] = req.params;
        try {
            const parsed = compositeSchema.parse(target);
            res.locals.validated = {
                ...(res.locals.validated || {}),
                ...parsed,
            };
            next();
        }
        catch (err) {
            if (err instanceof ZodError) {
                next(err);
            }
            else {
                next(err);
            }
        }
    };
}
