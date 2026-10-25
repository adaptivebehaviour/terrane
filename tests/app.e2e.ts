import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// Playwright compiles this file as CommonJS (the shell is not "type": "module", because Electron's sandboxed preload must be CJS).
const appDir = join(__dirname, '..');

interface Launched {
  app: ElectronApplication;
  page: Page;
  requests: string[];
}

/**
 * Starts the built app with its own user-data folder. With no current workspace the app asks for a folder; the folder
 * dialog is answered with `workspace` (default: a `workspace` folder inside the user-data folder).
 */
async function launch(userData: string, workspace?: string, files: string[] = []): Promise<Launched> {
  const app = await electron.launch({
    // GitHub's Linux runners restrict unprivileged user namespaces, which Chromium's own process sandbox needs.
    args: [appDir, `--user-data-dir=${userData}`, ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [])],
    cwd: appDir,
    env: { ...process.env, AB_E2E_PICK_FOLDER: workspace ?? join(userData, 'workspace'), AB_E2E_PICK_FILE: files.join(delimiter), ELECTRON_RENDERER_URL: '' },
  });
  const page = await app.firstWindow();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.waitForLoadState('domcontentloaded');
  return { app, page, requests };
}

/** The plus button, then "Select a file" (the native file dialog is answered by AB_E2E_PICK_FILE). */
async function addSelectedFile(page: Page): Promise<void> {
  await page.getByTestId('add').click();
  await page.getByTestId('choose-file').click();
}

