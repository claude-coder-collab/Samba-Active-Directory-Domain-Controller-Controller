import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { startFakeDc } from '../fake-dc/server.js';

const shots = process.env['SHOTS'] ?? join(tmpdir(), 'sdcc-shots');

async function main(): Promise<void> {
  const dc = await startFakeDc({ delayMs: 20 });
  const fp = `SHA256:${createHash('sha256').update(Buffer.from(dc.hostKeyFingerprint, 'base64')).digest('base64').replace(/=+$/, '')}`;
  const userData = await mkdtemp(join(tmpdir(), 'sdcc-e2e-'));
  const host = `127.0.0.1:${String(dc.port)}`;
  await writeFile(join(userData, 'prefs.json'), JSON.stringify({ host, username: 'root', knownHosts: { [host]: fp } }));

  const app = await electron.launch({ args: ['.'], env: { ...process.env, SDCC_USER_DATA: userData } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => {
    console.error('PAGE ERROR', e);
    process.exitCode = 1;
  });
  const step = async (name: string): Promise<void> => {
    await page.screenshot({ path: join(shots, `${name}.png`) });
    console.log('✓', name);
  };
  const assert = (cond: boolean, msg: string): void => {
    if (!cond) throw new Error(`Assertion failed: ${msg}`);
  };
  const idle = (): Promise<void> => page.locator('#busy').waitFor({ state: 'hidden' });

  await page.locator('#connect-view').waitFor();
  assert((await page.inputValue('#conn-host')) === host, 'host prefilled');
  await step('01-connect');

  await page.fill('#conn-pass', 'wrong');
  await page.click('#connect-form button[type=submit]');
  await page.locator('#dlg-message[open]').waitFor();
  assert((await page.textContent('#message-body'))!.includes('Authentication failed'), 'bad password message');
  await step('02-bad-password');
  await page.click('#message-ok');

  await page.fill('#conn-pass', 'secret');
  await page.click('#connect-form button[type=submit]');
  await page.locator('#main-view').waitFor({ timeout: 10000 });
  await page.locator('#users-table tbody tr').first().waitFor();
  await idle();
  assert((await page.locator('#users-table tbody tr').count()) === 7, '7 users');
  assert((await page.textContent('#users-table tr[data-username=jsmith] td.expiry'))!.trim() === '31 days', 'jsmith expiry');
  assert((await page.textContent('#users-table tr[data-username=rnew] td.expiry'))!.trim() === 'Must change', 'rnew must change');
  assert((await page.textContent('#domain-title')) === 'samdom.example.com', 'domain title');
  assert((await page.locator('#groups-tree li.group').count()) === 3, '3 non-built-in groups');
  await step('03-main');

  const userOrder = async (): Promise<string[]> => page.locator('#users-table tbody tr').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset['username']!));
  assert((await userOrder())[0] === 'Administrator', 'default sort by login name');
  await page.click('#users-table th[data-column=surname]');
  assert((await userOrder()).join() === 'pchen,agarcía,mjones,rnew,jsmith,Administrator,Guest', `surname ascending: ${(await userOrder()).join()}`);
  await page.click('#users-table th[data-column=surname]');
  assert((await userOrder()).slice(0, 2).join() === 'jsmith,rnew', 'surname descending');
  assert((await page.getAttribute('#users-table th[data-column=surname]', 'aria-sort')) === 'descending', 'sort indicator');
  await page.click('#users-table th[data-column=expiry]');
  assert((await userOrder())[0] === 'rnew', 'must change sorts first');
  await step('03b-sorted');
  await page.click('#users-table th[data-column=username]');

  await page.click('#btn-user-add');
  const rows = page.locator('#add-users-rows tr');
  await rows.nth(0).locator('[data-field=username]').fill('newbie');
  await rows.nth(0).locator('[data-field=givenName]').fill('New');
  await rows.nth(0).locator('[data-field=surname]').fill("O'Brien");
  await rows.nth(0).locator('[data-field=password]').fill('Str0ng pass"word');
  await step('04-add-users');
  await page.click('#add-users-form button[value=ok]');
  await page.locator('#users-table tbody tr[data-username=newbie]').waitFor();
  await idle();
  assert(dc.tool.users.get('newbie')?.surname === "O'Brien", 'user created with quote in surname');

  await page.click('#users-table tbody tr[data-username=newbie]');
  await page.click('#users-table tbody tr[data-username=jsmith]', { modifiers: ['ControlOrMeta'] });
  await page.click('#groups-tree .label[data-key="g:Empty Group"]');
  await page.click('#btn-members-add');
  await idle();
  await page.locator('#groups-tree .label[data-key="m:Empty Group\u001fnewbie"]').waitFor();
  await step('05-members-added');

  await page.click('#users-table tbody tr[data-username=mjones]');
  await page.click('#btn-user-enable');
  await idle();
  assert(((dc.tool.users.get('mjones')?.uac ?? 2) & 2) === 0, 'mjones enabled');

  await page.click('#users-table tbody tr[data-username=newbie]');
  await page.click('#btn-user-password');
  await page.fill('#pw-new', 'abc');
  await page.fill('#pw-confirm', 'abc');
  await page.click('#dlg-password button[value=ok]');
  await page.locator('#dlg-message[open]').waitFor();
  assert((await page.textContent('#message-body'))!.includes('try another password'), 'complexity error');
  await step('06-password-error');
  await page.click('#message-ok');

  await page.fill('#policy-Minimum-password-length', '3');
  await page.click('#policy-form button[type=submit]');
  await idle();
  assert(dc.tool.policy[3]![2] === '3', 'policy updated');

  await page.click('#groups-tree .label[data-key="m:Empty Group\u001fjsmith"]');
  await page.click('#btn-members-remove');
  await idle();
  assert(!dc.tool.groups.get('Empty Group')!.has('jsmith'), 'member removed');

  await page.click('#users-table tbody tr[data-username=newbie]');
  await page.click('#btn-user-delete');
  await page.locator('#dlg-message[open]').waitFor();
  await step('07-confirm-delete');
  await page.click('#message-ok');
  await idle();
  await page.locator('#users-table tbody tr[data-username=newbie]').waitFor({ state: 'detached' });
  assert(!dc.tool.users.has('newbie'), 'user deleted');
  await step('08-final');

  await app.close();
  await dc.close();
  console.log(`All UI checks passed. Screenshots in ${shots}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
