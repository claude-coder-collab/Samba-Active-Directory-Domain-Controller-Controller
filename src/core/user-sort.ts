import type { PasswordExpiry } from './expiry.js';
import type { DomainUser } from './types.js';

export const userColumns = ['username', 'givenName', 'surname', 'status', 'expiry', 'flags'] as const;
export type UserColumn = (typeof userColumns)[number];

export interface UserSort {
  column: UserColumn;
  descending: boolean;
}

export const defaultUserSort: UserSort = { column: 'username', descending: false };

const hiddenFlags = new Set(['NORMAL_ACCOUNT', 'ACCOUNTDISABLE', 'DONT_EXPIRE_PASSWORD', 'PASSWORD_EXPIRED']);

/** The account flags shown in the users table. */
export const displayFlags = (u: DomainUser): string => u.flags.filter((f) => !hiddenFlags.has(f)).join(', ');

/** Most urgent first: must change, then by expiry time, then never, then unknown. */
function expiryRank(e: PasswordExpiry): [number, number] {
  switch (e.kind) {
    case 'mustChange':
      return [0, 0];
    case 'at':
      return [1, e.unixMs];
    case 'never':
      return [2, 0];
    case 'unknown':
      return [3, 0];
  }
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function compareBy(column: UserColumn, a: DomainUser, b: DomainUser): number {
  switch (column) {
    case 'username':
    case 'givenName':
    case 'surname':
      return collator.compare(a[column], b[column]);
    case 'status':
      return Number(a.disabled) - Number(b.disabled);
    case 'expiry': {
      const [ra, ta] = expiryRank(a.passwordExpiry);
      const [rb, tb] = expiryRank(b.passwordExpiry);
      return ra - rb || ta - tb;
    }
    case 'flags':
      return collator.compare(displayFlags(a), displayFlags(b));
  }
}

function textOf(column: UserColumn, u: DomainUser): string | undefined {
  if (column === 'givenName' || column === 'surname') return u[column];
  if (column === 'flags') return displayFlags(u);
  return undefined;
}

/** Returns a sorted copy. Empty names and flags always sort last; ties are broken by login name ascending. */
export function sortUsers(users: readonly DomainUser[], sort: UserSort): DomainUser[] {
  return [...users].sort((a, b) => {
    const ea = textOf(sort.column, a) === '';
    const eb = textOf(sort.column, b) === '';
    if (ea !== eb) return ea ? 1 : -1;
    const c = compareBy(sort.column, a, b);
    return (sort.descending ? -c : c) || collator.compare(a.username, b.username);
  });
}

/** Clicking the sorted column reverses it; clicking another column sorts it ascending. */
export const toggleUserSort = (current: UserSort, column: UserColumn): UserSort =>
  current.column === column ? { column, descending: !current.descending } : { column, descending: false };