async function withTemp<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'ab-electron-e2e-'));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test.describe('electron shell: workspace', () => {
  test('opens a workspace folder by itself, shows only the toolbar, and reopens it after a restart', async () => {
    await withTemp(async (dir) => {
      const userData = join(dir, 'userData');
      const workspace = join(dir, 'My Workspace');

      const first = await launch(userData, workspace);
      await expect(first.page.getByTestId('workspace')).toBeVisible();
      // The screen holds only the toolbar: an open-workspace button and an add button, with icons and no text.
      expect((await first.page.locator('body').innerText()).trim()).toBe('');
      await expect(first.page.locator('input, h1, a')).toHaveCount(0);
      await expect(first.page.locator('[data-testid=toolbar] button')).toHaveCount(2);
      await expect(first.page.locator('[data-testid=toolbar] button').first()).toHaveAttribute('data-testid', 'open-workspace');

      // The folder holds a workspace.json, and a .lock while the app is open: nothing else.
      expect((await readdir(workspace)).sort()).toEqual(['.lock', 'workspace.json']);
      const info = JSON.parse(await readFile(join(workspace, 'workspace.json'), 'utf8'));
      expect(info.appId).toBe('terrane');
      expect(info.nodes).toEqual([]);

      await first.app.close();
      expect(await readdir(workspace)).not.toContain('.lock'); // quitting releases the lock

      // The current workspace is reopened on its own: the folder dialog is not needed (nothing answers it here).
      const second = await launch(userData, join(dir, 'never-picked'));
      await expect(second.page.getByTestId('workspace')).toBeVisible();
      expect(await readdir(dir)).not.toContain('never-picked');
      await second.app.close();
    });
  });

  test('with no current workspace the folder dialog is triggered and the chosen folder becomes the workspace', async () => {
    await withTemp(async (dir) => {
      const userData = join(dir, 'userData');
      const { app, page } = await launch(userData);
      await expect(page.getByTestId('workspace')).toBeVisible();
      expect(await readdir(join(userData, 'workspace'))).toContain('workspace.json'); // the scripted dialog chose this folder
      await app.close();
    });
  });

  test('a chosen folder without a workspace.json becomes a workspace, whatever else it holds', async () => {
    await withTemp(async (dir) => {
      const folder = join(dir, 'Downloads');
      await mkdir(folder);
      await writeFile(join(folder, 'existing.txt'), 'keep me');
      const { app, page } = await launch(join(dir, 'userData'), folder);
      await expect(page.getByTestId('workspace')).toBeVisible();
      await expect(page.getByTestId('error')).toHaveCount(0);
      expect((await readdir(folder)).filter((name) => name !== '.lock').sort()).toEqual(['existing.txt', 'workspace.json']);
      expect(await readFile(join(folder, 'existing.txt'), 'utf8')).toBe('keep me');
      await app.close();
    });
  });

  test('the plus button copies a chosen file into the workspace, shows it as a 100x100 white square and records it in workspace.json', async () => {
    await withTemp(async (dir) => {
      const userData = join(dir, 'userData');
      const workspace = join(dir, 'My Workspace');
      await mkdir(join(dir, 'source'));
      const source = join(dir, 'source', 'report.txt');
      await writeFile(source, 'hello');

      // The file dialog is answered with the same file twice, to see a name clash handled; the third click is cancelled.
      const first = await launch(userData, workspace, [source, source]);
      try {
        await expect(first.page.getByTestId('workspace')).toBeVisible();
        await addSelectedFile(first.page);
        const node = first.page.getByTestId('node');
        await expect(node).toHaveCount(1);
        await expect(node).toHaveText('report.txt');
        const box = await node.boundingBox();
        expect([Math.round(box!.width), Math.round(box!.height)]).toEqual([100, 100]);
        expect(await node.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, align: getComputedStyle(element).textAlign }))).toEqual({ background: 'rgb(255, 255, 255)', align: 'center' });

        await addSelectedFile(first.page);
        await expect(node).toHaveCount(2);
        await expect(node.nth(1)).toHaveText('report (1).txt');
        await addSelectedFile(first.page); // cancelled: nothing changes
        await expect(node).toHaveCount(2);

        expect(await readFile(source, 'utf8')).toBe('hello'); // the original is untouched
        expect((await readdir(workspace)).sort()).toEqual(['.lock', 'report (1).txt', 'report.txt', 'workspace.json']);
        expect(await readFile(join(workspace, 'report.txt'), 'utf8')).toBe('hello');
        const info = JSON.parse(await readFile(join(workspace, 'workspace.json'), 'utf8'));
        expect(info.appId).toBe('terrane'); // the rest of workspace.json is kept
        expect(info.nodes).toMatchObject([{ filename: 'report.txt', size: 5 }, { filename: 'report (1).txt', size: 5 }]);
      } finally {
        await first.app.close().catch(() => undefined);
      }

      // The squares come back when the workspace is reopened.
      const second = await launch(userData, join(dir, 'never-picked'));
      await expect(second.page.getByTestId('node')).toHaveText(['report.txt', 'report (1).txt']);
      await second.app.close();
    });
  });

  test('a file is shown by the handler for its type: jpeg, png and svg by the image handler, anything else by the default one', async () => {
    await withTemp(async (dir) => {
      await mkdir(join(dir, 'source'));
      const names = ['photo.PNG', 'pic.jpeg', 'logo.svg', 'notes.txt', 'noextension'];
      const sources = names.map((name) => join(dir, 'source', name));
      for (const source of sources) await writeFile(source, 'x');
      const { app, page } = await launch(join(dir, 'userData'), join(dir, 'ws'), sources);
      try {
        await expect(page.getByTestId('workspace')).toBeVisible();
        for (let i = 1; i <= names.length; i += 1) {
          await addSelectedFile(page);
          await expect(page.getByTestId('node')).toHaveCount(i);
        }
        await expect(page.getByTestId('node')).toHaveText(names);
        const handlers = await page.getByTestId('node').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-handler')));
        expect(handlers).toEqual(['image', 'image', 'image', 'default', 'default']);
      } finally {
        await app.close().catch(() => undefined);
      }
    });
  });

  test('the image display is portrait: the image in a square above, the name in the bottom 20%, aspect ratio kept', async () => {
    await withTemp(async (dir) => {
      await mkdir(join(dir, 'source'));
      const png = join(dir, 'source', 'dot.png');
      // A 1x1 PNG.
      await writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
      const { app, page } = await launch(join(dir, 'userData'), join(dir, 'ws'), [png]);
      try {
        await expect(page.getByTestId('workspace')).toBeVisible();
        await addSelectedFile(page);
        const node = page.getByTestId('node');
        await expect(node).toHaveAttribute('data-handler', 'image');
        const image = node.locator('img');
        await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(1);

        const box = async (locator: typeof node) => {
          const b = (await locator.boundingBox())!;
          return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
        };
        const whole = await box(node);
        const top = await box(node.getByTestId('node-image'));
        const bottom = await box(node.getByTestId('node-name'));
        expect(whole.height).toBeGreaterThan(whole.width); // portrait
        expect(top).toMatchObject({ x: whole.x, y: whole.y, width: top.height }); // a square at the top
        expect(bottom.height).toBe(Math.round(whole.height * 0.2)); // the name takes 20% of the height
        expect(top.height + bottom.height).toBe(whole.height);
        expect(bottom.y).toBe(top.y + top.height);
        await expect(node.getByTestId('node-name')).toHaveText('dot.png');
        expect(await image.evaluate((element) => getComputedStyle(element).objectFit)).toBe('contain'); // aspect ratio kept
        const shown = await box(image);
        expect(shown.width).toBeLessThanOrEqual(top.width);
        expect(shown.height).toBeLessThanOrEqual(top.height);
      } finally {
        await app.close().catch(() => undefined);
      }
    });
  });

  test('the plus button offers to create a text file: its name and text go into a new file in the workspace and a default node appears', async () => {
    await withTemp(async (dir) => {
      const workspace = join(dir, 'ws');
      const { app, page } = await launch(join(dir, 'userData'), workspace);
      try {
        await expect(page.getByTestId('workspace')).toBeVisible();
        await page.getByTestId('add').click();
        await expect(page.getByTestId('choose-text')).toBeVisible();
        await expect(page.getByTestId('choose-file')).toBeVisible();
        await page.getByTestId('choose-text').click();
        await expect(page.getByTestId('text-create')).toBeDisabled(); // a filename is required
        await page.getByTestId('text-name').fill('shopping');
        await page.getByTestId('text-body').fill('milk\neggs');
        await page.getByTestId('text-create').click();

        const node = page.getByTestId('node');
        await expect(node).toHaveCount(1);
        await expect(node).toHaveText('shopping.txt');
        await expect(node).toHaveAttribute('data-handler', 'default'); // looks like any default node
        await expect(page.getByTestId('add-dialog')).toHaveCount(0);
        expect(await readFile(join(workspace, 'shopping.txt'), 'utf8')).toBe('milk\neggs');
        const info = JSON.parse(await readFile(join(workspace, 'workspace.json'), 'utf8'));
        expect(info.nodes).toMatchObject([{ filename: 'shopping.txt', size: 9 }]);

        // The same name again does not overwrite; an invalid name is refused and nothing is created.
        await page.getByTestId('add').click();
        await page.getByTestId('choose-text').click();
        await page.getByTestId('text-name').fill('shopping.txt');
        await page.getByTestId('text-create').click();
        await expect(node).toHaveText(['shopping.txt', 'shopping (1).txt']);
        await page.getByTestId('add').click();
        await page.getByTestId('choose-text').click();
        await page.getByTestId('text-name').fill('a/b');
        await page.getByTestId('text-create').click();
        await expect(page.getByTestId('error')).toBeVisible();
        await expect(node).toHaveCount(2);

        // Cancelling creates nothing.
        await page.getByTestId('add').click();
        await page.getByTestId('choose-text').click();
        await page.getByTestId('text-name').fill('never');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('add-dialog')).toHaveCount(0);
        await expect(node).toHaveCount(2);
        expect((await readdir(workspace)).sort()).toEqual(['.lock', 'shopping (1).txt', 'shopping.txt', 'workspace.json']);
      } finally {
        await app.close().catch(() => undefined);
      }
    });
  });

  test('an existing workspace.json without nodes gets an empty nodes array, and its other entries are kept', async () => {
    await withTemp(async (dir) => {
      const folder = join(dir, 'old');
      await mkdir(folder);
      await writeFile(join(folder, 'workspace.json'), JSON.stringify({ title: 'mine' }));
      const { app, page } = await launch(join(dir, 'userData'), folder);
      await expect(page.getByTestId('workspace')).toBeVisible();
      expect(JSON.parse(await readFile(join(folder, 'workspace.json'), 'utf8'))).toEqual({ title: 'mine', nodes: [] });
      await app.close();
    });
  });

  test('a second app instance cannot open a workspace that is already open, and shows nothing for it', async () => {
    await withTemp(async (dir) => {
      const workspace = join(dir, 'shared');
      const first = await launch(join(dir, 'userData-1'), workspace);
      await expect(first.page.getByTestId('workspace')).toBeVisible();

      const second = await launch(join(dir, 'userData-2'), workspace);
      await second.page.waitForLoadState('load');
      await expect(second.page.getByTestId('workspace')).toHaveCount(0);
      expect(await second.page.evaluate(async () => (await (window as unknown as { workspaceBridge: { current: () => Promise<{ open: boolean }> } }).workspaceBridge.current()).open)).toBe(false);

      await first.app.close();
      await second.app.close();
    });
  });

  test('the app makes no network request: everything it loads comes from the app itself', async () => {
    await withTemp(async (dir) => {
      const { app, page, requests } = await launch(join(dir, 'userData'));
      await expect(page.getByTestId('workspace')).toBeVisible();
      expect(requests.length).toBeGreaterThan(0);
      for (const url of requests) expect(url, url).toMatch(/^(app|data|blob):/);
      await app.close();
    });
  });
});

