/**
 * Link paths (PRD 8.4), worked out from the positions of the displays, in distance units.
 *
 * A path may join a display anywhere on its edge, and never crosses a display: it keeps a clearance from every display
 * other than its own two (D9). A link's path is as short as it can be:
 *
 * 1. The straight line between the nearest points of the two displays' edges, so that its length is the distance
 *    between the displays that the link's weight sets. Where the displays face each other along an axis, every such line
 *    is as short as the others; the one nearest the middle of the part they share is used.
 * 2. Only if no such line is clear, the shortest path routed around the displays in the way, found with the
 *    visibility-graph method (shortest paths among rectangular obstacles, with Dijkstra's algorithm), with its corners
 *    rounded into a smooth curve (D10).
 *
 * Links may cross other links (the layout keeps the number of crossings down; see countCrossings).
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

/** A display's connection points (shown on the canvas): the midpoint of an edge, or a corner. */
export type Anchor = 'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left' | 'top-left';

export interface LinkPath {
  /** SVG path data. */
  d: string;
  length: number;
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
/** Other displays are inflated by this for routing: a little more than KEEP, so that rounded corners still keep it. */
const INFLATE = KEEP + 3;
/** Corner radii tried, largest first, when rounding a routed path. */
const RADII = [32, 16, 8, 4, 0];
const SAMPLE_STEP = 2;
/** How far apart the points of a display's edge are that a routed path may join it at, when the nearest one is hidden. */
const EDGE_STEP = 8;
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

/** Near an end two links share (they join a display at the same point), meeting does not count as crossing. */
const SHARED_END = 8;

type Segment = { kind: 'L'; to: Point } | { kind: 'Q'; c: Point; to: Point } | { kind: 'C'; c1: Point; c2: Point; to: Point };

interface Shape {
  start: Point;
  segments: Segment[];
}

const add = (a: Point, b: Point, k = 1): Point => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

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

/** The point of a rectangle nearest p (p itself if it is inside). */
function nearestPoint(r: Rect, p: Point): Point {
  return { x: Math.min(Math.max(p.x, r.x), r.x + r.width), y: Math.min(Math.max(p.y, r.y), r.y + r.height) };
}

/** Points around the edge of a rectangle, about EDGE_STEP apart, its corners among them. */
function edgePoints(r: Rect): Point[] {
  const points: Point[] = [];
  const side = (from: Point, to: Point) => {
    const steps = Math.max(1, Math.ceil(distance(from, to) / EDGE_STEP));
    for (let i = 0; i < steps; i += 1) points.push({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
  };
  const [tl, tr, br, bl] = [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
  side(tl, tr);
  side(tr, br);
  side(br, bl);
  side(bl, tl);
  return points;
}

/**
 * The shortest straight lines between the edges of two displays, best first: each is as long as the distance between
 * the displays' nearest edges. Displays side by side (or one above the other) face each other along an axis, and every
 * line across the part of their facing edges they share is as short as the others: the one at the middle of that part
 * comes first, then the ones at either side of each other display that is in the way, nearest the middle first. Displays
 * that do not face each other have one: between their nearest corners. Displays that overlap have none.
 */
function shortestLines(rects: Rect[], source: number, target: number): [Point, Point][] {
  const [a, b] = [rects[source], rects[target]];
  const shared = (a0: number, a1: number, b0: number, b1: number) => [Math.max(a0, b0), Math.min(a1, b1)];
  const [x0, x1] = shared(a.x, a.x + a.width, b.x, b.x + b.width);
  const [y0, y1] = shared(a.y, a.y + a.height, b.y, b.y + b.height);
  const facingX = x0 <= x1;
  const facingY = y0 <= y1;
  if (facingX && facingY) return [];
  if (!facingX && !facingY) {
    const corner = (r: Rect, other: Rect): Point => ({
      x: r.x + r.width < other.x ? r.x + r.width : r.x,
      y: r.y + r.height < other.y ? r.y + r.height : r.y,
    });
    return [[corner(a, b), corner(b, a)]];
  }
  // Along the shared part of the facing edges (x for displays one above the other, y for displays side by side).
  const [lo, hi] = facingX ? [x0, x1] : [y0, y1];
  const middle = (lo + hi) / 2;
  const places = [middle, lo, hi];
  const margin = KEEP + 0.01;
  rects.forEach((r, i) => {
    if (i === source || i === target) return;
    const [start, size] = facingX ? [r.x, r.width] : [r.y, r.height];
    for (const place of [start - margin, start + size + margin]) if (place > lo && place < hi) places.push(place);
  });
  places.sort((p, q) => Math.abs(p - middle) - Math.abs(q - middle));
  return places.map((place): [Point, Point] => {
    if (facingX) {
      const [aEdge, bEdge] = a.y + a.height < b.y ? [a.y + a.height, b.y] : [a.y, b.y + b.height];
      return [{ x: place, y: aEdge }, { x: place, y: bEdge }];
    }
    const [aEdge, bEdge] = a.x + a.width < b.x ? [a.x + a.width, b.x] : [a.x, b.x + b.width];
    return [{ x: aEdge, y: place }, { x: bEdge, y: place }];
  });
}

function straight(from: Point, to: Point): Shape {
  return { start: from, segments: [{ kind: 'L', to }] };
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

/**
 * The visibility graph for one link: the displays in its way are the other displays, inflated, and its own two, as they
 * are (a path may run up to their edges, but not through them). Its corners are the corners of the inflated other
 * displays that lie outside every obstacle.
 */
class Graph {
  readonly obstacles: Rect[];
  readonly corners: Point[];

  constructor(
    rects: Rect[],
    private readonly source: Rect,
    private readonly target: Rect,
  ) {
    const others = rects.filter((r) => r !== source && r !== target).map((r) => inflate(r, INFLATE));
    this.obstacles = [...others, source, target];
    this.corners = others
      .flatMap((r) => [
        { x: r.x, y: r.y },
        { x: r.x + r.width, y: r.y },
        { x: r.x + r.width, y: r.y + r.height },
        { x: r.x, y: r.y + r.height },
      ])
      .filter((corner) => this.isFree(corner));
  }

  isFree(point: Point): boolean {
    return !this.obstacles.some((r) => strictlyInside(point, r));
  }

  sees(a: Point, b: Point): boolean {
    return !this.obstacles.some((r) => crossesInside(a, b, r));
  }

  /** The point of a display's edge nearest p that p can see, or undefined if p sees none of the edge. */
  private join(r: Rect, p: Point): Point | undefined {
    const nearest = nearestPoint(r, p);
    if (this.sees(nearest, p)) return nearest;
    return edgePoints(r)
      .sort((q, s) => distance(q, p) - distance(s, p))
      .find((q) => this.sees(q, p));
  }

  /**
   * The shortest path from the source display's edge to the target display's edge that keeps outside every obstacle and
   * turns only at the corners (at least one), or undefined if there is none.
   */
  shortest(): Point[] | undefined {
    const n = this.corners.length;
    const starts = this.corners.map((corner) => this.join(this.source, corner));
    const ends = this.corners.map((corner) => this.join(this.target, corner));
    const best = this.corners.map((corner, i) => (starts[i] ? distance(starts[i]!, corner) : Infinity));
    const previous = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    // Dijkstra's algorithm over the corners, from the source's edge; the path ends at the corner from which the whole
    // way to the target's edge is shortest.
    let finish = -1;
    let finishCost = Infinity;
    for (;;) {
      let current = -1;
      for (let i = 0; i < n; i += 1) if (!done[i] && best[i] < Infinity && (current < 0 || best[i] < best[current])) current = i;
      if (current < 0 || best[current] >= finishCost) break;
      done[current] = true;
      const corner = this.corners[current];
      if (ends[current]) {
        const cost = best[current] + distance(corner, ends[current]!);
        if (cost < finishCost) [finish, finishCost] = [current, cost];
      }
      for (let next = 0; next < n; next += 1) {
        if (done[next]) continue;
        const cost = best[current] + distance(corner, this.corners[next]);
        if (cost < best[next] && this.sees(corner, this.corners[next])) {
          best[next] = cost;
          previous[next] = current;
        }
      }
    }
    if (finish < 0) return undefined;
    const path: Point[] = [ends[finish]!];
    let i = finish;
    for (; previous[i] >= 0; i = previous[i]) path.unshift(this.corners[i]);
    path.unshift(starts[i]!, this.corners[i]);
    return path;
  }
}

interface Chosen {
  shape: Shape;
  points: Point[];
  length: number;
  clear: boolean;
}

function chosen(shape: Shape, clear: boolean): Chosen {
  const points = sample(shape);
  return { shape, points, length: lengthOf(points), clear };
}

/**
 * The path of a link between the displays `rects[source]` and `rects[target]`: the shortest straight line between their
 * edges, if one is clear (see shortestLines); if not, the shortest path routed around the displays in the way, with its
 * corners rounded (the largest radius that keeps it clear). A link with no clear path is given the first of the
 * shortest straight lines (or, for displays that overlap, the line between their centres), marked `clear: false`, so
 * that it is still shown.
 */
function routeLink(rects: Rect[], source: number, target: number): Chosen {
  const lines = shortestLines(rects, source, target);
  for (const [from, to] of lines) {
    const shape = straight(from, to);
    const points = sample(shape);
    if (isClear(points, rects, source, target)) return { shape, points, length: lengthOf(points), clear: true };
  }
  const polyline = new Graph(rects, rects[source], rects[target]).shortest();
  if (polyline) {
    for (const radius of RADII) {
      const shape = rounded(polyline, radius);
      const points = sample(shape);
      if (isClear(points, rects, source, target)) return { shape, points, length: lengthOf(points), clear: true };
    }
  }
  const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  return chosen(lines.length ? straight(...lines[0]) : straight(centre(rects[source]), centre(rects[target])), false);
}

/** The paths of the given links between the displays `rects` (see routeLink). */
export function routeLinks(rects: Rect[], links: RouteRequest[]): Map<string, LinkPath> {
  return new Map(
    links.map((link) => {
      const path = routeLink(rects, link.source, link.target);
      return [link.id, { d: toPathData(path.shape), length: path.length, clear: path.clear, points: path.points }];
    }),
  );
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
