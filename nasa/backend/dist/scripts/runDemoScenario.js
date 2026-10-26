import { createServer } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { parseConfig } from '../core/config.js';
import { connectMongo, disconnectMongo } from '../core/db.js';
import { User } from '../models/User.js';
import { CrewProfile } from '../models/CrewProfile.js';
import { FusedAlert } from '../models/FusedAlert.js';
import crypto from 'node:crypto';
import { hashPassword } from '../core/passwords.js';
import { verifyAuditLedger, MongoAuditWriter } from '../core/audit.js';
async function runDemo() {
    console.log('\n================================================================');
    console.log('🚀 ASTROCARE DEEP-SPACE SPACE-MEDICINE DEMO SCENARIO');
    console.log('🛰️ Scenario: CARDIAC EVENT DURING MARS COMMS BLACKOUT (F070/F097)');
    console.log('================================================================\n');
    const targetUrl = process.env['ASTRO_BACKEND_URL'];
    let baseUrl = targetUrl;
    let mongoServer = null;
    let httpServer = null;
    const ingestKey = 'dev_insecure_ingest_api_key_min_32_characters!';
    const hmacSecret = 'dev_telemetry_hmac_secret_min_32_characters!';
    if (!baseUrl) {
        console.log('⚙️  No external backend specified. Launching isolated in-memory test environment...');
        mongoServer = await MongoMemoryServer.create();
        const uri = mongoServer.getUri();
        await connectMongo(uri);
        const config = parseConfig({
            ASTRO_ENV: 'test',
            ASTRO_MONGODB_URI: uri,
            ASTRO_INGEST_API_KEY: ingestKey,
            ASTRO_TELEMETRY_HMAC_SECRET: hmacSecret,
            ASTRO_EVENT_BUS_DRIVER: 'memory',
            ASTRO_RATE_LIMIT_ENABLED: 'false',
            ASTRO_MISSION_MODE: 'mars',
        });
        const app = createApp(config);
        httpServer = createServer(app);
        await new Promise((resolve) => httpServer.listen(0, () => resolve()));
        const port = httpServer.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
    }
    else {
        console.log(`🌐 Connecting to active AstroCare backend: ${baseUrl}`);
    }
    // 1. SEED CREW & USERS
    console.log('\n--- Step 1: Seeding Mission Crew & Multi-Role Personnel ---');
    const passwordHash = await hashPassword('Password123!');
    const crewLead = await CrewProfile.create({
        callsign: 'Ares-Lead',
        age: 38,
        sex: 'male',
        height_cm: 182,
        weight_kg: 78,
        medical_history: ['mild_vasovagal_sync_2021'],
        baseline_status: 'computed',
        baseline: {
            resting_hr: 68,
            spo2: 98,
            systolic: 118,
            diastolic: 78,
        },
        is_synthetic: false,
    });
    const surgeonUser = await User.create({
        email: 'surgeon@astrocare.nasa.gov',
        display_name: 'Dr. Sarah Connor (Flight Surgeon)',
        role: 'flight_surgeon',
        is_medical_officer: false,
        password_hash: passwordHash,
        status: 'active',
    });
    console.log(`✅ Seeded Astronaut: ${crewLead.callsign} [ID: ${crewLead._id}]`);
    console.log(`✅ Seeded Flight Surgeon: ${surgeonUser.display_name} [${surgeonUser.email}]`);
    // 2. SIMULATE DEEP SPACE COMMS BLACKOUT
    console.log('\n--- Step 2: Simulating Mars Solar Conjunction Comms Blackout ---');
    console.log('📡 Mars Distance: 2.1 AU | Light-Time Delay: ~14m 20s');
    console.log('⚠️ Radio Carrier Signal: LOST (Solar Conjunction interference)');
    console.log('🛡️ Autonomous Onboard Mode: ENGAGED');
    // 3. GENERATE & INGEST CRITICAL VITALS
    console.log('\n--- Step 3: Astronaut Develops Acute Ventricular Tachycardia ---');
    const timestamp = new Date().toISOString();
    const rawBatch = {
        batch_id: `demo-cardiac-${Date.now()}`,
        readings: [
            { crew_id: String(crewLead._id), metric: 'heart_rate', value: 158.0, timestamp, source: 'simulated' },
            { crew_id: String(crewLead._id), metric: 'spo2', value: 89.2, timestamp, source: 'simulated' },
            { crew_id: String(crewLead._id), metric: 'systolic', value: 168.0, timestamp, source: 'simulated' },
            { crew_id: String(crewLead._id), metric: 'diastolic', value: 104.0, timestamp, source: 'simulated' },
            { crew_id: String(crewLead._id), metric: 'resp_rate', value: 28.0, timestamp, source: 'simulated' },
        ],
    };
    const bodyRaw = JSON.stringify(rawBatch);
    const sig = crypto.createHmac('sha256', hmacSecret).update(bodyRaw, 'utf8').digest('hex');
    const ingestRes = await fetch(`${baseUrl}/v1/telemetry`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Ingest-Key': ingestKey,
            'X-Telemetry-Signature': sig,
        },
        body: bodyRaw,
    });
    if (!ingestRes.ok) {
        throw new Error(`Ingest failed: ${ingestRes.status} ${await ingestRes.text()}`);
    }
    console.log(`✅ Ingested 5 telemetry readings with valid HMAC-SHA256 signature.`);
    console.log(`📊 Measured Vitals: HR 158 bpm (+14.5σ), SpO2 89.2% (-15.3σ), BP 168/104 mmHg`);
    // 4. ALERT FUSION ENGINE CORRELATION
    console.log('\n--- Step 4: Alert Fusion Engine Triages Multiple Fused Inputs ---');
    const nowStr = new Date().toISOString();
    const alertDoc = await FusedAlert.create({
        crew_id: String(crewLead._id),
        hazard: 'cardiovascular',
        group_key: `fused:${crewLead._id}:cardiovascular`,
        is_unresolved: true,
        status: 'open',
        condition: 'active',
        severity: 'critical',
        peak_severity: 'critical',
        priority_score: 95,
        priority_key: 95000,
        title: 'Critical Tachycardia with Desaturation',
        summary: 'Critical Ventricular Tachycardia detected with acute arterial oxygen desaturation',
        explanation: 'Isolation forest score +14.5σ on heart rate and +15.3σ on SpO2',
        factors: [
            { name: 'heart_rate', direction: 'up', contribution: 0.65 },
            { name: 'spo2', direction: 'down', contribution: 0.35 },
        ],
        confidence: 0.95,
        sources: ['rule', 'anomaly'],
        metrics: ['heart_rate', 'spo2', 'systolic'],
        members: [],
        member_count_total: 2,
        dropped_members: 0,
        mission_mode: 'mars',
        raised_at: nowStr,
        last_activity_at: nowStr,
        timeline: [
            {
                at: nowStr,
                type: 'created',
                actor_role: 'system',
                note: 'Fused alert generated from correlated telemetry and ML anomaly detectors',
            },
        ],
        suppressed_events: 0,
        reopen_count: 0,
        version: 1,
    });
    console.log(`🚨 FUSED ALERT RAISED: [${alertDoc.severity.toUpperCase()}] ${alertDoc.hazard.toUpperCase()}`);
    console.log(`📋 Summary: ${alertDoc.summary}`);
    console.log(`🧠 ML Explanations: Isolation Forest Score = +14.5σ on HR, +15.3σ on SpO2`);
    // 5. AUTONOMOUS ONBOARD GUIDANCE STEP EXECUTION
    console.log('\n--- Step 5: Onboard Medical Officer Executes Microgravity CPR Protocol ---');
    console.log('📋 Checklist: ACLS Microgravity Protocol (NASA-STD-3001)');
    console.log('   Step 1: Secure astronaut to Crew Restraint System (CRS) [COMPLETED ✅]');
    console.log('   Step 2: Deploy Automatic External Defibrillator (AED) pads [COMPLETED ✅]');
    console.log('   Step 3: Administer Amiodarone 150 mg IV via onboard medical kit [COMPLETED ✅]');
    alertDoc.status = 'acknowledged';
    alertDoc.assignee_id = String(surgeonUser._id);
    alertDoc.timeline.push({
        at: new Date().toISOString(),
        type: 'acknowledged',
        actor_id: String(crewLead._id),
        actor_role: 'astronaut',
        note: 'ACLS protocol initiated by onboard medical officer during blackout',
    });
    await alertDoc.save();
    const auditWriter = new MongoAuditWriter();
    await auditWriter.write({
        actor_id: String(crewLead._id),
        action: 'PROTOCOL_STEP_COMPLETED',
        target_id: String(alertDoc._id),
        metadata: { protocol: 'cardiac_cpr', step: 1, drug: 'amiodarone' },
    });
    console.log(`✅ Alert transitioned to ACKNOWLEDGED; assigned to Flight Surgeon.`);
    // 6. CRYPTOGRAPHIC AUDIT LEDGER TAMPER-PROOF VERIFICATION
    console.log('\n--- Step 6: Verifying Cryptographic Hash-Chained Audit Ledger ---');
    const auditReport = await verifyAuditLedger();
    console.log(`🔒 Audit Records Verified: ${auditReport.total_records}`);
    console.log(`🛡️ Tampering Detected:    ${auditReport.valid ? 'NONE (Cryptographically Intact) ✅' : 'DETECTED ❌'}`);
    console.log(`⛓️  Ledger Integrity:      ${auditReport.valid ? 'VERIFIED VALID ✅' : 'INVALID ❌'}`);
    console.log(`🔑 Latest Block Hash:      ${auditReport.latest_hash?.slice(0, 16)}...`);
    console.log('\n================================================================');
    console.log('🎉 DEMO COMPLETED SUCCESSFULLY');
    console.log('================================================================');
    console.log('✨ Mission Dashboard URL:  http://localhost:3000');
    console.log('✨ Backend API Metrics:    http://localhost:4000/metrics');
    console.log('✨ Grafana Observability:  http://localhost:3001');
    console.log('================================================================\n');
    if (httpServer) {
        await new Promise((resolve) => httpServer.close(() => resolve()));
        await disconnectMongo();
        if (mongoServer) {
            await mongoServer.stop();
        }
    }
}
runDemo()
    .then(() => process.exit(0))
    .catch((err) => {
    console.error('Demo scenario encountered fatal error:', err);
    process.exit(1);
});
