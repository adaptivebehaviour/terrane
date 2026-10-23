import type { AbBridge } from '@adaptivebehaviour/desktop/src/ipc/index';

declare global {
  interface WorkspaceNode {
    id: string;
    filename: string;
    size: number;
    addedAt: string;
  }

  interface WorkspaceState {
    open: boolean;
    name?: string;
    nodes: WorkspaceNode[];
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
      /** The contents of the file behind a node, base64-encoded. */
      readNode: (id: string) => Promise<string>;
    };
  }
}
