export interface ParsedMongoUri {
  scheme: 'mongodb' | 'mongodb+srv';
  /** "host" or "host:port" entries, in URI order. Never includes credentials. */
  hosts: string[];
  /** Never the password — only ever the username, if present. */
  username?: string;
  hasCredentials: boolean;
  database?: string;
  /** Raw query string including the leading "?", if present. */
  query?: string;
}

const MONGO_URI_PATTERN = /^(mongodb(?:\+srv)?):\/\/(?:([^@/]*)@)?([^/?]+)(\/[^?#]*)?(\?[^#]*)?/i;

/**
 * Hand-rolled instead of `new URL()` because the WHATWG URL parser doesn't
 * reliably handle the comma-separated multi-host form
 * (`mongodb://a:27017,b:27017,c:27017/db`) that non-SRV Mongo URIs use.
 * Deliberately never captures the password: the regex's userinfo group is
 * split for `username` and the rest is dropped immediately.
 */
export function parseMongoUri(uri: string): ParsedMongoUri {
  const match = MONGO_URI_PATTERN.exec(uri.trim());
  if (!match) {
    throw new Error('Not a recognizable mongodb:// or mongodb+srv:// connection string');
  }

  const [, schemeRaw, userinfo, hostPart, pathPart, query] = match;
  const scheme = schemeRaw.toLowerCase() as 'mongodb' | 'mongodb+srv';
  const hosts = hostPart
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const database = pathPart && pathPart.length > 1 ? pathPart.slice(1) : undefined;
  const username = userinfo ? userinfo.split(':')[0] : undefined;

  return { scheme, hosts, username, hasCredentials: Boolean(userinfo), database, query };
}

/** Strips a trailing ":port" from a "host" or "host:port" string. */
export function hostnameOnly(hostMaybeWithPort: string): string {
  const idx = hostMaybeWithPort.lastIndexOf(':');
  if (idx === -1) {
    return hostMaybeWithPort;
  }
  return hostMaybeWithPort.slice(0, idx);
}
