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
 * Starts the built app with its own user-data folder. The app reopens the last workspace on its own, and otherwise shows
 * only the toolbar. The folder dialogs are answered, one folder per dialog, with `workspace` (none by default);
 * several folders are separated by the path delimiter.
 */
async function launch(userData: string, workspace?: string, files: string[] = []): Promise<Launched> {
  const app = await electron.launch({
    // GitHub's Linux runners restrict unprivileged user namespaces, which Chromium's own process sandbox needs.
    args: [appDir, `--user-data-dir=${userData}`, ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [])],
    cwd: appDir,
    env: { ...process.env, AB_E2E_PICK_FOLDER: workspace ?? '', AB_E2E_PICK_FILE: files.join(delimiter), ELECTRON_RENDERER_URL: '' },
  });
  const page = await app.firstWindow();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.waitForLoadState('domcontentloaded');
  return { app, page, requests };
}

/** Starts the app and opens the workspace folder `workspace` with the open-workspace button (the folder dialog is answered by AB_E2E_PICK_FOLDER). */
async function launchOpened(userData: string, workspace: string, files: string[] = []): Promise<Launched> {
  const launched = await launch(userData, workspace, files);
  await launched.page.getByTestId('open-workspace').click();
  await expect(launched.page.getByTestId('workspace')).toBeVisible();
  return launched;
}

interface NodeFields {
  title?: string;
  description?: string;
  body?: string;
  /** The fields to tick (of those with text); the others are unticked. Absent: the dialog's own ticks. */
  show?: ('title' | 'description' | 'body')[];
  /** Click "File" (the native file dialog is answered by AB_E2E_PICK_FILE). */
  file?: boolean;
  copy?: boolean;
}

