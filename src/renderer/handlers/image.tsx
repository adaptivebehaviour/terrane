import { useEffect, useState } from 'react';
import type { Handler } from './types';

const MIME_TYPES: Record<string, string> = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml' };

/**
 * Takes jpeg, png and svg files. Its markup is deliberately its own copy rather than shared with the default
 * handler, so the image handler can change without touching the default one.
 *
 * The display is portrait: a square above (the image, always fully visible at its own aspect ratio) and the file name
 * below, which takes 20% of the height.
 */
export const imageHandler: Handler = {
  id: 'image',
  extensions: ['jpeg', 'jpg', 'png', 'svg'],
  Component: ({ node }) => {
    const [src, setSrc] = useState<string>();
    useEffect(() => {
      let current = true;
      const mime = MIME_TYPES[node.filename.slice(node.filename.lastIndexOf('.') + 1).toLowerCase()];
      window.workspaceBridge.readNode(node.id).then(
        (base64) => current && setSrc(`data:${mime};base64,${base64}`),
        () => undefined, // the file cannot be read: the name is still shown
      );
      return () => {
        current = false;
      };
    }, [node.id, node.filename]);

    return (
      <div data-testid="node" data-handler="image" className="flex h-[125px] w-[100px] flex-col overflow-hidden bg-white ring-1 ring-slate-300">
        <div data-testid="node-image" className="flex h-[80%] w-full items-center justify-center">
          {src && <img src={src} alt={node.filename} className="h-full w-full object-contain" />}
        </div>
        <div data-testid="node-name" className="flex h-[20%] w-full items-center justify-center px-1">
          <span title={node.filename} className="truncate text-center text-xs">
            {node.filename}
          </span>
        </div>
      </div>
    );
  },
};
