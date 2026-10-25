import { Router, type Request, type Response } from 'express';

export const healthRouter: Router = Router();

/**
 * Liveness probe endpoint. Always returns status: ok if process is serving HTTP traffic.
 */
healthRouter.get('/health', (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok' });
});
