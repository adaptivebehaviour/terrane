import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Playwright compiles this file as CommonJS (the shell is not "type": "module", because Electron's sandboxed preload must be CJS).
const appDir = join(__dirname, '..');

interface Launched {
  app: ElectronApplication;
  page: Page;
  requests: string[];
}

/** Starts the built app with its own user-data folder; `workspace` (optional) moves its one workspace out of that folder. */
async function launch(userData: string, workspace?: string): Promise<Launched> {
  const app = await electron.launch({
    // GitHub's Linux runners restrict unprivileged user namespaces, which Chromium's own process sandbox needs.
    args: [appDir, `--user-data-dir=${userData}`, ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [])],
    cwd: appDir,
    env: { ...process.env, ...(workspace ? { AB_E2E_WORKSPACE: workspace } : {}), ELECTRON_RENDERER_URL: '' },
  });
  const page = await app.firstWindow();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.waitForLoadState('domcontentloaded');
  return { app, page, requests };
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
  test('opens its workspace by itself, shows a blank screen, and keeps what is saved to disk across a restart', async () => {
    await withTemp(async (dir) => {
      const userData = join(dir, 'userData');
      const workspace = join(dir, 'My Workspace');

      const first = await launch(userData, workspace);
      await expect(first.page.getByTestId('workspace')).toBeVisible();
      // The default screen is blank: no text, no controls, no chooser.
      expect((await first.page.locator('body').innerText()).trim()).toBe('');
      await expect(first.page.locator('input, button, h1, a')).toHaveCount(0);

      const record = { id: 'n1', kind: 'root', factory: 'component', props: { text: 'remember the milk' }, items: [], refs: [] };
      const put = await first.page.evaluate(async (record) => {
        const bridge = (window as unknown as { abBridge: { records: { put: (input: unknown) => Promise<{ ok: boolean }> } } }).abBridge;
        return (await bridge.records.put({ collection: 'notes', record })).ok;
      }, record);
      expect(put).toBe(true);

      // The data really is a plain JSON file in the workspace folder.
      const files = await readdir(join(workspace, 'collections', 'notes'));
      expect(files).toHaveLength(1);
      const saved = JSON.parse(await readFile(join(workspace, 'collections', 'notes', files[0]), 'utf8'));
      expect(saved.props.text).toBe('remember the milk');
      expect((await readdir(workspace)).sort()).toEqual(['.lock', 'collections', 'files', 'sessions', 'workspace.json']);

      await first.app.close();
      expect(await readdir(workspace)).not.toContain('.lock'); // quitting releases the lock

      const second = await launch(userData, workspace);
      await expect(second.page.getByTestId('workspace')).toBeVisible();
      const listed = await second.page.evaluate(async () => {
        const bridge = (window as unknown as { abBridge: { records: { list: (input: unknown) => Promise<{ ok: boolean; value: { items: { id: string }[] } }> } } }).abBridge;
        return (await bridge.records.list({ collection: 'notes' })).value;
      });
      expect(JSON.stringify(listed)).toContain('remember the milk');
      expect((await second.page.locator('body').innerText()).trim()).toBe('');
      await second.app.close();
    });
  });

  test('without any configuration the workspace lives in the user-data folder', async () => {
    await withTemp(async (dir) => {
      const userData = join(dir, 'userData');
      const { app, page } = await launch(userData);
      await expect(page.getByTestId('workspace')).toBeVisible();
      expect(await readdir(join(userData, 'workspace'))).toContain('workspace.json');
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
      expect(await second.page.evaluate(async () => (await (window as unknown as { abBridge: { workspace: { current: () => Promise<{ ok: boolean; value: { open: boolean } }> } } }).abBridge.workspace.current()).value.open)).toBe(false);

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
        isolated: (window as unknown as { abBridge: { app: Record<string, unknown> } }).abBridge.app.info !== undefined,
        protocol: location.protocol,
      }));
      expect(exposed).toMatchObject({ require: 'undefined', process: 'undefined', buffer: 'undefined', electron: 'undefined', isolated: true, protocol: 'app:' });
      expect(exposed.groups).toEqual(['app', 'credentials', 'events', 'files', 'net', 'records', 'sessions', 'sidecar', 'workspace']);
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
          badId: (await bridge.records.get({ collection: '../x', id: 'a' })).error?.code,
          badPath: (await bridge.files.get({ path: '../workspace.json' })).error?.code,
          badShape: (await bridge.records.get({ collection: 5, id: 'a' })).error?.code,
          unknownMethod: typeof (bridge.records as Record<string, unknown>).drop,
          unknownGroup: typeof (bridge as Record<string, unknown>).fs,
          noGenericInvoke: typeof (bridge as Record<string, unknown>).invoke,
        };
      });
      expect(results).toEqual({ badId: 'invalid_id', badPath: 'invalid_path', badShape: 'invalid_request', unknownMethod: 'undefined', unknownGroup: 'undefined', noGenericInvoke: 'undefined' });
      await app.close();
    });
  });
});
