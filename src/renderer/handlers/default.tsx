import type { ReactNode } from 'react';
import type { Handler } from './types';

/** The default display: a 100×100 white square showing `children`. Shared with the text handler, which extends this one. */
export function DefaultSquare({ handler, className = '', children }: { handler: string; className?: string; children: ReactNode }) {
  return (
    <div
      data-testid="node"
      data-handler={handler}
      className={`flex h-[100px] w-[100px] items-center justify-center overflow-hidden break-words border border-slate-300 bg-white p-1 text-center text-sm ${className}`}
    >
      {children}
    </div>
  );
}

/** Takes every file that no other handler claims. */
export const defaultHandler: Handler = {
  id: 'default',
  extensions: [],
  Component: ({ node }) => <DefaultSquare handler="default">{node.filename}</DefaultSquare>,
};
