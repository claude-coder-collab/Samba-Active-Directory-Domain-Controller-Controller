import type { ConnectRequest, Preferences, Result, Snapshot } from '../core/api.js';
import { SambaTool } from '../core/samba.js';
import type { Executor } from '../core/types.js';
import { formatHostPort, parseHostPort } from '../core/validate.js';
import { domainToDn } from '../core/parse.js';

export interface SessionDeps {
  connect(host: string, port: number, username: string, password: string, verifyHostKey: (fp: string) => Promise<boolean>): Promise<Executor & { close(): void }>;
  confirmNewHostKey(host: string, fingerprint: string): Promise<boolean>;
  reportChangedHostKey(host: string, expected: string, actual: string): Promise<void>;
  loadPreferences(): Promise<Preferences>;
  savePreferences(prefs: Preferences): Promise<void>;
}

export async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Holds the current connection and implements the operations exposed to the renderer. */
export class Session {
  private executor: (Executor & { close(): void }) | undefined;
  private tool: SambaTool | undefined;
  private host = '';

  constructor(private readonly deps: SessionDeps) {}

  private get samba(): SambaTool {
    if (this.tool === undefined) throw new Error('Not connected to a domain controller.');
    return this.tool;
  }

  async connect(req: ConnectRequest): Promise<void> {
    const target = parseHostPort(req.host);
    const host = formatHostPort(target);
    const username = req.username.trim() || 'root';
    const prefs = await this.deps.loadPreferences();
    const verify = async (fp: string): Promise<boolean> => {
      const known = prefs.knownHosts[host];
      if (known === fp) return true;
      if (known !== undefined) {
        await this.deps.reportChangedHostKey(host, known, fp);
        return false;
      }
      if (!(await this.deps.confirmNewHostKey(host, fp))) return false;
      prefs.knownHosts[host] = fp;
      return true;
    };
    this.disconnect();
    const executor = await this.deps.connect(target.host, target.port, username, req.password, verify);
    this.executor = executor;
    this.tool = new SambaTool(executor);
    this.host = target.host;
    await this.deps.savePreferences({ ...prefs, host, username });
  }

  disconnect(): void {
    this.executor?.close();
    this.executor = undefined;
    this.tool = undefined;
  }

  async snapshot(): Promise<Snapshot> {
    const s = this.samba;
    const [domain, policy, users, groups] = await Promise.all([s.getDomainInfo(this.host), s.getPasswordPolicy(), s.getUsers(), s.getGroups()]);
    const domainDn = domainToDn(domain['Domain'] ?? '');
    return { domain, domainDn, policy, users, groups };
  }

  get tools(): SambaTool {
    return this.samba;
  }
}
