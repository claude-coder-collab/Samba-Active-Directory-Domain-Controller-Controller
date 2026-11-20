import { contextBridge, ipcRenderer } from 'electron';
import { apiMethods, type SdccApi } from '../core/api.js';

const api: Record<string, unknown> = Object.fromEntries(apiMethods.map((name) => [name, (...args: unknown[]) => ipcRenderer.invoke(name, ...args)]));
api['onMenu'] = (handler: Parameters<SdccApi['onMenu']>[0]) => {
  ipcRenderer.on('menu', (_e, action: Parameters<typeof handler>[0]) => handler(action));
};

contextBridge.exposeInMainWorld('sdcc', api);
