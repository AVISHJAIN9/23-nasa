import crypto from 'node:crypto';
import { verifyAccessToken } from '../core/tokens.js';
import { UnauthenticatedError, ForbiddenError } from '../core/errors.js';
import { User } from '../models/User.js';
import { CrewProfile } from '../models/CrewProfile.js';
import { canonicalJson } from '../core/audit.js';
/**
 * Length-safe, timing-safe string comparison using SHA-256 digest buffers.
 */
export function timingSafeCompare(provided, expected) {
    if (!provided || !expected)
        return false;
    const hashProvided = crypto.createHash('sha256').update(provided).digest();
    const hashExpected = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(hashProvided, hashExpected);
}
/**
 * Verifies HMAC-SHA256 signature for telemetry batches from machine clients.
 * Supports canonical JSON formatting and standard JSON stringification.
 */
export function verifyTelemetryHmac(payload, signatureHeader, secret) {
    if (!signatureHeader || !secret)
        return false;
    const cleanSignature = signatureHeader.startsWith('sha256=')
        ? signatureHeader.slice(7)
        : signatureHeader;
    // 1. Check canonical JSON serialization (key-order independent)
    const canonicalStr = canonicalJson(payload);
    const expectedCanonical = crypto
        .createHmac('sha256', secret)
        .update(canonicalStr, 'utf8')
        .digest('hex');
    // 2. Check standard JSON stringification
    const standardStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const expectedStandard = crypto
        .createHmac('sha256', secret)
        .update(standardStr, 'utf8')
        .digest('hex');
    return (timingSafeCompare(cleanSignature.toLowerCase(), expectedCanonical.toLowerCase()) ||
        timingSafeCompare(cleanSignature.toLowerCase(), expectedStandard.toLowerCase()));
}
/**
 * Resolves the authenticated principal from HTTP headers or WebSocket handshake auth.
 * Supports service callers (X-Ingest-Key with optional HMAC) and interactive users (Bearer JWT).
 */
export async function resolveIngestPrincipal(credentials, settings) {
    const { ingestKey, authHeader, token, signature, payload } = credentials;
    // 1. Service caller via X-Ingest-Key
    if (ingestKey !== undefined) {
        if (!timingSafeCompare(ingestKey, settings.ingest_api_key)) {
            throw new UnauthenticatedError('Invalid ingest API key');
        }
        const hmacSecret = settings.telemetry_hmac_secret || settings.ingest_api_key;
        if (settings.telemetry_hmac_required && !signature) {
            throw new UnauthenticatedError('HMAC signature required. Provide X-Telemetry-Signature header.');
        }
        if (signature) {
            const isValid = verifyTelemetryHmac(payload, signature, hmacSecret);
            if (!isValid) {
                throw new UnauthenticatedError('Invalid telemetry HMAC signature');
            }
        }
        return { type: 'service', scope: 'ingest_service' };
    }
    // 2. User caller via Bearer token
    let rawToken = token;
    if (!rawToken && authHeader) {
        const parts = authHeader.split(' ');
        if (parts.length === 2 && parts[0]?.toLowerCase() === 'bearer') {
            rawToken = parts[1];
        }
    }
    if (rawToken) {
        const payload = verifyAccessToken(rawToken, settings.jwt_access_secret);
        if (payload.role === 'admin') {
            return {
                type: 'user',
                userId: payload.sub,
                role: 'admin',
                scope: payload.sub,
            };
        }
        if (payload.role === 'astronaut') {
            // Find linked crew profile
            const user = await User.findById(payload.sub).select('crew_profile_id');
            let crewProfileId = user?.crew_profile_id?.toString();
            if (!crewProfileId) {
                const profile = await CrewProfile.findOne({ user_id: payload.sub }).select('_id');
                crewProfileId = profile?._id?.toString();
            }
            if (!crewProfileId) {
                throw new ForbiddenError('Astronaut user is not linked to an active crew profile');
            }
            return {
                type: 'user',
                userId: payload.sub,
                role: 'astronaut',
                crewProfileId,
                scope: payload.sub,
            };
        }
        // flight_surgeon, mission_control are forbidden from ingesting sensor telemetry
        throw new ForbiddenError(`Role "${payload.role}" is not authorized for telemetry ingestion`);
    }
    throw new UnauthenticatedError('Missing ingest credentials. Provide X-Ingest-Key header or Bearer JWT token.');
}
/**
 * Validates that the principal is authorized to submit telemetry for the specified crew profiles.
 * If an astronaut sends any reading for another crew, the entire batch is rejected with FORBIDDEN.
 */
export function assertPrincipalCanWriteCrew(principal, crewIds) {
    if (principal.type === 'service' || principal.role === 'admin') {
        return; // Service callers and admins may ingest for any crew
    }
    if (principal.role === 'astronaut') {
        for (const crewId of crewIds) {
            if (crewId !== principal.crewProfileId) {
                throw new ForbiddenError('Astronaut is only authorized to submit telemetry for their own crew profile');
            }
        }
    }
}
