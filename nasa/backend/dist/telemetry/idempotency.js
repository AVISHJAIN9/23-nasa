import crypto from 'node:crypto';
import { IdempotencyRecord } from '../models/IdempotencyRecord.js';
import { ConflictError, ServiceUnavailableError } from '../core/errors.js';
import { logger } from '../core/logger.js';
/**
 * Deterministically serializes an arbitrary object to a canonical JSON string
 * by recursively sorting object keys.
 */
export function canonicalJson(obj) {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        return `[${obj.map((item) => canonicalJson(item)).join(',')}]`;
    }
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
    return `{${pairs.join(',')}}`;
}
/**
 * Computes a SHA-256 hash of a payload in canonical JSON representation.
 */
export function computePayloadHash(payload) {
    const serialized = canonicalJson(payload);
    return crypto.createHash('sha256').update(serialized).digest('hex');
}
/**
 * Resolves the idempotency key using the priority order:
 * 1. Explicit Idempotency-Key header
 * 2. Payload body batch_id
 * 3. Implicit SHA-256 hash of the canonical JSON payload
 */
export function resolveIdempotencyKey(headerKey, bodyBatchId, payloadHash) {
    if (headerKey && headerKey.trim().length > 0) {
        return headerKey.trim();
    }
    if (bodyBatchId && bodyBatchId.trim().length > 0) {
        return bodyBatchId.trim();
    }
    return payloadHash;
}
export class MongoIdempotencyStore {
    /**
     * Attempts to reserve an idempotency slot as "processing".
     *
     * LEASE TAKEOVER RULE:
     * If a concurrent request finds an existing record in "processing" status that is
     * older than 60 seconds (abandoned due to crash or timeout), this request assumes
     * the lease and proceeds with processing.
     */
    async reserve(scope, key, payloadHash) {
        const now = new Date();
        try {
            await IdempotencyRecord.create({
                scope,
                key,
                request_hash: payloadHash,
                status: 'processing',
                created_at: now,
                updated_at: now,
            });
            return {
                isReplay: false,
                scope,
                key,
            };
        }
        catch (err) {
            // MongoDB duplicate key error code 11000
            const isDuplicate = err && typeof err === 'object' && 'code' in err && err.code === 11000;
            if (!isDuplicate) {
                logger.error({ err, scope, key }, 'Failed to reserve idempotency record');
                throw new ServiceUnavailableError('Database service error during idempotency check');
            }
            // Record exists; query existing state
            const existing = await IdempotencyRecord.findOne({ scope, key });
            if (!existing) {
                // Race condition: previous record was deleted/rolled back just now; retry once
                return this.reserve(scope, key, payloadHash);
            }
            // Check payload consistency
            if (existing.request_hash !== payloadHash) {
                throw new ConflictError('Idempotency key has already been used with a different request payload');
            }
            // Completed request replay
            if (existing.status === 'done') {
                return {
                    isReplay: true,
                    response: existing.response,
                    scope,
                    key,
                };
            }
            // Status is "processing" - check for lease expiration (60 seconds)
            const ageMs = Date.now() - existing.created_at.getTime();
            if (ageMs > 60_000) {
                // Lease expired; take over processing lease
                const takenOver = await IdempotencyRecord.findOneAndUpdate({ scope, key, created_at: existing.created_at }, {
                    $set: {
                        status: 'processing',
                        request_hash: payloadHash,
                        created_at: now,
                        updated_at: now,
                    },
                }, { new: true });
                if (takenOver) {
                    logger.warn({ scope, key, ageMs }, 'Assumed expired idempotency lease for request');
                    return {
                        isReplay: false,
                        scope,
                        key,
                    };
                }
            }
            // Concurrently processing
            throw new ConflictError('A request with this idempotency key is currently processing. Please retry shortly.', [
                {
                    field: 'idempotency_key',
                    issue: 'Concurrent request in progress. Retry-After hint: 2 seconds',
                },
            ]);
        }
    }
    async complete(scope, key, response) {
        await IdempotencyRecord.updateOne({ scope, key }, {
            $set: {
                status: 'done',
                response,
                updated_at: new Date(),
            },
        });
    }
    /**
     * Deletes the reservation if an infrastructure or processing exception occurs,
     * allowing a client retry to succeed.
     *
     * KNOWN LIMITATION & EDGE CASE:
     * If a MongoDB insertMany({ ordered: false }) partially succeeded before an infra error,
     * rolling back the idempotency record will permit a subsequent retry that may re-insert
     * duplicate readings in the time-series collection.
     */
    async rollback(scope, key) {
        try {
            await IdempotencyRecord.deleteOne({ scope, key });
        }
        catch (err) {
            logger.error({ err, scope, key }, 'Failed to rollback idempotency record');
        }
    }
}
