import { builtInGroups, builtInUsers } from './builtins.js';
import { domainToDn, lines, parseKeyValueLines, parseLdif, parsePasswordPolicy, policyOptions, summariseSambaError, userFromLdif } from './parse.js';
import { shellJoin } from './shell.js';
import type { DomainUser, Executor, GroupMap, NewUser, PolicyEntry } from './types.js';
import { ValidationError, validateAccountName, validatePassword, validatePersonName } from './validate.js';

export class SambaError extends Error {
  override name = 'SambaError';
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Runs `fn` for every item, collecting failures into a single SambaError. */
async function forEachCollectingErrors<T>(items: readonly T[], label: (item: T) => string, fn: (item: T) => Promise<void>, what: string): Promise<void> {
  const errors: string[] = [];
  for (const item of items) {
    try {
      await fn(item);
    } catch (e) {
      errors.push(`${label(item)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (errors.length > 0) throw new SambaError(`Errors when ${what}:\n${errors.join('\n')}`);
}

/** High-level domain management on top of samba-tool, executed through an Executor. */
export class SambaTool {
  constructor(
    private readonly executor: Executor,
    private readonly concurrency = 4,
  ) {}

  /** Runs `samba-tool <args...>` and returns stdout, throwing SambaError on a non-zero exit. */
  async run(...args: string[]): Promise<string> {
    const result = await this.executor.exec(shellJoin(['samba-tool', ...args]));
    if (result.code !== 0) {
      throw new SambaError(summariseSambaError(result.stderr || result.stdout, `samba-tool ${args[0] ?? ''} failed with exit code ${String(result.code)}`));
    }
    return result.stdout;
  }

  async getDomainInfo(dcAddress: string): Promise<Record<string, string>> {
    return parseKeyValueLines(await this.run('domain', 'info', dcAddress));
  }

  async getDomainDn(dcAddress: string): Promise<string> {
    const domain = (await this.getDomainInfo(dcAddress))['Domain'];
    if (domain === undefined) throw new SambaError('Domain name not found in domain info.');
    return domainToDn(domain);
  }

  async listUsernames(): Promise<string[]> {
    return lines(await this.run('user', 'list')).filter((u) => !builtInUsers.has(u));
  }

  async getUser(username: string): Promise<DomainUser> {
    return userFromLdif(parseLdif(await this.run('user', 'show', username)));
  }

  async getUsers(): Promise<DomainUser[]> {
    const names = await this.listUsernames();
    const users = await mapLimit(names, this.concurrency, (n) => this.getUser(n));
    return users.sort((a, b) => a.username.localeCompare(b.username));
  }

  async listGroupMembers(group: string): Promise<string[]> {
    return lines(await this.run('group', 'listmembers', group))
      .filter((u) => !builtInUsers.has(u))
      .sort((a, b) => a.localeCompare(b));
  }

  /** Returns all non-built-in groups and their members. */
  async getGroups(): Promise<GroupMap> {
    const groups = lines(await this.run('group', 'list'))
      .filter((g) => !builtInGroups.has(g))
      .sort((a, b) => a.localeCompare(b));
    const members = await mapLimit(groups, this.concurrency, (g) => this.listGroupMembers(g));
    return Object.fromEntries(groups.map((g, i) => [g, members[i]!]));
  }

  async listOrganizationalUnits(): Promise<string[]> {
    return lines(await this.run('ou', 'list'));
  }

  async listComputers(): Promise<string[]> {
    return lines(await this.run('computer', 'list'));
  }

  async addUser(user: NewUser): Promise<void> {
    const args = [
      'user',
      'create',
      validateAccountName(user.username, 'Username'),
      validatePassword(user.password),
      `--given-name=${validatePersonName(user.givenName, 'Given name', false)}`,
      `--surname=${validatePersonName(user.surname, 'Surname', false)}`,
    ];
    if (user.mustChangeAtNextLogin) args.push('--must-change-at-next-login');
    await this.run(...args);
  }

  async addUsers(users: readonly NewUser[]): Promise<void> {
    await forEachCollectingErrors(users, (u) => u.username, (u) => this.addUser(u), 'adding users');
  }

  async deleteUsers(usernames: readonly string[]): Promise<void> {
    await forEachCollectingErrors(usernames, (u) => u, (u) => this.run('user', 'delete', u).then(() => undefined), 'deleting users');
  }

  async disableUsers(usernames: readonly string[]): Promise<void> {
    await forEachCollectingErrors(usernames, (u) => u, (u) => this.run('user', 'disable', u).then(() => undefined), 'disabling users');
  }

  async enableUsers(usernames: readonly string[]): Promise<void> {
    await forEachCollectingErrors(usernames, (u) => u, (u) => this.run('user', 'enable', u).then(() => undefined), 'enabling users');
  }

  async setPassword(username: string, password: string, mustChangeAtNextLogin: boolean): Promise<void> {
    const args = ['user', 'setpassword', username, `--newpassword=${validatePassword(password)}`];
    if (mustChangeAtNextLogin) args.push('--must-change-at-next-login');
    await this.run(...args);
  }

  async addGroup(group: string): Promise<void> {
    await this.run('group', 'add', validateAccountName(group, 'Group name'));
  }

  async deleteGroup(group: string): Promise<void> {
    await this.run('group', 'delete', group);
  }

  async addGroupMembers(group: string, members: readonly string[]): Promise<void> {
    if (members.length === 0) throw new ValidationError('No users selected.');
    await this.run('group', 'addmembers', group, members.join(','));
  }

  async removeGroupMembers(group: string, members: readonly string[]): Promise<void> {
    if (members.length === 0) throw new ValidationError('No users selected.');
    await this.run('group', 'removemembers', group, members.join(','));
  }

  /** Creates an OU. `parentPath` is the parent's relative DN, e.g. `OU=parent,OU=grandparent`. */
  async addOrganizationalUnit(name: string, parentPath?: string): Promise<void> {
    const ou = `OU=${validateAccountName(name, 'Organizational unit')}`;
    await this.run('ou', 'create', parentPath ? `${ou},${parentPath}` : ou);
  }

  async getPasswordPolicy(): Promise<PolicyEntry[]> {
    return parsePasswordPolicy(await this.run('domain', 'passwordsettings', 'show'));
  }

  /** Applies password policy changes keyed by the labels returned from getPasswordPolicy. */
  async setPasswordPolicy(changes: Readonly<Record<string, string>>): Promise<void> {
    const args = Object.entries(changes).map(([label, value]) => {
      const option = policyOptions[label];
      if (option === undefined) throw new ValidationError(`Unknown password policy setting: ${label}`);
      if (!/^[A-Za-z0-9]+$/.test(value.trim())) throw new ValidationError(`Invalid value for ${label}: ${value}`);
      return `--${option}=${value.trim()}`;
    });
    if (args.length === 0) return;
    await this.run('domain', 'passwordsettings', 'set', ...args);
  }
}
