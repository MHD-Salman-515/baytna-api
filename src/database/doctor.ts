import { envFilePath, envFileFound } from '../config/load-env'; // MUST be the first import: loads .env as a side effect, before anything else reads process.env

import * as dns from 'dns';
import * as fs from 'fs';
import * as net from 'net';
import mongoose from 'mongoose';
import { hostnameOnly, ParsedMongoUri, parseMongoUri } from '../config/mongo-uri';
import { redactMongoUrisInText } from '../config/redact-connection-string';

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

interface MalformedLine {
  line: number;
  key: string;
  issue: string;
}

/** Specifically guards against `KEY=KEY=value` — a real typo hit while setting this up. */
function findMalformedLines(raw: string): MalformedLine[] {
  const problems: MalformedLine[] = [];
  raw.split(/\r?\n/).forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!m) return;
    const [, key, value] = m;
    if (new RegExp(`^${key}\\s*=`).test(value)) {
      problems.push({
        line: idx + 1,
        key,
        issue: `value starts with "${key}=" again — looks like a duplicated key prefix`,
      });
    }
  });
  return problems;
}

function checkTcp(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<{ pass: boolean; detail: string }> {
  return new Promise((resolvePromise) => {
    const start = Date.now();
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolvePromise({ pass: false, detail: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      const ms = Date.now() - start;
      socket.destroy();
      resolvePromise({ pass: true, detail: `${ms}ms` });
    });
    socket.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolvePromise({ pass: false, detail: err.code ?? err.message });
    });
  });
}

interface VerdictContext {
  parsed?: ParsedMongoUri;
  srvWorkedWithDefault: boolean;
  srvWorkedWithOverride: boolean;
  srvErrorDefault?: NodeJS.ErrnoException;
}

/**
 * Collects every applicable diagnosis rather than stopping at the first
 * match — DNS and auth problems are independent and commonly coexist (e.g.
 * fixing DNS just gets you to a *different* failure at the auth step), so
 * reporting only the first one found would hide a second real blocker.
 */
function printVerdict(ctx: VerdictContext): void {
  console.log('\n=== Verdict ===');

  const anyFail = results.some((r) => !r.pass);
  if (!anyFail) {
    console.log('Every check passed — the connection is healthy end to end.');
    return;
  }

  const diagnoses: string[] = [];

  if (
    ctx.parsed?.scheme === 'mongodb+srv' &&
    !ctx.srvWorkedWithDefault &&
    ctx.srvWorkedWithOverride
  ) {
    diagnoses.push(
      [
        `DNS: Node's built-in resolver (c-ares) cannot reach this machine's configured`,
        `nameserver for SRV/TXT-type queries specifically — seen on some Windows setups`,
        `(certain VPNs/network adapters) — even though the OS resolver ("nslookup") works`,
        `fine for the same lookup. Default resolver error: ${ctx.srvErrorDefault?.code ?? 'unknown'}.`,
        ``,
        `Fix: add this line to ${envFilePath}:`,
        `  DNS_SERVERS=1.1.1.1,8.8.8.8`,
        `The app and every script already read this var and apply it before connecting`,
        `(src/config/apply-dns-servers.ts) — no code change needed, just the env var.`,
        `Alternative: run "npm run uri:build" for a non-SRV connection string that`,
        `sidesteps SRV/TXT DNS lookups entirely.`,
      ].join('\n'),
    );
  } else if (
    ctx.parsed?.scheme === 'mongodb+srv' &&
    !ctx.srvWorkedWithDefault &&
    !ctx.srvWorkedWithOverride
  ) {
    diagnoses.push(
      [
        `DNS: SRV lookups fail even against 1.1.1.1/8.8.8.8, so this looks like outbound`,
        `DNS (UDP/53) or the network itself is blocked — a firewall, VPN, or captive`,
        `network — not just a resolver misconfiguration.`,
        ``,
        `Fix: run "npm run uri:build" from a network where SRV lookups work (or copy the`,
        `non-SRV string from Atlas's "Connect" dialog in a browser), then paste it into`,
        `MONGODB_URI in ${envFilePath}.`,
      ].join('\n'),
    );
  }

  const tcpFailed = results.some((r) => r.name.startsWith('TCP connect') && !r.pass);
  if (tcpFailed) {
    diagnoses.push(
      [
        `Network: DNS resolves fine but port 27017 itself is unreachable — common on`,
        `restrictive corporate/school networks or some ISPs blocking it.`,
        ``,
        `Fix: try a different network (a phone hotspot is a quick test), or confirm`,
        `Atlas's Network Access list actually includes your current public IP.`,
      ].join('\n'),
    );
  }

  const mongooseCheck = results.find((r) => r.name === 'Mongoose connection + ping');
  if (mongooseCheck && !mongooseCheck.pass) {
    diagnoses.push(
      [
        `Auth/handshake: DNS and TCP both look fine (or were skipped because a hop before`,
        `them already failed), but the MongoDB handshake itself failed:`,
        `  ${mongooseCheck.detail}`,
        `That points at wrong credentials, an IP not in Atlas's Network Access list, or`,
        `the database user not existing yet — not a DNS/network problem.`,
      ].join('\n'),
    );
  }

  if (diagnoses.length === 0) {
    console.log('One or more checks failed above — see the FAIL lines for detail.');
    return;
  }

  diagnoses.forEach((d, i) => {
    if (i > 0) console.log('');
    console.log(`${i + 1}) ${d}`);
  });
}

