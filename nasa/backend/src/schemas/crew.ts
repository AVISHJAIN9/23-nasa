import { z } from 'zod';
import { createPageSchema } from './common.js';

export const ObjectIdParamSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid 24-character hexadecimal ObjectId')
  .openapi({ description: 'MongoDB ObjectId', example: '6710d1fa73a11b0012c89012' });

export const BaselineSchema = z
  .object({
    resting_hr: z.number().min(30).max(220).optional().nullable(),
    spo2: z.number().min(70).max(100).optional().nullable(),
    systolic: z.number().min(60).max(240).optional().nullable(),
    diastolic: z.number().min(40).max(160).optional().nullable(),
    temp_c: z.number().min(32.0).max(43.0).optional().nullable(),
    resp_rate: z.number().min(6).max(50).optional().nullable(),
    hrv_rmssd: z.number().min(0).max(300).optional().nullable(),
  })
  .openapi('BaselineVitals');

export const CreateCrewProfileBodySchema = z
  .object({
    user_id: ObjectIdParamSchema.optional().nullable(),
    callsign: z.string().min(1).trim().openapi({ example: 'Ares-1' }),
    age: z
      .number()
      .int()
      .min(18, 'Age must be at least 18')
      .max(80, 'Age cannot exceed 80')
      .openapi({ example: 34 }),
    sex: z.enum(['female', 'male', 'other']).openapi({ example: 'female' }),
    height_cm: z.number().min(100).max(250).openapi({ example: 175 }),
    weight_kg: z.number().min(30).max(200).openapi({ example: 68 }),
    medical_history: z
      .array(z.string())
      .default([])
      .openapi({ example: ['Penicillin allergy', 'Mild motion sickness'] }),
    is_synthetic: z.boolean().default(true),
  })
  .openapi('CreateCrewProfileBody');

export const UpdateCrewProfileBodySchema = z
  .object({
    callsign: z.string().min(1).trim().optional(),
    age: z.number().int().min(18).max(80).optional(),
    sex: z.enum(['female', 'male', 'other']).optional(),
    height_cm: z.number().min(100).max(250).optional(),
    weight_kg: z.number().min(30).max(200).optional(),
    medical_history: z.array(z.string()).optional(),
  })
  .openapi('UpdateCrewProfileBody');

export const CrewProfileResponseSchema = z
  .object({
    id: z.string().openapi({ example: '6710d1fa73a11b0012c89012' }),
    user_id: z.string().nullable().optional().openapi({ example: '6710d21a73a11b0012c89015' }),
    callsign: z.string().openapi({ example: 'Ares-1' }),
    age: z.number().openapi({ example: 34 }),
    sex: z.enum(['female', 'male', 'other']).openapi({ example: 'female' }),
    height_cm: z.number().openapi({ example: 175 }),
    weight_kg: z.number().openapi({ example: 68 }),
    medical_history: z
      .array(z.string())
      .optional()
      .openapi({ example: ['Penicillin allergy'] }),
    baseline: BaselineSchema,
    baseline_status: z.enum(['pending', 'computed']).openapi({ example: 'pending' }),
    is_synthetic: z.boolean().openapi({ example: true }),
    created_at: z.string().openapi({ example: '2026-10-17T18:00:00.000Z' }),
    updated_at: z.string().openapi({ example: '2026-10-17T18:00:00.000Z' }),
  })
  .openapi('CrewProfileResponse');

export const CrewProfileQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
    cursor: z.string().optional(),
  })
  .openapi('CrewProfileQuery');

export const CrewProfilePageSchema = createPageSchema(CrewProfileResponseSchema, 'CrewProfilePage');

export const UpdateCrewBaselineBodySchema = z
  .object({
    baseline: BaselineSchema.optional(),
    resting_hr: z.number().min(30).max(220).optional().nullable(),
    spo2: z.number().min(70).max(100).optional().nullable(),
    systolic: z.number().min(60).max(240).optional().nullable(),
    diastolic: z.number().min(40).max(160).optional().nullable(),
    temp_c: z.number().min(32.0).max(43.0).optional().nullable(),
    resp_rate: z.number().min(6).max(50).optional().nullable(),
    hrv_rmssd: z.number().min(0).max(300).optional().nullable(),
  })
  .openapi('UpdateCrewBaselineBody');

export type CreateCrewProfileBody = z.infer<typeof CreateCrewProfileBodySchema>;
export type UpdateCrewProfileBody = z.infer<typeof UpdateCrewProfileBodySchema>;
export type UpdateCrewBaselineBody = z.infer<typeof UpdateCrewBaselineBodySchema>;
export type CrewProfileResponse = z.infer<typeof CrewProfileResponseSchema>;
