import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalisePreferences, type Preferences } from '../core/api.js';

export async function loadPreferences(path: string): Promise<Preferences> {
  try {
    return normalisePreferences(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return normalisePreferences({});
  }
}

export async function savePreferences(path: string, prefs: Preferences): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(prefs, null, 2), { mode: 0o600 });
  await rename(tmp, path);
}
