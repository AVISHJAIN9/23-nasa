import crypto from 'node:crypto';
import { getRequestId } from './requestContext.js';
import { AuditLog } from '../models/AuditLog.js';
export const GENESIS_HASH = '0'.repeat(64);
/**
 * Deterministically serializes an arbitrary object with sorted keys so identical
 * payloads always yield identical cryptographic digests regardless of key insertion order.
 */
export function canonicalJson(obj) {
    if (obj === null || obj === undefined)
        return '';
    if (typeof obj !== 'object')
        return JSON.stringify(obj);
    if (obj instanceof Date)
        return JSON.stringify(obj.toISOString());
    if (Array.isArray(obj)) {
        return '[' + obj.map(canonicalJson).join(',') + ']';
    }
    const keys = Object.keys(obj).sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
    return '{' + entries.join(',') + '}';
}
/**
 * Computes a deterministic SHA-256 hash for an audit ledger block.
 */
export function computeAuditHash(fields) {
    const atIso = fields.at instanceof Date ? fields.at.toISOString() : new Date(fields.at).toISOString();
    const metaStr = canonicalJson(fields.metadata ?? {});
    const payload = [
        fields.sequence_number,
        fields.prev_hash,
        atIso,
        fields.actor_id,
        fields.action,
        fields.target_id,
        fields.request_id ?? '',
        metaStr,
    ].join('|');
    return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}
/**
 * Pure verification function that walks an array of audit ledger records from sequence 1 to N,
 * verifying sequence contiguity, prev_hash linking, and SHA-256 block hash integrity.
 */
export function verifyAuditChain(records) {
    const total = records.length;
    if (total === 0) {
        return {
            valid: true,
            verified_count: 0,
            total_records: 0,
            genesis_hash: GENESIS_HASH,
            latest_hash: GENESIS_HASH,
        };
    }
    let expectedPrevHash = GENESIS_HASH;
    for (let i = 0; i < total; i++) {
        const record = records[i];
        const expectedSeq = i + 1;
        // 1. Contiguous sequence numbering check
        if (record.sequence_number !== expectedSeq) {
            return {
                valid: false,
                verified_count: i,
                total_records: total,
                genesis_hash: GENESIS_HASH,
                latest_hash: i > 0 ? records[i - 1].hash : GENESIS_HASH,
                broken_at_sequence: record.sequence_number,
                broken_record_id: record._id ? String(record._id) : undefined,
                reason: 'SEQUENCE_GAP',
                details: { expected_sequence: expectedSeq, actual_sequence: record.sequence_number },
            };
        }
        // 2. Previous hash link check
        if (record.prev_hash !== expectedPrevHash) {
            return {
                valid: false,
                verified_count: i,
                total_records: total,
                genesis_hash: GENESIS_HASH,
                latest_hash: i > 0 ? records[i - 1].hash : GENESIS_HASH,
                broken_at_sequence: record.sequence_number,
                broken_record_id: record._id ? String(record._id) : undefined,
                reason: 'PREV_HASH_MISMATCH',
                details: { expected_prev_hash: expectedPrevHash, actual_prev_hash: record.prev_hash },
            };
        }
        // 3. Cryptographic hash re-computation check
        const calculatedHash = computeAuditHash({
            sequence_number: record.sequence_number,
            prev_hash: record.prev_hash,
            at: record.at,
            actor_id: record.actor_id,
            action: record.action,
            target_id: record.target_id,
            request_id: record.request_id,
            metadata: record.metadata,
        });
        if (record.hash !== calculatedHash) {
            return {
                valid: false,
                verified_count: i,
                total_records: total,
                genesis_hash: GENESIS_HASH,
                latest_hash: i > 0 ? records[i - 1].hash : GENESIS_HASH,
                broken_at_sequence: record.sequence_number,
                broken_record_id: record._id ? String(record._id) : undefined,
                reason: 'HASH_MISMATCH',
                details: { expected_hash: calculatedHash, recorded_hash: record.hash },
            };
        }
        expectedPrevHash = record.hash;
    }
    return {
        valid: true,
        verified_count: total,
        total_records: total,
        genesis_hash: GENESIS_HASH,
        latest_hash: records[total - 1].hash,
    };
}
/**
 * Verifies all records in the persistent MongoDB audit ledger.
 */
export async function verifyAuditLedger() {
    const records = await AuditLog.find().sort({ sequence_number: 1 }).lean();
    return verifyAuditChain(records);
}
/**
 * Cryptographic hash-chained MongoDB audit ledger writer.
 * Guarantees atomic, tamper-evident record logging with monotonic sequence numbers and SHA-256 linkage.
 */
export class MongoAuditWriter {
    writeQueue = Promise.resolve();
    async write(entry) {
        return new Promise((resolve, reject) => {
            this.writeQueue = this.writeQueue
                .then(async () => {
                await this.writeRecordWithRetry(entry);
                resolve();
            })
                .catch((err) => {
                reject(err);
            });
        });
    }
    async writeRecordWithRetry(entry, maxRetries = 5) {
        let attempts = 0;
        while (attempts < maxRetries) {
            attempts++;
            try {
                const lastRecord = (await AuditLog.findOne()
                    .sort({ sequence_number: -1 })
                    .select('sequence_number hash')
                    .lean());
                const sequence_number = (lastRecord?.sequence_number ?? 0) + 1;
                const prev_hash = lastRecord?.hash ?? GENESIS_HASH;
                const at = entry.at ?? new Date();
                const request_id = entry.request_id ?? getRequestId();
                const hash = computeAuditHash({
                    sequence_number,
                    prev_hash,
                    at,
                    actor_id: entry.actor_id,
                    action: entry.action,
                    target_id: entry.target_id,
                    request_id,
                    metadata: entry.metadata,
                });
                await AuditLog.create({
                    sequence_number,
                    prev_hash,
                    hash,
                    actor_id: entry.actor_id,
                    action: entry.action,
                    target_id: entry.target_id,
                    at,
                    request_id,
                    metadata: entry.metadata ?? {},
                });
                return;
            }
            catch (err) {
                const mongoErr = err;
                if (mongoErr.code === 11000 && attempts < maxRetries) {
                    // Concurrency collision on unique sequence_number index; backoff and retry
                    await new Promise((r) => setTimeout(r, 25 * attempts));
                    continue;
                }
                throw err;
            }
        }
    }
}
/**
 * In-memory hash-chained audit writer for isolated unit testing.
 */
export class InMemoryAuditWriter {
    entries = [];
    async write(entry) {
        const last = this.entries[this.entries.length - 1];
        const sequence_number = (last?.sequence_number ?? 0) + 1;
        const prev_hash = last?.hash ?? GENESIS_HASH;
        const at = entry.at ?? new Date();
        const request_id = entry.request_id ?? getRequestId();
        const hash = computeAuditHash({
            sequence_number,
            prev_hash,
            at,
            actor_id: entry.actor_id,
            action: entry.action,
            target_id: entry.target_id,
            request_id,
            metadata: entry.metadata,
        });
        this.entries.push({
            ...entry,
            at,
            request_id,
            sequence_number,
            prev_hash,
            hash,
        });
    }
    verify() {
        return verifyAuditChain(this.entries);
    }
    clear() {
        this.entries.length = 0;
    }
}
