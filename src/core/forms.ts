import type { NewUser, PolicyEntry } from './types.js';

export interface UserRow {
  username: string;
  givenName: string;
  surname: string;
  password: string;
  mustChangeAtNextLogin: boolean;
}

export const emptyUserRow = (): UserRow => ({ username: '', givenName: '', surname: '', password: '', mustChangeAtNextLogin: true });

/** Converts add-user form rows into users. Blank rows are ignored; incomplete rows are reported. */
export function rowsToUsers(rows: readonly UserRow[]): { users: NewUser[]; errors: string[] } {
  const users: NewUser[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const filled = [r.username, r.givenName, r.surname, r.password].map((s) => s.trim() !== '');
    if (!filled.some(Boolean)) return;
    if (r.username.trim() === '' || r.password === '') {
      errors.push(`Row ${String(i + 1)}: a username and password are required.`);
      return;
    }
    users.push({ username: r.username.trim(), givenName: r.givenName.trim(), surname: r.surname.trim(), password: r.password, mustChangeAtNextLogin: r.mustChangeAtNextLogin });
  });
  return { users, errors };
}

/** Returns only the policy values that were edited and can be set. */
export function policyChanges(original: readonly PolicyEntry[], edited: Readonly<Record<string, string>>): Record<string, string> {
  const changes: Record<string, string> = {};
  for (const entry of original) {
    const v = edited[entry.label];
    if (entry.option !== undefined && v !== undefined && v.trim() !== entry.value) changes[entry.label] = v.trim();
  }
  return changes;
}
