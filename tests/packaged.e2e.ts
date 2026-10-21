import { chromium, expect, test } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Checks the packaged app (npm run package): it starts from its asar, serves the renderer from the app:// protocol,
// applies the CSP, and has the hardening fuses set. Playwright's _electron API cannot drive it, because it relies on
// Node's inspector switch, which a hardened build deliberately disables; so the app is started directly and attached
// to over the Chromium DevTools protocol. Folder dialogs cannot be scripted in a packaged build, so this stays
// short of creating a workspace (the unpackaged e2e tests cover that).
const defaultExe = process.platform === 'win32' ? join(__dirname, '..', 'dist', 'win-unpacked', 'Terrane.exe') : '';
const exe = process.env.AB_PACKAGED_EXE || defaultExe;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function stop(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGKILL');
}

test.describe('packaged app', () => {
  test.skip(!exe || !existsSync(exe), 'no packaged app: run `npm run package` (or set AB_PACKAGED_EXE)');

  test('starts from its asar, loads over app://, applies the CSP and exposes only the bridge', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ab-packaged-'));
    const port = await freePort();
    const child = spawn(exe, [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`], { stdio: 'ignore', windowsHide: false });
    try {
      let browser;
      for (let attempt = 0; attempt < 60 && !browser; attempt += 1) {
        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      expect(browser, 'could not attach to the packaged app').toBeTruthy();
      const context = browser!.contexts()[0];
      const page = context.pages()[0] ?? (await context.waitForEvent('page'));
      await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 30_000 });
      expect(page.url()).toMatch(/^app:\/\/app\//);

      const facts = await page.evaluate(async () => ({
        csp: (await fetch(location.href)).headers.get('content-security-policy'),
        nodeGlobals: [typeof (globalThis as Record<string, unknown>).require, typeof (globalThis as Record<string, unknown>).process],
        groups: Object.keys((window as unknown as { abBridge: object }).abBridge).sort(),
        info: await (window as unknown as { abBridge: { app: { info: () => Promise<{ ok: boolean; value?: { name: string; platform: string } }> } } }).abBridge.app.info(),
      }));
      expect(facts.csp).toContain("connect-src 'self'");
      expect(facts.nodeGlobals).toEqual(['undefined', 'undefined']);
      expect(facts.groups).toContain('workspace');
      expect(facts.info).toMatchObject({ ok: true, value: { name: 'Terrane' } });
      await browser!.close();
    } finally {
      stop(child);
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
    }
  });

  test('the Electron fuses are set as configured', async () => {
    const { getCurrentFuseWire, FuseV1Options } = await import('@electron/fuses');
    // @electron/fuses does not re-export its FuseState enum; these are its values (ASCII '0' and '1').
    const FuseState = { DISABLE: 48, ENABLE: 49 };
    const wire = await getCurrentFuseWire(exe);
    expect(wire[FuseV1Options.RunAsNode]).toBe(FuseState.DISABLE);
    expect(wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(FuseState.DISABLE);
    expect(wire[FuseV1Options.EnableNodeCliInspectArguments]).toBe(FuseState.DISABLE);
    expect(wire[FuseV1Options.OnlyLoadAppFromAsar]).toBe(FuseState.ENABLE);
    expect(wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(FuseState.ENABLE);
    expect(wire[FuseV1Options.GrantFileProtocolExtraPrivileges]).toBe(FuseState.DISABLE);
  });
});
