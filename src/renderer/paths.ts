/**
 * Link paths (PRD 8.4), worked out from the positions of the displays, in distance units.
 *
 * A path leaves and enters a display at one of its eight anchors (the connection points: the midpoints of its edges and
 * its corners), at right angles to the edge (diagonally, at a corner), and never crosses a display: it keeps a clearance
 * from every display other than its own two (D9). Between each pair of anchors it first tries a single curve (a cubic
 * Bézier, which is a straight line between aligned displays facing each other); if no such curve is clear, it is
 * routed around the displays with the visibility-graph method (shortest paths among rectangular obstacles, found with
 * Dijkstra's algorithm) and its corners are rounded into a smooth curve (D10).
 *
 * Of the clear paths, the shortest is used; but where two or more paths meet a display at the same anchor, the longer
 * ones move to an anchor next to it (see spread). Links may cross other links (the layout keeps the number of crossings
 * down; see countCrossings).
 */

export interface Point {
  x: number;
  y: number;
}

/** A display: its top-left corner and size. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where on a display a path may join it: the midpoint of an edge, or a corner. */
export type Anchor = 'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left' | 'top-left';

/** The anchors in order around a display: each is next to those before and after it (and the last to the first). */
export const ANCHORS: Anchor[] = ['top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left', 'top-left'];

export interface LinkPath {
  /** SVG path data. */
  d: string;
  length: number;
  /** The anchors the path leaves the source and enters the target by. */
  anchors: [Anchor, Anchor];
  /** False if no clear path was found and this one may cross displays. */
  clear: boolean;
  /** Points along the path, about SAMPLE_STEP apart. */
  points: Point[];
}

/** A link to route: the indexes of its source and target displays. */
export interface RouteRequest {
  id: string;
  source: number;
  target: number;
}

/** Clearance between a link and every other display (D9). */
export const CLEARANCE = 12;
/** Thickness of a link's line (D9). */
export const LINE_WIDTH = 2;

/** How far the middle of a line keeps from other displays, so that its edge keeps the clearance. */
const KEEP = CLEARANCE + LINE_WIDTH / 2;
/** Displays are inflated by this for routing: a little more than KEEP, so that rounded corners still keep it. */
const INFLATE = KEEP + 3;
/**
 * The straight piece a routed path starts and ends with, at right angles to its edge, before it may turn: this far
 * from the edge (and from both edges, at a corner), just outside the inflated display.
 */
const STUB = INFLATE + 1;
/** Corner radii tried, largest first, when rounding a routed path. */
const RADII = [32, 16, 8, 4, 0];
const SAMPLE_STEP = 2;
/** Where each anchor is, as -1, 0 or 1 across (left to right) and down (top to bottom) the display. */
const PLACES: Record<Anchor, [number, number]> = {
  top: [0, -1],
  'top-right': [1, -1],
  right: [1, 0],
  'bottom-right': [1, 1],
  bottom: [0, 1],
  'bottom-left': [-1, 1],
  left: [-1, 0],
  'top-left': [-1, -1],
};
/** How much worse (in distance units) a diagonal axis is than a horizontal or vertical one: displays sit on a diagonal axis only when they cannot sit on one of those. */
export const DIAGONAL_PENALTY = 8;

/**
 * How far the line from one display's centre to another's, which runs (dx, dy), is from the nearest ideal axis (horizontal,
 * vertical or diagonal): the distance the second centre lies from that axis through the first, plus DIAGONAL_PENALTY for a diagonal axis.
 * Zero means the two displays are centred on a horizontal or vertical axis.
 */
export function alignmentCost(dx: number, dy: number): number {
  const [ax, ay] = [Math.abs(dx), Math.abs(dy)];
  return Math.min(ax, ay, Math.abs(ax - ay) / Math.SQRT2 + DIAGONAL_PENALTY);
}

/**
 * The anchors a link between two displays ideally joins them by, given the line (dx, dy) from the source's centre to the
 * target's: on the axis nearest that line (see alignmentCost), the source's anchor facing along it and the target's facing back.
 * Undefined if the centres coincide.
 */
