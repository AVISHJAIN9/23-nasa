import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { TokenExpiredError as AppTokenExpiredError, UnauthenticatedError } from './errors.js';
/**
 * Signs an AstroCare access token with HS256.
 */
export function signAccessToken(payload, secret, expiresIn = '15m') {
    const claims = {
        sub: payload.userId,
        role: payload.role,
        mo: payload.isMedicalOfficer,
    };
    const options = {
        algorithm: 'HS256',
        expiresIn: expiresIn,
    };
    return jwt.sign(claims, secret, options);
}
/**
 * Verifies an AstroCare access token with explicit HS256 algorithm enforcement.
 */
export function verifyAccessToken(token, secret) {
    try {
        const decoded = jwt.verify(token, secret, {
            algorithms: ['HS256'],
        });
        return decoded;
    }
    catch (err) {
        if (err instanceof jwt.TokenExpiredError) {
            throw new AppTokenExpiredError('Access token has expired');
        }
        throw new UnauthenticatedError('Invalid or malformed access token');
    }
}
/**
 * Generates an opaque, cryptographically random refresh token.
 */
export function generateRawRefreshToken() {
    return crypto.randomBytes(40).toString('hex');
}
/**
 * Generates a new refresh token family identifier.
 */
export function generateTokenFamilyId() {
    return crypto.randomUUID();
}
/**
 * Computes a SHA-256 hash of a refresh token.
 * Raw refresh tokens are never stored in the database.
 */
export function hashRefreshToken(rawToken) {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
}
