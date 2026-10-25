import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { TokenExpiredError as AppTokenExpiredError, UnauthenticatedError } from './errors.js';
import type { Role } from './roles.js';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  mo: boolean;
  iat?: number;
  exp?: number;
}

/**
 * Signs an AstroCare access token with HS256.
 */
export function signAccessToken(
  payload: { userId: string; role: Role; isMedicalOfficer: boolean },
  secret: string,
  expiresIn = '15m',
): string {
  const claims = {
    sub: payload.userId,
    role: payload.role,
    mo: payload.isMedicalOfficer,
  };

  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: expiresIn as SignOptions['expiresIn'],
  };

  return jwt.sign(claims, secret, options);
}

/**
 * Verifies an AstroCare access token with explicit HS256 algorithm enforcement.
 */
export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    });
    return decoded as AccessTokenPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppTokenExpiredError('Access token has expired');
    }
    throw new UnauthenticatedError('Invalid or malformed access token');
  }
}

/**
 * Generates an opaque, cryptographically random refresh token.
 */
export function generateRawRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex');
}

/**
 * Generates a new refresh token family identifier.
 */
export function generateTokenFamilyId(): string {
  return crypto.randomUUID();
}

/**
 * Computes a SHA-256 hash of a refresh token.
 * Raw refresh tokens are never stored in the database.
 */
export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
