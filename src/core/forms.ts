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

/** Parses RFC 4180-style CSV into rows of fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const truthy = new Set(['1', 'true', 'yes', 'y', 'on', 'x']);
const headerAliases: Record<string, keyof UserRow> = {
  username: 'username',
  login: 'username',
  samaccountname: 'username',
  givenname: 'givenName',
  firstname: 'givenName',
  given: 'givenName',
  surname: 'surname',
  lastname: 'surname',
  sn: 'surname',
  password: 'password',
  mustchange: 'mustChangeAtNextLogin',
  mustchangeatnextlogin: 'mustChangeAtNextLogin',
  changeatlogin: 'mustChangeAtNextLogin',
};

/**
 * Converts CSV text into add-user rows.
 * With a header row, columns are matched by name; otherwise the order is
 * username, given name, surname, password, must-change-at-next-login.
 */
export function csvToUserRows(text: string): UserRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');
  const header = rows[0]!.map((h) => headerAliases[norm(h)]);
  const hasHeader = header.some((h) => h !== undefined);
  const columns: (keyof UserRow | undefined)[] = hasHeader ? header : ['username', 'givenName', 'surname', 'password', 'mustChangeAtNextLogin'];
  return (hasHeader ? rows.slice(1) : rows).map((fields) => {
    const r = emptyUserRow();
    columns.forEach((col, i) => {
      const v = fields[i] ?? '';
      if (col === 'mustChangeAtNextLogin') r.mustChangeAtNextLogin = v.trim() === '' ? true : truthy.has(v.trim().toLowerCase());
      else if (col !== undefined) r[col] = col === 'password' ? v : v.trim();
    });
    return r;
  });
}
