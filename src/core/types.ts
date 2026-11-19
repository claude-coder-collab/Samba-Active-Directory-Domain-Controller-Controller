import type { PasswordExpiry } from './expiry.js';
import type { AccountFlag } from './flags.js';

export interface DomainUser {
  username: string;
  givenName: string;
  surname: string;
  flags: AccountFlag[];
  disabled: boolean;
  distinguishedName: string;
  passwordExpiry: PasswordExpiry;
}

export interface NewUser {
  username: string;
  password: string;
  givenName: string;
  surname: string;
  mustChangeAtNextLogin: boolean;
}

/** Group name mapped to its member account names. */
export type GroupMap = Record<string, string[]>;

export interface PolicyEntry {
  label: string;
  value: string;
  /** samba-tool `domain passwordsettings set` option name, or undefined when the setting is read-only. */
  option: string | undefined;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Runs a shell command line on the domain controller. */
export interface Executor {
  exec(command: string): Promise<CommandResult>;
}
