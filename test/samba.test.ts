import { describe, expect, it } from 'vitest';
import { mapLimit, SambaError, SambaTool } from '../src/core/samba.js';
import type { CommandResult, Executor } from '../src/core/types.js';
import { ValidationError } from '../src/core/validate.js';
import { domainInfo, passwordPolicy, userShow } from './fixtures.js';

class FakeExecutor implements Executor {
  readonly commands: string[] = [];
  constructor(private readonly responder: (cmd: string) => Partial<CommandResult>) {}
  exec(command: string): Promise<CommandResult> {
    this.commands.push(command);
    return Promise.resolve({ stdout: '', stderr: '', code: 0, ...this.responder(command) });
  }
}

const fakeDc = (): FakeExecutor =>
  new FakeExecutor((cmd) => {
    if (cmd === 'samba-tool domain info 10.0.0.1') return { stdout: domainInfo };
    if (cmd === 'samba-tool user list') return { stdout: 'Administrator\nkrbtgt\nzoe\nadam\n' };
    if (cmd.startsWith('samba-tool user show ')) {
      const name = cmd.split(' ')[3]!;
      return { stdout: userShow(name[0]!.toUpperCase() + name.slice(1)) };
    }
    if (cmd === 'samba-tool group list') return { stdout: 'Domain Users\nStaff\nDomain Admins\nAlpha\n' };
    if (cmd === 'samba-tool group listmembers Staff') return { stdout: 'zoe\nadam\nkrbtgt\n' };
    if (cmd === 'samba-tool group listmembers Alpha') return { stdout: '' };
    if (cmd === 'samba-tool domain passwordsettings show') return { stdout: passwordPolicy };
    return {};
  });

describe('SambaTool', () => {
  it('reads domain info and DN', async () => {
    const s = new SambaTool(fakeDc());
    expect((await s.getDomainInfo('10.0.0.1'))['Netbios domain']).toBe('SAMDOM');
    expect(await s.getDomainDn('10.0.0.1')).toBe('DC=samdom,DC=example,DC=com');
  });

  it('requests the computed password expiry attribute', async () => {
    const ex = fakeDc();
    await new SambaTool(ex).getUser('zoe');
    expect(ex.commands).toEqual(["samba-tool user show zoe '--attributes=*,msDS-UserPasswordExpiryTimeComputed'"]);
  });

  it('lists non-built-in users sorted', async () => {
    const users = await new SambaTool(fakeDc()).getUsers();
    expect(users.map((u) => u.username)).toEqual(['adam', 'administrator', 'zoe']);
  });

  it('lists non-built-in groups with members', async () => {
    expect(await new SambaTool(fakeDc()).getGroups()).toEqual({ Alpha: [], Staff: ['adam', 'zoe'] });
  });

  it('reads the password policy', async () => {
    expect(await new SambaTool(fakeDc()).getPasswordPolicy()).toHaveLength(9);
  });

  it('quotes user creation arguments safely', async () => {
    const ex = fakeDc();
    await new SambaTool(ex).addUser({ username: 'jdoe', password: `p'w"$(x)`, givenName: 'José María', surname: "O'Neil", mustChangeAtNextLogin: true });
    expect(ex.commands).toEqual([`samba-tool user create jdoe 'p'\\''w"$(x)' '--given-name=José María' '--surname=O'\\''Neil' --must-change-at-next-login`]);
  });

  it('validates before running', async () => {
    const ex = fakeDc();
    await expect(new SambaTool(ex).addUser({ username: 'bad;name', password: 'x', givenName: '', surname: '', mustChangeAtNextLogin: false })).rejects.toThrow(ValidationError);
    await expect(new SambaTool(ex).addGroup('')).rejects.toThrow(ValidationError);
    await expect(new SambaTool(ex).addGroupMembers('Staff', [])).rejects.toThrow(ValidationError);
    expect(ex.commands).toEqual([]);
  });

  it('collects errors across bulk operations and continues', async () => {
    const ex = new FakeExecutor((cmd) => (cmd.endsWith(' bob') ? { code: 255, stderr: 'ERROR: Unable to find user "bob"\n' } : {}));
    const err = await new SambaTool(ex).deleteUsers(['amy', 'bob', 'cat']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SambaError);
    expect((err as Error).message).toBe('Errors when deleting users:\nbob: ERROR: Unable to find user "bob"');
    expect(ex.commands).toEqual(['samba-tool user delete amy', 'samba-tool user delete bob', 'samba-tool user delete cat']);
  });

  it('treats stderr warnings with exit 0 as success', async () => {
    const ex = new FakeExecutor(() => ({ stdout: 'ok\n', stderr: 'WARNING: something deprecated\n' }));
    expect(await new SambaTool(ex).run('user', 'list')).toBe('ok\n');
  });

  it('builds member, password, OU and policy commands', async () => {
    const ex = fakeDc();
    const s = new SambaTool(ex);
    await s.addGroupMembers('Sales Team', ['a', 'b']);
    await s.removeGroupMembers('Sales Team', ['a']);
    await s.setPassword('a', 'n3w pw', true);
    await s.setPassword('a', 'pw', false);
    await s.addOrganizationalUnit('Sub', 'OU=Top');
    await s.addOrganizationalUnit('Top');
    await s.setPasswordPolicy({ 'Minimum password length': '10', 'Password complexity': 'off' });
    await s.setPasswordPolicy({});
    expect(ex.commands).toEqual([
      "samba-tool group addmembers 'Sales Team' a,b",
      "samba-tool group removemembers 'Sales Team' a",
      "samba-tool user setpassword a '--newpassword=n3w pw' --must-change-at-next-login",
      'samba-tool user setpassword a --newpassword=pw',
      'samba-tool ou create OU=Sub,OU=Top',
      'samba-tool ou create OU=Top',
      'samba-tool domain passwordsettings set --min-pwd-length=10 --complexity=off',
    ]);
  });

  it('rejects unknown or unsafe policy values', async () => {
    const s = new SambaTool(fakeDc());
    await expect(s.setPasswordPolicy({ Bogus: '1' })).rejects.toThrow(ValidationError);
    await expect(s.setPasswordPolicy({ 'Minimum password length': '1; reboot' })).rejects.toThrow(ValidationError);
  });
});

describe('mapLimit', () => {
  it('preserves order and caps concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });
});
