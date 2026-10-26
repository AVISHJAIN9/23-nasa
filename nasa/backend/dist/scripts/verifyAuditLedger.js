import { loadConfig } from '../core/config.js';
import { connectMongo, disconnectMongo } from '../core/db.js';
import { verifyAuditLedger, MongoAuditWriter } from '../core/audit.js';
import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../core/logger.js';
import { MongoMemoryServer } from 'mongodb-memory-server';
async function runDemo(tamper = false) {
    const memServer = await MongoMemoryServer.create();
    await connectMongo(memServer.getUri());
    try {
        const writer = new MongoAuditWriter();
        console.log('[DEMO] Writing 5 cryptographically chained audit blocks...');
        await writer.write({
            actor_id: 'cmo-001',
            action: 'PROTOCOL_STEP_COMPLETED',
            target_id: 'crew-001',
            metadata: { protocol: 'cardiovascular', step: 'administer_epinephrine' },
        });
        await writer.write({
            actor_id: 'cmo-001',
            action: 'VITALS_STABILIZED',
            target_id: 'crew-001',
            metadata: { hr: 88, spo2: 98 },
        });
        await writer.write({
            actor_id: 'surgeon-earth',
            action: 'PRESCRIPTION_LOGGED',
            target_id: 'crew-001',
            metadata: { drug: 'amiodarone' },
        });
        await writer.write({
            actor_id: 'admin',
            action: 'FEATURE_FLAG_TOGGLED',
            target_id: 'system',
            metadata: { flag: 'link_loss_simulation' },
        });
        await writer.write({
            actor_id: 'cmo-001',
            action: 'MISSION_CHECKLIST_CLOSED',
            target_id: 'crew-001',
        });
        if (tamper) {
            console.log('[DEMO] ⚠️ Simulating unauthorized DB modification on Block #3...');
            const block3 = await AuditLog.findOne({ sequence_number: 3 });
            if (block3) {
                block3.action = 'MALICIOUS_RECORD_ALTERATION';
                await block3.save();
            }
        }
        const result = await verifyAuditLedger();
        if (result.valid) {
            console.log(`\n✅ [AUDIT LEDGER] Verified ${result.total_records} blocks — INTEGRITY OK`);
            console.log(`   Latest Hash: ${result.latest_hash}\n`);
            process.exit(0);
        }
        else {
            console.log(`\n❌ [AUDIT LEDGER] TAMPERING DETECTED at sequence #${result.broken_at_sequence}!`);
            console.log(`   Reason: ${result.reason}`);
            console.log(`   Details:`, result.details, '\n');
            process.exit(1);
        }
    }
    finally {
        await disconnectMongo();
        await memServer.stop();
    }
}
async function main() {
    const args = process.argv.slice(2);
    const isDemo = args.includes('--demo');
    const isDemoTamper = args.includes('--demo-tamper');
    if (isDemo || isDemoTamper) {
        await runDemo(isDemoTamper);
        return;
    }
    const settings = loadConfig();
    try {
        await connectMongo(settings.mongodb_uri);
    }
    catch (connErr) {
        logger.warn({ uri: settings.mongodb_uri, err: connErr.message }, 'MongoDB connection unavailable on specified URI. Running in demo mode with in-memory ledger.');
        await runDemo(false);
        return;
    }
    try {
        logger.info('Verifying cryptographic hash-chained audit ledger...');
        const result = await verifyAuditLedger();
        if (result.valid) {
            logger.info({
                total_records: result.total_records,
                verified_count: result.verified_count,
                genesis_hash: result.genesis_hash,
                latest_hash: result.latest_hash,
            }, '✅ Audit ledger integrity verification PASSED: All blocks contiguous and untampered.');
            process.exit(0);
        }
        else {
            logger.error({
                total_records: result.total_records,
                verified_count: result.verified_count,
                broken_at_sequence: result.broken_at_sequence,
                broken_record_id: result.broken_record_id,
                reason: result.reason,
                details: result.details,
            }, '❌ Audit ledger integrity verification FAILED: Cryptographic tampering or sequence break detected!');
            process.exit(1);
        }
    }
    catch (err) {
        logger.error({ err }, 'Error during audit ledger verification');
        process.exit(1);
    }
    finally {
        await disconnectMongo();
    }
}
main().catch((err) => {
    console.error('Unhandled script error:', err);
    process.exit(1);
});