export function idealAnchors(dx: number, dy: number): [Anchor, Anchor] | undefined {
  if (dx === 0 && dy === 0) return undefined;
  const [ax, ay] = [Math.abs(dx), Math.abs(dy)];
  const diagonal = Math.abs(ax - ay) / Math.SQRT2 + DIAGONAL_PENALTY;
  const [across, down] = diagonal < Math.min(ax, ay) ? [Math.sign(dx), Math.sign(dy)] : ay <= ax ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
  const anchorAt = (x: number, y: number) => ANCHORS.find((anchor) => PLACES[anchor][0] === x && PLACES[anchor][1] === y)!;
  return [anchorAt(across, down), anchorAt(-across, -down)];
}

/** Near an end two links share (they join a display at the same anchor), meeting does not count as crossing. */
const SHARED_END = 8;

type Segment = { kind: 'L'; to: Point } | { kind: 'Q'; c: Point; to: Point } | { kind: 'C'; c1: Point; c2: Point; to: Point };

interface Shape {
  start: Point;
  segments: Segment[];
}

const add = (a: Point, b: Point, k = 1): Point => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** An anchor of a display: where it is, the direction (a unit vector) a path leaves it in, and its stub's length. */
function port(rect: Rect, anchor: Anchor): { point: Point; normal: Point; stub: number } {
  const [across, down] = PLACES[anchor];
  const length = Math.hypot(across, down);
  return {
    point: { x: rect.x + (rect.width * (across + 1)) / 2, y: rect.y + (rect.height * (down + 1)) / 2 },
    normal: { x: across / length, y: down / length },
    stub: STUB * length,
  };
}

/** The distance from a point to a rectangle (0 on or inside it). */
export function pointRectDistance(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

function strictlyInside(p: Point, r: Rect): boolean {
  const e = 1e-6;
  return p.x > r.x + e && p.x < r.x + r.width - e && p.y > r.y + e && p.y < r.y + r.height - e;
}

/** Whether the segment from a to b passes through the inside of r (running along its boundary does not count). */
function crossesInside(a: Point, b: Point, r: Rect): boolean {
  const e = 1e-6;
  const x0 = r.x + e, x1 = r.x + r.width - e, y0 = r.y + e, y1 = r.y + r.height - e;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p: number, q: number) => {
    if (p === 0) return q > 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, a.x - x0) && clip(dx, x1 - a.x) && clip(-dy, a.y - y0) && clip(dy, y1 - a.y) && t1 - t0 > 1e-9;
}

function pointAt(from: Point, segment: Segment, t: number): Point {
  const u = 1 - t;
  switch (segment.kind) {
    case 'L':
      return { x: from.x * u + segment.to.x * t, y: from.y * u + segment.to.y * t };
    case 'Q':
      return {
        x: u * u * from.x + 2 * u * t * segment.c.x + t * t * segment.to.x,
        y: u * u * from.y + 2 * u * t * segment.c.y + t * t * segment.to.y,
      };
    case 'C':
      return {
        x: u * u * u * from.x + 3 * u * u * t * segment.c1.x + 3 * u * t * t * segment.c2.x + t * t * t * segment.to.x,
        y: u * u * u * from.y + 3 * u * u * t * segment.c1.y + 3 * u * t * t * segment.c2.y + t * t * t * segment.to.y,
      };
  }
}

/** Points along the shape, about SAMPLE_STEP apart. */
function sample(shape: Shape): Point[] {
  const points = [shape.start];
  let from = shape.start;
  for (const segment of shape.segments) {
    const hull = segment.kind === 'L' ? [segment.to] : segment.kind === 'Q' ? [segment.c, segment.to] : [segment.c1, segment.c2, segment.to];
    let reach = 0;
    let previous = from;
    for (const point of hull) {
      reach += distance(previous, point);
      previous = point;
    }
    const steps = Math.max(1, Math.ceil(reach / SAMPLE_STEP));
    for (let i = 1; i <= steps; i += 1) points.push(pointAt(from, segment, i / steps));
    from = segment.to;
  }
  return points;
}

