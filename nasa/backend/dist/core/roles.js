import { z } from 'zod';
export const ROLES = ['astronaut', 'flight_surgeon', 'mission_control', 'admin'];
export const RoleEnum = z.enum(ROLES);
