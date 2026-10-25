import { Router, type Request, type Response, type NextFunction } from 'express';
import { registerRoute } from '../../core/openapi.js';
import { authenticate } from '../../core/security.js';
import { validate } from '../../middleware/validate.js';
import {
  LoginBodySchema,
  LoginResponseSchema,
  RefreshResponseSchema,
  LogoutResponseSchema,
  MeResponseSchema,
  type LoginBody,
} from '../../schemas/auth.js';
import { User } from '../../models/User.js';
import { RefreshToken } from '../../models/RefreshToken.js';
import { verifyPassword, verifyDummyPassword } from '../../core/passwords.js';
import {
  signAccessToken,
  generateRawRefreshToken,
  generateTokenFamilyId,
  hashRefreshToken,
} from '../../core/tokens.js';
import { UnauthenticatedError, RateLimitedError } from '../../core/errors.js';
import type { Settings } from '../../core/config.js';

export interface AuthRouterOptions {
  settings: Settings;
}

export function createV1AuthRouter(options: AuthRouterOptions): Router {
  const router = Router();
  const { settings } = options;

  // 1. POST /v1/auth/login
  registerRoute({
    method: 'post',
    path: '/v1/auth/login',
    tags: ['Auth'],
    summary: 'Authenticate crew member with email and password',
    description:
      'Validates credentials, checks account lockouts, returns an access token and sets a secure httpOnly refresh cookie.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: LoginBodySchema,
          },
        },
      },
    },
    successResponse: {
      status: 200,
      description: 'Login successful',
      schema: LoginResponseSchema,
    },
  });

  router.post(
    '/login',
    validate({ body: LoginBodySchema }),
    async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { email, password } = (res.locals.validated?.body as LoginBody) || {};

        const user = await User.findOne({ email: email.toLowerCase().trim() });

        if (!user) {
          // Prevent user enumeration with constant-time dummy verification
          await verifyDummyPassword(password);
          throw new UnauthenticatedError('Invalid email or password');
        }

        // Check account lockout
        if (user.locked_until && user.locked_until > new Date()) {
          const retrySeconds = Math.max(
            1,
            Math.ceil((user.locked_until.getTime() - Date.now()) / 1000),
          );
          res.setHeader('Retry-After', String(retrySeconds));
          throw new RateLimitedError(
            `Account temporarily locked due to excessive failed attempts. Please retry after ${retrySeconds} seconds.`,
          );
        }

        if (user.status === 'disabled') {
          throw new UnauthenticatedError(
            'User account has been disabled. Contact flight medical control.',
          );
        }

        const isMatch = await verifyPassword(password, user.password_hash);
        if (!isMatch) {
          user.failed_login_count += 1;
          if (user.failed_login_count >= 5) {
            user.locked_until = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes lockout
          }
          await user.save();

          if (user.failed_login_count >= 5) {
            res.setHeader('Retry-After', '900');
            throw new RateLimitedError(
              'Account temporarily locked due to excessive failed attempts. Please retry after 900 seconds.',
            );
          }

          throw new UnauthenticatedError('Invalid email or password');
        }

        // Reset lockout counter on success
        if (user.failed_login_count > 0 || user.locked_until) {
          user.failed_login_count = 0;
          user.locked_until = null;
          await user.save();
        }

        const accessToken = signAccessToken(
          {
            userId: user.id,
            role: user.role,
            isMedicalOfficer: user.is_medical_officer,
          },
          settings.jwt_access_secret,
          settings.access_token_ttl,
        );

        const rawRefreshToken = generateRawRefreshToken();
        const familyId = generateTokenFamilyId();
        const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await RefreshToken.create({
          user_id: user._id,
          family_id: familyId,
          token_hash: hashRefreshToken(rawRefreshToken),
          expires_at: refreshExpiresAt,
        });

        res.cookie('refresh_token', rawRefreshToken, {
          httpOnly: true,
          secure: settings.cookie_secure,
          sameSite: 'lax',
          path: '/v1/auth',
          expires: refreshExpiresAt,
        });

        res.status(200).json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 900,
          user: user.toJSON(),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // 2. POST /v1/auth/refresh
  registerRoute({
    method: 'post',
    path: '/v1/auth/refresh',
    tags: ['Auth'],
    summary: 'Rotate refresh token and issue new access token',
    description:
      'Rotates the refresh token cookie and issues a new access token. Detects token reuse and revokes token family.',
    successResponse: {
      status: 200,
      description: 'Token refreshed successfully',
      schema: RefreshResponseSchema,
    },
  });

  router.post(
    '/refresh',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const rawToken = req.cookies?.['refresh_token'] as string | undefined;

        if (!rawToken) {
          throw new UnauthenticatedError('Refresh token cookie missing');
        }

        const tokenHash = hashRefreshToken(rawToken);
        const tokenDoc = await RefreshToken.findOne({ token_hash: tokenHash });

        if (!tokenDoc) {
          res.clearCookie('refresh_token', { path: '/v1/auth' });
          throw new UnauthenticatedError('Invalid refresh token');
        }

        // Token reuse detection: if already used or revoked, revoke entire family
        if (tokenDoc.used_at || tokenDoc.revoked_at) {
          await RefreshToken.updateMany(
            { family_id: tokenDoc.family_id },
            { revoked_at: new Date() },
          );
          res.clearCookie('refresh_token', { path: '/v1/auth' });
          throw new UnauthenticatedError(
            'Refresh token reuse detected. Token family has been revoked.',
          );
        }

        if (tokenDoc.expires_at < new Date()) {
          res.clearCookie('refresh_token', { path: '/v1/auth' });
          throw new UnauthenticatedError('Refresh token has expired');
        }

        // Reload user from database so role/status modifications take effect immediately
        const user = await User.findById(tokenDoc.user_id);
        if (!user || user.status === 'disabled') {
          await RefreshToken.updateMany(
            { family_id: tokenDoc.family_id },
            { revoked_at: new Date() },
          );
          res.clearCookie('refresh_token', { path: '/v1/auth' });
          throw new UnauthenticatedError('User account is inactive or disabled');
        }

        // Mark current token as used
        tokenDoc.used_at = new Date();
        await tokenDoc.save();

        // Issue rotated token within the same family
        const newRawToken = generateRawRefreshToken();
        const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await RefreshToken.create({
          user_id: user._id,
          family_id: tokenDoc.family_id,
          token_hash: hashRefreshToken(newRawToken),
          expires_at: refreshExpiresAt,
        });

        res.cookie('refresh_token', newRawToken, {
          httpOnly: true,
          secure: settings.cookie_secure,
          sameSite: 'lax',
          path: '/v1/auth',
          expires: refreshExpiresAt,
        });

        const accessToken = signAccessToken(
          {
            userId: user.id,
            role: user.role,
            isMedicalOfficer: user.is_medical_officer,
          },
          settings.jwt_access_secret,
          settings.access_token_ttl,
        );

        res.status(200).json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 900,
          user: user.toJSON(),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // 3. POST /v1/auth/logout
  registerRoute({
    method: 'post',
    path: '/v1/auth/logout',
    tags: ['Auth'],
    summary: 'Log out current session',
    description: 'Revokes the active refresh token family and clears the refresh cookie.',
    successResponse: {
      status: 200,
      description: 'Logged out successfully',
      schema: LogoutResponseSchema,
    },
  });

  router.post('/logout', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawToken = req.cookies?.['refresh_token'] as string | undefined;

      if (rawToken) {
        const tokenHash = hashRefreshToken(rawToken);
        const tokenDoc = await RefreshToken.findOne({ token_hash: tokenHash });
        if (tokenDoc) {
          await RefreshToken.updateMany(
            { family_id: tokenDoc.family_id },
            { revoked_at: new Date() },
          );
        }
      }

      res.clearCookie('refresh_token', { path: '/v1/auth' });
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      next(err);
    }
  });

  // 4. GET /v1/auth/me
  registerRoute({
    method: 'get',
    path: '/v1/auth/me',
    tags: ['Auth'],
    summary: 'Get authenticated crew member profile',
    description: 'Returns the currently authenticated user profile based on Bearer token.',
    successResponse: {
      status: 200,
      description: 'Current user retrieved',
      schema: MeResponseSchema,
    },
  });

  router.get(
    '/me',
    authenticate,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const user = await User.findById(req.auth?.userId);
        if (!user || user.status === 'disabled') {
          throw new UnauthenticatedError('User session invalid or account disabled');
        }

        res.status(200).json({ user: user.toJSON() });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
