import { DefaultSquare, DisplayLines, defaultHandler } from './default';
import type { Handler } from './types';

/** Takes nodes without a file. It extends the default handler: the same display, showing the node's display lines. */
export const textHandler: Handler<TerraneNode> = {
  ...defaultHandler,
  id: 'text',
  Component: ({ node }) => (
    <DefaultSquare handler="text">
      <DisplayLines node={node} />
    </DefaultSquare>
  ),
};
