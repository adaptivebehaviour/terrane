import { buildBridge } from '@adaptivebehaviour/desktop/src/ipc/index';
import { contextBridge, ipcRenderer } from 'electron';

// The only bridge between the renderer and the main process: one named function per channel in the IPC contract,
// each of which resolves with a plain result. There is no generic "invoke any channel" function, and nothing
// from Node or Electron is exposed.
contextBridge.exposeInMainWorld('abBridge', buildBridge((channel, payload) => ipcRenderer.invoke(channel, payload)));

// The application's workspace: a folder the user picks (see main/workspace.ts).
contextBridge.exposeInMainWorld('workspaceBridge', {
  current: () => ipcRenderer.invoke('terrane:workspace.current'),
  open: () => ipcRenderer.invoke('terrane:workspace.open'),
  readNode: (id: string) => ipcRenderer.invoke('terrane:workspace.readNode', id),
  openNode: (id: string) => ipcRenderer.invoke('terrane:workspace.openNode', id),
  createText: (name: string, text: string) => ipcRenderer.invoke('terrane:workspace.createText', name, text),
  addFile: () => ipcRenderer.invoke('terrane:workspace.addFile'),
  createInformation: (text: string) => ipcRenderer.invoke('terrane:workspace.createInformation', text),
  createInformationLinked: (text: string, target: string) => ipcRenderer.invoke('terrane:workspace.createInformationLinked', text, target),
  updateInformation: (id: string, text: string) => ipcRenderer.invoke('terrane:workspace.updateInformation', id, text),
  createLink: (source: string, target: string) => ipcRenderer.invoke('terrane:workspace.createLink', source, target),
  setLinkWeight: (id: string, weight: number) => ipcRenderer.invoke('terrane:workspace.setLinkWeight', id, weight),
});
