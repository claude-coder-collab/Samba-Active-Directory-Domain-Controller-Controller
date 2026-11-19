import { describe, expect, it } from 'vitest';
import { normalisePreferences, type Preferences } from '../src/core/api.js';
import type { CommandResult, Executor } from '../src/core/types.js';
import { Session, wrap, type SessionDeps } from '../src/main/session.js';
import { domainInfo, passwordPolicy } from './fixtures.js';

function deps(overrides: Partial<SessionDeps> & { hostKey?: string; accept?: boolean } = {}): SessionDeps & { saved: Preferences[]; closed: number } {
  let prefs = normalisePreferences({});
  const saved: Preferences[] = [];
  const result = {
    saved,
    closed: 0,
    loadPreferences: () => Promise.resolve(structuredClone(prefs)),
    savePreferences: (p: Preferences) => {
      prefs = structuredClone(p);
      saved.push(prefs);
      return Promise.resolve();
    },
    confirmNewHostKey: () => Promise.resolve(overrides.accept ?? true),
    reportChangedHostKey: () => Promise.resolve(),
    connect: async (_h: string, _port: number, _u: string, _p: string, verify: (fp: string) => Promise<boolean>) => {
      if (!(await verify(overrides.hostKey ?? 'SHA256:abc'))) throw new Error('Host key was rejected.');
      const ex: Executor & { close(): void } = {
        exec: (cmd: string): Promise<CommandResult> => {
          const stdout = cmd.startsWith('samba-tool domain info') ? domainInfo : cmd.includes('passwordsettings') ? passwordPolicy : '';
          return Promise.resolve({ stdout, stderr: '', code: 0 });
        },
        close: () => {
          result.closed++;
        },
      };
      return ex;
    },
    ...overrides,
  };
  return result;
}

describe('Session', () => {
  it('requires a connection', async () => {
    expect(await wrap(() => new Session(deps()).snapshot())).toEqual({ ok: false, error: 'Not connected to a domain controller.' });
  });

  it('connects, remembers the host key and preferences, and snapshots', async () => {
    const d = deps();
    const s = new Session(d);
    await s.connect({ host: ' 10.0.0.1 ', username: 'admin', password: 'x', autoConnect: true });
    expect(d.saved.at(-1)).toEqual({ host: '10.0.0.1', username: 'admin', autoConnect: true, knownHosts: { '10.0.0.1': 'SHA256:abc' } });
    const snap = await s.snapshot();
    expect(snap.domainDn).toBe('DC=samdom,DC=example,DC=com');
    expect(snap.policy).toHaveLength(9);
    expect(snap.users).toEqual([]);
  });

  it('refuses a changed host key', async () => {
    const d = deps();
    await new Session(d).connect({ host: '10.0.0.1', username: 'root', password: '', autoConnect: false });
    const d2 = deps({ hostKey: 'SHA256:evil', loadPreferences: () => d.loadPreferences(), savePreferences: (p) => d.savePreferences(p) });
    await expect(new Session(d2).connect({ host: '10.0.0.1', username: 'root', password: '', autoConnect: false })).rejects.toThrow('Host key was rejected.');
  });

  it('does not save when the user declines a new host key', async () => {
    const d = deps({ accept: false });
    await expect(new Session(d).connect({ host: 'dc1', username: 'root', password: '', autoConnect: false })).rejects.toThrow();
    expect(d.saved).toEqual([]);
  });

  it('keys known hosts by host and non-default port', async () => {
    const d = deps();
    await new Session(d).connect({ host: '127.0.0.1:2222', username: 'root', password: '', autoConnect: false });
    expect(d.saved.at(-1)?.knownHosts).toEqual({ '127.0.0.1:2222': 'SHA256:abc' });
    expect(d.saved.at(-1)?.host).toBe('127.0.0.1:2222');
  });

  it('auto-connects only when enabled', async () => {
    const d = deps();
    const s = new Session(d);
    expect(await s.autoConnect()).toBe(false);
    await s.connect({ host: 'dc1', username: 'root', password: '', autoConnect: true });
    expect(await s.autoConnect()).toBe(true);
    expect(d.closed).toBe(1);
    await s.setAutoConnect(false);
    expect(await s.autoConnect()).toBe(false);
  });
});