/** The Add button, then the node dialog filled in with `fields`, then "Create". */
async function createNode(page: Page, fields: NodeFields): Promise<void> {
  await page.getByTestId('add').click();
  const dialog = page.getByTestId('node-dialog');
  for (const field of ['title', 'description', 'body'] as const) if (fields[field] !== undefined) await dialog.getByTestId(`node-${field}`).fill(fields[field]!);
  if (fields.file) {
    await dialog.getByTestId('node-file').click();
    await expect(dialog.getByTestId('node-path')).toBeVisible();
  }
  if (fields.copy !== undefined) await dialog.getByTestId('node-copy').setChecked(fields.copy);
  if (fields.show) {
    for (const field of ['title', 'description', 'body'] as const) {
      const box = dialog.getByTestId(`show-${field}`);
      if (await box.isEnabled()) await box.setChecked(fields.show.includes(field));
    }
  }
  await dialog.getByTestId('node-submit').click();
  await expect(dialog).toHaveCount(0);
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
  test('shows only the toolbar until a workspace folder is opened, and reopens it after a restart', async () => {
    await withTemp(async (dir) => {
      const userData = join(dir, 'userData');
      const workspace = join(dir, 'My Workspace');

      const first = await launch(userData, workspace);
      // Nothing is asked for: the screen holds only the toolbar (a new-workspace, an open-workspace and an add button, with
      // icons and no text), and no workspace is open.
      await expect(first.page.getByTestId('toolbar')).toBeVisible();
      await expect(first.page.getByTestId('workspace')).toHaveCount(0);
      expect((await first.page.locator('body').innerText()).trim()).toBe('');
      await expect(first.page.locator('input, h1, a')).toHaveCount(0);
      await expect(first.page.locator('[data-testid=toolbar] button')).toHaveCount(3);
      expect(await first.page.locator('[data-testid=toolbar] button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-testid')))).toEqual(['new-workspace', 'open-workspace', 'add']);

      await first.page.getByTestId('open-workspace').click();
      await expect(first.page.getByTestId('workspace')).toBeVisible();

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

  test('new workspace asks for a name and a location, creates the folder there as a workspace, and reopens it after a restart', async () => {
    await withTemp(async (dir) => {
      const userData = join(dir, 'userData');
      const location = join(dir, 'Locations');
      await mkdir(location);
      // The folder dialog is answered with `location` (for the "Location" button).
      const first = await launch(userData, location);
      try {
        await first.page.getByTestId('new-workspace').click();
        const dialog = first.page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled(); // a name is required
        await dialog.getByLabel('Name').fill('a/b');
        await expect(dialog.getByRole('alert')).not.toHaveText('');
        await dialog.getByLabel('Name').fill('Fresh');
        await dialog.getByRole('button', { name: 'Location' }).click();
        await expect(dialog.getByTestId('workspace-location')).toHaveText(location);
        await dialog.getByRole('button', { name: 'Create' }).click();
        await expect(first.page.getByTestId('workspace')).toBeVisible();
        await expect(first.page.getByRole('dialog')).toHaveCount(0);

        // The new folder is a Terrane workspace like any other: a workspace.json, and a .lock while the app is open.
        expect((await readdir(join(location, 'Fresh'))).sort()).toEqual(['.lock', 'workspace.json']);
        expect(JSON.parse(await readFile(join(location, 'Fresh', 'workspace.json'), 'utf8')).appId).toBe('terrane');
        const settings = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8'));
        expect(settings).toEqual({ lastWorkspace: join(location, 'Fresh'), workspaceLocation: location });
      } finally {
        await first.app.close().catch(() => undefined);
      }

      const second = await launch(userData, join(dir, 'never-picked'));
      await expect(second.page.getByTestId('workspace')).toBeVisible();
      await second.app.close();
    });
  });

  test('a new workspace cannot take the name of a folder that exists, and nothing is opened', async () => {
    await withTemp(async (dir) => {
      const location = join(dir, 'Locations');
      await mkdir(join(location, 'Taken'), { recursive: true });
      const { app, page } = await launch(join(dir, 'userData'), location);
      try {
        await page.getByTestId('new-workspace').click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'Location' }).click();
        await dialog.getByLabel('Name').fill('Taken');
        await dialog.getByRole('button', { name: 'Create' }).click();
        await expect(dialog.getByRole('alert')).toContainText('already exists');
        await expect(page.getByTestId('workspace')).toHaveCount(0);
        expect(await readdir(join(location, 'Taken'))).toEqual([]);
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
      } finally {
        await app.close().catch(() => undefined);
      }
    });
  });

  test('a chosen folder without a workspace.json becomes a workspace, whatever else it holds', async () => {
    await withTemp(async (dir) => {
      const folder = join(dir, 'Downloads');
      await mkdir(folder);
      await writeFile(join(folder, 'existing.txt'), 'keep me');
      const { app, page } = await launchOpened(join(dir, 'userData'), folder);
      await expect(page.getByTestId('workspace')).toBeVisible();
      await expect(page.getByTestId('error')).toHaveCount(0);
      expect((await readdir(folder)).filter((name) => name !== '.lock').sort()).toEqual(['existing.txt', 'workspace.json']);
      expect(await readFile(join(folder, 'existing.txt'), 'utf8')).toBe('keep me');
      await app.close();
    });
  });

  test('Add opens the node dialog: Title ticked by default, a checkbox disabled while its field is empty, Create disabled until a ticked field has text', async () => {
    await withTemp(async (dir) => {
      const workspace = join(dir, 'ws');
      const { app, page } = await launchOpened(join(dir, 'userData'), workspace);
      try {
        await page.getByTestId('add').click();
        const dialog = page.getByTestId('node-dialog');
        await expect(dialog).toBeVisible();
        expect(await Promise.all(['title', 'description', 'body'].map((field) => dialog.getByTestId(`node-${field}`).getAttribute('rows')))).toEqual(['1', '2', '10']);
        await expect(dialog.getByTestId('show-title')).toBeChecked();
        await expect(dialog.getByTestId('show-title')).toBeDisabled(); // ticked, but its field is empty
        await expect(dialog.getByTestId('show-description')).not.toBeChecked();
        await expect(dialog.getByTestId('show-description')).toBeDisabled();
        await expect(dialog.getByTestId('show-body')).not.toBeChecked();
        await expect(dialog.getByTestId('show-body')).toBeDisabled();
        await expect(dialog.getByTestId('node-copy')).not.toBeChecked();
        await expect(dialog.getByTestId('node-path')).toHaveCount(0);
        await expect(dialog.getByTestId('node-submit')).toHaveText('Create');
        await expect(dialog.getByTestId('node-submit')).toBeDisabled();

        // Text in an unticked field is not enough; ticking it is.
        await dialog.getByTestId('node-body').fill('just a body');
        await expect(dialog.getByTestId('show-body')).toBeEnabled();
        await expect(dialog.getByTestId('node-submit')).toBeDisabled();
        await dialog.getByTestId('show-body').check();
        await expect(dialog.getByTestId('node-submit')).toBeEnabled();
        await dialog.getByTestId('node-submit').click();
        await expect(dialog).toHaveCount(0);

        const node = page.getByTestId('node');
        await expect(node).toHaveText('just a body');
        await expect(node).toHaveAttribute('data-handler', 'text');
        const box = await node.boundingBox();
        expect([Math.round(box!.width), Math.round(box!.height)]).toEqual([100, 100]);
        const info = JSON.parse(await readFile(join(workspace, 'workspace.json'), 'utf8'));
        expect(info.appId).toBe('terrane'); // the rest of workspace.json is kept
        expect(info.nodes).toEqual([{ id: expect.any(String), addedAt: expect.any(String), title: null, description: null, body: 'just a body', display: ['body'] }]);

        // Ctrl+N opens the same dialog; cancelling it creates nothing.
        await page.keyboard.press('Control+n');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByTestId('node-submit')).toHaveText('Create');
        await dialog.getByTestId('node-title').fill('never');
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(node).toHaveCount(1);

        // Right-clicking the canvas or a node does nothing.
        await page.getByTestId('workspace').click({ button: 'right', position: { x: 10, y: 10 } });
        await node.click({ button: 'right' });
        await expect(page.locator('dialog[open], [role=menu]')).toHaveCount(0);
      } finally {
        await app.close().catch(() => undefined);
      }
    });
  });

  test('a node shows its ticked fields in the order title, description, body, each on its own line and without labels; a long body is cut at 127 characters', async () => {
    await withTemp(async (dir) => {
      const { app, page } = await launchOpened(join(dir, 'userData'), join(dir, 'ws'));
      try {
        await createNode(page, { title: 'T', description: 'D', body: 'b'.repeat(200), show: ['title', 'description', 'body'] });
        await createNode(page, { title: 'T2', description: 'D2', body: 'short', show: ['title', 'body'] });
        await createNode(page, { title: 'T3', description: 'D3', body: 'short', show: ['description', 'body'] });
        await createNode(page, { title: 'T4', description: 'D4', body: 'short', show: ['title'] });
        const lines = (index: number) => page.getByTestId('node').nth(index).getByTestId('node-line');
        await expect(lines(0)).toHaveText(['T', 'D', `${'b'.repeat(127)}…`]);
        await expect(lines(1)).toHaveText(['T2', 'short']);
        await expect(lines(2)).toHaveText(['D3', 'short']);
        await expect(lines(3)).toHaveText(['T4']);
        await expect(page.getByTestId('workspace')).not.toContainText('Title');
        // Each line is below the one before it.
        const tops = await lines(0).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
        expect(tops[1]).toBeGreaterThan(tops[0]);
        expect(tops[2]).toBeGreaterThan(tops[1]);
      } finally {
        await app.close().catch(() => undefined);
      }
    });
  });

  test('a file chosen in the node dialog is left where it is unless copying is ticked; its name fills an empty title', async () => {
    await withTemp(async (dir) => {
      const userData = join(dir, 'userData');
      const workspace = join(dir, 'ws');
      await mkdir(join(dir, 'source'));
      const source = join(dir, 'source', 'report.txt');
      await writeFile(source, 'hello');

      // The file dialog is answered with the same file three times, then cancelled.
      const first = await launchOpened(userData, workspace, [source, source, source, '']);
      const { page } = first;
      try {
        // Not copied (the default): the path is the original's, and the file's name becomes the empty title.
        await page.getByTestId('add').click();
        const dialog = page.getByTestId('node-dialog');
        await dialog.getByTestId('node-file').click();
        await expect(dialog.getByTestId('node-path')).toHaveText(source);
        await expect(dialog.getByTestId('node-title')).toHaveValue('report.txt');
        await dialog.getByTestId('node-submit').click();
        await expect(page.getByTestId('node')).toHaveText('report.txt');
        await expect(page.getByTestId('node')).toHaveAttribute('data-handler', 'default');

        // A title already typed is kept; copied into the workspace, a clashing name is numbered.
        await createNode(page, { title: 'mine', file: true, copy: true });
        await createNode(page, { file: true, copy: true });
        await expect(page.getByTestId('node')).toHaveText(['report.txt', 'mine', 'report.txt']);

        // A cancelled file dialog chooses nothing.
        await page.getByTestId('add').click();
        await dialog.getByTestId('node-file').click();
        await expect(dialog.getByTestId('node-path')).toHaveCount(0);
        await page.keyboard.press('Escape');

        expect(await readFile(source, 'utf8')).toBe('hello'); // the original is untouched
        expect((await readdir(workspace)).sort()).toEqual(['.lock', 'report (1).txt', 'report.txt', 'workspace.json']);
        const info = JSON.parse(await readFile(join(workspace, 'workspace.json'), 'utf8'));
        expect(info.nodes).toMatchObject([
          { title: 'report.txt', display: ['title'], filename: 'report.txt', path: source },
          { title: 'mine', filename: 'report.txt', path: 'report.txt' },
          { title: 'report.txt', filename: 'report (1).txt', path: 'report (1).txt' },
        ]);
        expect(info.nodes.some((node: object) => 'size' in node)).toBe(false);
      } finally {
        await first.app.close().catch(() => undefined);
      }

      // The nodes come back when the workspace is reopened.
      const second = await launch(userData, join(dir, 'never-picked'));
      await expect(second.page.getByTestId('node')).toHaveText(['report.txt', 'mine', 'report.txt']);
      await second.app.close();
    });
  });

  test('a file is shown by the handler for its type: jpeg, png and svg by the image handler, anything else by the default one', async () => {
    await withTemp(async (dir) => {
      await mkdir(join(dir, 'source'));
      const names = ['photo.PNG', 'pic.jpeg', 'logo.svg', 'notes.txt', 'noextension'];
      const sources = names.map((name) => join(dir, 'source', name));
      for (const source of sources) await writeFile(source, 'x');
      const { app, page } = await launchOpened(join(dir, 'userData'), join(dir, 'ws'), sources);
      try {
        for (let i = 1; i <= names.length; i += 1) {
          await createNode(page, { file: true });
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

  test('the image display is portrait (the image in a square above, the text in the bottom 20%), and shows no image while the body is shown', async () => {
    await withTemp(async (dir) => {
      await mkdir(join(dir, 'source'));
      const png = join(dir, 'source', 'dot.png');
      // A 1x1 PNG.
      await writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
      const { app, page } = await launchOpened(join(dir, 'userData'), join(dir, 'ws'), [png]);
      try {
        await createNode(page, { file: true, copy: true });
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
        const bottom = await box(node.getByTestId('node-text'));
        expect(whole.height).toBeGreaterThan(whole.width); // portrait
        expect(top).toMatchObject({ x: whole.x, y: whole.y, width: top.height }); // a square at the top
        expect(bottom.height).toBe(Math.round(whole.height * 0.2)); // the text takes 20% of the height
        expect(top.height + bottom.height).toBe(whole.height);
        expect(bottom.y).toBe(top.y + top.height);
        await expect(node.getByTestId('node-text')).toHaveText('dot.png');
        expect(await image.evaluate((element) => getComputedStyle(element).objectFit)).toBe('contain'); // aspect ratio kept
        const shown = await box(image);
        expect(shown.width).toBeLessThanOrEqual(top.width);
        expect(shown.height).toBeLessThanOrEqual(top.height);

        // With the body shown, there is no image: a 100x100 square with the lines.
        await node.dblclick();
        await page.getByTestId('node-body').fill('a body');
        await page.getByTestId('show-body').check();
        await page.getByTestId('node-submit').click();
        await expect(node.getByTestId('node-line')).toHaveText(['dot.png', 'a body']);
        await expect(node.locator('img')).toHaveCount(0);
        expect(await box(node)).toMatchObject({ width: 100, height: 100 });
      } finally {
        await app.close().catch(() => undefined);
      }
    });
  });

  test('double-clicking a node opens the dialog filled in, with Save; saving replaces the node, cancelling changes nothing', async () => {
    await withTemp(async (dir) => {
      const workspace = join(dir, 'ws');
      await mkdir(join(dir, 'source'));
      const source = join(dir, 'source', 'later.txt');
      await writeFile(source, 'x');
      const { app, page } = await launchOpened(join(dir, 'userData'), workspace, [source]);
      try {
        await createNode(page, { title: 'remember', body: 'the milk' });
        const before = JSON.parse(await readFile(join(workspace, 'workspace.json'), 'utf8')).nodes[0];
        const node = page.getByTestId('node');

        await node.dblclick();
        const dialog = page.getByTestId('node-dialog');
        await expect(dialog.getByTestId('node-title')).toHaveValue('remember');
        await expect(dialog.getByTestId('node-body')).toHaveValue('the milk');
        await expect(dialog.getByTestId('show-title')).toBeChecked();
        await expect(dialog.getByTestId('show-body')).not.toBeChecked();
        await expect(dialog.getByTestId('node-submit')).toHaveText('Save');
        await dialog.getByTestId('node-title').fill('changed');
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(node).toHaveText('remember');

        // Everything can be changed, including giving the node a file.
        await node.dblclick();
        await dialog.getByTestId('node-title').fill('');
        await dialog.getByTestId('node-description').fill('described');
        await dialog.getByTestId('show-description').check();
        await dialog.getByTestId('show-body').check();
        await dialog.getByTestId('node-file').click();
        await expect(dialog.getByTestId('node-title')).toHaveValue('later.txt'); // the emptied title takes the file's name
        await dialog.getByTestId('node-submit').click();
        await expect(dialog).toHaveCount(0);
        await expect(node).toHaveCount(1);
        await expect(node.getByTestId('node-line')).toHaveText(['later.txt', 'described', 'the milk']);
        await expect(node).toHaveAttribute('data-handler', 'default');
        const after = JSON.parse(await readFile(join(workspace, 'workspace.json'), 'utf8')).nodes;
        expect(after).toEqual([
          { id: before.id, addedAt: before.addedAt, title: 'later.txt', description: 'described', body: 'the milk', display: ['title', 'description', 'body'], filename: 'later.txt', path: source },
        ]);
      } finally {
        await app.close().catch(() => undefined);
      }
    });
  });

  test('editing a node whose file was copied in: copying stays ticked and disabled until another file is chosen, and saving then asks whether to keep the old copy', async () => {
    await withTemp(async (dir) => {
      const workspace = join(dir, 'ws');
      await mkdir(join(dir, 'source'));
      const [a, b, c] = ['a.txt', 'b.txt', 'c.txt'].map((name) => join(dir, 'source', name));
      for (const file of [a, b, c]) await writeFile(file, 'x');
      const { app, page } = await launchOpened(join(dir, 'userData'), workspace, [a, b, c]);
      const nodes = async () => JSON.parse(await readFile(join(workspace, 'workspace.json'), 'utf8')).nodes;
      try {
        await createNode(page, { file: true, copy: true });
        const node = page.getByTestId('node');
        const dialog = page.getByTestId('node-dialog');

        await node.dblclick();
        await expect(dialog.getByTestId('node-path')).toHaveText('a.txt');
        await expect(dialog.getByTestId('node-copy')).toBeChecked();
        await expect(dialog.getByTestId('node-copy')).toBeDisabled();
        await dialog.getByTestId('node-file').click();
        await expect(dialog.getByTestId('node-path')).toHaveText(b);
        await expect(dialog.getByTestId('node-copy')).toBeEnabled();
        await expect(dialog.getByTestId('node-title')).toHaveValue('a.txt'); // not empty, so kept
        await dialog.getByTestId('node-submit').click();
        const ask = page.getByTestId('keep-copy-dialog');
        await expect(ask).toBeVisible();
        await ask.getByTestId('delete-copy').click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(async () => (await readdir(workspace)).sort()).toEqual(['.lock', 'b.txt', 'workspace.json']);
        expect(await nodes()).toMatchObject([{ filename: 'b.txt', path: 'b.txt' }]);

        // Not copied this time, and the old copy kept.
        await node.dblclick();
        await dialog.getByTestId('node-file').click();
        await expect(dialog.getByTestId('node-path')).toHaveText(c);
        await dialog.getByTestId('node-copy').uncheck();
        await dialog.getByTestId('node-submit').click();
        await ask.getByTestId('keep-copy').click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(async () => (await nodes())[0].path).toBe(c);
        expect((await readdir(workspace)).sort()).toEqual(['.lock', 'b.txt', 'workspace.json']);
      } finally {
        await app.close().catch(() => undefined);
      }
    });
  });

  test('ticking copying for a node whose file is outside the workspace copies the file in on Save', async () => {
    await withTemp(async (dir) => {
      const workspace = join(dir, 'ws');
      await mkdir(join(dir, 'source'));
      const source = join(dir, 'source', 'outside.txt');
      await writeFile(source, 'x');
      const { app, page } = await launchOpened(join(dir, 'userData'), workspace, [source]);
      try {
        await createNode(page, { file: true });
        await page.getByTestId('node').dblclick();
        const dialog = page.getByTestId('node-dialog');
        await expect(dialog.getByTestId('node-path')).toHaveText(source);
        await expect(dialog.getByTestId('node-copy')).not.toBeChecked();
        await dialog.getByTestId('node-copy').check();
        await dialog.getByTestId('node-submit').click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByTestId('keep-copy-dialog')).toHaveCount(0);
        await expect.poll(async () => JSON.parse(await readFile(join(workspace, 'workspace.json'), 'utf8')).nodes[0].path).toBe('outside.txt');
        expect(await readFile(join(workspace, 'outside.txt'), 'utf8')).toBe('x');
        expect(await readFile(source, 'utf8')).toBe('x');
      } finally {
        await app.close().catch(() => undefined);
      }
    });
  });

  test('linked nodes line up on a horizontal or vertical axis, centred on it, and their link joins the facing connection points', async () => {
    await withTemp(async (dir) => {
      // A hub (a file node) with three nodes linked to it, written before the workspace is opened.
      const folder = join(dir, 'ws');
      await mkdir(folder);
      await writeFile(join(folder, 'hub.txt'), 'x');
      const plain = (id: string, title: string) => ({ id, addedAt: '2026-01-01T00:00:00.000Z', title, description: null, body: null, display: ['title'] });
      const nodes = [{ ...plain('hub', 'hub.txt'), filename: 'hub.txt', path: 'hub.txt' }, plain('one', 'one'), plain('two', 'two'), plain('three', 'three')];
      const links = ['one', 'two', 'three'].map((id) => ({ id: `link-${id}`, source: id, target: 'hub', weight: 10 }));
      await writeFile(join(folder, 'workspace.json'), JSON.stringify({ appId: 'terrane', nodes, links }));
      const { app, page } = await launchOpened(join(dir, 'userData'), folder);
      try {
        await expect(page.getByTestId('link')).toHaveCount(3);

        const boxes = async () => {
          const found = await page.getByTestId('node').evaluateAll((elements) => elements.map((element) => {
            const { left, top, width, height } = element.getBoundingClientRect();
            return { handler: element.getAttribute('data-handler'), left, top, width, height };
          }));
          return found.map((box) => ({ ...box, cx: box.left + box.width / 2, cy: box.top + box.height / 2 }));
        };
        // Each note is on an axis through the centre of the node it is linked to (the layout settles a moment after the last note appears).
        await expect
          .poll(async () => {
            const all = await boxes();
            const hub = all.find((box) => box.handler === 'default')!;
            return all.filter((box) => box.handler === 'text').map((note) => Math.min(Math.abs(note.cx - hub.cx), Math.abs(note.cy - hub.cy)) < 1.5);
          })
          .toEqual([true, true, true]);

        // Every link is a straight line that starts and ends at the midpoint of an edge of a display.
        const all = await boxes();
        const ends = await page.getByTestId('link-line').evaluateAll((paths) =>
          paths.map((path) => {
            const svg = path as unknown as SVGGeometryElement;
            const matrix = svg.getScreenCTM()!;
            const at = (length: number) => {
              const point = svg.getPointAtLength(length);
              return { x: point.x * matrix.a + point.y * matrix.c + matrix.e, y: point.x * matrix.b + point.y * matrix.d + matrix.f };
            };
            return [at(0), at(svg.getTotalLength())];
          }),
        );
        const onMidpoint = (point: { x: number; y: number }) =>
          all.some(
            (box) =>
              (Math.abs(point.y - box.cy) < 1.5 && (Math.abs(point.x - box.left) < 1.5 || Math.abs(point.x - (box.left + box.width)) < 1.5)) ||
              (Math.abs(point.x - box.cx) < 1.5 && (Math.abs(point.y - box.top) < 1.5 || Math.abs(point.y - (box.top + box.height)) < 1.5)),
          );
        expect(ends).toHaveLength(3);
        for (const [from, to] of ends) {
          expect(Math.min(Math.abs(from.x - to.x), Math.abs(from.y - to.y))).toBeLessThan(1.5);
          expect(onMidpoint(from)).toBe(true);
          expect(onMidpoint(to)).toBe(true);
        }
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
      const { app, page } = await launchOpened(join(dir, 'userData'), folder);
      await expect(page.getByTestId('workspace')).toBeVisible();
      expect(JSON.parse(await readFile(join(folder, 'workspace.json'), 'utf8'))).toEqual({ title: 'mine', nodes: [] });
      await app.close();
    });
  });

  test('a second app instance cannot open a workspace that is already open, and shows nothing for it', async () => {
    await withTemp(async (dir) => {
      const workspace = join(dir, 'shared');
      const first = await launchOpened(join(dir, 'userData-1'), workspace);
      await expect(first.page.getByTestId('workspace')).toBeVisible();

      const second = await launch(join(dir, 'userData-2'), workspace);
      await second.page.getByTestId('open-workspace').click();
      await expect(second.page.getByTestId('error')).toContainText('in use by another instance');
      await expect(second.page.getByTestId('workspace')).toHaveCount(0);
      expect(await second.page.evaluate(async () => (await (window as unknown as { workspaceBridge: { current: () => Promise<{ open: boolean }> } }).workspaceBridge.current()).open)).toBe(false);

      await first.app.close();
      await second.app.close();
    });
  });

  test('a workspace that cannot be opened leaves the open one open, and the open one is what is reopened after a restart', async () => {
    await withTemp(async (dir) => {
      const shared = join(dir, 'shared');
      const mine = join(dir, 'mine');
      const userData = join(dir, 'userData-2');
      const holder = await launchOpened(join(dir, 'userData-1'), shared);

      type Bridge = { workspaceBridge: { current: () => Promise<{ open: boolean; name?: string }> } };
      const second = await launch(userData, [mine, shared].join(delimiter));
      await second.page.getByTestId('open-workspace').click();
      await expect(second.page.getByTestId('workspace')).toBeVisible();
      await second.page.getByTestId('open-workspace').click(); // the folder held by the first instance
      await expect(second.page.getByTestId('error')).toContainText('in use by another instance');
      expect(await second.page.evaluate(async () => (await (window as unknown as Bridge).workspaceBridge.current()))).toMatchObject({ open: true, name: 'mine' });
      await second.app.close();

      const third = await launch(userData, join(dir, 'never-picked'));
      await expect(third.page.getByTestId('workspace')).toBeVisible();
      expect(await third.page.evaluate(async () => (await (window as unknown as Bridge).workspaceBridge.current()).name)).toBe('mine');
      await third.app.close();
      await holder.app.close();
    });
  });

  test('the app makes no network request: everything it loads comes from the app itself', async () => {
    await withTemp(async (dir) => {
      const { app, page, requests } = await launch(join(dir, 'userData'));
      await expect(page.getByTestId('toolbar')).toBeVisible();
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
      expect(exposed.workspaceBridge).toEqual(['createLink', 'createNode', 'current', 'pickFile', 'readNode', 'setLinkWeight', 'updateNode']);
      expect(exposed.groups).toEqual(['app', 'credentials', 'data', 'net', 'sidecar', 'workspace']);
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
      await expect(page.getByTestId('toolbar')).toBeVisible();
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
