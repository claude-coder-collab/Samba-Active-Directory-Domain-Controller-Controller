import type { Result, SdccApi, Snapshot } from '../core/api.js';
import { csvToUserRows, emptyUserRow, policyChanges, rowsToUsers, type UserRow } from '../core/forms.js';
import type { DomainUser, GroupMap, PolicyEntry } from '../core/types.js';

declare global {
  interface Window {
    sdcc: SdccApi;
  }
}

const api = window.sdcc;

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`Missing element #${id}`);
  return el as T;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
}

const state = {
  users: [] as DomainUser[],
  groups: {} as GroupMap,
  policy: [] as PolicyEntry[],
  selectedUsers: new Set<string>(),
  lastUserClick: undefined as string | undefined,
  selectedTree: new Set<string>(),
  collapsed: new Set<string>(),
};

let busyCount = 0;
function setBusy(delta: number): void {
  busyCount += delta;
  $('busy').hidden = busyCount === 0;
}

function showMessage(title: string, body: string, confirm = false): Promise<boolean> {
  const dlg = $<HTMLDialogElement>('dlg-message');
  $('message-title').textContent = title;
  $('message-body').textContent = body;
  $('message-cancel').hidden = !confirm;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}

const confirmAction = (title: string, body: string): Promise<boolean> => showMessage(title, body, true);

/** Calls an API method with the busy overlay, showing errors. Returns undefined on failure. */
async function call<T>(fn: () => Promise<Result<T>>): Promise<T | undefined> {
  setBusy(1);
  try {
    const r = await fn();
    if (!r.ok) {
      await showMessage('An error occurred', r.error);
      return undefined;
    }
    return r.value;
  } finally {
    setBusy(-1);
  }
}

function showView(view: 'connect' | 'main'): void {
  $('connect-view').hidden = view !== 'connect';
  $('main-view').hidden = view !== 'main';
}

function renderDomain(snap: Pick<Snapshot, 'domain' | 'domainDn'>): void {
  $('domain-title').textContent = snap.domain['Domain'] ?? 'Domain';
  $('domain-dn').textContent = snap.domainDn;
  $('domain-info').replaceChildren(...Object.entries(snap.domain).flatMap(([k, v]) => [h('dt', { textContent: k }), h('dd', { textContent: v })]));
}

function renderPolicy(policy: PolicyEntry[]): void {
  state.policy = policy;
  $('policy-fields').replaceChildren(
    ...policy.flatMap((p) => {
      const id = `policy-${p.label.replace(/\W+/g, '-')}`;
      const input = h('input', { id, value: p.value, disabled: p.option === undefined });
      input.dataset['label'] = p.label;
      return [h('label', { htmlFor: id, textContent: p.label }), input];
    }),
  );
}

function renderUsers(): void {
  const filter = $<HTMLInputElement>('user-filter').value.trim().toLowerCase();
  const known = new Set(state.users.map((u) => u.username));
  for (const u of state.selectedUsers) if (!known.has(u)) state.selectedUsers.delete(u);
  const visible = state.users.filter((u) => filter === '' || [u.username, u.givenName, u.surname].some((s) => s.toLowerCase().includes(filter)));
  $('user-count').textContent = `(${String(state.users.length)})`;
  $('users-table').querySelector('tbody')!.replaceChildren(
    ...visible.map((u) => {
      const tr = h(
        'tr',
        { className: [state.selectedUsers.has(u.username) ? 'selected' : '', u.disabled ? 'disabled-user' : ''].join(' ').trim() },
        h('td', { textContent: u.username }),
        h('td', { textContent: u.givenName }),
        h('td', { textContent: u.surname }),
        h('td', { textContent: u.disabled ? 'Disabled' : 'Enabled' }),
        h('td', { className: 'flags', textContent: u.flags.filter((f) => f !== 'NORMAL_ACCOUNT' && f !== 'ACCOUNTDISABLE').join(', ') }),
      );
      tr.dataset['username'] = u.username;
      return tr;
    }),
  );
}

const treeKey = (group: string, member?: string): string => (member === undefined ? `g:${group}` : `m:${group}\u001f${member}`);

