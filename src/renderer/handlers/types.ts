import type { ComponentType } from 'react';

/**
 * A handler decides how a node (a file added to the workspace) is shown. Each handler is self-contained, so changing
 * one never affects another.
 */
export interface Handler {
  /** Names the handler (and is written to `data-handler` on what it renders). */
  id: string;
  /** Lower-case file extensions, without the dot, that this handler takes. The default handler has none. */
  extensions: string[];
  Component: ComponentType<{ node: WorkspaceNode }>;
}
