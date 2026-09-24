import * as dns from 'dns';
import { parseMongoUri } from './mongo-uri';

/**
 * Cheap DNS-only check before handing the URI to Mongoose. DNS-class
 * failures (querySrv, ENOTFOUND, EAI_AGAIN, a resolver refusing the query)
 * are not transient — retrying the Mongo connection 3 or 10 times over
 * won't fix a broken resolver, it'll just burn 10-30s before failing with a
 * confusing driver error. Fail fast with an actionable message instead.
 */
export async function preflightMongoDns(uri: string): Promise<void> {
  const parsed = parseMongoUri(uri);

  try {
    if (parsed.scheme === 'mongodb+srv') {
      await dns.promises.resolveSrv(`_mongodb._tcp.${parsed.hosts[0]}`);
    } else {
      const hostnames = [...new Set(parsed.hosts.map((h) => h.split(':')[0]))];
      await Promise.all(hostnames.map((h) => dns.promises.lookup(h)));
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    throw new Error(
      [
        `DNS lookup for the MongoDB host failed (${code}) before even attempting to connect.`,
        `This is a DNS problem, not a MongoDB problem — retrying the connection won't help.`,
        `Run "npm run db:doctor" for a full diagnosis. If you suspect your default DNS`,
        `resolver can't do SRV/A lookups (common on some Windows setups), set`,
        `DNS_SERVERS=1.1.1.1,8.8.8.8 in your env file and try again.`,
      ].join('\n'),
    );
  }
}
