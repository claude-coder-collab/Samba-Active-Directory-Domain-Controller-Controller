import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const production = process.env.NODE_ENV === 'production';
const common = { bundle: true, sourcemap: !production, minify: production, logLevel: 'info', target: 'es2023' };

await rm('dist', { recursive: true, force: true });
await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js', platform: 'node', format: 'cjs', external: ['electron', 'cpu-features', '*.node'] }),
  build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.js', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/renderer/renderer.ts'], outfile: 'dist/renderer/renderer.js', platform: 'browser', format: 'iife' }),
]);
await mkdir('dist/renderer', { recursive: true });
await cp('src/renderer/index.html', 'dist/renderer/index.html');
await cp('src/renderer/styles.css', 'dist/renderer/styles.css');
