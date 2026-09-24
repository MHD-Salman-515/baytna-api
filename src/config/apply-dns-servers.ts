import * as dns from 'dns';
import { Logger } from '@nestjs/common';

const logger = new Logger('DNS');

/**
 * Node's dns.resolveSrv/resolve4/resolveTxt (used internally by the MongoDB
 * driver to resolve mongodb+srv:// URIs) go through Node's own resolver
 * (c-ares), a separate code path from dns.lookup()/the OS resolver that
 * tools like `nslookup` use. On some Windows setups (certain VPNs/network
 * adapters) c-ares can't reach the configured nameserver for these query
 * types at all — instant ECONNREFUSED — even though the OS resolver works
 * fine. Setting DNS_SERVERS points c-ares at a known-good resolver without
 * touching OS network settings. Call this before any Mongo connection is
 * attempted, in both the app and every standalone script.
 */
export function applyDnsServersFromEnv(): void {
  const raw = process.env.DNS_SERVERS;
  if (!raw) {
    return;
  }

  const servers = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (servers.length === 0) {
    return;
  }

  dns.setServers(servers);
  logger.log(`Using custom DNS servers for SRV/TXT lookups: ${servers.join(', ')}`);
}
