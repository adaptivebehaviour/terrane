import { useState } from 'react';
import { handlerFor, isFileNode } from './handlers';
import { displayLines } from './handlers/display';
import { imageHandler, showsImage, useNodeImage } from './handlers/image';
import { SplitView } from './SplitView';

/** A node's displayed text (its display lines) on one line: line breaks become spaces. */
export const displayText = (node: NodeRecord) => displayLines(node).join(' ').replace(/\r?\n/g, ' ');

interface NodeListProps {
  nodes: NodeRecord[];
  /** The ids of the nodes that have at least one link. */
  linked: Set<string>;
  /** The user double-clicked a node's entry. */
  onOpenNode: (node: NodeRecord) => void;
  /** The user right-clicked a node's entry, at (`x`, `y`) in the window. */
  onNodeMenu: (node: NodeRecord, x: number, y: number) => void;
}

/**
 * The node list: a search box above the nodes, which are split by a draggable splitter into those without a link (top,
 * sized to fit its entries) and those with one (bottom). Each change to the search text shows only the nodes whose displayed text contains it
 * (ignoring case).
 */
export function NodeList({ nodes, linked, onOpenNode, onNodeMenu }: NodeListProps) {
  const [search, setSearch] = useState('');
  const query = search.toLowerCase();
  const shown = nodes.filter((node) => displayText(node).toLowerCase().includes(query));
  const entries = (list: NodeRecord[]) => list.map((node) => <NodeEntry key={node.id} node={node} onOpenNode={onOpenNode} onNodeMenu={onNodeMenu} />);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="node-list">
      <input
        type="search"
        aria-label="Search nodes"
        placeholder="Search"
        data-testid="node-search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="m-1 min-w-0 rounded border border-slate-300 px-2 py-1 text-sm"
      />
      <SplitView
        direction="column"
        initialFirst={0}
        // The unlinked part is as tall as its entries: the splitter sits under the last one (or under the search box if there are none).
        fitFirst
        first={<ul data-testid="unlinked-nodes">{entries(shown.filter((node) => !linked.has(node.id)))}</ul>}
        second={<ul data-testid="linked-nodes">{entries(shown.filter((node) => linked.has(node.id)))}</ul>}
      />
    </div>
  );
}

/**
 * A node's entry: its displayed text on one line, with a toggle arrow on the left that expands the entry to show all of
 * the text, wrapped (and, for an image node whose display shows its image, the image above it).
 */
function NodeEntry({ node, onOpenNode, onNodeMenu }: { node: NodeRecord; onOpenNode: NodeListProps['onOpenNode']; onNodeMenu: NodeListProps['onNodeMenu'] }) {
  const [expanded, setExpanded] = useState(false);
  const image = isFileNode(node) && handlerFor(node.filename).id === imageHandler.id && showsImage(node) ? node : undefined;

  return (
    <li
      data-testid="node-entry"
      data-node-id={node.id}
      data-expanded={expanded}
      className="flex cursor-default items-start gap-1 border-b border-slate-100 px-1 py-0.5 text-sm hover:bg-slate-50"
      onDoubleClick={() => onOpenNode(node)}
      onContextMenu={(event) => {
        event.preventDefault();
        onNodeMenu(node, event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        aria-label={expanded ? 'Collapse' : 'Expand'}
        aria-expanded={expanded}
        data-testid="node-entry-toggle"
        className="w-4 shrink-0 text-slate-500"
        onClick={() => setExpanded(!expanded)}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {expanded ? '▾' : '▸'}
      </button>
      <div className="min-w-0 flex-1">
        {expanded && image && <EntryImage node={image} />}
        <div data-testid="node-entry-text" className={expanded ? 'whitespace-pre-line break-words' : 'truncate'}>
          {displayLines(node).join('\n')}
        </div>
      </div>
    </li>
  );
}

function EntryImage({ node }: { node: FileNode }) {
  const src = useNodeImage(node, true);
  return <div data-testid="node-entry-image">{src && <img src={src} alt={node.filename} className="max-h-40 max-w-full object-contain" />}</div>;
}
