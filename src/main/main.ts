import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { apiMethods, type SdccApi } from '../core/api.js';
import type { NewUser } from '../core/types.js';
import { loadPreferences, savePreferences } from './prefs.js';
import { Session, wrap } from './session.js';
import { SshExecutor } from './ssh.js';

const userDataOverride = process.env['SDCC_USER_DATA'];
if (userDataOverride !== undefined && userDataOverride !== '') app.setPath('userData', userDataOverride);

let mainWindow: BrowserWindow | undefined;
const prefsPath = (): string => join(app.getPath('userData'), 'prefs.json');

const session = new Session({
  connect: (host, port, username, password, verifyHostKey) => SshExecutor.connect({ host, port, username, password, verifyHostKey }),
  confirmNewHostKey: async (host, fp) => {
    const opts = {
      type: 'question' as const,
      buttons: ['Trust and connect', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unknown host key',
      message: `First connection to ${host}`,
      detail: `The server's host key fingerprint is:\n\n${fp}\n\nCheck it on the server with:\nssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`,
    };
    const r = mainWindow ? await dialog.showMessageBox(mainWindow, opts) : await dialog.showMessageBox(opts);
    return r.response === 0;
  },
  reportChangedHostKey: async (host, expected, actual) => {
    const opts = {
      type: 'error' as const,
      title: 'Host key changed',
      message: `The host key for ${host} has changed. The connection was refused.`,
      detail: `Expected: ${expected}\nReceived: ${actual}\n\nIf the server was legitimately reinstalled, remove its entry from:\n${prefsPath()}`,
    };
    if (mainWindow) await dialog.showMessageBox(mainWindow, opts);
    else await dialog.showMessageBox(opts);
  },
  loadPreferences: () => loadPreferences(prefsPath()),
  savePreferences: (p) => savePreferences(prefsPath(), p),
});

type Handlers = { [K in (typeof apiMethods)[number]]: (...args: Parameters<SdccApi[K]>) => ReturnType<SdccApi[K]> };

const handlers: Handlers = {
  getPreferences: () => wrap(() => loadPreferences(prefsPath())),
  connect: (req) => wrap(async () => {
    await session.connect(req);
    return null;
  }),
  autoConnect: () => wrap(() => session.autoConnect()),
  disconnect: () => wrap(async () => {
    session.disconnect();
    return Promise.resolve(null);
  }),
  setAutoConnect: (enabled) => wrap(async () => {
    await session.setAutoConnect(enabled);
    return null;
  }),
  snapshot: () => wrap(() => session.snapshot()),
  getUsers: () => wrap(() => session.tools.getUsers()),
  getGroups: () => wrap(() => session.tools.getGroups()),
  getPolicy: () => wrap(() => session.tools.getPasswordPolicy()),
  addUsers: (users: NewUser[]) => wrap(async () => {
    await session.tools.addUsers(users);
    return null;
  }),
  deleteUsers: (u) => wrap(async () => {
    await session.tools.deleteUsers(u);
    return null;
  }),
  enableUsers: (u) => wrap(async () => {
    await session.tools.enableUsers(u);
    return null;
  }),
  disableUsers: (u) => wrap(async () => {
    await session.tools.disableUsers(u);
    return null;
  }),
  setPassword: (u, p, m) => wrap(async () => {
    await session.tools.setPassword(u, p, m);
    return null;
  }),
  addGroup: (g) => wrap(async () => {
    await session.tools.addGroup(g);
    return null;
  }),
  deleteGroup: (g) => wrap(async () => {
    await session.tools.deleteGroup(g);
    return null;
  }),
  addGroupMembers: (g, m) => wrap(async () => {
    await session.tools.addGroupMembers(g, m);
    return null;
  }),
  removeGroupMembers: (g, m) => wrap(async () => {
    await session.tools.removeGroupMembers(g, m);
    return null;
  }),
  setPolicy: (c) => wrap(async () => {
    await session.tools.setPasswordPolicy(c);
    return null;
  }),
};

function sendMenu(action: 'disable-auto-connect' | 'disconnect' | 'refresh'): void {
  mainWindow?.webContents.send('menu', action);
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Connection',
      submenu: [
        { label: 'Refresh', accelerator: 'CmdOrCtrl+R', click: () => sendMenu('refresh') },
        { label: 'Disconnect', click: () => sendMenu('disconnect') },
        { label: "Don't Connect Automatically", click: () => sendMenu('disable-auto-connect') },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ];
  if (!app.isPackaged) template.push({ label: 'Develop', submenu: [{ role: 'toggleDevTools' }, { role: 'forceReload' }] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: 'Samba Domain Controller Controller',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

void app.whenReady().then(() => {
  for (const name of apiMethods) {
    ipcMain.handle(name, (_e, ...args: unknown[]) => (handlers[name] as (...a: unknown[]) => unknown)(...args));
  }
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  session.disconnect();
  app.quit();
});
