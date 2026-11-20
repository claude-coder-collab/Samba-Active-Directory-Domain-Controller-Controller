import { describe, expect, it } from 'vitest';
import { normalisePreferences } from '../src/core/api.js';
import { describeExpiry, parsePasswordExpiry } from '../src/core/expiry.js';
import { parseAccountFlags } from '../src/core/flags.js';
import { emptyUserRow, policyChanges, rowsToUsers } from '../src/core/forms.js';
import { domainToDn, parseDn, parseKeyValueLines, parseLdif, parsePasswordPolicy, summariseSambaError, userFromLdif } from '../src/core/parse.js';
import { shellJoin, shellQuote } from '../src/core/shell.js';
import { formatHostPort, parseHostPort, ValidationError, validateAccountName, validateHost, validatePassword, validatePersonName } from '../src/core/validate.js';
import { domainInfo, passwordPolicy, userShow } from './fixtures.js';

describe('shellQuote', () => {
  it('leaves safe words alone', () => {
    expect(shellQuote('user')).toBe('user');
    expect(shellQuote('--given-name=John')).toBe('--given-name=John');
  });
  it('quotes empty strings and metacharacters', () => {
    expect(shellQuote('')).toBe("''");
    expect(shellQuote('a b')).toBe("'a b'");
    expect(shellQuote('$(rm -rf /)')).toBe("'$(rm -rf /)'");
  });
  it('escapes single quotes', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
  it('rejects NUL', () => {
    expect(() => shellQuote('a\0b')).toThrow();
  });
  it('joins argv', () => {
    expect(shellJoin(['samba-tool', 'group', 'add', 'Sales Team'])).toBe("samba-tool group add 'Sales Team'");
  });
});

describe('flags', () => {
  it('decodes userAccountControl', () => {
    expect(parseAccountFlags(514)).toEqual(['ACCOUNTDISABLE', 'NORMAL_ACCOUNT']);
    expect(parseAccountFlags('66048')).toEqual(['NORMAL_ACCOUNT', 'DONT_EXPIRE_PASSWORD']);
  });
  it('rejects garbage', () => {
    expect(() => parseAccountFlags('nope')).toThrow();
  });
});

describe('validation', () => {
  it('accepts normal account names', () => {
    expect(validateAccountName('john.smith')).toBe('john.smith');
    expect(validateAccountName('Sales Team')).toBe('Sales Team');
  });
  it.each(['', ' lead', 'trail ', 'a"b', 'a;b', 'ü', 'a{b', 'a=b'])('rejects account name %j', (n) => {
    expect(() => validateAccountName(n)).toThrow(ValidationError);
  });
  it('allows unicode person names and optional surnames', () => {
    expect(validatePersonName('José', 'Given name', true)).toBe('José');
    expect(validatePersonName('', 'Surname', false)).toBe('');
    expect(() => validatePersonName('', 'Given name', true)).toThrow(ValidationError);
    expect(() => validatePersonName('a\nb', 'Surname', false)).toThrow(ValidationError);
  });
  it('validates passwords', () => {
    expect(validatePassword(`p"a's$w0rd`)).toBe(`p"a's$w0rd`);
    expect(() => validatePassword('')).toThrow(ValidationError);
  });
  it.each(['10.0.0.1', 'dc1', 'dc1.samdom.example.com', 'fe80::1'])('accepts host %s', (host) => {
    expect(validateHost(` ${host} `)).toBe(host);
  });
  it.each(['', '10.0.0.256', '1.2.3', 'bad host', 'a..b'])('rejects host %j', (host) => {
    expect(() => validateHost(host)).toThrow(ValidationError);
  });
});

describe('parseHostPort', () => {
  it.each([
    ['dc1', 'dc1', 22],
    ['10.0.0.1:2222', '10.0.0.1', 2222],
    ['[fe80::1]:2200', 'fe80::1', 2200],
    ['fe80::1', 'fe80::1', 22],
  ])('parses %s', (input, host, port) => {
    expect(parseHostPort(input)).toEqual({ host, port });
    expect(parseHostPort(formatHostPort({ host, port }))).toEqual({ host, port });
  });
  it.each(['dc1:0', 'dc1:70000', ''])('rejects %j', (input) => {
    expect(() => parseHostPort(input)).toThrow(ValidationError);
  });
});

describe('parsers', () => {
  it('parses domain info', () => {
    const info = parseKeyValueLines(domainInfo);
    expect(info['Domain']).toBe('samdom.example.com');
    expect(info['DC name']).toBe('dc1.samdom.example.com');
    expect(Object.keys(info)).toHaveLength(7);
  });
  it('parses password policy', () => {
    const policy = parsePasswordPolicy(passwordPolicy);
    expect(policy).toHaveLength(9);
    expect(policy[0]).toEqual({ label: 'Password complexity', value: 'on', option: 'complexity' });
    expect(policy.at(-1)).toEqual({ label: 'Reset account lockout after (mins)', value: '30', option: 'reset-account-lockout-after' });
  });
  it('marks unknown policy lines read-only', () => {
    expect(parsePasswordPolicy('Something new: 5\n')).toEqual([{ label: 'Something new', value: '5', option: undefined }]);
  });
  it('parses LDIF with folding, repeats and base64', () => {
    const attrs = parseLdif(`${userShow('John')}comment:: ${Buffer.from('héllo: world').toString('base64')}\n`);
    expect(attrs['memberOf']).toHaveLength(2);
    expect(attrs['description']![0]).toBe('A very long description that samba-tool folds across multiple lines because it is longer than the LDIF limit');
    expect(attrs['comment']![0]).toBe('héllo: world');
  });
  it('builds users from LDIF', () => {
    expect(userFromLdif(parseLdif(userShow('Jane', 514)))).toEqual({
      username: 'jane',
      givenName: 'Jane',
      surname: 'Smith',
      flags: ['ACCOUNTDISABLE', 'NORMAL_ACCOUNT'],
      disabled: true,
      distinguishedName: 'CN=Jane Smith,CN=Users,DC=samdom,DC=example,DC=com',
      passwordExpiry: { kind: 'unknown' },
    });
  });
  it('falls back to UPN and empty names', () => {
    const u = userFromLdif({ userPrincipalName: ['x@y'] });
    expect(u.username).toBe('x@y');
    expect(u.givenName).toBe('');
    expect(u.flags).toEqual([]);
  });
  it('handles DNs', () => {
    expect(domainToDn('samdom.example.com')).toBe('DC=samdom,DC=example,DC=com');
    expect(parseDn('CN=Smith\\, John,OU=Staff,DC=x')).toEqual([
      ['CN', 'Smith\\, John'],
      ['OU', 'Staff'],
      ['DC', 'x'],
    ]);
  });
  it('summarises samba errors', () => {
    expect(summariseSambaError('blah\nERROR(ldb): Failed to add user "x": already exists\n', 'f')).toBe('ERROR(ldb): Failed to add user "x": already exists');
    expect(summariseSambaError('ERROR: ... the password does not meet the complexity criteria!', 'f')).toMatch(/try another password/);
    expect(summariseSambaError('', 'fallback')).toBe('fallback');
  });
});

describe('forms', () => {
  it('converts rows to users, ignoring blanks and reporting incomplete rows', () => {
    const rows = [
      { ...emptyUserRow(), username: ' jo ', password: 'pw', givenName: 'Jo' },
      emptyUserRow(),
      { ...emptyUserRow(), givenName: 'Nameless' },
    ];
    const { users, errors } = rowsToUsers(rows);
    expect(users).toEqual([{ username: 'jo', password: 'pw', givenName: 'Jo', surname: '', mustChangeAtNextLogin: true }]);
    expect(errors).toEqual(['Row 3: a username and password are required.']);
  });
  it('computes policy changes', () => {
    const policy = parsePasswordPolicy(passwordPolicy + 'Readonly thing: 1\n');
    expect(policyChanges(policy, { 'Password complexity': 'on', 'Minimum password length': ' 10 ', 'Readonly thing': '2' })).toEqual({ 'Minimum password length': '10' });
  });
});

describe('preferences', () => {
  it('normalises bad input', () => {
    expect(normalisePreferences({ host: 5, username: '', knownHosts: { a: 'x', b: 2 } })).toEqual({
      host: '',
      username: 'root',
      knownHosts: { a: 'x' },
    });
  });
});

describe('password expiry', () => {
  const now = Date.UTC(2026, 10, 19, 12, 0, 0);
  const filetime = (unixMs: number): string => String((BigInt(unixMs) + 11644473600000n) * 10000n);

  it('parses special values', () => {
    expect(parsePasswordExpiry('9223372036854775807')).toEqual({ kind: 'never' });
    expect(parsePasswordExpiry('0')).toEqual({ kind: 'mustChange' });
    expect(parsePasswordExpiry(undefined)).toEqual({ kind: 'unknown' });
    expect(parsePasswordExpiry('garbage')).toEqual({ kind: 'unknown' });
  });

  it('converts FILETIME to unix time', () => {
    expect(parsePasswordExpiry('116444736000000000')).toEqual({ kind: 'at', unixMs: 0 });
    expect(parsePasswordExpiry(filetime(now))).toEqual({ kind: 'at', unixMs: now });
  });

  it('describes expiry', () => {
    const at = (days: number) => ({ kind: 'at' as const, unixMs: now + days * 86400000 });
    expect(describeExpiry(at(30.5), now)).toEqual({ text: '30 days', level: 'ok' });
    expect(describeExpiry(at(14), now)).toEqual({ text: '14 days', level: 'warn' });
    expect(describeExpiry(at(1.2), now)).toEqual({ text: '1 day', level: 'warn' });
    expect(describeExpiry(at(0.5), now)).toEqual({ text: 'Today', level: 'warn' });
    expect(describeExpiry(at(-2), now)).toEqual({ text: 'Expired', level: 'expired' });
    expect(describeExpiry({ kind: 'never' }, now).text).toBe('Never');
    expect(describeExpiry({ kind: 'mustChange' }, now).text).toBe('Must change');
    expect(describeExpiry({ kind: 'unknown' }, now).text).toBe('—');
  });
});
