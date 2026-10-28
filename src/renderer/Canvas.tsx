import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { renderNode } from './handlers';
import { runLayout, type Layout } from './layout';
import { LinkDisplay } from './LinkDisplay';
import { LINE_WIDTH, routeLinks, type Anchor, type Rect } from './paths';
import { WeightDialog } from './WeightDialog';

/** Pixels per distance unit: the scale the layout's coordinate space is shown at (9.5). */
const UNIT_PX = 1;
/** Space (in pixels) between the displays and the edges of the canvas. */
const MARGIN = 16;

const CONNECTION_POINTS: { anchor: Anchor; style: CSSProperties }[] = [
  { anchor: 'top', style: { left: '50%', top: 0 } },
  { anchor: 'top-right', style: { left: '100%', top: 0 } },
  { anchor: 'right', style: { left: '100%', top: '50%' } },
  { anchor: 'bottom-right', style: { left: '100%', top: '100%' } },
  { anchor: 'bottom', style: { left: '50%', top: '100%' } },
  { anchor: 'bottom-left', style: { left: 0, top: '100%' } },
  { anchor: 'left', style: { left: 0, top: '50%' } },
  { anchor: 'top-left', style: { left: 0, top: 0 } },
];

interface Size {
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/** A link being dragged: from the connection point at `from` to the pointer at `to`, in pixels from the content's top left. */
interface Drag {
  source: string;
  from: Point;
  to: Point;
}

interface CanvasProps {
  nodes: NodeRecord[];
  links: WorkspaceLink[];
  onCreateLink: (source: string, target: string) => void;
  onSetWeight: (link: string, weight: number) => void;
  /** The user right-clicked an empty part of the canvas, at (`x`, `y`) in pixels from the window's top left. */
  onEmptyContextMenu: (x: number, y: number) => void;
  /** The user right-clicked a node's display. */
  onNodeContextMenu: (nodeId: string) => void;
  /** The user double-clicked a node's display. */
  onOpenNode: (node: NodeRecord) => void;
}

/**
 * The canvas (PRD 9.5): the layout's coordinate space, shown at UNIT_PX pixels per distance unit, with each node's
 * display where the layout puts it and each link's display along its path. It scrolls when the displays take up more
 * room than it shows. The network is centred on the canvas, and each time the layout settles the canvas scrolls to its
 * centre.
 *
 * The layout runs whenever the network changes (and so each time a workspace is opened), starting from the positions
 * of the previous run. Hovering over a display shows its eight connection points (its edges' midpoints and its corners); dragging from one shows a line from
 * that point to the pointer, and releasing over another node's display creates a link from the first node (the
 * source) to the other (the target).
 */
export function Canvas({ nodes, links, onCreateLink, onSetWeight, onEmptyContextMenu, onNodeContextMenu, onOpenNode }: CanvasProps) {
  const elements = useRef(new Map<string, HTMLDivElement>());
  const [sizes, setSizes] = useState(new Map<string, Size>());
  const [layout, setLayout] = useState<Layout>();
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<WorkspaceLink>();
  const [drag, setDrag] = useState<Drag>();
  const canvas = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);

  // Measure each display (in pixels): the layout works with their sizes.
  useLayoutEffect(() => {
    const measured = new Map<string, Size>();
    for (const node of nodes) {
      const element = elements.current.get(node.id);
      if (element) measured.set(node.id, { width: element.offsetWidth, height: element.offsetHeight });
    }
    const same = measured.size === sizes.size && [...measured].every(([id, size]) => sizes.get(id)?.width === size.width && sizes.get(id)?.height === size.height);
    if (!same) setSizes(measured);
  });

  const network = JSON.stringify([nodes.map((node) => [node.id, sizes.get(node.id)]), links.map((link) => [link.id, link.source, link.target, link.weight])]);
  useLayoutEffect(() => {
    if (nodes.some((node) => !sizes.has(node.id))) return;
    const units = nodes.map((node) => ({ id: node.id, width: sizes.get(node.id)!.width / UNIT_PX, height: sizes.get(node.id)!.height / UNIT_PX }));
    setLayout((previous) => runLayout(units, links, previous?.positions ?? new Map()));
    // `network` stands for nodes, links and sizes: the layout runs only when one of them changes.
  }, [network]);

