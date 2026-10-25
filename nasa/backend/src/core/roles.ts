import { z } from 'zod';

export const ROLES = ['astronaut', 'flight_surgeon', 'mission_control', 'admin'] as const;

export type Role = (typeof ROLES)[number];

export const RoleEnum = z.enum(ROLES);
