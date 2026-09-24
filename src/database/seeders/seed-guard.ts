import { hostnameOnly, parseMongoUri } from '../../config/mongo-uri';
import { redactConnectionString } from '../../config/redact-connection-string';

const ALLOWED_SEED_HOSTS = ['localhost', '127.0.0.1', 'mongodb'];

/**
 * The seeder writes reference data with upserts, which makes it tempting to
 * run "just to be safe" against whatever MONGODB_URI happens to be set to.
 * That's exactly how a dev laptop accidentally seeds a shared/staging/prod
 * database. Refuse unless every host in the URI is obviously local, or the
 * operator explicitly opts in. Handles both mongodb+srv:// (single host) and
 * the comma-separated multi-host mongodb:// form.
 */
export function assertLocalMongoUri(uri: string): void {
  if (process.env.ALLOW_REMOTE_SEED === 'true') {
    return;
  }

  let hostnames: string[];
  try {
    hostnames = parseMongoUri(uri).hosts.map((h) => hostnameOnly(h).toLowerCase());
  } catch {
    throw new Error(
      `Cannot parse MONGODB_URI to verify it is local: "${redactConnectionString(uri)}"`,
    );
  }

  const nonLocalHosts = hostnames.filter((h) => !ALLOWED_SEED_HOSTS.includes(h));
  if (nonLocalHosts.length > 0) {
    throw new Error(
      `Refusing to seed MongoDB host(s) "${nonLocalHosts.join(', ')}" — they don't look local ` +
        `(allowed: ${ALLOWED_SEED_HOSTS.join(', ')}). This seeder upserts reference data ` +
        `and must not run against a remote/shared database by accident. ` +
        `If you really intend to seed this database, set ALLOW_REMOTE_SEED=true and re-run.`,
    );
  }
}