function renderGroups(): void {
  const valid = new Set(Object.entries(state.groups).flatMap(([g, ms]) => [treeKey(g), ...ms.map((m) => treeKey(g, m))]));
  for (const k of state.selectedTree) if (!valid.has(k)) state.selectedTree.delete(k);
  const item = (key: string, text: string): HTMLSpanElement => {
    const span = h('span', { className: 'label', textContent: text });
    span.dataset['key'] = key;
    return span;
  };
  $('groups-tree').replaceChildren(
    ...Object.entries(state.groups).map(([g, members]) => {
      const li = h('li', { className: `group${state.collapsed.has(g) ? ' collapsed' : ''}${state.selectedTree.has(treeKey(g)) ? ' selected' : ''}` }, item(treeKey(g), g));
      li.dataset['group'] = g;
      const ul = h('ul');
      ul.append(
        ...(members.length === 0
          ? [h('li', { className: 'empty', textContent: 'No members' })]
          : members.map((m) => h('li', { className: state.selectedTree.has(treeKey(g, m)) ? 'selected' : '' }, item(treeKey(g, m), m)))),
      );
      li.append(ul);
      return li;
    }),
  );
}

async function refreshAll(): Promise<void> {
  const snap = await call(() => api.snapshot());
  if (snap === undefined) return;
  renderDomain(snap);
  renderPolicy(snap.policy);
  state.users = snap.users;
  state.groups = snap.groups;
  renderUsers();
  renderGroups();
}

async function refreshUsers(): Promise<void> {
  const users = await call(() => api.getUsers());
  if (users !== undefined) {
    state.users = users;
    renderUsers();
  }
}

async function refreshGroups(): Promise<void> {
  const groups = await call(() => api.getGroups());
  if (groups !== undefined) {
    state.groups = groups;
    renderGroups();
  }
}

async function onConnected(): Promise<void> {
  showView('main');
  await refreshAll();
}

async function initConnectForm(): Promise<void> {
  const prefs = await call(() => api.getPreferences());
  if (prefs !== undefined) {
    $<HTMLInputElement>('conn-host').value = prefs.host;
    $<HTMLInputElement>('conn-user').value = prefs.username;
    $<HTMLInputElement>('conn-auto').checked = prefs.autoConnect;
  }
  showView('connect');
  (prefs?.host ? $('conn-pass') : $('conn-host')).focus();
}

$('connect-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void (async () => {
    const pass = $<HTMLInputElement>('conn-pass');
    const ok = await call(() =>
      api.connect({ host: $<HTMLInputElement>('conn-host').value, username: $<HTMLInputElement>('conn-user').value, password: pass.value, autoConnect: $<HTMLInputElement>('conn-auto').checked }),
    );
    if (ok === undefined) return;
    pass.value = '';
    await onConnected();
  })();
});

async function disconnect(): Promise<void> {
  await call(() => api.disconnect());
  state.selectedUsers.clear();
  state.selectedTree.clear();
  await initConnectForm();
}

$('btn-refresh').addEventListener('click', () => void refreshAll());
$('btn-disconnect').addEventListener('click', () => void disconnect());

api.onMenu((action) => {
  if (action === 'refresh' && !$('main-view').hidden) void refreshAll();
  if (action === 'disconnect') void disconnect();
  if (action === 'disable-auto-connect') {
    void call(() => api.setAutoConnect(false)).then((r) => {
      if (r !== undefined) void showMessage('Auto-connect', 'Automatic connection has been turned off.');
    });
  }
});

$('policy-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const edited: Record<string, string> = {};
  for (const input of $('policy-fields').querySelectorAll('input')) {
    if (input.dataset['label'] !== undefined) edited[input.dataset['label']] = input.value;
  }
  const changes = policyChanges(state.policy, edited);
  if (Object.keys(changes).length === 0) {
    void showMessage('Password policy', 'Nothing has changed.');
    return;
  }
  void (async () => {
    if ((await call(() => api.setPolicy(changes))) !== undefined) {
      const policy = await call(() => api.getPolicy());
      if (policy !== undefined) renderPolicy(policy);
    }
  })();
});

$('user-filter').addEventListener('input', renderUsers);

