import { randomBytes } from 'crypto';

/**
 * Unguessable object key — deliberately structureless (no userId, phone,
 * name, or document type folded in) so the key itself never identifies
 * whose document it is or what kind, even if it leaked out of context.
 */
export function generateObjectKey(): string {
  return `documents/${randomBytes(32).toString('hex')}`;
}