test.describe('electron shell: security', () => {
  test('the renderer has no Node, no Electron and only the declared bridge', async () => {
    await withTemp(async (dir) => {
      const { app, page } = await launch(join(dir, 'userData'));
      const exposed = await page.evaluate(() => ({
        require: typeof (globalThis as Record<string, unknown>).require,
        process: typeof (globalThis as Record<string, unknown>).process,
        buffer: typeof (globalThis as Record<string, unknown>).Buffer,
        electron: typeof (globalThis as Record<string, unknown>).electron,
        groups: Object.keys((window as unknown as { abBridge: object }).abBridge).sort(),
        workspaceBridge: Object.keys((window as unknown as { workspaceBridge: object }).workspaceBridge).sort(),
        isolated: (window as unknown as { abBridge: { app: Record<string, unknown> } }).abBridge.app.info !== undefined,
        protocol: location.protocol,
      }));
      expect(exposed).toMatchObject({ require: 'undefined', process: 'undefined', buffer: 'undefined', electron: 'undefined', isolated: true, protocol: 'app:' });
      expect(exposed.workspaceBridge).toEqual(['addFile', 'createInformation', 'createLink', 'createText', 'current', 'open', 'readNode', 'setLinkWeight']);
      expect(exposed.groups).toEqual(['app', 'credentials', 'net', 'sidecar']);
      await app.close();
    });
  });

  test('window.open and navigation away from the app are blocked', async () => {
    await withTemp(async (dir) => {
      const { app, page } = await launch(join(dir, 'userData'));
      const before = app.windows().length;
      const opened = await page.evaluate(() => window.open('https://example.com') === null);
      expect(opened).toBe(true);
      await page.evaluate(() => { location.href = 'https://example.com/'; });
      await page.waitForTimeout(500);
      expect(page.url()).toMatch(/^app:\/\//);
      expect(app.windows().length).toBe(before);
      await app.close();
    });
  });

  test('the CSP stops the renderer reaching any remote origin', async () => {
    await withTemp(async (dir) => {
      const { app, page } = await launch(join(dir, 'userData'));
      const outcome = await page.evaluate(async () => {
        try {
          await fetch('https://example.com/');
          return 'fetched';
        } catch {
          return 'blocked';
        }
      });
      expect(outcome).toBe('blocked');
      const csp = await page.evaluate(async () => (await fetch(location.href)).headers.get('content-security-policy'));
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("object-src 'none'");
      await app.close();
    });
  });

  test('bad requests over the bridge come back as coded errors, and the bridge cannot reach an unknown channel', async () => {
    await withTemp(async (dir) => {
      const { app, page } = await launch(join(dir, 'userData'));
      await expect(page.getByTestId('workspace')).toBeVisible();
      const results = await page.evaluate(async () => {
        const bridge = (window as unknown as { abBridge: Record<string, Record<string, (input?: unknown) => Promise<{ ok: boolean; error?: { code: string } }>>> }).abBridge;
        return {
          badShape: (await bridge.credentials.status({ service: 5 })).error?.code,
          unknownMethod: typeof (bridge.credentials as Record<string, unknown>).drop,
          unknownGroup: typeof (bridge as Record<string, unknown>).fs,
          noGenericInvoke: typeof (bridge as Record<string, unknown>).invoke,
        };
      });
      expect(results).toEqual({ badShape: 'invalid_request', unknownMethod: 'undefined', unknownGroup: 'undefined', noGenericInvoke: 'undefined' });
      await app.close();
    });
  });
});
