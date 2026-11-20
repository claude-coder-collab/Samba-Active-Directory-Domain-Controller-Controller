export class ValidationError extends Error {
  override name = 'ValidationError';
}

const forbiddenAccountChars = /[`~!@#$%,^&*(){}[\]'|\\:;"<>?/=+]/;

/**
 * Validates an account or group name (sAMAccountName style).
 * Printable ASCII only, none of the characters Active Directory or samba-tool treat specially,
 * no leading or trailing spaces.
 */
export function validateAccountName(name: string, what = 'Name'): string {
  if (name.length === 0) throw new ValidationError(`Please enter a ${what.toLowerCase()}.`);
  if (!/^[\x20-\x7a]+$/.test(name)) {
    throw new ValidationError(`${what} contains characters outside the allowed range: ${name}`);
  }
  if (forbiddenAccountChars.test(name)) throw new ValidationError(`Illegal characters found in ${what.toLowerCase()}: ${name}`);
  if (name !== name.trim()) throw new ValidationError(`${what} cannot start or end with a space.`);
  return name;
}

/** Validates a human name (given name, surname). Any printable text, no control characters or surrounding spaces. */
export function validatePersonName(name: string, what: string, required: boolean): string {
  if (name.length === 0) {
    if (required) throw new ValidationError(`Please enter a ${what.toLowerCase()}.`);
    return name;
  }
  if (/\p{Cc}/u.test(name)) throw new ValidationError(`${what} contains control characters.`);
  if (name !== name.trim()) throw new ValidationError(`${what} cannot start or end with a space.`);
  return name;
}

/** Validates a password: non-empty, no control characters. Complexity is left to the server's policy. */
export function validatePassword(password: string): string {
  if (password.length === 0) throw new ValidationError('Please enter a password.');
  if (/\p{Cc}/u.test(password)) throw new ValidationError('Password contains control characters.');
  return password;
}

const ipv4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const hostname = /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/** Validates a server address: an IPv4 address, bracket-free IPv6 address or DNS hostname. */
export function validateHost(host: string): string {
  const h = host.trim();
  if (/^[\d.]+$/.test(h) && !ipv4.test(h)) {
    throw new ValidationError('Invalid IP address. Please enter 4 numbers from 0 to 255 separated by dots.');
  }
  if (ipv4.test(h) || hostname.test(h) || (h.includes(':') && /^[0-9A-Fa-f:.]+$/.test(h))) return h;
  throw new ValidationError('Please enter a valid IP address or hostname for the domain controller.');
}

export interface HostPort {
  host: string;
  port: number;
}

/** Parses `host`, `host:port` or `[ipv6]:port`, defaulting to port 22. */
export function parseHostPort(input: string): HostPort {
  const s = input.trim();
  let host = s;
  let port = 22;
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(s);
  const withPort = /^([^:]+):(\d+)$/.exec(s);
  if (bracketed) {
    host = bracketed[1]!;
    if (bracketed[2] !== undefined) port = Number(bracketed[2]);
  } else if (withPort) {
    host = withPort[1]!;
    port = Number(withPort[2]);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ValidationError('Port must be between 1 and 65535.');
  return { host: validateHost(host), port };
}

/** Formats a host and port back into the form accepted by parseHostPort, omitting the default port. */
export function formatHostPort({ host, port }: HostPort): string {
  if (port === 22) return host;
  return host.includes(':') ? `[${host}]:${String(port)}` : `${host}:${String(port)}`;
}