function lengthOf(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += distance(points[i - 1], points[i]);
  return length;
}

/**
 * Whether the sampled path is clear: it keeps KEEP from every display but its own two, and stays out of its own two
 * except where it starts and ends.
 */
function isClear(points: Point[], rects: Rect[], source: number, target: number): boolean {
  const start = points[0];
  const end = points[points.length - 1];
  // Only displays within KEEP of the path's bounds can be too close to it.
  const reach = inflate(bounds(points), KEEP);
  const near = rects.flatMap((rect, i) => (i === source || i === target || overlaps(reach, rect) ? [i] : []));
  const within2 = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < 4;
  for (const point of points) {
    const nearEnds = within2(point, start) || within2(point, end);
    for (const i of near) {
      const d = pointRectDistance(point, rects[i]);
      if (i === source || i === target) {
        if (!nearEnds && d < 0.5) return false;
      } else if (d < KEEP) {
        return false;
      }
    }
  }
  return true;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

function toPathData(shape: Shape): string {
  const parts = [`M${fmt(shape.start.x)} ${fmt(shape.start.y)}`];
  for (const s of shape.segments) {
    if (s.kind === 'L') parts.push(`L${fmt(s.to.x)} ${fmt(s.to.y)}`);
    else if (s.kind === 'Q') parts.push(`Q${fmt(s.c.x)} ${fmt(s.c.y)} ${fmt(s.to.x)} ${fmt(s.to.y)}`);
    else parts.push(`C${fmt(s.c1.x)} ${fmt(s.c1.y)} ${fmt(s.c2.x)} ${fmt(s.c2.y)} ${fmt(s.to.x)} ${fmt(s.to.y)}`);
  }
  return parts.join(' ');
}

/**
 * The single curve from one anchor to another: a cubic Bézier leaving and entering in the anchors' directions. When the
 * two anchors face each other on one line (aligned displays), it is a straight line.
 */
function singleCurve(a: { point: Point; normal: Point }, b: { point: Point; normal: Point }): Shape {
  const dx = b.point.x - a.point.x;
  const dy = b.point.y - a.point.y;
  const facing = a.normal.x === -b.normal.x && a.normal.y === -b.normal.y;
  const along = dx * a.normal.x + dy * a.normal.y;
  const across = Math.abs(dx * a.normal.y - dy * a.normal.x);
  if (facing && along > 0 && across < 0.5) return { start: a.point, segments: [{ kind: 'L', to: b.point }] };
  const reach = Math.max(STUB, distance(a.point, b.point) / 2);
  return { start: a.point, segments: [{ kind: 'C', c1: add(a.point, a.normal, reach), c2: add(b.point, b.normal, reach), to: b.point }] };
}

/** A polyline with its corners rounded (radius at most `radius`, and never more than half of either side). */
function rounded(points: Point[], radius: number): Shape {
  const segments: Segment[] = [];
  for (let i = 1; i < points.length - 1; i += 1) {
    const [p, c, n] = [points[i - 1], points[i], points[i + 1]];
    const r = Math.min(radius, distance(p, c) / 2, distance(c, n) / 2);
    if (r <= 0) {
      segments.push({ kind: 'L', to: c });
      continue;
    }
    const before = add(c, { x: (p.x - c.x) / distance(p, c), y: (p.y - c.y) / distance(p, c) }, r);
    const after = add(c, { x: (n.x - c.x) / distance(c, n), y: (n.y - c.y) / distance(c, n) }, r);
    segments.push({ kind: 'L', to: before }, { kind: 'Q', c, to: after });
  }
  segments.push({ kind: 'L', to: points[points.length - 1] });
  return { start: points[0], segments };
}

/** The visibility graph's corners: the corners of the inflated displays that lie outside every other inflated display. */
class Graph {
  readonly obstacles: Rect[];
  readonly corners: Point[];
  private readonly visibility: (boolean | undefined)[][];

  constructor(rects: Rect[]) {
    this.obstacles = rects.map((r) => inflate(r, INFLATE));
    this.corners = this.obstacles
      .flatMap((r) => [
        { x: r.x, y: r.y },
        { x: r.x + r.width, y: r.y },
        { x: r.x + r.width, y: r.y + r.height },
        { x: r.x, y: r.y + r.height },
      ])
      .filter((corner) => this.isFree(corner));
    this.visibility = this.corners.map(() => []);
  }

  isFree(point: Point): boolean {
    return !this.obstacles.some((r) => strictlyInside(point, r));
  }

  sees(a: Point, b: Point): boolean {
    return !this.obstacles.some((r) => crossesInside(a, b, r));
  }

  private cornersSee(i: number, j: number): boolean {
    const [lo, hi] = i < j ? [i, j] : [j, i];
    return (this.visibility[lo][hi] ??= this.sees(this.corners[lo], this.corners[hi]));
  }

  /** The shortest path from `from` to `to` that keeps outside every inflated display, or undefined if there is none. */
  shortest(from: Point, to: Point): Point[] | undefined {
    if (this.sees(from, to)) return [from, to];
    // Nodes: the corners, then `from`, then `to`.
    const count = this.corners.length + 2;
    const fromIndex = count - 2;
    const toIndex = count - 1;
    const pointOf = (i: number) => (i === fromIndex ? from : i === toIndex ? to : this.corners[i]);
    const fromSees = this.corners.map((corner) => this.sees(from, corner));
    const toSees = this.corners.map((corner) => this.sees(corner, to));
    const visible = (i: number, j: number) => {
      if (i === fromIndex) return j === toIndex ? false : fromSees[j];
      if (j === toIndex) return toSees[i];
      if (j === fromIndex || i === toIndex) return false;
      return this.cornersSee(i, j);
    };
    const best = new Array<number>(count).fill(Infinity);
    const previous = new Array<number>(count).fill(-1);
    const done = new Array<boolean>(count).fill(false);
    best[fromIndex] = 0;
    for (;;) {
      let current = -1;
      for (let i = 0; i < count; i += 1) if (!done[i] && best[i] < Infinity && (current < 0 || best[i] < best[current])) current = i;
      if (current < 0) return undefined;
      if (current === toIndex) break;
      done[current] = true;
      for (let next = 0; next < count; next += 1) {
        if (done[next] || next === current || next === fromIndex) continue;
        const cost = best[current] + distance(pointOf(current), pointOf(next));
        if (cost < best[next] && visible(current, next)) {
          best[next] = cost;
          previous[next] = current;
        }
      }
    }
    const path: Point[] = [];
    for (let i = toIndex; i >= 0; i = previous[i]) path.unshift(pointOf(i));
    return path;
  }
}

interface Candidate {
  shape: Shape;
  points: Point[];
  length: number;
  anchors: [Anchor, Anchor];
}

/**
 * The paths a link could take between its two displays: at most one clear path per pair of anchors, each worked out
 * only when it is asked for. If any single curve is clear, the link's paths are single curves; otherwise they are
 * routed around the displays.
 */
class Options {
  /** The shortest clear path, if there is one. */
  readonly best: Candidate | undefined;
  /** Every single curve, shortest first, clear or not. */
  readonly curves: Candidate[];
  private readonly routed: boolean;
  private readonly known = new Map<string, Candidate | undefined>();

  constructor(
    private readonly rects: Rect[],
    private readonly source: number,
    private readonly target: number,
    private readonly graph: () => Graph,
  ) {
    this.curves = ANCHORS.flatMap((s) =>
      ANCHORS.map((t): Candidate => {
        const shape = singleCurve(port(rects[source], s), port(rects[target], t));
        const points = sample(shape);
        return { shape, points, length: lengthOf(points), anchors: [s, t] };
      }),
    ).sort((a, b) => a.length - b.length);
    this.routed = false;
    // A clear single curve between the anchors the displays' relative position calls for wins over a shorter one elsewhere.
    const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    const [from, to] = [centre(rects[source]), centre(rects[target])];
    const ideal = idealAnchors(to.x - from.x, to.y - from.y);
    this.best = (ideal && this.get(...ideal)) || this.curves.find((curve) => this.get(...curve.anchors));
    if (!this.best) {
      this.routed = true;
      // No single curve is clear: route around the displays. A path is never shorter than the distance between its
      // anchors, so pairs further apart than the shortest path found so far need not be routed.
      this.known.clear();
      const gap = ([s, t]: [Anchor, Anchor]) => distance(port(rects[source], s).point, port(rects[target], t).point);
      for (const anchors of this.curves.map((curve) => curve.anchors).sort((p, q) => gap(p) - gap(q))) {
        if (this.best && gap(anchors) >= this.best.length) break;
        const path = this.get(...anchors);
        if (path && (!this.best || path.length < this.best.length)) this.best = path;
      }
    }
  }

  /** The clear path between these two anchors, if there is one. */
  get(s: Anchor, t: Anchor): Candidate | undefined {
    const key = `${s}:${t}`;
    if (!this.known.has(key)) this.known.set(key, this.routed ? this.route(s, t) : this.curve(s, t));
    return this.known.get(key);
  }

  private curve(s: Anchor, t: Anchor): Candidate | undefined {
    const curve = this.curves.find((c) => c.anchors[0] === s && c.anchors[1] === t)!;
    return isClear(curve.points, this.rects, this.source, this.target) ? curve : undefined;
  }

  private route(s: Anchor, t: Anchor): Candidate | undefined {
    const g = this.graph();
    const a = port(this.rects[this.source], s);
    const b = port(this.rects[this.target], t);
    const aOut = add(a.point, a.normal, a.stub);
    const bOut = add(b.point, b.normal, b.stub);
    if (!g.isFree(aOut) || !g.isFree(bOut)) return undefined;
    const middle = g.shortest(aOut, bOut);
    if (!middle) return undefined;
    const polyline = [a.point, ...middle, b.point];
    for (const radius of RADII) {
      const shape = rounded(polyline, radius);
      const points = sample(shape);
      if (isClear(points, this.rects, this.source, this.target)) return { shape, points, length: lengthOf(points), anchors: [s, t] };
    }
    return undefined;
  }
}

interface Chosen extends Candidate {
  clear: boolean;
}

/** The anchors next to an anchor around its display. */
function neighbours(anchor: Anchor): Anchor[] {
  const i = ANCHORS.indexOf(anchor);
  return [ANCHORS[(i + ANCHORS.length - 1) % ANCHORS.length], ANCHORS[(i + 1) % ANCHORS.length]];
}

/**
 * Where two or more paths meet a display at the same anchor, every one but the shortest (of equal lengths, the
 * earlier link's counts as shorter) moves to an anchor next to it, provided that anchor has no more paths than are
 * left at this one and a clear path joins the display there; of two such anchors, the one giving the shorter path (or,
 * for paths as long, the one with fewer paths).
 * The other end of the path stays where it is. Each end of a path moves at most once, and a path that is not clear
 * does not move.
 */
function spread(links: RouteRequest[], options: Options[], chosen: Chosen[]): void {
  const display = (k: number, end: number) => (end === 0 ? links[k].source : links[k].target);
  const moved = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    const at = new Map<string, [number, number][]>();
    chosen.forEach((path, k) => {
      for (const end of [0, 1]) {
        const key = `${display(k, end)}:${path.anchors[end]}`;
        at.set(key, [...(at.get(key) ?? []), [k, end]]);
      }
    });
    search: for (const ends of at.values()) {
      if (ends.length < 2) continue;
      const longestFirst = [...ends].sort(([j], [k]) => chosen[k].length - chosen[j].length || k - j);
      for (const [k, end] of longestFirst.slice(0, -1)) {
        if (!chosen[k].clear || moved.has(`${k}:${end}`)) continue;
        const anchors = chosen[k].anchors;
        const moves = neighbours(anchors[end])
          .map((anchor) => ({ anchor, count: at.get(`${display(k, end)}:${anchor}`)?.length ?? 0 }))
          .filter(({ count }) => count <= ends.length - 1)
          .flatMap(({ anchor, count }) => {
            const path = options[k].get(...((end === 0 ? [anchor, anchors[1]] : [anchors[0], anchor]) as [Anchor, Anchor]));
            return path ? [{ path, count }] : [];
          })
          .sort((p, q) => (Math.abs(p.path.length - q.path.length) < 0.5 ? p.count - q.count : p.path.length - q.path.length));
        if (moves.length === 0) continue;
        chosen[k] = { ...moves[0].path, clear: true };
        moved.add(`${k}:${end}`);
        changed = true;
        break search;
      }
    }
  }
}

