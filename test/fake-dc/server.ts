import { timingSafeEqual } from 'node:crypto';
import { Server, utils } from 'ssh2';
import { FakeSambaTool } from './fake-samba-tool.js';

export interface FakeDc {
  port: number;
  tool: FakeSambaTool;
  hostKeyFingerprint: string;
  close(): Promise<void>;
}

/** Starts an SSH server on localhost that answers samba-tool commands from an in-memory fake domain. */
export function startFakeDc(opts: { port?: number; username?: string; password?: string; delayMs?: number } = {}): Promise<FakeDc> {
  const username = opts.username ?? 'root';
  const password = opts.password ?? 'secret';
  const { private: privateKey } = utils.generateKeyPairSync('ed25519');
  const hostKey = utils.parseKey(privateKey);
  if (hostKey instanceof Error) throw hostKey;
  const tool = new FakeSambaTool();
  const eq = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    client.on('error', () => undefined);
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && eq(ctx.username, username) && eq(ctx.password, password)) ctx.accept();
      else ctx.reject(['password']);
    });
    client.on('session', (accept) => {
      accept().on('exec', (acceptExec, _reject, info) => {
        const stream = acceptExec();
        setTimeout(() => {
          const r = tool.exec(info.command);
          if (r.stdout) stream.write(r.stdout);
          if (r.stderr) stream.stderr.write(r.stderr);
          stream.exit(r.code ?? 1);
          stream.end();
        }, opts.delayMs ?? 0);
      });
    });
  });

  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      const pub = hostKey.getPublicSSH();
      resolve({
        port,
        tool,
        hostKeyFingerprint: pub.toString('base64'),
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
