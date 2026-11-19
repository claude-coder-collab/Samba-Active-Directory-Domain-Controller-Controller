import type { CommandResult } from '../../src/core/types.js';
import { shellWords } from './shell-words.js';

interface FakeUser {
  username: string;
  givenName: string;
  surname: string;
  password: string;
  uac: number;
}

/** An in-memory emulation of the samba-tool commands used by the app. */
export class FakeSambaTool {
  readonly domain = 'samdom.example.com';
  readonly users = new Map<string, FakeUser>();
  readonly groups = new Map<string, Set<string>>();
  readonly policy: [string, string, string][] = [
    ['Password complexity', 'complexity', 'on'],
    ['Store plaintext passwords', 'store-plaintext', 'off'],
    ['Password history length', 'history-length', '24'],
    ['Minimum password length', 'min-pwd-length', '7'],
    ['Minimum password age (days)', 'min-pwd-age', '1'],
    ['Maximum password age (days)', 'max-pwd-age', '42'],
    ['Account lockout duration (mins)', 'account-lockout-duration', '30'],
    ['Account lockout threshold (attempts)', 'account-lockout-threshold', '0'],
    ['Reset account lockout after (mins)', 'reset-account-lockout-after', '30'],
  ];
  readonly log: string[][] = [];

  constructor() {
    for (const g of ['Domain Users', 'Domain Admins', 'Administrators', 'Schema Admins', 'Enterprise Admins', 'Domain Guests']) this.groups.set(g, new Set());
    this.addUser('Administrator', '', '', 'Passw0rd!', 0x10200);
    this.addUser('krbtgt', '', '', 'x', 0x202);
    this.addUser('Guest', '', '', '', 0x10222);
    this.addUser('jsmith', 'John', 'Smith', 'Passw0rd!', 0x200);
    this.addUser('mjones', 'Mary', 'Jones', 'Passw0rd!', 0x202);
    this.addUser('agarcía', 'Ana', 'García', 'Passw0rd!', 0x10200);
    this.groups.set('Staff', new Set(['jsmith', 'mjones']));
    this.groups.set('Sales Team', new Set(['agarcía']));
    this.groups.set('Empty Group', new Set());
    this.groups.get('Domain Admins')!.add('Administrator');
  }

  private addUser(username: string, givenName: string, surname: string, password: string, uac: number): void {
    this.users.set(username.toLowerCase(), { username, givenName, surname, password, uac });
  }

  private option(args: string[], name: string): string | undefined {
    const prefix = `--${name}=`;
    return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
  }

  private findUser(name: string): FakeUser {
    const u = this.users.get(name.toLowerCase());
    if (u === undefined) throw new Error(`ERROR: Unable to find user "${name}"`);
    return u;
  }

  private findGroup(name: string): Set<string> {
    const g = this.groups.get(name);
    if (g === undefined) throw new Error(`ERROR: Unable to find group "${name}"`);
    return g;
  }

  private checkPassword(pw: string): void {
    const min = Number(this.policy[3]![2]);
    if (pw.length < min) throw new Error("ERROR(ldb): Failed to add user: - 0000052D: Constraint violation - check_password_restrictions: the password does not meet the complexity criteria!");
  }

  exec(command: string): CommandResult {
    try {
      const argv = shellWords(command);
      if (argv[0] !== 'samba-tool') return { stdout: '', stderr: `sh: ${argv[0] ?? ''}: command not found\n`, code: 127 };
      const args = argv.slice(1);
      this.log.push(args);
      return { stdout: this.dispatch(args), stderr: '', code: 0 };
    } catch (e) {
      return { stdout: '', stderr: `${(e as Error).message}\n`, code: 255 };
    }
  }