  // Once the layout has settled, scroll to the centre of the network (when it is larger than the canvas; otherwise it
  // is already centred).
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || !layout) return;
    element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
    element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
  }, [layout]);

  // Every display the layout has placed, as a rectangle in distance units, and the paths of the links between them.
  const { rects, paths } = useMemo(() => {
    const rects = new Map<string, Rect>();
    for (const node of nodes) {
      const at = layout?.positions.get(node.id);
      const size = sizes.get(node.id);
      if (at && size) rects.set(node.id, { x: at.x - size.width / UNIT_PX / 2, y: at.y - size.height / UNIT_PX / 2, width: size.width / UNIT_PX, height: size.height / UNIT_PX });
    }
    const ids = [...rects.keys()];
    const routable = links.filter((link) => link.source !== link.target && rects.has(link.source) && rects.has(link.target));
    const paths = routeLinks([...rects.values()], routable.map((link) => ({ id: link.id, source: ids.indexOf(link.source), target: ids.indexOf(link.target) })));
    return { rects, paths };
  }, [nodes, links, sizes, layout]);

  // The content takes in every display and every link's path (a curve can bow out beyond the displays).
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const extend = (x: number, y: number) => ([x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)]);
  for (const r of rects.values()) {
    extend(r.x, r.y);
    extend(r.x + r.width, r.y + r.height);
  }
  for (const path of paths.values()) for (const p of path.points) extend(p.x, p.y);
  const empty = rects.size === 0;
  const origin = empty ? { x: 0, y: 0 } : { x: x0, y: y0 };
  const toPx = (x: number, y: number) => ({ left: (x - origin.x) * UNIT_PX + MARGIN, top: (y - origin.y) * UNIT_PX + MARGIN });
  const width = empty ? 0 : (x1 - origin.x) * UNIT_PX + 2 * MARGIN;
  const height = empty ? 0 : (y1 - origin.y) * UNIT_PX + 2 * MARGIN;

  const toContent = (clientX: number, clientY: number): Point => {
    const box = content.current!.getBoundingClientRect();
    return { x: clientX - box.left, y: clientY - box.top };
  };
  const startDrag = (event: PointerEvent<HTMLElement>, source: string) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = event.currentTarget.getBoundingClientRect();
    setDrag({ source, from: toContent(point.left + point.width / 2, point.top + point.height / 2), to: toContent(event.clientX, event.clientY) });
  };
  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const to = toContent(event.clientX, event.clientY);
    setDrag((current) => current && { ...current, to });
  };
  const endDrag = (event: PointerEvent<HTMLElement>) => {
    const source = drag?.source;
    setDrag(undefined);
    if (!source) return;
    // Released over the source's own display (or no display): no link (D6).
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    if (target && target !== source) onCreateLink(source, target);
  };

  return (
    <main
      ref={canvas}
      className="relative flex min-h-0 flex-1 overflow-auto"
      data-testid="workspace"
      onContextMenu={(event) => {
        const target = event.target as Element;
        // On a node's display: the node. Otherwise only an empty part counts, not a link (its wide invisible path takes the clicks).
        const nodeId = target.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
        if (nodeId === undefined && target.closest('[data-link-id]')) return;
        event.preventDefault();
        if (nodeId !== undefined) return onNodeContextMenu(nodeId);
        onEmptyContextMenu(event.clientX, event.clientY);
      }}
    >
      {/* m-auto centres the content when it is smaller than the canvas, without cutting off its top or left when it is larger. */}
      <div ref={content} className="relative m-auto shrink-0" style={{ width, height }}>
        <svg className="pointer-events-none absolute left-0 top-0" width={width} height={height}>
          <g transform={`translate(${MARGIN - origin.x * UNIT_PX} ${MARGIN - origin.y * UNIT_PX}) scale(${UNIT_PX})`}>
            {links.map((link) => {
              const path = paths.get(link.id);
              return path ? <LinkDisplay key={link.id} id={link.id} d={path.d} selected={selected === link.id} onSelect={() => setSelected(link.id)} onEdit={() => setEditing(link)} /> : null;
            })}
          </g>
        </svg>
        {nodes.map((node) => {
          const rect = rects.get(node.id);
          return (
            <div
              key={node.id}
              ref={(element) => {
                if (element) elements.current.set(node.id, element);
                else elements.current.delete(node.id);
              }}
              data-node-id={node.id}
              className="group absolute"
              onDoubleClick={(event) => {
                if (!(event.target as Element).closest('[data-testid=connection-point]')) onOpenNode(node);
              }}
              style={rect ? toPx(rect.x, rect.y) : { left: 0, top: 0, visibility: 'hidden' }}
            >
              {renderNode(node)}
              {CONNECTION_POINTS.map(({ anchor, style }) => (
                <span
                  key={anchor}
                  data-testid="connection-point"
                  data-anchor={anchor}
                  className="invisible absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-crosshair touch-none rounded-full border border-slate-700 bg-white group-hover:visible"
                  style={style}
                  onPointerDown={(event) => startDrag(event, node.id)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={() => setDrag(undefined)}
                />
              ))}
            </div>
          );
        })}
        {/* Above the displays, so the end of the line stays visible over the target. */}
        {drag && (
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={width} height={height}>
            <line data-testid="link-drag" x1={drag.from.x} y1={drag.from.y} x2={drag.to.x} y2={drag.to.y} stroke="black" strokeWidth={LINE_WIDTH} />
          </svg>
        )}
      </div>
      {editing && (
        <WeightDialog
          weight={editing.weight}
          onClose={(weight) => {
            setEditing(undefined);
            if (weight !== editing.weight) onSetWeight(editing.id, weight);
          }}
        />
      )}
    </main>
  );
}
