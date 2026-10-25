import { Router, type Request, type Response, type NextFunction } from 'express';
import { registerRoute } from '../../core/openapi.js';
import { requireRole } from '../../core/security.js';
import {
  type AuditWriter,
  InMemoryAuditWriter,
  verifyAuditLedger,
  type AuditVerificationResult,
} from '../../core/audit.js';
import { AuditVerificationResponseSchema } from '../../schemas/audit.js';

export interface AuditRouterOptions {
  auditWriter?: AuditWriter;
}

/**
 * Creates the /v1/audit router providing cryptographic ledger verification.
 */
export function createV1AuditRouter(options?: AuditRouterOptions): Router {
  const router = Router();
  const auditWriter = options?.auditWriter;

  registerRoute({
    method: 'get',
    path: '/v1/audit/verify',
    tags: ['Audit', 'Security'],
    summary: 'Verify integrity of cryptographic hash-chained audit ledger',
    description:
      'Walks the contiguous chain of audit records from genesis block to current tip. Validates monotonic sequences, prev_hash linkages, and SHA-256 block hashes to detect tampering.',
    successResponse: {
      status: 200,
      description: 'Audit ledger verification report',
      schema: AuditVerificationResponseSchema,
    },
  });

  router.get(
    '/verify',
    requireRole('admin', 'flight_surgeon'),
    async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        let result: AuditVerificationResult;
        if (auditWriter instanceof InMemoryAuditWriter) {
          result = auditWriter.verify();
        } else {
          result = await verifyAuditLedger();
        }

        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
