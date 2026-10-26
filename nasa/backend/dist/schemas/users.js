import { z } from 'zod';
import { RoleEnum } from '../core/roles.js';
import { createPageSchema } from './common.js';
export const CreateUserBodySchema = z
    .object({
    email: z
        .string()
        .email('Invalid email address')
        .toLowerCase()
        .trim()
        .openapi({ example: 'surgeon.vance@astrocare.nasa.gov' }),
    display_name: z
        .string()
        .min(1, 'Display name cannot be empty')
        .trim()
        .openapi({ example: 'Dr. Jane Vance' }),
    role: RoleEnum.openapi({ example: 'flight_surgeon' }),
    password: z
        .string()
        .min(12, 'Password must be at least 12 characters long')
        .openapi({ example: 'Surg3on#MarsOrbit2026' }),
})
    .refine((data) => data.password.toLowerCase() !== data.email.toLowerCase(), {
    message: 'Password must not be identical to email address',
    path: ['password'],
})
    .openapi('CreateUserBody');
export const UpdateUserBodySchema = z
    .object({
    display_name: z.string().min(1).trim().optional().openapi({ example: 'Dr. Jane Vance MD' }),
    role: RoleEnum.optional().openapi({ example: 'flight_surgeon' }),
    status: z.enum(['active', 'disabled']).optional().openapi({ example: 'active' }),
})
    .openapi('UpdateUserBody');
export const MedicalOfficerBodySchema = z
    .object({
    enabled: z.boolean().openapi({
        description: 'Flag designating astronaut as crew medical officer',
        example: true,
    }),
})
    .openapi('MedicalOfficerBody');
export const UserResponseSchema = z
    .object({
    id: z.string().openapi({ example: '6710d1fa73a11b0012c89012' }),
    email: z.string().email().openapi({ example: 'surgeon.vance@astrocare.nasa.gov' }),
    display_name: z.string().openapi({ example: 'Dr. Jane Vance' }),
    role: RoleEnum.openapi({ example: 'flight_surgeon' }),
    is_medical_officer: z.boolean().openapi({ example: false }),
    status: z.enum(['active', 'disabled']).openapi({ example: 'active' }),
    crew_profile_id: z.string().nullable().optional().openapi({ example: null }),
    created_at: z.string().openapi({ example: '2026-10-17T18:00:00.000Z' }),
    updated_at: z.string().openapi({ example: '2026-10-17T18:00:00.000Z' }),
})
    .openapi('UserResponse');
export const UserQuerySchema = z
    .object({
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
    cursor: z.string().optional(),
    role: RoleEnum.optional(),
    status: z.enum(['active', 'disabled']).optional(),
})
    .openapi('UserQuery');
export const UserPageSchema = createPageSchema(UserResponseSchema, 'UserPage');
