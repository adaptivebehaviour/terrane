import type { Handler } from './types';

/** Takes every file that no other handler claims. */
export const defaultHandler: Handler = {
  id: 'default',
  extensions: [],
  Component: ({ node }) => (
    <div
      data-testid="node"
      data-handler="default"
      className="flex h-[100px] w-[100px] items-center justify-center overflow-hidden break-words border border-slate-300 bg-white p-1 text-center text-sm"
    >
      {node.filename}
    </div>
  ),
};
