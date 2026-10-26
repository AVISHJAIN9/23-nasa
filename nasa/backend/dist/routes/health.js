import { Router } from 'express';
export const healthRouter = Router();
/**
 * Liveness probe endpoint. Always returns status: ok if process is serving HTTP traffic.
 */
healthRouter.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});
