import { z } from 'zod';
import { RoleEnum } from '../core/roles.js';

export const LoginBodySchema = z
  .object({
    email: z
      .string()
      .email('Invalid email address format')
      .openapi({ example: 'commander@astrocare.nasa.gov' }),
    password: z
      .string()
      .min(1, 'Password is required')
      .openapi({ example: 'MissionPassword#2026' }),
  })
  .openapi('LoginBody');

export const AuthUserSchema = z
  .object({
    id: z.string().openapi({ example: '6710d1fa73a11b0012c89012' }),
    email: z.string().email().openapi({ example: 'commander@astrocare.nasa.gov' }),
    display_name: z.string().openapi({ example: 'Cmdr. Alex Mercer' }),
    role: RoleEnum.openapi({ example: 'astronaut' }),
    is_medical_officer: z.boolean().openapi({ example: false }),
    crew_profile_id: z
      .string()
      .nullable()
      .optional()
      .openapi({ example: '6710d21a73a11b0012c89015' }),
  })
  .openapi('AuthUser');

export const LoginResponseSchema = z
  .object({
    access_token: z.string().openapi({ description: 'HS256 JWT access token' }),
    token_type: z.literal('Bearer').openapi({ example: 'Bearer' }),
    expires_in: z
      .number()
      .int()
      .openapi({ description: 'Validity duration in seconds', example: 900 }),
    user: AuthUserSchema,
  })
  .openapi('LoginResponse');

export const RefreshResponseSchema = z
  .object({
    access_token: z.string().openapi({ description: 'Rotated HS256 JWT access token' }),
    token_type: z.literal('Bearer').openapi({ example: 'Bearer' }),
    expires_in: z
      .number()
      .int()
      .openapi({ description: 'Validity duration in seconds', example: 900 }),
    user: AuthUserSchema,
  })
  .openapi('RefreshResponse');

export const LogoutResponseSchema = z
  .object({
    status: z.literal('ok').openapi({ example: 'ok' }),
  })
  .openapi('LogoutResponse');

export const MeResponseSchema = z
  .object({
    user: AuthUserSchema,
  })
  .openapi('MeResponse');

export type LoginBody = z.infer<typeof LoginBodySchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;
