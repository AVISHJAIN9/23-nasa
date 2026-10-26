import { ForbiddenError, UnauthenticatedError } from './errors.js';
import { verifyAccessToken } from './tokens.js';
import { User } from '../models/User.js';
/**
 * Middleware that validates the JWT Bearer access token and establishes req.auth.
 */
export const authenticate = (req, _res, next) => {
    const authHeader = req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new UnauthenticatedError('Authentication required: missing or invalid Bearer authorization header');
    }
    const token = authHeader.substring(7).trim();
    if (!token) {
        throw new UnauthenticatedError('Authentication token cannot be empty');
    }
    const settings = req.app?.locals['settings'];
    const secret = settings?.jwt_access_secret ||
        process.env['ASTRO_JWT_ACCESS_SECRET'] ||
        'dev_insecure_access_secret_min_32_chars_long!';
    const decoded = verifyAccessToken(token, secret);
    req.auth = {
        userId: decoded.sub,
        role: decoded.role,
        isMedicalOfficer: Boolean(decoded.mo),
    };
    next();
};
/**
 * Middleware enforcing that the authenticated caller holds one of the specified roles.
 * Runs authenticate() automatically if req.auth is not yet established.
 */
export function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.auth) {
            try {
                authenticate(req, res, () => {
                    verifyRoleRequirement(req, roles, next);
                });
            }
            catch (err) {
                next(err);
            }
        }
        else {
            verifyRoleRequirement(req, roles, next);
        }
    };
}
function verifyRoleRequirement(req, roles, next) {
    if (!req.auth) {
        return next(new UnauthenticatedError('Authentication required'));
    }
    if (!roles.includes(req.auth.role)) {
        return next(new ForbiddenError(`Insufficient permissions: required role in [${roles.join(', ')}], caller has '${req.auth.role}'`));
    }
    next();
}
/**
 * Middleware granting access to medical personnel:
 * flight_surgeon, admin, or an astronaut designated as crew medical officer.
 */
export function requireMedicalAccess() {
    return (req, res, next) => {
        const handleCheck = () => {
            if (!req.auth) {
                return next(new UnauthenticatedError('Authentication required'));
            }
            const { role, isMedicalOfficer } = req.auth;
            const isAllowed = role === 'flight_surgeon' || role === 'admin' || (role === 'astronaut' && isMedicalOfficer);
            if (!isAllowed) {
                return next(new ForbiddenError('Medical access restricted to Flight Surgeons, Admins, or designated Crew Medical Officers'));
            }
            next();
        };
        if (!req.auth) {
            try {
                authenticate(req, res, handleCheck);
            }
            catch (err) {
                next(err);
            }
        }
        else {
            handleCheck();
        }
    };
}
/**
 * Middleware allowing access if the caller matches the specified route parameter
 * (user ID or linked crew profile ID), or if the caller holds one of the authorized roles.
 */
export function requireSelfOrRole(paramName, ...roles) {
    return async (req, res, next) => {
        const handleCheck = async () => {
            if (!req.auth) {
                return next(new UnauthenticatedError('Authentication required'));
            }
            const targetId = req.params[paramName];
            const { userId, role } = req.auth;
            // Direct user ID match
            if (userId === targetId) {
                return next();
            }
            // Check role override (e.g. flight_surgeon or admin)
            if (roles.includes(role)) {
                return next();
            }
            // If caller is an astronaut accessing a crew profile, check linked crew profile ID
            try {
                const user = await User.findById(userId).lean();
                if (user?.crew_profile_id && String(user.crew_profile_id) === targetId) {
                    return next();
                }
            }
            catch (err) {
                return next(err);
            }
            return next(new ForbiddenError(`Access restricted: you may only access your own profile, or hold one of [${roles.join(', ')}]`));
        };
        if (!req.auth) {
            try {
                authenticate(req, res, () => {
                    handleCheck().catch(next);
                });
            }
            catch (err) {
                next(err);
            }
        }
        else {
            await handleCheck().catch(next);
        }
    };
}