async function main(): Promise<void> {
  console.log('=== MongoDB connection doctor ===\n');

  // 1. env file
  record('.env file found', envFileFound, envFilePath);

  // 2. malformed lines
  const rawEnv = envFileFound ? fs.readFileSync(envFilePath, 'utf8') : '';
  const malformed = findMalformedLines(rawEnv);
  if (malformed.length === 0) {
    record('No duplicated-key lines in .env', true, '');
  } else {
    malformed.forEach((m) => {
      record('No duplicated-key lines in .env', false, `line ${m.line}: "${m.key}" — ${m.issue}`);
    });
  }

  // 3. parse MONGODB_URI
  const rawUri = process.env.MONGODB_URI;
  let parsed: ParsedMongoUri | undefined;
  if (!rawUri) {
    record('MONGODB_URI parses', false, 'not set');
    printVerdict({ srvWorkedWithDefault: false, srvWorkedWithOverride: false });
    return;
  }
  try {
    parsed = parseMongoUri(rawUri);
    record(
      'MONGODB_URI parses',
      true,
      `scheme=${parsed.scheme} host(s)=${parsed.hosts.join(', ')}`,
    );
  } catch (error) {
    record('MONGODB_URI parses', false, (error as Error).message);
    printVerdict({ srvWorkedWithDefault: false, srvWorkedWithOverride: false });
    return;
  }

  // 4. plain A-record resolution of the URI's own host(s)
  for (const host of parsed.hosts) {
    const hn = hostnameOnly(host);
    try {
      const addrs = await dns.promises.resolve4(hn);
      record(`A-record resolution: ${hn}`, true, addrs.join(', '));
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      const note =
        parsed.scheme === 'mongodb+srv'
          ? ' (expected for an SRV cluster alias — it normally has no A record of its own)'
          : '';
      record(`A-record resolution: ${hn}`, false, `${err.code}${note}`);
    }
  }

  // 5. SRV resolution, default resolver
  let srvRecords: dns.SrvRecord[] = [];
  let srvWorkedWithDefault = false;
  let srvErrorDefault: NodeJS.ErrnoException | undefined;
  if (parsed.scheme === 'mongodb+srv') {
    try {
      srvRecords = await dns.promises.resolveSrv(`_mongodb._tcp.${parsed.hosts[0]}`);
      srvWorkedWithDefault = true;
      record(
        'SRV resolution (default resolver)',
        true,
        srvRecords.map((r) => `${r.name}:${r.port}`).join(', '),
      );
    } catch (error) {
      srvErrorDefault = error as NodeJS.ErrnoException;
      record(
        'SRV resolution (default resolver)',
        false,
        `${srvErrorDefault.code}: ${srvErrorDefault.message}`,
      );
    }
  } else {
    record('SRV resolution (default resolver)', true, 'skipped — not a mongodb+srv:// URI');
  }

  // 6. SRV resolution, forced 1.1.1.1 / 8.8.8.8 — distinguishes "resolver
  // misconfigured" (this fixes it) from "network/DNS blocked outright" (it doesn't)
  let srvWorkedWithOverride = false;
  if (parsed.scheme === 'mongodb+srv' && !srvWorkedWithDefault) {
    dns.setServers(['1.1.1.1', '8.8.8.8']);
    try {
      srvRecords = await dns.promises.resolveSrv(`_mongodb._tcp.${parsed.hosts[0]}`);
      srvWorkedWithOverride = true;
      record(
        'SRV resolution (1.1.1.1 / 8.8.8.8)',
        true,
        srvRecords.map((r) => `${r.name}:${r.port}`).join(', '),
      );
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      record('SRV resolution (1.1.1.1 / 8.8.8.8)', false, `${err.code}: ${err.message}`);
    }
  } else if (parsed.scheme === 'mongodb+srv') {
    record('SRV resolution (1.1.1.1 / 8.8.8.8)', true, 'skipped — default resolver already worked');
  } else {
    record('SRV resolution (1.1.1.1 / 8.8.8.8)', true, 'skipped — not a mongodb+srv:// URI');
  }

  // Targets for the remaining checks: whichever SRV result worked, or the
  // explicit host list for a non-SRV URI.
  const targets =
    parsed.scheme === 'mongodb+srv'
      ? srvRecords.map((r) => ({ host: r.name, port: r.port }))
      : parsed.hosts.map((h) => {
          const hn = hostnameOnly(h);
          const portPart = h.slice(hn.length + 1);
          return { host: hn, port: portPart ? parseInt(portPart, 10) : 27017 };
        });

  // 7. raw TCP connectivity
  for (const t of targets) {
    const outcome = await checkTcp(t.host, t.port, 5000);
    record(`TCP connect ${t.host}:${t.port}`, outcome.pass, outcome.detail);
  }

  // 8. TXT record (replicaSet / authSource)
  let replicaSet: string | undefined;
  if (parsed.scheme === 'mongodb+srv') {
    try {
      const txt = await dns.promises.resolveTxt(parsed.hosts[0]);
      const joined = txt.map((parts) => parts.join('')).join('&');
      record('TXT record lookup', true, joined);
      replicaSet = new URLSearchParams(joined).get('replicaSet') ?? undefined;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      record('TXT record lookup', false, `${err.code}: ${err.message}`);
    }
  } else {
    record('TXT record lookup', true, 'skipped — not a mongodb+srv:// URI');
  }
  void replicaSet; // surfaced via the TXT record log line above; not otherwise needed here

  // 9. actual Mongoose connection + ping
  if (targets.length === 0) {
    record('Mongoose connection + ping', false, 'no reachable hosts resolved — skipped');
  } else {
    const start = Date.now();
    try {
      const connection = await mongoose
        .createConnection(rawUri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 })
        .asPromise();
      const admin = connection.db!.admin();
      const buildInfo = (await admin.command({ buildInfo: 1 })) as { version?: string };
      const pingStart = Date.now();
      await admin.command({ ping: 1 });
      const pingMs = Date.now() - pingStart;
      record(
        'Mongoose connection + ping',
        true,
        `server version ${buildInfo.version ?? 'unknown'}, ping ${pingMs}ms, total connect ${Date.now() - start}ms`,
      );
      await connection.close();
    } catch (error) {
      const err = error as Error;
      record('Mongoose connection + ping', false, redactMongoUrisInText(err.message));
    }
  }

  printVerdict({ parsed, srvWorkedWithDefault, srvWorkedWithOverride, srvErrorDefault });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redactMongoUrisInText(message));
  process.exit(1);
});
