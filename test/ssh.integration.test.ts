import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SambaTool } from '../src/core/samba.js';
import { authMethods, SshExecutor } from '../src/main/ssh.js';
import { startFakeDc, type FakeDc } from './fake-dc/server.js';

let dc: FakeDc;
beforeAll(async () => {
  dc = await startFakeDc();
});
afterAll(async () => {
  await dc.close();
});

const expectedFingerprint = (): string => `SHA256:${createHash('sha256').update(Buffer.from(dc.hostKeyFingerprint, 'base64')).digest('base64').replace(/=+$/, '')}`;

describe('SshExecutor against the fake DC', () => {
  it('verifies the host key, authenticates and runs samba-tool end to end', async () => {
    const seen: string[] = [];
    const ex = await SshExecutor.connect({
      host: '127.0.0.1',
      port: dc.port,
      username: 'root',
      password: 'secret',
      verifyHostKey: (fp) => {
        seen.push(fp);
        return Promise.resolve(true);
      },
    });
    try {
      expect(seen).toEqual([expectedFingerprint()]);
      const s = new SambaTool(ex);
      expect((await s.getUsers()).map((u) => u.username)).toEqual(['Administrator', 'agarcía', 'Guest', 'jsmith', 'mjones']);
      expect((await s.getUsers()).find((u) => u.username === 'agarcía')?.surname).toBe('García');
      await s.addUser({ username: 'qa1', password: `it's "quoted" $(x)`, givenName: 'Q A', surname: "O'Neil", mustChangeAtNextLogin: false });
      expect(dc.tool.users.get('qa1')).toMatchObject({ password: `it's "quoted" $(x)`, givenName: 'Q A', surname: "O'Neil" });
      await s.addGroupMembers('Sales Team', ['qa1', 'jsmith']);
      expect((await s.getGroups())['Sales Team']).toEqual(['agarcía', 'jsmith', 'qa1']);
      await expect(s.setPassword('qa1', 'short', false)).rejects.toThrow(/try another password/);
      await expect(s.deleteUsers(['nobody'])).rejects.toThrow(/Unable to find user "nobody"/);
    } finally {
      ex.close();
    }
  });

  it('fails cleanly when the host key is rejected', async () => {
    await expect(SshExecutor.connect({ host: '127.0.0.1', port: dc.port, username: 'root', password: 'secret', verifyHostKey: () => Promise.resolve(false) })).rejects.toThrow();
  });

  it('requires a password', async () => {
    await expect(SshExecutor.connect({ host: '127.0.0.1', port: dc.port, username: 'root', password: '', verifyHostKey: () => Promise.resolve(true) })).rejects.toThrow('Please enter a password.');
  });

  it('reports bad credentials', async () => {
    await expect(SshExecutor.connect({ host: '127.0.0.1', port: dc.port, username: 'root', password: 'wrong', verifyHostKey: () => Promise.resolve(true) })).rejects.toThrow(/Authentication failed/);
  });
});

describe('authMethods', () => {
  it('uses password then keyboard-interactive only', () => {
    expect(authMethods('u', 'pw').map((m) => m.type)).toEqual(['password', 'keyboard-interactive']);
  });
});
