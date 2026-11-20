import { parsePasswordExpiry } from './expiry.js';
import { parseAccountFlags } from './flags.js';
import type { DomainUser, PolicyEntry } from './types.js';

/** Splits command output into trimmed-right, non-empty lines. */
export function lines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l !== '');
}

/** Parses `key : value` lines (as printed by `samba-tool domain info`), splitting on the first colon. */
export function parseKeyValueLines(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of lines(output)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return result;
}

/**
 * Parses LDIF as printed by `samba-tool user show`.
 * Handles folded continuation lines, repeated (multi-valued) attributes and base64 (`::`) values.
 */
export function parseLdif(output: string): Record<string, string[]> {
  const unfolded: string[] = [];
  for (const raw of output.split(/\r?\n/)) {
    if (raw.startsWith(' ') && unfolded.length > 0) {
      unfolded.push(unfolded.pop()! + raw.slice(1));
    } else if (raw.trim() !== '' && !raw.startsWith('#')) {
      unfolded.push(raw);
    }
  }
  const attrs: Record<string, string[]> = {};
  for (const line of unfolded) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx);
    let value: string;
    if (line[idx + 1] === ':') {
      value = Buffer.from(line.slice(idx + 2).trim(), 'base64').toString('utf8');
    } else {
      value = line.slice(idx + 1).replace(/^ /, '');
    }
    (attrs[key] ??= []).push(value);
  }
  return attrs;
}

function first(attrs: Record<string, string[]>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = attrs[k]?.[0];
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Constructed attribute holding the effective password expiry time; only returned when requested. */
export const passwordExpiryAttribute = 'msDS-UserPasswordExpiryTimeComputed';

/** Builds a DomainUser from parsed `user show` attributes. */
export function userFromLdif(attrs: Record<string, string[]>): DomainUser {
  const uac = first(attrs, 'userAccountControl');
  const flags = uac === undefined ? [] : parseAccountFlags(uac);
  return {
    username: first(attrs, 'sAMAccountName', 'userPrincipalName') ?? '',
    givenName: first(attrs, 'givenName') ?? '',
    surname: first(attrs, 'sn') ?? '',
    flags,
    disabled: flags.includes('ACCOUNTDISABLE'),
    distinguishedName: first(attrs, 'distinguishedName', 'dn') ?? '',
    passwordExpiry: parsePasswordExpiry(first(attrs, passwordExpiryAttribute)),
  };
}

/** Maps `domain passwordsettings show` labels to `domain passwordsettings set` options. */
export const policyOptions: Readonly<Record<string, string>> = {
  'Password complexity': 'complexity',
  'Store plaintext passwords': 'store-plaintext',
  'Password history length': 'history-length',
  'Minimum password length': 'min-pwd-length',
  'Minimum password age (days)': 'min-pwd-age',
  'Maximum password age (days)': 'max-pwd-age',
  'Account lockout duration (mins)': 'account-lockout-duration',
  'Account lockout threshold (attempts)': 'account-lockout-threshold',
  'Reset account lockout after (mins)': 'reset-account-lockout-after',
};

/** Parses `samba-tool domain passwordsettings show` output. */
export function parsePasswordPolicy(output: string): PolicyEntry[] {
  return lines(output)
    .filter((l) => !l.startsWith('Password information for domain'))
    .flatMap((l) => {
      const idx = l.lastIndexOf(':');
      if (idx < 0) return [];
      const label = l.slice(0, idx).trim();
      return [{ label, value: l.slice(idx + 1).trim(), option: policyOptions[label] }];
    });
}

/** Converts a DNS domain name into its LDAP base DN, e.g. `samdom.example.com` → `DC=samdom,DC=example,DC=com`. */
export function domainToDn(domain: string): string {
  return domain
    .split('.')
    .filter((p) => p !== '')
    .map((p) => `DC=${p}`)
    .join(',');
}

/** Splits a distinguished name into [attribute, value] pairs, honouring backslash-escaped commas. */
export function parseDn(dn: string): [string, string][] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < dn.length; i++) {
    const c = dn[i]!;
    if (c === '\\' && i + 1 < dn.length) {
      current += c + dn[i + 1]!;
      i++;
    } else if (c === ',') {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (current !== '') parts.push(current);
  return parts.map((p) => {
    const idx = p.indexOf('=');
    return [p.slice(0, idx).trim(), p.slice(idx + 1).trim()];
  });
}

/** Extracts the most useful error line from samba-tool's stderr. */
export function summariseSambaError(stderr: string, fallback: string): string {
  const ls = lines(stderr);
  if (ls.some((l) => l.includes('the password does not meet the complexity criteria'))) {
    return 'Please try another password. This one might be too short or might be a known common password. Check the password policy for more information.';
  }
  const err = ls.find((l) => l.includes('ERROR'));
  if (err !== undefined) return err;
  return ls.length > 0 ? ls.join('\n') : fallback;
}
