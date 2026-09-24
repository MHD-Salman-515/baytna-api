import { envFilePath } from '../config/load-env'; // MUST be the first import: loads .env as a side effect, before anything else reads process.env

import * as dns from 'dns';
import { applyDnsServersFromEnv } from '../config/apply-dns-servers';
import { parseMongoUri } from '../config/mongo-uri';

/**
 * Resolves the SRV/TXT records for MONGODB_URI (when it's mongodb+srv://) and
 * prints the equivalent non-SRV connection string — real hosts, real
 * replicaSet, password left as a placeholder so nothing secret ever prints.
 * Paste it into .env yourself; this never writes to .env.
 */
async function main(): Promise<void> {
  const rawUri = process.env.MONGODB_URI;
  if (!rawUri) {
    console.error(`MONGODB_URI is not set in ${envFilePath}`);
    process.exit(1);
  }

  const parsed = parseMongoUri(rawUri);
  if (parsed.scheme !== 'mongodb+srv') {
    console.log('MONGODB_URI is already a non-SRV connection string — nothing to build.');
    return;
  }

  applyDnsServersFromEnv();

  const host = parsed.hosts[0];

  let srvRecords: dns.SrvRecord[];
  try {
    srvRecords = await dns.promises.resolveSrv(`_mongodb._tcp.${host}`);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.error(
      `SRV resolution failed (${err.code}). Run "npm run db:doctor" for a full diagnosis,`,
    );
    console.error(`or set DNS_SERVERS=1.1.1.1,8.8.8.8 in ${envFilePath} and try again.`);
    process.exit(1);
  }

  let replicaSet: string | undefined;
  let authSource = 'admin';
  try {
    const txt = await dns.promises.resolveTxt(host);
    const params = new URLSearchParams(txt.map((parts) => parts.join('')).join('&'));
    replicaSet = params.get('replicaSet') ?? undefined;
    authSource = params.get('authSource') ?? authSource;
  } catch {
    console.warn(
      'Warning: TXT record lookup failed — replicaSet/authSource omitted below; add them manually if your cluster needs them.',
    );
  }

  const hostList = srvRecords
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => `${r.name}:${r.port}`)
    .join(',');

  const username = parsed.username ?? 'USERNAME_HERE';
  const database = parsed.database ?? 'home-services';

  const query = new URLSearchParams();
  query.set('tls', 'true'); // not implied outside mongodb+srv:// — must be explicit
  if (replicaSet) query.set('replicaSet', replicaSet);
  query.set('authSource', authSource);
  query.set('retryWrites', 'true');
  query.set('w', 'majority');

  const builtUri = `mongodb://${username}:PASSWORD_HERE@${hostList}/${database}?${query.toString()}`;

  console.log('\nNon-SRV equivalent (password redacted — replace PASSWORD_HERE before using):\n');
  console.log(builtUri);
  console.log(`\nPaste this into MONGODB_URI in ${envFilePath}, then set the real password.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
