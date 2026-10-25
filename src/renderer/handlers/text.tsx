import { DefaultSquare, defaultHandler } from './default';
import type { Handler } from './types';

/** Takes information nodes. It extends the default handler: the same display, showing the node's string (on as many lines as it has) instead of a filename. */
export const textHandler: Handler<InformationNode> = {
  ...defaultHandler,
  id: 'text',
  Component: ({ node }) => (
    <DefaultSquare handler="text" className="whitespace-pre-line">
      {node.items[0]}
    </DefaultSquare>
  ),
};
