import { acquireLock, FORMAT_VERSION, type WorkspaceLock } from './lock';
import { randomUUID } from 'node:crypto';
import { access, constants, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';

/** The text fields of a node, in the order they are shown. */
export const DISPLAY_FIELDS = ['title', 'description', 'body'] as const;
export type DisplayField = (typeof DISPLAY_FIELDS)[number];

/** An entry of the `nodes` array in `workspace.json`. Every node is one of these; a node with a file is a `FileNode`. */
export interface TerraneNode {
  id: string;
  addedAt: string;
  title: string | null;
  description: string | null;
  body: string | null;
  /** The fields shown in the node's display (at least one, each with text), in the order title, description, body. */
  display: DisplayField[];
}

/** A node with a file. */
export interface FileNode extends TerraneNode {
  /** The file's name. */
  filename: string;
  /** Where the file is: relative to the workspace folder if it was copied into the workspace, otherwise the absolute path of the original. */
  path: string;
}

/** Either kind of entry in `nodes`. */
export type NodeRecord = TerraneNode | FileNode;

export function isFileNode(node: NodeRecord): node is FileNode {
  return 'path' in node;
}

/** What the node dialog sends to create or save a node. Empty strings are stored as `null`. */
export interface NodeInput {
  title: string;
  description: string;
  body: string;
  display: DisplayField[];
  /** The node's file, if it has one. `source` is a newly chosen file (absent: the node keeps its current one); `copy` is whether the file is (to be) copied into the workspace. */
  file?: { source?: string; copy: boolean };
  /** When saving replaces a file that was copied into the workspace: whether that copy is kept in the workspace folder. */
  keepOldCopy?: boolean;
}

/** `value` as a `NodeInput`, or an error if it is not one. */
export function parseNodeInput(value: unknown): NodeInput {
  const input = value as Partial<NodeInput> | null;
  const valid =
    typeof input === 'object' &&
    input !== null &&
    typeof input.title === 'string' &&
    typeof input.description === 'string' &&
    typeof input.body === 'string' &&
    Array.isArray(input.display) &&
    input.display.every((field) => DISPLAY_FIELDS.includes(field)) &&
    (input.file === undefined || (typeof input.file === 'object' && input.file !== null && typeof input.file.copy === 'boolean' && (input.file.source === undefined || typeof input.file.source === 'string'))) &&
    (input.keepOldCopy === undefined || typeof input.keepOldCopy === 'boolean');
  if (!valid) throw new Error('Invalid node');
  return { title: input.title!, description: input.description!, body: input.body!, display: input.display!, file: input.file && { source: input.file.source, copy: input.file.copy }, keepOldCopy: input.keepOldCopy };
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
  appId: string;
  createdBy: string;
  onOpened?: (root: string) => void | Promise<void>;
  onClosed?: () => void | Promise<void>;
  onHookError?: (error: unknown) => void;
}

const WORKSPACE_FILE = 'workspace.json';
/** The weight of a new link. */
const NEW_LINK_WEIGHT = 5;

/** The text fields of `input` (empty strings as `null`) and the fields it shows: those ticked that have text, in display order. Refused if none is shown. */
function textFields(input: NodeInput): Pick<TerraneNode, 'title' | 'description' | 'body' | 'display'> {
  const fields = { title: input.title || null, description: input.description || null, body: input.body || null };
  const display = DISPLAY_FIELDS.filter((field) => input.display.includes(field) && fields[field] !== null);
  if (display.length === 0) throw new Error('A node must show at least one field with text');
  return { ...fields, display };
}

/** The `filename` and `path` of a file left where it is (not copied into the workspace); it must exist and have an absolute path. */
async function outsideFile(source: string): Promise<Pick<FileNode, 'filename' | 'path'>> {
  if (!isAbsolute(source)) throw new Error(`Not an absolute path: ${source}`);
  await access(source);
  return { filename: basename(source), path: source };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The workspace: the folder that the framework's workspace manager has created or opened (see `main/index.ts`). It holds a
 * `workspace.json` (written if the folder has none) and a `.lock` while open, so that two instances of the app cannot open
 * it at once.
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

  /** The open workspace's folder. */
  get path(): string | undefined {
    return this.root;
  }

  /** Records a node made from `input` in the `nodes` of `workspace.json`, copying its file into the workspace folder if `input.file.copy` is set. */
  async createNode(input: NodeInput): Promise<OpenResult> {
    try {
      const root = this.root;
      if (!root) throw new Error('No workspace is open');
      const texts = textFields(input);
      let node: NodeRecord = { id: randomUUID(), addedAt: new Date().toISOString(), ...texts };
      let copied: string | undefined;
      if (input.file) {
        const { source, copy } = input.file;
        if (!source) throw new Error('No file was chosen');
        if (copy) {
          copied = await this.copyIn(root, source);
          node = { ...node, filename: copied, path: copied };
        } else {
          node = { ...node, ...(await outsideFile(source)) };
        }
      }
      await this.saveNodes(root, [...this.nodes, node], copied);
      return { status: 'opened', workspace: this.state() };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error), workspace: this.state() };
    }
  }

  /**
   * Replaces the node `id` with one made from `input` in the `nodes` of `workspace.json`. A node with a file keeps one. Its
   * file is copied into the workspace folder if `input.file.copy` is newly set; a file already copied in stays copied
   * unless another file is chosen, and then the old copy is removed from the folder unless `input.keepOldCopy` is set.
   */
  async updateNode(id: string, input: NodeInput): Promise<OpenResult> {
    try {
      const root = this.root;
      if (!root) throw new Error('No workspace is open');
      const current = this.nodes.find((node) => node.id === id);
      if (!current) throw new Error('No such node in the workspace');
      const texts = textFields(input);
      let node: NodeRecord = { id, addedAt: current.addedAt, ...texts };
      const currentFile = isFileNode(current) ? current : undefined;
      const wasCopied = currentFile !== undefined && !isAbsolute(currentFile.path);
      let copied: string | undefined;
      let discard: string | undefined;
      if (input.file) {
        const { source, copy } = input.file;
        if (source) {
          if (copy) {
            copied = await this.copyIn(root, source);
            node = { ...node, filename: copied, path: copied };
          } else {
            node = { ...node, ...(await outsideFile(source)) };
          }
          if (wasCopied && !input.keepOldCopy) discard = currentFile.path;
        } else {
          if (!currentFile) throw new Error('No file was chosen');
          if (wasCopied && !copy) throw new Error('A file copied into the workspace stays there until another file is chosen');
          if (!wasCopied && copy) {
            copied = await this.copyIn(root, currentFile.path);
            node = { ...node, filename: copied, path: copied };
          } else {
            node = { ...node, filename: currentFile.filename, path: currentFile.path };
          }
        }
      } else if (currentFile) {
        throw new Error('A node with a file keeps a file');
      }
      await this.saveNodes(root, this.nodes.map((candidate) => (candidate.id === id ? node : candidate)), copied);
      if (discard && basename(discard) === discard) await rm(join(root, discard), { force: true });
      return { status: 'opened', workspace: this.state() };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error), workspace: this.state() };
    }
  }

  /**
   * Records a link from the node `source` to the node `target`, with the weight of a new link, in the `links` of
   * `workspace.json`; if the two nodes are already linked (either way), nothing changes.
   */
  async createLink(source: string, target: string): Promise<OpenResult> {
    try {
      const root = this.root;
      if (!root) throw new Error('No workspace is open');
      if (source === target || ![source, target].every((id) => this.nodes.some((node) => node.id === id))) throw new Error('Not a valid link');
      // Only one link between two nodes, whichever way it points: a duplicate changes nothing, and is no error.
      if (this.links.some((link) => (link.source === source && link.target === target) || (link.source === target && link.target === source))) return { status: 'opened', workspace: this.state() };
      const links = [...this.links, { id: randomUUID(), source, target, weight: NEW_LINK_WEIGHT }];
      await this.writeLinks(root, links);
      this.links = links;
      return { status: 'opened', workspace: this.state() };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error), workspace: this.state() };
    }
  }

  /** Sets the weight (a number from 1 to 10) of the link `id` in `workspace.json`. */
  async setLinkWeight(id: string, weight: number): Promise<OpenResult> {
    try {
      const root = this.root;
      if (!root) throw new Error('No workspace is open');
      if (!Number.isFinite(weight) || weight < 1 || weight > 10) throw new Error(`Not a valid weight: ${weight}`);
      if (!this.links.some((link) => link.id === id)) throw new Error('No such link in the workspace');
      const links = this.links.map((link) => (link.id === id ? { ...link, weight } : link));
      await this.writeLinks(root, links);
      this.links = links;
      return { status: 'opened', workspace: this.state() };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error), workspace: this.state() };
    }
  }

  /** Copies the file at `source` into the workspace folder, under a free name; resolves with that name. */
  private async copyIn(root: string, source: string): Promise<string> {
    const filename = await this.freeName(root, basename(source));
    await copyFile(source, join(root, filename), constants.COPYFILE_EXCL);
    return filename;
  }

  /** Writes `nodes` to `workspace.json` and keeps them; if that fails, the file `copied` (just copied into the workspace folder) is removed again. */
  private async saveNodes(root: string, nodes: NodeRecord[], copied?: string): Promise<void> {
    try {
      await this.writeNodes(root, nodes);
      this.nodes = nodes;
    } catch (error) {
      if (copied) await rm(join(root, copied), { force: true });
      throw error;
    }
  }

  /** The contents of the file behind one node, base64-encoded. Only the files of nodes of the open workspace can be read. */
  async readNode(id: string): Promise<string> {
    const node = this.nodes.find((candidate) => candidate.id === id);
    if (!this.root || !node || !isFileNode(node)) throw new Error('No such file in the workspace');
    if (isAbsolute(node.path)) return (await readFile(node.path)).toString('base64');
    if (basename(node.path) !== node.path) throw new Error('No such file in the workspace');
    return (await readFile(join(this.root, node.path))).toString('base64');
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

  /** Opens `folder` as the workspace: writes its `workspace.json` if it has none, takes the lock and loads the nodes and links. Fails, leaving the current workspace open, if another instance holds the lock. */
  async openFolder(folder: string): Promise<void> {
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
