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

/** An entry of the `nodes` array in `workspace.json` that is not a file: it stores a single string, in `items`. */
export interface InformationNode {
  id: string;
  addedAt: string;
  /** Holds the node's one string. */
  items: string[];
}

/** Either kind of entry in `nodes`. */
export type NodeRecord = WorkspaceNode | InformationNode;

export function isInformationNode(node: NodeRecord): node is InformationNode {
  return 'items' in node;
}

/** An entry of the `links` array in `workspace.json`: a connection from a source node to a target node. */
export interface WorkspaceLink {
  id: string;
  /** The `id` of the source node. */
  source: string;
  /** The `id` of the target node. */
  target: string;
  /** 1 to 10. */
  weight: number;
}

export interface WorkspaceState {
  open: boolean;
  /** The folder's name; the renderer never sees the path. */
  name?: string;
  nodes: NodeRecord[];
  links: WorkspaceLink[];
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
  /** Opens a file with the application the system associates with its type; resolves with an error message, or an empty string if it worked. */
  openPath: (path: string) => Promise<string>;
  onOpened?: (root: string) => void | Promise<void>;
  onClosed?: () => void | Promise<void>;
  onHookError?: (error: unknown) => void;
}

const WORKSPACE_FILE = 'workspace.json';
/** The weight of a new link. */
const NEW_LINK_WEIGHT = 5;
/** The weight of the link from a note created by right-clicking a node to that node. */
const ATTACHED_NOTE_WEIGHT = 10;

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
  private nodes: NodeRecord[] = [];
  private links: WorkspaceLink[] = [];
  private lock: WorkspaceLock | undefined;

  constructor(private readonly options: WorkspaceOptions) {}

  state(): WorkspaceState {
    return this.root ? { open: true, name: basename(this.root), nodes: this.nodes, links: this.links } : { open: false, nodes: [], links: [] };
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

  /** Records an information node holding `text` in the `nodes` of `workspace.json`; no file is created. An empty string is refused. */
  async createInformation(text: string): Promise<OpenResult> {
    try {
      const root = this.root;
      if (!root) throw new Error('No workspace is open');
      if (text === '') throw new Error('An information node cannot be empty');
      const node: InformationNode = { id: randomUUID(), addedAt: new Date().toISOString(), items: [text] };
      const nodes = [...this.nodes, node];
      await this.writeNodes(root, nodes);
      this.nodes = nodes;
      return { status: 'opened', workspace: this.state() };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error), workspace: this.state() };
    }
  }

  /** Records an information node holding `text`, and a link from it to the node `target` with the weight of an attached note, in `workspace.json`. An empty string is refused. */
  async createInformationLinked(text: string, target: string): Promise<OpenResult> {
    try {
      const root = this.root;
      if (!root) throw new Error('No workspace is open');
      if (text === '') throw new Error('An information node cannot be empty');
      if (!this.nodes.some((node) => node.id === target)) throw new Error('Not a valid link');
      const node: InformationNode = { id: randomUUID(), addedAt: new Date().toISOString(), items: [text] };
      const nodes = [...this.nodes, node];
      const links = [...this.links, { id: randomUUID(), source: node.id, target, weight: ATTACHED_NOTE_WEIGHT }];
      await this.writeEntries(root, { nodes, links });
      this.nodes = nodes;
      this.links = links;
      return { status: 'opened', workspace: this.state() };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error), workspace: this.state() };
    }
  }

  /** Replaces the string of the information node `id` with `text` in the `nodes` of `workspace.json`. An empty string is refused. */
  async updateInformation(id: string, text: string): Promise<OpenResult> {
    try {
      const root = this.root;
      if (!root) throw new Error('No workspace is open');
      if (text === '') throw new Error('An information node cannot be empty');
      if (!this.nodes.some((node) => node.id === id && isInformationNode(node))) throw new Error('No such information node in the workspace');
      const nodes = this.nodes.map((node) => (node.id === id ? { ...node, items: [text] } : node));
      await this.writeNodes(root, nodes);
      this.nodes = nodes;
      return { status: 'opened', workspace: this.state() };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error), workspace: this.state() };
    }
  }

  /** Records a link from the node `source` to the node `target`, with the weight of a new link, in the `links` of `workspace.json`. */
  async createLink(source: string, target: string): Promise<OpenResult> {
    try {
      const root = this.root;
      if (!root) throw new Error('No workspace is open');
      if (source === target || ![source, target].every((id) => this.nodes.some((node) => node.id === id))) throw new Error('Not a valid link');
      const links = [...this.links, { id: randomUUID(), source, target, weight: NEW_LINK_WEIGHT }];
      await this.writeLinks(root, links);
      this.links = links;
      return { status: 'opened', workspace: this.state() };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error), workspace: this.state() };
    }
  }

  /** Sets the weight (a whole number from 1 to 10) of the link `id` in `workspace.json`. */
  async setLinkWeight(id: string, weight: number): Promise<OpenResult> {
    try {
      const root = this.root;
      if (!root) throw new Error('No workspace is open');
      if (!Number.isInteger(weight) || weight < 1 || weight > 10) throw new Error(`Not a valid weight: ${weight}`);
      if (!this.links.some((link) => link.id === id)) throw new Error('No such link in the workspace');
      const links = this.links.map((link) => (link.id === id ? { ...link, weight } : link));
      await this.writeLinks(root, links);
      this.links = links;
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

  /** The contents of the file behind one node, base64-encoded. Only files that are nodes of the open workspace can be read; information nodes have no file. */
  async readNode(id: string): Promise<string> {
    const node = this.nodes.find((candidate) => candidate.id === id);
    if (!this.root || !node || isInformationNode(node) || basename(node.filename) !== node.filename) throw new Error('No such file in the workspace');
    return (await readFile(join(this.root, node.filename))).toString('base64');
  }

  /** Opens the file behind one node with the application the system associates with its type. Only files that are nodes of the open workspace can be opened. */
  async openNode(id: string): Promise<OpenResult> {
    try {
      const node = this.nodes.find((candidate) => candidate.id === id);
      if (!this.root || !node || isInformationNode(node) || basename(node.filename) !== node.filename) throw new Error('No such file in the workspace');
      const message = await this.options.openPath(join(this.root, node.filename));
      if (message) throw new Error(message);
      return { status: 'opened', workspace: this.state() };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error), workspace: this.state() };
    }
  }

  async close(): Promise<void> {
    const lock = this.lock;
    this.lock = undefined;
    this.root = undefined;
    this.nodes = [];
    this.links = [];
    if (!lock) return;
    await lock.release();
    await this.runHook(() => this.options.onClosed?.());
  }

  private async openFolder(folder: string): Promise<void> {
    if (folder === this.root) return;
    await this.ensureWorkspaceFile(folder);
    // Take the new lock before letting go of the current workspace, so a failed switch leaves it open.
    const lock = await acquireLock(folder);
    let nodes: NodeRecord[];
    let links: WorkspaceLink[];
    try {
      nodes = await this.loadNodes(folder);
      links = await this.loadLinks(folder);
    } catch (error) {
      await lock.release();
      throw error;
    }
    await this.close();
    this.root = folder;
    this.lock = lock;
    this.nodes = nodes;
    this.links = links;
    await writeFile(this.options.settingsFile, JSON.stringify({ path: folder }, null, 2) + '\n');
    await this.runHook(() => this.options.onOpened?.(folder));
  }

  /** Writes `workspace.json` if the folder has none; whatever else the folder holds is left alone. */
  private async ensureWorkspaceFile(folder: string): Promise<void> {
    const file = join(folder, WORKSPACE_FILE);
    if (await exists(file)) return;
    const info = { formatVersion: FORMAT_VERSION, workspaceId: randomUUID(), appId: this.options.appId, createdAt: new Date().toISOString(), createdBy: this.options.createdBy, nodes: [], links: [] };
    await mkdir(folder, { recursive: true });
    await writeFile(file, JSON.stringify(info, null, 2) + '\n', { flag: 'wx' });
  }

  /** Reads the `nodes` of `workspace.json`, adding an empty `nodes` array to a file that has none. */
  private async loadNodes(folder: string): Promise<NodeRecord[]> {
    const info = await this.readInfo(folder);
    if (Array.isArray(info.nodes)) return info.nodes as NodeRecord[];
    await this.writeNodes(folder, []);
    return [];
  }

  /** Reads the `links` of `workspace.json`; a file without them has no links (they are written with the first link). */
  private async loadLinks(folder: string): Promise<WorkspaceLink[]> {
    const info = await this.readInfo(folder);
    return Array.isArray(info.links) ? (info.links as WorkspaceLink[]) : [];
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

  /** Replaces `nodes` in `workspace.json`, leaving its other entries as they are. */
  private async writeNodes(folder: string, nodes: NodeRecord[]): Promise<void> {
    await this.writeEntries(folder, { nodes });
  }

  /** Replaces `links` in `workspace.json`, leaving its other entries as they are. */
  private async writeLinks(folder: string, links: WorkspaceLink[]): Promise<void> {
    await this.writeEntries(folder, { links });
  }

  /** Replaces the given entries of `workspace.json`, leaving its others as they are. The file is swapped in whole. */
  private async writeEntries(folder: string, entries: { nodes?: NodeRecord[]; links?: WorkspaceLink[] }): Promise<void> {
    const info = { ...(await this.readInfo(folder)), ...entries };
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
