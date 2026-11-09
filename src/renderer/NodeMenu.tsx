import { displayText } from './NodeList';

/** How many characters (spaces included) of each node's displayed text the popup shows. */
const TEXT_LENGTH = 30;

interface NodeMenuProps {
  /** The node that was right-clicked: not listed. */
  source: string;
  nodes: NodeRecord[];
  /** The ids of the nodes that have at least one link. */
  linked: Set<string>;
  /** Every link: the nodes already linked to the right-clicked node (either way) are not listed, as two nodes have at most one link. */
  links: WorkspaceLink[];
  /** Where the right-click was, in the window. */
  x: number;
  y: number;
  /** The pointer moved onto a listed node (its id) or off the list (undefined). */
  onHover: (id: string | undefined) => void;
  onSelect: (target: string) => void;
  onCancel: () => void;
}

/**
 * The popup shown on right-clicking a node: every other node it is not already linked to, those without a link first, each shown by the first
 * TEXT_LENGTH characters of its displayed text. Choosing one asks for a link from the right-clicked node to it; a click
 * anywhere off the list cancels.
 */
export function NodeMenu({ source, nodes, linked, links, x, y, onHover, onSelect, onCancel }: NodeMenuProps) {
  const joined = new Set(links.flatMap((link) => (link.source === source ? [link.target] : link.target === source ? [link.source] : [])));
  const others = nodes.filter((node) => node.id !== source && !joined.has(node.id));
  const ordered = [...others.filter((node) => !linked.has(node.id)), ...others.filter((node) => linked.has(node.id))];

  return (
    <div
      className="fixed inset-0 z-50"
      data-testid="node-menu-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ul role="menu" data-testid="node-menu" className="fixed max-h-80 overflow-auto rounded border border-slate-300 bg-white py-1 text-sm shadow-lg" style={{ left: x, top: y }} onPointerLeave={() => onHover(undefined)}>
        {ordered.map((node) => (
          <li
            key={node.id}
            role="menuitem"
            data-testid="node-menu-item"
            data-node-id={node.id}
            className="cursor-pointer whitespace-pre px-3 py-0.5 hover:bg-slate-100"
            onPointerEnter={() => onHover(node.id)}
            onClick={() => onSelect(node.id)}
          >
            {displayText(node).slice(0, TEXT_LENGTH)}
          </li>
        ))}
      </ul>
    </div>
  );
}
