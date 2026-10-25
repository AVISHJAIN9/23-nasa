import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

// Precomputed bcrypt hash for constant-time comparisons when email is not found
const DUMMY_HASH = '$2a$10$7EqJtq98hPqEX7fNZaODo.YfC1yv9oA/mU9jW5Y4dG1u2Vv7X3Dqy';

/**
 * Hashes a plaintext password using bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verifies a plaintext password against a bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

/**
 * Performs a dummy password comparison to defend against timing attacks and user enumeration.
 */
export async function verifyDummyPassword(password: string): Promise<boolean> {
  await bcrypt.compare(password, DUMMY_HASH);
  return false;
}
