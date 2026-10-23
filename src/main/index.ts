import { createHandlers } from '@adaptivebehaviour/desktop/src/main/index';
import { registerHandlers, type IpcEventLike } from '@adaptivebehaviour/desktop/src/ipc/index';
import { buildCsp, EnvironmentCredentials, NetworkServices } from '@adaptivebehaviour/desktop/src/net/index';
import { app, BrowserWindow, dialog, ipcMain, net as electronNet, protocol, session, shell } from 'electron';
import { delimiter, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_ID, APP_NAME, externalLinkOrigins, services } from './config';
import { createSidecar } from './sidecar';
import { Workspace } from './workspace';

const APP_ORIGIN = 'app://app';
// In development the renderer is served by the Vite dev server; in a build it is served from the app:// protocol.
const devUrl = (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) || undefined;

// Must run before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const log = (...parts: unknown[]) => console.log(new Date().toISOString(), ...parts);

function isAppUrl(url: string): boolean {
  return url.startsWith(`${APP_ORIGIN}/`) || (devUrl !== undefined && url.startsWith(devUrl));
}

/** Test-only: in a development run (never a packaged one) AB_E2E_PICK_FOLDER answers the folder dialogs, one path per dialog. */
const scriptedFolders: string[] = !app.isPackaged && process.env['AB_E2E_PICK_FOLDER'] ? process.env['AB_E2E_PICK_FOLDER'].split(delimiter) : [];

async function pickFolder(purpose: 'create' | 'open'): Promise<string | undefined> {
  if (scriptedFolders.length > 0) return scriptedFolders.shift();
  const options: Electron.OpenDialogOptions = {
    title: purpose === 'create' ? 'Choose an empty folder for the new workspace' : 'Choose a workspace folder',
    properties: purpose === 'create' ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
  };
  const window = BrowserWindow.getFocusedWindow();
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
}

/** Test-only: in a development run AB_E2E_PICK_FILE answers the file dialogs, one path per dialog. */
const scriptedFiles: string[] = !app.isPackaged && process.env['AB_E2E_PICK_FILE'] ? process.env['AB_E2E_PICK_FILE'].split(delimiter) : [];

async function pickFile(): Promise<string | undefined> {
  if (scriptedFiles.length > 0) return scriptedFiles.shift();
  const options: Electron.OpenDialogOptions = { title: 'Choose a file to add to the workspace', properties: ['openFile'] };
  const window = BrowserWindow.getFocusedWindow();
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
}

function serveRenderer(): void {
  const rendererRoot = join(__dirname, '../renderer');
  const csp = buildCsp(services);
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    const requested = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    const file = join(rendererRoot, requested);
    if (file !== rendererRoot && !file.startsWith(rendererRoot + sep)) return new Response('Forbidden', { status: 403 });
    const upstream = await electronNet.fetch(pathToFileURL(file).toString());
    const headers = new Headers(upstream.headers);
    headers.set('Content-Security-Policy', csp);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(upstream.body, { status: upstream.status, headers });
  });
}

function hardenSession(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  if (devUrl) {
    const csp = buildCsp(services, { dev: { origin: new URL(devUrl).origin } });
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };
      if (details.url.startsWith(devUrl)) headers['Content-Security-Policy'] = [csp];
      callback({ responseHeaders: headers });
    });
  }
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url);
        if (target.protocol === 'https:' && externalLinkOrigins.includes(target.origin)) void shell.openExternal(url);
      } catch {
        // an unparseable URL is simply denied
      }
      return { action: 'deny' };
    });
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: APP_NAME,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  window.once('ready-to-show', () => window.show());
  void window.loadURL(devUrl ?? `${APP_ORIGIN}/index.html`);
  return window;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(async () => {
    // The Python backend (if the application has one) lives and dies with the open workspace.
    const sidecar = createSidecar({
      log,
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      allowedEnv: services.flatMap((service) => (service.credential ? [service.credential.env] : [])),
    });
    const net = new NetworkServices({ services, credentials: new EnvironmentCredentials(), log });
    // The framework's own API (records, sessions, files, …) is registered but unused: no framework workspace is opened.
    const handlers = createHandlers({
      app: { name: APP_NAME, version: app.getVersion(), platform: process.platform },
      net,
      sidecar,
    });
    registerHandlers(ipcMain, handlers, {
      isTrustedSender: (event: IpcEventLike) => isAppUrl(event.senderFrame?.url ?? ''),
      onError: (channel, error) => log(`[ipc] ${channel} failed:`, error instanceof Error ? error.message : error),
    });

    // The workspace is a folder the user picks; the last one is reopened at startup. With none open, the renderer
    // asks the user to select a folder.
    const workspace = new Workspace({
      settingsFile: join(app.getPath('userData'), 'last-workspace.json'),
      appId: APP_ID,
      createdBy: `${APP_ID} ${app.getVersion()}`,
      pickFolder: () => pickFolder('open'),
      pickFile,
      onOpened: () => sidecar?.start(),
      onClosed: () => sidecar?.stop(),
      onHookError: (error) => log('[workspace] hook failed:', error instanceof Error ? error.message : error),
    });
    const trusted = (event: Electron.IpcMainInvokeEvent) => {
      if (!isAppUrl(event.senderFrame?.url ?? '')) throw new Error('Untrusted sender');
    };
    ipcMain.handle('terrane:workspace.current', (event) => (trusted(event), workspace.state()));
    ipcMain.handle('terrane:workspace.open', (event) => (trusted(event), workspace.open()));
    ipcMain.handle('terrane:workspace.readNode', (event, id: unknown) => (trusted(event), typeof id === 'string' ? workspace.readNode(id) : Promise.reject(new Error('Invalid node id'))));
    ipcMain.handle('terrane:workspace.createText', (event, name: unknown, text: unknown) => {
      trusted(event);
      if (typeof name !== 'string' || typeof text !== 'string') throw new Error('Invalid text file');
      return workspace.createText(name, text);
    });
    ipcMain.handle('terrane:workspace.addFile', (event) => (trusted(event), workspace.addFile()));
    try {
      await workspace.reopenLast();
    } catch (error) {
      log('[workspace] could not reopen the last workspace:', error instanceof Error ? error.message : error);
    }

    hardenSession();
    if (!devUrl) serveRenderer();
    const window = createWindow();

    app.on('second-instance', () => {
      if (window.isMinimized()) window.restore();
      window.focus();
    });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // Release the workspace lock (and let any in-flight write finish) before the process exits.
    let closing = false;
    app.on('before-quit', (event) => {
      if (closing) return;
      event.preventDefault();
      closing = true;
      void Promise.allSettled([workspace.close(), sidecar?.stop()]).finally(() => app.quit());
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