/**
 * The paths of the given links between the displays `rects`: the shortest clear path for each, then spread out where
 * paths meet a display at the same anchor. A link with no clear path is given the shortest single curve (marked
 * `clear: false`), so that it is still shown.
 */
export function routeLinks(rects: Rect[], links: RouteRequest[]): Map<string, LinkPath> {
  let graph: Graph | undefined;
  const lazyGraph = () => (graph ??= new Graph(rects));
  const options = links.map((link) => new Options(rects, link.source, link.target, lazyGraph));
  const chosen: Chosen[] = options.map((o) => (o.best ? { ...o.best, clear: true } : { ...o.curves[0], clear: false }));
  spread(links, options, chosen);
  return new Map(links.map((link, k) => [link.id, { d: toPathData(chosen[k].shape), length: chosen[k].length, anchors: chosen[k].anchors, clear: chosen[k].clear, points: chosen[k].points }]));
}

/** Whether the segments ab and cd cross (touching, or running along each other, does not count). */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const turn = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return turn(c, d, a) * turn(c, d, b) < 0 && turn(a, b, c) * turn(a, b, d) < 0;
}

function bounds(points: Point[]): Rect {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Whether two paths (with their bounds) cross each other anywhere but at an end they share. */
function pathsCross(p: Point[], pBox: Rect, q: Point[], qBox: Rect): boolean {
  const shared = [p[0], p[p.length - 1]].filter((end) => distance(end, q[0]) < 0.5 || distance(end, q[q.length - 1]) < 0.5);
  const awayFrom = (points: Point[]) => (shared.length ? points.map((point) => shared.every((end) => distance(point, end) >= SHARED_END)) : points.map(() => true));
  const pAway = awayFrom(p);
  const qAway = awayFrom(q);
  const outside = (a: Point, b: Point, box: Rect) =>
    Math.max(a.x, b.x) < box.x || Math.min(a.x, b.x) > box.x + box.width || Math.max(a.y, b.y) < box.y || Math.min(a.y, b.y) > box.y + box.height;
  for (let i = 1; i < p.length; i += 1) {
    if (!pAway[i - 1] || !pAway[i] || outside(p[i - 1], p[i], qBox)) continue;
    for (let j = 1; j < q.length; j += 1) {
      if (qAway[j - 1] && qAway[j] && !outside(q[j - 1], q[j], pBox) && segmentsCross(p[i - 1], p[i], q[j - 1], q[j])) return true;
    }
  }
  return false;
}

/** How many pairs of the given paths cross each other, and which paths (by index) are in one of those pairs. */
export function countCrossings(paths: LinkPath[]): { count: number; crossed: Set<number> } {
  const boxes = paths.map((path) => bounds(path.points));
  let count = 0;
  const crossed = new Set<number>();
  for (let i = 0; i < paths.length; i += 1) {
    for (let j = i + 1; j < paths.length; j += 1) {
      if (overlaps(boxes[i], boxes[j]) && pathsCross(paths[i].points, boxes[i], paths[j].points, boxes[j])) {
        count += 1;
        crossed.add(i).add(j);
      }
    }
  }
  return { count, crossed };
}