$('users-table').addEventListener('click', (e) => {
  const tr = (e.target as HTMLElement).closest('tr');
  const name = tr?.dataset['username'];
  if (name === undefined) return;
  const multi = e.metaKey || e.ctrlKey;
  if (e.shiftKey && state.lastUserClick !== undefined) {
    const rows = [...$('users-table').querySelectorAll<HTMLTableRowElement>('tbody tr')].map((r) => r.dataset['username']!);
    const [a, b] = [rows.indexOf(state.lastUserClick), rows.indexOf(name)].sort((x, y) => x - y) as [number, number];
    if (!multi) state.selectedUsers.clear();
    rows.slice(Math.max(a, 0), b + 1).forEach((r) => state.selectedUsers.add(r));
  } else if (multi) {
    if (!state.selectedUsers.delete(name)) state.selectedUsers.add(name);
    state.lastUserClick = name;
  } else {
    state.selectedUsers.clear();
    state.selectedUsers.add(name);
    state.lastUserClick = name;
  }
  renderUsers();
});

$('groups-tree').addEventListener('click', (e) => {
  const label = (e.target as HTMLElement).closest<HTMLElement>('.label');
  const key = label?.dataset['key'];
  if (key === undefined) return;
  if (e.metaKey || e.ctrlKey) {
    if (!state.selectedTree.delete(key)) state.selectedTree.add(key);
  } else {
    state.selectedTree.clear();
    state.selectedTree.add(key);
  }
  renderGroups();
});

$('groups-tree').addEventListener('dblclick', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>('li.group');
  const g = li?.dataset['group'];
  if (g === undefined) return;
  if (!state.collapsed.delete(g)) state.collapsed.add(g);
  renderGroups();
});

const selectedUsernames = (): string[] => state.users.map((u) => u.username).filter((u) => state.selectedUsers.has(u));
const selectedGroups = (): string[] => [...state.selectedTree].filter((k) => k.startsWith('g:')).map((k) => k.slice(2));
const selectedMembers = (): [string, string][] =>
  [...state.selectedTree].filter((k) => k.startsWith('m:')).map((k) => k.slice(2).split('\u001f') as [string, string]);

async function bulkUserAction(fn: (u: string[]) => Promise<Result<null>>, confirmText?: string): Promise<void> {
  const users = selectedUsernames();
  if (users.length === 0) {
    await showMessage('Users', 'Please select users from the users panel.');
    return;
  }
  if (confirmText !== undefined && !(await confirmAction('Are you sure?', `${confirmText}\n\n${users.join('\n')}`))) return;
  await call(() => fn(users));
  await refreshUsers();
}

$('btn-user-enable').addEventListener('click', () => void bulkUserAction((u) => api.enableUsers(u)));
$('btn-user-disable').addEventListener('click', () => void bulkUserAction((u) => api.disableUsers(u)));
$('btn-user-delete').addEventListener('click', () => {
  void bulkUserAction((u) => api.deleteUsers(u), 'Permanently delete these users?').then(refreshGroups);
});

$('btn-user-password').addEventListener('click', () => {
  const users = selectedUsernames();
  if (users.length !== 1) {
    void showMessage('Change user password', 'Please select exactly one user.');
    return;
  }
  const user = users[0]!;
  const dlg = $<HTMLDialogElement>('dlg-password');
  const pw = $<HTMLInputElement>('pw-new');
  const confirm = $<HTMLInputElement>('pw-confirm');
  $('pw-user').textContent = user;
  pw.value = confirm.value = '';
  $<HTMLInputElement>('pw-must-change').checked = false;
  dlg.returnValue = '';
  dlg.showModal();
  dlg.addEventListener(
    'close',
    () => {
      const [a, b, must] = [pw.value, confirm.value, $<HTMLInputElement>('pw-must-change').checked];
      pw.value = confirm.value = '';
      if (dlg.returnValue !== 'ok') return;
      if (a !== b) {
        void showMessage('Change user password', 'The passwords do not match.');
        return;
      }
      void call(() => api.setPassword(user, a, must)).then((r) => {
        if (r !== undefined) void showMessage('Change user password', `Password changed for ${user}.`);
      });
    },
    { once: true },
  );
});

function prompt(title: string, label: string): Promise<string | undefined> {
  const dlg = $<HTMLDialogElement>('dlg-prompt');
  const input = $<HTMLInputElement>('prompt-input');
  $('prompt-title').textContent = title;
  $('prompt-label').textContent = label;
  input.value = '';
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' && input.value.trim() !== '' ? input.value.trim() : undefined), { once: true });
  });
}

$('btn-group-add').addEventListener('click', () => {
  void (async () => {
    const g = await prompt('Add group', 'Name of the new group');
    if (g === undefined) return;
    if ((await call(() => api.addGroup(g))) !== undefined) await refreshGroups();
  })();
});