  private dispatch(args: string[]): string {
    const [a, b, c, d] = args;
    const pos = args.filter((x) => !x.startsWith('--'));
    switch (`${a ?? ''} ${b ?? ''}`) {
      case 'domain info':
        return [
          `Forest           : ${this.domain}`,
          `Domain           : ${this.domain}`,
          'Netbios domain   : SAMDOM',
          `DC name          : dc1.${this.domain}`,
          'DC netbios name  : DC1',
          'Server site      : Default-First-Site-Name',
          'Client site      : Default-First-Site-Name',
          '',
        ].join('\n');
      case 'domain passwordsettings':
        if (c === 'show') {
          return [`Password information for domain 'DC=samdom,DC=example,DC=com'`, '', ...this.policy.map(([l, , v]) => `${l}: ${v}`), ''].join('\n');
        }
        for (const p of this.policy) {
          const v = this.option(args, p[1]);
          if (v !== undefined) p[2] = v;
        }
        return 'All changes applied successfully!\n';
      case 'user list':
        return [...this.users.values()].map((u) => u.username).join('\n') + '\n';
      case 'user show': {
        const u = this.findUser(c!);
        const cn = [u.givenName, u.surname].filter(Boolean).join(' ') || u.username;
        const dn = `CN=${cn},CN=Users,DC=samdom,DC=example,DC=com`;
        return [
          `dn: ${dn}`,
          'objectClass: user',
          `cn: ${cn}`,
          ...(u.surname ? [`sn: ${u.surname}`] : []),
          ...(u.givenName ? [`givenName:: ${Buffer.from(u.givenName).toString('base64')}`] : []),
          `userAccountControl: ${String(u.uac)}`,
          `sAMAccountName: ${u.username}`,
          `distinguishedName: ${dn}`,
          '',
        ].join('\n');
      }
      case 'user create': {
        if (this.users.has(c!.toLowerCase())) throw new Error(`ERROR(ldb): Failed to add user "${c!}": - LDAP error 68 LDAP_ENTRY_ALREADY_EXISTS`);
        this.checkPassword(d!);
        this.addUser(c!, this.option(args, 'given-name') ?? '', this.option(args, 'surname') ?? '', d!, args.includes('--must-change-at-next-login') ? 0x800200 : 0x200);
        this.groups.get('Domain Users')!.add(c!);
        return `User '${c!}' added successfully\n`;
      }
      case 'user delete': {
        const u = this.findUser(c!);
        this.users.delete(u.username.toLowerCase());
        for (const g of this.groups.values()) g.delete(u.username);
        return `Deleted user ${c!}\n`;
      }
      case 'user enable':
        this.findUser(c!).uac &= ~0x2;
        return `Enabled user '${c!}'\n`;
      case 'user disable':
        this.findUser(c!).uac |= 0x2;
        return '';
      case 'user setpassword': {
        const u = this.findUser(c!);
        const pw = this.option(args, 'newpassword') ?? '';
        this.checkPassword(pw);
        u.password = pw;
        return `Changed password OK\n`;
      }
      case 'group list':
        return [...this.groups.keys()].join('\n') + '\n';
      case 'group listmembers':
        return [...this.findGroup(c!)].join('\n') + '\n';
      case 'group add':
        if (this.groups.has(c!)) throw new Error(`ERROR(ldb): Failed to create group "${c!}" - LDAP_ENTRY_ALREADY_EXISTS`);
        this.groups.set(c!, new Set());
        return `Added group ${c!}\n`;
      case 'group delete':
        this.findGroup(c!);
        this.groups.delete(c!);
        return `Deleted group ${c!}\n`;
      case 'group addmembers':
      case 'group removemembers': {
        const g = this.findGroup(c!);
        for (const m of d!.split(',')) {
          const u = this.findUser(m.trim());
          if (b === 'addmembers') g.add(u.username);
          else g.delete(u.username);
        }
        return `Modified group ${c!}\n`;
      }
      case 'ou list':
        return 'OU=Domain Controllers\n';
      case 'computer list':
        return 'DC1$\n';
      case 'ou create':
        return `Created ou "${pos[2]!}"\n`;
      default:
        return `Usage: samba-tool <subcommand>\n`;
    }
  }
}
