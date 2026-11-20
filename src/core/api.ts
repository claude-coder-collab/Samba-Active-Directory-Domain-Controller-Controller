import type { DomainUser, GroupMap, NewUser, PolicyEntry } from './types.js';

export interface ConnectRequest {
  host: string;
  username: string;
  password: string;
}

export interface Preferences {
  host: string;
  username: string;
  /** Host → SHA256 host key fingerprint, recorded on first connection. */
  knownHosts: Record<string, string>;
}

export interface Snapshot {
  domain: Record<string, string>;
  domainDn: string;
  policy: PolicyEntry[];
  users: DomainUser[];
  groups: GroupMap;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** The API exposed to the renderer through the preload bridge. */
export interface SdccApi {
  getPreferences(): Promise<Result<Preferences>>;
  connect(req: ConnectRequest): Promise<Result<null>>;
  disconnect(): Promise<Result<null>>;
  snapshot(): Promise<Result<Snapshot>>;
  getUsers(): Promise<Result<DomainUser[]>>;
  getGroups(): Promise<Result<GroupMap>>;
  getPolicy(): Promise<Result<PolicyEntry[]>>;
  addUsers(users: NewUser[]): Promise<Result<null>>;
  deleteUsers(usernames: string[]): Promise<Result<null>>;
  enableUsers(usernames: string[]): Promise<Result<null>>;
  disableUsers(usernames: string[]): Promise<Result<null>>;
  setPassword(username: string, password: string, mustChange: boolean): Promise<Result<null>>;
  addGroup(group: string): Promise<Result<null>>;
  deleteGroup(group: string): Promise<Result<null>>;
  addGroupMembers(group: string, members: string[]): Promise<Result<null>>;
  removeGroupMembers(group: string, members: string[]): Promise<Result<null>>;
  setPolicy(changes: Record<string, string>): Promise<Result<null>>;
  onMenu(handler: (action: 'disconnect' | 'refresh') => void): void;
}

export const apiMethods = [
  'getPreferences',
  'connect',
  'disconnect',
  'snapshot',
  'getUsers',
  'getGroups',
  'getPolicy',
  'addUsers',
  'deleteUsers',
  'enableUsers',
  'disableUsers',
  'setPassword',
  'addGroup',
  'deleteGroup',
  'addGroupMembers',
  'removeGroupMembers',
  'setPolicy',
] as const satisfies readonly Exclude<keyof SdccApi, 'onMenu'>[];

export const defaultPreferences: Preferences = { host: '', username: 'root', knownHosts: {} };

/** Fills in missing or mistyped fields of a loaded preferences object. */
export function normalisePreferences(raw: unknown): Preferences {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const knownHosts: Record<string, string> = {};
  if (typeof r['knownHosts'] === 'object' && r['knownHosts'] !== null) {
    for (const [k, v] of Object.entries(r['knownHosts'] as Record<string, unknown>)) {
      if (typeof v === 'string') knownHosts[k] = v;
    }
  }
  return {
    host: typeof r['host'] === 'string' ? r['host'] : defaultPreferences.host,
    username: typeof r['username'] === 'string' && r['username'] !== '' ? r['username'] : defaultPreferences.username,
    knownHosts,
  };
}
