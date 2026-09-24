import { parseMongoUri } from './mongo-uri';

/**
 * Strips credentials from a MongoDB connection string before it's ever logged.
 * Used on every code path that might print a Mongo URI (startup logs, seeder
 * output, error messages) so a bad connection string never leaks a password.
 * Handles both mongodb+srv:// and the comma-separated multi-host mongodb://
 * form (see parseMongoUri — `new URL()` doesn't parse the latter reliably).
 */
export function redactConnectionString(uri: string): string {
  try {
    const parsed = parseMongoUri(uri);
    const auth = parsed.hasCredentials ? '***@' : '';
    const db = parsed.database ? `/${parsed.database}` : '';
    return `${parsed.scheme}://${auth}${parsed.hosts.join(',')}${db}${parsed.query ?? ''}`;
  } catch {
    // Not parseable at all (e.g. malformed input) — best-effort strip
    // anything that looks like `user:pass@` before the host.
    return uri.replace(/\/\/[^/?#@\s]+@/, '//***@');
  }
}

const MONGO_URI_PATTERN = /mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi;

/**
 * Defense in depth for error messages we didn't construct ourselves (driver
 * errors, stack traces, etc.): finds and redacts any Mongo connection string
 * embedded in arbitrary text before it gets logged.
 */
export function redactMongoUrisInText(text: string): string {
  return text.replace(MONGO_URI_PATTERN, (match) => redactConnectionString(match));
}
