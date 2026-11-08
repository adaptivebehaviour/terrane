import type { AbBridge } from '@adaptivebehaviour/desktop/src/ipc/index';

declare global {
  /** A node's text fields, in the order they are shown. */
  type DisplayField = 'title' | 'description' | 'body';

  /** Every node is one of these; a node with a file is a `FileNode`. */
  interface TerraneNode {
    id: string;
    addedAt: string;
    title: string | null;
    description: string | null;
    body: string | null;
    /** The fields shown in the node's display (at least one, each with text), in the order title, description, body. */
    display: DisplayField[];
  }

  /** A node with a file. */
  interface FileNode extends TerraneNode {
    filename: string;
    /** Relative to the workspace folder if the file was copied into the workspace, otherwise the absolute path of the original. */
    path: string;
  }

  type NodeRecord = TerraneNode | FileNode;

  /** What the node dialog sends to create or save a node (see main/workspace.ts). */
  interface NodeInput {
    title: string;
    description: string;
    body: string;
    display: DisplayField[];
    /** `source` is a newly chosen file (absent: the node keeps its current one); `copy` is whether the file is (to be) copied into the workspace. */
    file?: { source?: string; copy: boolean };
    /** When saving replaces a file that was copied into the workspace: whether that copy is kept. */
    keepOldCopy?: boolean;
  }

  /** A connection from a source node to a target node, with a weight from 1 to 10. */
  interface WorkspaceLink {
    id: string;
    source: string;
    target: string;
    weight: number;
  }

  interface WorkspaceState {
    open: boolean;
    name?: string;
    nodes: NodeRecord[];
    links: WorkspaceLink[];
  }

  interface WorkspaceResult {
    status: 'opened' | 'cancelled' | 'failed';
    message?: string;
    workspace: WorkspaceState;
  }

  interface Window {
    /** Exposed by the preload script; wrapped into `ab` (see ab.ts). Not for direct use. */
    abBridge: AbBridge;
    /** What the open workspace holds (see main/workspace.ts). Creating and opening a workspace go through `abBridge.workspace`. */
    workspaceBridge: {
      current: () => Promise<WorkspaceState>;
      /** The contents of the file behind a node, base64-encoded. */
      readNode: (id: string) => Promise<string>;
      /** Shows the file picker; resolves with the chosen file's path, or `null` if the user cancels. */
      pickFile: () => Promise<string | null>;
      /** Records a new node in `workspace.json` (copying its file into the workspace folder if asked to). */
      createNode: (input: NodeInput) => Promise<WorkspaceResult>;
      /** Replaces an existing node with one made from `input` in `workspace.json`. */
      updateNode: (id: string, input: NodeInput) => Promise<WorkspaceResult>;
      /** Records a link (with the weight of a new link) from one node to another in `workspace.json`. */
      createLink: (source: string, target: string) => Promise<WorkspaceResult>;
      /** Sets a link's weight (1 to 10) in `workspace.json`. */
      setLinkWeight: (id: string, weight: number) => Promise<WorkspaceResult>;
    };
  }
}
