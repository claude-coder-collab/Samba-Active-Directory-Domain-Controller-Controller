import { startFakeDc } from './server.js';

const password = process.env['PASSWORD'] ?? 'secret';
void startFakeDc({ port: Number(process.env['PORT'] ?? 2222), password, delayMs: 40 }).then((dc) => {
  console.log(`Fake Samba DC listening on 127.0.0.1:${String(dc.port)} (user root, password ${password})`);
});
