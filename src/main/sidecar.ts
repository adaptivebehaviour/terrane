import type { SidecarManager } from '@adaptivebehaviour/desktop/src/sidecar/index';

export interface SidecarContext {
  log: (line: string) => void;
  /** `app.getAppPath()`: the application's own folder (development) or its asar (packaged). */
  appPath: string;
  isPackaged: boolean;
  /** `process.resourcesPath`: where a packaged build keeps files copied alongside the app. */
  resourcesPath: string;
  /** Environment variables the application's declared services say the sidecar may see (credentials). */
  allowedEnv: string[];
}

/**
 * The optional Python backend. This plain Electron application has none, so there is nothing to start and the
 * renderer sees `sidecar.status` as `absent`. The `electron-fastapi` application replaces this file with one that
 * returns a configured `SidecarManager`.
 */
export function createSidecar(_context: SidecarContext): SidecarManager | undefined {
  return undefined;
}
