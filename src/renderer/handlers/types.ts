import type { ComponentType } from 'react';

/**
 * A handler decides how a node is shown. Each handler is self-contained, so changing one never affects another
 * (the text handler deliberately extends the default one).
 */
export interface Handler<N extends NodeRecord = WorkspaceNode> {
  /** Names the handler (and is written to `data-handler` on what it renders). */
  id: string;
  /** Lower-case file extensions, without the dot, that this handler takes. The default and text handlers have none. */
  extensions: string[];
  Component: ComponentType<{ node: N }>;
}
