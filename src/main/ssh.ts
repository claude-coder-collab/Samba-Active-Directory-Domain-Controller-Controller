import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client, utils, type AnyAuthMethod } from 'ssh2';
import type { CommandResult, Executor } from '../core/types.js';

export interface SshOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  /** Called with the server's SHA256 fingerprint; resolve true to accept the key. */
  verifyHostKey: (fingerprint: string) => Promise<boolean>;
}

function defaultPrivateKeys(): Buffer[] {
  const dir = join(homedir(), '.ssh');
  return ['id_ed25519', 'id_ecdsa', 'id_rsa']
    .map((f) => join(dir, f))
    .filter((p) => existsSync(p))
    .flatMap((p) => {
      try {
        const key = readFileSync(p);
        return utils.parseKey(key) instanceof Error ? [] : [key];
      } catch {
        return [];
      }
    });
}

/** Builds the ordered list of authentication attempts: password, agent, then default key files. */
export function authMethods(username: string, password: string, agent: string | undefined, keys: Buffer[]): AnyAuthMethod[] {
  const methods: AnyAuthMethod[] = [];
  if (password !== '') {
    methods.push({ type: 'password', username, password });
    methods.push({
      type: 'keyboard-interactive',
      username,
      prompt: (_name, _instructions, _lang, prompts, finish) => {
        finish(prompts.map(() => password));
      },
    });
  }
  if (agent !== undefined && agent !== '') methods.push({ type: 'agent', username, agent });
  for (const key of keys) methods.push({ type: 'publickey', username, key });
  return methods;
}

export function fingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/** An Executor over a single persistent SSH connection. */
export class SshExecutor implements Executor {
  private constructor(private readonly client: Client) {}

  static connect(opts: SshOptions): Promise<SshExecutor> {
    const client = new Client();
    const agent = process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : process.env['SSH_AUTH_SOCK'];
    const methods = authMethods(opts.username, opts.password, agent, defaultPrivateKeys());
    if (methods.length === 0) {
      return Promise.reject(new Error('No password given and no SSH agent or unencrypted key in ~/.ssh was found.'));
    }
    return new Promise((resolve, reject) => {
      client
        .on('ready', () => resolve(new SshExecutor(client)))
        .on('error', (err) => reject(new Error(friendlySshError(err))))
        .connect({
          host: opts.host,
          port: opts.port ?? 22,
          username: opts.username,
          readyTimeout: 15000,
          keepaliveInterval: 30000,
          hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
            opts.verifyHostKey(fingerprint(key)).then(verify, () => {
              verify(false);
            });
          },
          authHandler: methods,
        });
    });
  }

  exec(command: string): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        const out: Buffer[] = [];
        const errOut: Buffer[] = [];
        stream.on('data', (d: Buffer) => out.push(d));
        stream.stderr.on('data', (d: Buffer) => errOut.push(d));
        stream.on('close', (code: number | null) => {
          resolve({ stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(errOut).toString('utf8'), code });
        });
      });
    });
  }

  close(): void {
    this.client.end();
  }
}

function friendlySshError(err: Error & { level?: string; code?: string }): string {
  if (err.level === 'client-authentication') return 'Authentication failed. Check the username and password, or your SSH keys/agent.';
  if (err.message.toLowerCase().includes('host') && err.message.toLowerCase().includes('verif')) return 'Host key was rejected.';
  if (err.code === 'ECONNREFUSED') return 'Connection refused. Is SSH running on the domain controller?';
  if (err.code === 'ENOTFOUND') return 'Host not found.';
  if (err.code === 'ETIMEDOUT' || err.message.includes('Timed out')) return 'Timed out connecting to the domain controller.';
  return err.message;
}
