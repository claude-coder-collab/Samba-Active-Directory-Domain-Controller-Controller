import { describe, expect, it } from 'vitest';
import type { PasswordExpiry } from '../src/core/expiry.js';
import type { AccountFlag } from '../src/core/flags.js';
import type { DomainUser } from '../src/core/types.js';
import { displayFlags, sortUsers, toggleUserSort, type UserSort } from '../src/core/user-sort.js';

const user = (username: string, o: Partial<DomainUser> = {}): DomainUser => ({
  username,
  givenName: '',
  surname: '',
  flags: ['NORMAL_ACCOUNT'],
  disabled: false,
  distinguishedName: `CN=${username}`,
  passwordExpiry: { kind: 'never' },
  ...o,
});
const order = (users: DomainUser[], sort: UserSort): string[] => sortUsers(users, sort).map((u) => u.username);
const asc = (column: UserSort['column']): UserSort => ({ column, descending: false });
const desc = (column: UserSort['column']): UserSort => ({ column, descending: true });

describe('sortUsers', () => {
  it('sorts names case-insensitively and numerically', () => {
    const users = [user('user10'), user('Bob'), user('user2'), user('alice')];
    expect(order(users, asc('username'))).toEqual(['alice', 'Bob', 'user2', 'user10']);
    expect(order(users, desc('username'))).toEqual(['user10', 'user2', 'Bob', 'alice']);
  });

  it('keeps empty names last in both directions, ties by login', () => {
    const users = [user('c', { surname: 'Smith' }), user('a'), user('b', { surname: 'Jones' }), user('d', { surname: 'Smith' })];
    expect(order(users, asc('surname'))).toEqual(['b', 'c', 'd', 'a']);
    expect(order(users, desc('surname'))).toEqual(['c', 'd', 'b', 'a']);
  });

  it('sorts status enabled first', () => {
    const users = [user('a', { disabled: true }), user('b'), user('c', { disabled: true })];
    expect(order(users, asc('status'))).toEqual(['b', 'a', 'c']);
    expect(order(users, desc('status'))).toEqual(['a', 'c', 'b']);
  });

  it('sorts expiry by urgency', () => {
    const e = (passwordExpiry: PasswordExpiry): Partial<DomainUser> => ({ passwordExpiry });
    const users = [
      user('never', e({ kind: 'never' })),
      user('later', e({ kind: 'at', unixMs: 2000 })),
      user('unknown', e({ kind: 'unknown' })),
      user('must', e({ kind: 'mustChange' })),
      user('soon', e({ kind: 'at', unixMs: 1000 })),
    ];
    expect(order(users, asc('expiry'))).toEqual(['must', 'soon', 'later', 'never', 'unknown']);
    expect(order(users, desc('expiry'))).toEqual(['unknown', 'never', 'later', 'soon', 'must']);
  });

  it('sorts by displayed flags', () => {
    const f = (...flags: AccountFlag[]): Partial<DomainUser> => ({ flags: ['NORMAL_ACCOUNT', ...flags] });
    const users = [user('a'), user('b', f('SMARTCARD_REQUIRED')), user('c', f('ACCOUNTDISABLE', 'PASSWD_NOTREQD'))];
    expect(displayFlags(users[2]!)).toBe('PASSWD_NOTREQD');
    expect(order(users, asc('flags'))).toEqual(['c', 'b', 'a']);
  });

  it('does not modify its input', () => {
    const users = [user('b'), user('a')];
    sortUsers(users, asc('username'));
    expect(users.map((u) => u.username)).toEqual(['b', 'a']);
  });
});

describe('toggleUserSort', () => {
  it('reverses the same column and resets for a new one', () => {
    expect(toggleUserSort(asc('username'), 'username')).toEqual(desc('username'));
    expect(toggleUserSort(desc('username'), 'surname')).toEqual(asc('surname'));
  });
});