$('btn-group-remove').addEventListener('click', () => {
  void (async () => {
    const groups = selectedGroups();
    if (groups.length !== 1) {
      await showMessage('Remove group', 'Please select exactly one group (not a member).');
      return;
    }
    const g = groups[0]!;
    if (!(await confirmAction('Remove group', `Permanently delete the group "${g}"?`))) return;
    if ((await call(() => api.deleteGroup(g))) !== undefined) await refreshGroups();
  })();
});

$('btn-members-add').addEventListener('click', () => {
  void (async () => {
    const users = selectedUsernames();
    const groups = selectedGroups();
    if (users.length === 0) {
      await showMessage('Add users to group', 'Please select users from the users panel.');
      return;
    }
    if (groups.length !== 1) {
      await showMessage('Add users to group', 'Please select one group from the groups panel.');
      return;
    }
    await call(() => api.addGroupMembers(groups[0]!, users));
    await refreshGroups();
  })();
});

$('btn-members-remove').addEventListener('click', () => {
  void (async () => {
    const pairs = selectedMembers();
    if (pairs.length === 0 || selectedGroups().length > 0) {
      await showMessage('Remove group members', 'Please select only members (not groups) in the groups panel.');
      return;
    }
    const byGroup = new Map<string, string[]>();
    for (const [g, m] of pairs) byGroup.set(g, [...(byGroup.get(g) ?? []), m]);
    for (const [g, ms] of byGroup) await call(() => api.removeGroupMembers(g, ms));
    await refreshGroups();
  })();
});

function userRowElement(row: UserRow): HTMLTableRowElement {
  const cell = (field: 'username' | 'givenName' | 'surname' | 'password'): HTMLTableCellElement => {
    const input = h('input', { value: row[field], type: field === 'password' ? 'password' : 'text', spellcheck: false });
    input.dataset['field'] = field;
    return h('td', {}, input);
  };
  const chk = h('input', { type: 'checkbox', checked: row.mustChangeAtNextLogin });
  chk.dataset['field'] = 'mustChangeAtNextLogin';
  return h('tr', {}, cell('username'), cell('givenName'), cell('surname'), cell('password'), h('td', {}, chk));
}

function readUserRows(): UserRow[] {
  return [...$('add-users-rows').querySelectorAll('tr')].map((tr) => {
    const r = emptyUserRow();
    for (const input of tr.querySelectorAll('input')) {
      const f = input.dataset['field'] as keyof UserRow;
      if (f === 'mustChangeAtNextLogin') r.mustChangeAtNextLogin = input.checked;
      else r[f] = input.value;
    }
    return r;
  });
}

function openAddUsers(rows: UserRow[] = Array.from({ length: 10 }, emptyUserRow)): void {
  $('add-users-rows').replaceChildren(...rows.map(userRowElement));
  const dlg = $<HTMLDialogElement>('dlg-add-users');
  dlg.returnValue = '';
  if (!dlg.open) dlg.showModal();
}

$('btn-user-add').addEventListener('click', () => {
  openAddUsers();
});
$('btn-add-row').addEventListener('click', () => $('add-users-rows').append(userRowElement(emptyUserRow())));
$('btn-import-csv').addEventListener('click', () => $('csv-file').click());
$<HTMLInputElement>('csv-file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file === undefined) return;
  void file.text().then((text) => {
    const imported = csvToUserRows(text);
    const existing = readUserRows().filter((r) => [r.username, r.givenName, r.surname, r.password].some((s) => s.trim() !== ''));
    openAddUsers([...existing, ...imported]);
  });
});

$<HTMLDialogElement>('dlg-add-users').addEventListener('close', () => {
  const dlg = $<HTMLDialogElement>('dlg-add-users');
  if (dlg.returnValue !== 'ok') return;
  const rows = readUserRows();
  const { users, errors } = rowsToUsers(rows);
  void (async () => {
    if (errors.length > 0 || users.length === 0) {
      await showMessage('Add users', errors.length > 0 ? errors.join('\n') : 'No user details entered.');
      openAddUsers(rows);
      return;
    }
    await call(() => api.addUsers(users));
    await refreshUsers();
  })();
});

void (async () => {
  const auto = await api.autoConnect();
  if (auto.ok && auto.value) {
    await onConnected();
    return;
  }
  await initConnectForm();
  if (!auto.ok) await showMessage('Automatic connection failed', auto.error);
})();
