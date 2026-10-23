import { acquireLock, FORMAT_VERSION, type WorkspaceLock } from './lock';
import { randomUUID } from 'node:crypto';
import { access, constants, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

/** An entry of the `nodes` array in `workspace.json`: a file that was added to the workspace. */
export interface WorkspaceNode {
  id: string;
  /** The name of the copy inside the workspace folder. */
  filename: string;
  /** Size in bytes. */
  size: number;
  addedAt: string;
}

export interface WorkspaceState {
  open: boolean;
  /** The folder's name; the renderer never sees the path. */
  name?: string;
  nodes: WorkspaceNode[];
}

export interface OpenResult {
  status: 'opened' | 'cancelled' | 'failed';
  message?: string;
  workspace: WorkspaceState;
}

export interface WorkspaceOptions {
  /** File (in the app's own data folder) remembering the last workspace. */
  settingsFile: string;
  appId: string;
  createdBy: string;
  /** Shows the folder dialog; resolves with `undefined` if the user cancels. */
  pickFolder: () => Promise<string | undefined>;
  /** Shows the file dialog (a single file); resolves with `undefined` if the user cancels. */
  pickFile: () => Promise<string | undefined>;
  onOpened?: (root: string) => void | Promise<void>;
  onClosed?: () => void | Promise<void>;
  onHookError?: (error: unknown) => void;
}

const WORKSPACE_FILE = 'workspace.json';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The workspace: a folder the user picks. It holds a `workspace.json` (written if the folder has none) and a `.lock`
 * while open, so that two instances of the app cannot open it at once. The app remembers the last workspace.
 */
export class Workspace {
  private root: string | undefined;
  private nodes: WorkspaceNode[] = [];
  private lock: WorkspaceLock | undefined;

  constructor(private readonly options: WorkspaceOptions) {}

  state(): WorkspaceState {
    return this.root ? { open: true, name: basename(this.root), nodes: this.nodes } : { open: false, nodes: [] };
  }

  /** Reopens the last workspace, if it is still a workspace folder. */
  async reopenLast(): Promise<void> {
    let folder: unknown;
    try {
      folder = JSON.parse(await readFile(this.options.settingsFile, 'utf8')).path;
    } catch {
      return; // no (readable) record of a last workspace
    }
    if (typeof folder === 'string' && (await exists(join(folder, WORKSPACE_FILE)))) await this.openFolder(folder);
  }

  async open(): Promise<OpenResult> {
    try {
      const folder = await this.options.pickFolder();
      if (!folder) return { status: 'cancelled', workspace: this.state() };
      await this.openFolder(folder);
      return { status: 'opened', workspace: this.state() };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error), workspace: this.state() };
    }
  }

  /** Lets the user pick a file, copies it into the workspace folder and records it in the `nodes` of `workspace.json`. */
  async addFile(): Promise<OpenResult> {
    try {
      const root = this.root;
      if (!root) throw new Error('No workspace is open');
      const source = await this.options.pickFile();
      if (!source) return { status: 'cancelled', workspace: this.state() };
      const filename = await this.freeName(root, basename(source));
      const target = join(root, filename);
      await copyFile(source, target, constants.COPYFILE_EXCL);
      await this.recordNode(root, filename);
      return { status: 'opened', workspace: this.state() };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error), workspace: this.state() };
    }
  }

  /** Creates a `.txt` file with `text` in the workspace folder (`.txt` is added to the name if it is missing) and records it in `nodes`. */
  async createText(name: string, text: string): Promise<OpenResult> {
    try {
      const root = this.root;
      if (!root) throw new Error('No workspace is open');
      const wanted = name.trim();
      if (!wanted || wanted === '.' || wanted === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(wanted)) throw new Error(`Not a valid file name: ${name}`);
      const filename = await this.freeName(root, extname(wanted).toLowerCase() === '.txt' ? wanted : `${wanted}.txt`);
      await writeFile(join(root, filename), text, { flag: 'wx' });
      await this.recordNode(root, filename);
      return { status: 'opened', workspace: this.state() };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error), workspace: this.state() };
    }
  }

  /** Adds the file `filename`, already in the workspace folder, to `nodes`; if that fails the file is removed again. */
  private async recordNode(root: string, filename: string): Promise<void> {
    const target = join(root, filename);
    try {
      const node: WorkspaceNode = { id: randomUUID(), filename, size: (await stat(target)).size, addedAt: new Date().toISOString() };
      const nodes = [...this.nodes, node];
      await this.writeNodes(root, nodes);
      this.nodes = nodes;
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
  }

  /** The contents of the file behind one node, base64-encoded. Only files that are nodes of the open workspace can be read. */
  async readNode(id: string): Promise<string> {
    const node = this.nodes.find((candidate) => candidate.id === id);
    if (!this.root || !node || basename(node.filename) !== node.filename) throw new Error('No such file in the workspace');
    return (await readFile(join(this.root, node.filename))).toString('base64');
  }

  async close(): Promise<void> {
    const lock = this.lock;
    this.lock = undefined;
    this.root = undefined;
    this.nodes = [];
    if (!lock) return;
    await lock.release();
    await this.runHook(() => this.options.onClosed?.());
  }

  private async openFolder(folder: string): Promise<void> {
    if (folder === this.root) return;
    await this.ensureWorkspaceFile(folder);
    // Take the new lock before letting go of the current workspace, so a failed switch leaves it open.
    const lock = await acquireLock(folder);
    let nodes: WorkspaceNode[];
    try {
      nodes = await this.loadNodes(folder);
    } catch (error) {
      await lock.release();
      throw error;
    }
    await this.close();
    this.root = folder;
    this.lock = lock;
    this.nodes = nodes;
    await writeFile(this.options.settingsFile, JSON.stringify({ path: folder }, null, 2) + '\n');
    await this.runHook(() => this.options.onOpened?.(folder));
  }

  /** Writes `workspace.json` if the folder has none; whatever else the folder holds is left alone. */
  private async ensureWorkspaceFile(folder: string): Promise<void> {
    const file = join(folder, WORKSPACE_FILE);
    if (await exists(file)) return;
    const info = { formatVersion: FORMAT_VERSION, workspaceId: randomUUID(), appId: this.options.appId, createdAt: new Date().toISOString(), createdBy: this.options.createdBy, nodes: [] };
    await mkdir(folder, { recursive: true });
    await writeFile(file, JSON.stringify(info, null, 2) + '\n', { flag: 'wx' });
  }

  /** Reads the `nodes` of `workspace.json`, adding an empty `nodes` array to a file that has none. */
  private async loadNodes(folder: string): Promise<WorkspaceNode[]> {
    const info = await this.readInfo(folder);
    if (Array.isArray(info.nodes)) return info.nodes as WorkspaceNode[];
    await this.writeNodes(folder, []);
    return [];
  }

  private async readInfo(folder: string): Promise<Record<string, unknown>> {
    let info: unknown;
    try {
      info = JSON.parse(await readFile(join(folder, WORKSPACE_FILE), 'utf8'));
    } catch {
      throw new Error(`${WORKSPACE_FILE} is not valid JSON: ${folder}`);
    }
    if (typeof info !== 'object' || info === null || Array.isArray(info)) throw new Error(`${WORKSPACE_FILE} is not a JSON object: ${folder}`);
    return info as Record<string, unknown>;
  }

  /** Replaces `nodes` in `workspace.json`, leaving its other entries as they are. The file is swapped in whole. */
  private async writeNodes(folder: string, nodes: WorkspaceNode[]): Promise<void> {
    const info = { ...(await this.readInfo(folder)), nodes };
    const file = join(folder, WORKSPACE_FILE);
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(info, null, 2) + '\n');
    await rename(temp, file);
  }

  /** `name`, or `name (1)`, `name (2)`, … (before the extension) if the folder already has such a file. */
  private async freeName(folder: string, name: string): Promise<string> {
    const extension = extname(name);
    const stem = name.slice(0, name.length - extension.length);
    let candidate = name;
    for (let n = 1; await exists(join(folder, candidate)); n += 1) candidate = `${stem} (${n})${extension}`;
    return candidate;
  }

  private async runHook(hook: () => void | Promise<void>): Promise<void> {
    try {
      await hook();
    } catch (error) {
      this.options.onHookError?.(error);
    }
  }
}
