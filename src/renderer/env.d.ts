import type { AbBridge } from '@adaptivebehaviour/desktop/src/ipc/index';

declare global {
  interface WorkspaceNode {
    id: string;
    filename: string;
    size: number;
    addedAt: string;
  }

  /** A node that is not a file: it stores a single string, in `items`. */
  interface InformationNode {
    id: string;
    addedAt: string;
    items: string[];
  }

  type NodeRecord = WorkspaceNode | InformationNode;

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
    /** The application's workspace: a folder the user picks (see main/workspace.ts). */
    workspaceBridge: {
      current: () => Promise<WorkspaceState>;
      open: () => Promise<WorkspaceResult>;
      /** Picks a file, copies it into the workspace folder and records it in `workspace.json`. */
      addFile: () => Promise<WorkspaceResult>;
      /** Creates a .txt file with the given name and text in the workspace folder and records it in `workspace.json`. */
      createText: (name: string, text: string) => Promise<WorkspaceResult>;
      /** Records an information node holding the given (non-empty) string in `workspace.json`. */
      createInformation: (text: string) => Promise<WorkspaceResult>;
      /** Records a link (with the weight of a new link) from one node to another in `workspace.json`. */
      createLink: (source: string, target: string) => Promise<WorkspaceResult>;
      /** Sets a link's weight (1 to 10) in `workspace.json`. */
      setLinkWeight: (id: string, weight: number) => Promise<WorkspaceResult>;
      /** The contents of the file behind a node, base64-encoded. */
      readNode: (id: string) => Promise<string>;
    };
  }
}
