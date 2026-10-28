import { alignmentCost, countCrossings, DIAGONAL_PENALTY, routeLinks, segmentsCross, type LinkPath, type Point, type Rect } from './paths';

/**
 * The layout (PRD 9): positions the node displays, in distance units, to meet its goals:
 *
 * 1. no link crosses a node display (every link has a clear path; see paths.ts);
 * 2. nodes joined by a higher-weight link are closer: each link's distance (between the nearest edges of its two
 *    displays, D14) falls within the range of distances for its weight (9.3);
 *
 * with as few links crossing each other as it can manage while meeting them, and while keeping at least the minimum space between displays (9.4). It is a force simulation written for these goals,
 * starting from the Fruchterman-Reingold algorithm (D4): links pull or push their two displays into their range,
 * displays push away from close neighbours, a weak pull towards the middle keeps the network together, and the
 * temperature (the most a display may move in one step) cools as it runs. A run stops as soon as the goals are met.
 *
 * The link distances of every weight are scaled together. The layout tries the starting scale (1) and grows the scale
 * until the goals are met, then narrows down to the smallest scale that still meets them (D13), and ends there.
 *
 * At the scale it ends at it then keeps down the number of links that cross each other. While links cross, it moves a
 * display at the end of a crossing link to other positions around the displays it is linked to, runs the simulation
 * from there, and keeps the move if it has fewer crossings and comes at least as close to the goals (so a layout that
 * met them still meets them).
 *
 * Last, the layout biases the positions towards an ideal (see align): nodes joined by a link line up with each other, centred on
 * a horizontal or vertical axis, or failing that a diagonal one. The bias gives way to everything above: it only moves a
 * display where the goals are still met and no more links cross. (Paths support it: a link between displays that sit on
 * an axis joins the facing anchors, see idealAnchors in paths.ts.)
 *
 * Positions are not saved (D3): each run starts from the positions it is given (those of the previous run) and places
 * displays without one.
 */

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutLink {
  id: string;
  source: string;
  target: string;
  weight: number;
}

export interface Layout {
  /** The centre of each display. */
  positions: Map<string, Point>;
  scale: number;
  minSpace: number;
  /** False if no scale tried met every goal; the positions are then the closest the layout came. */
  satisfied: boolean;
}

/** Starting ranges (D12): each is RANGE_WIDTH wide, and weight 10's starts at RANGE_START. */
const RANGE_START = 30;
const RANGE_WIDTH = 30;
/** The minimum space between displays, at the starting scale (9.4): it grows with the scale, so is never less. */
const MIN_SPACE = 16;
/** Displays closer than this (times the scale) push each other away, leaving room for links to pass between them. */
const ROOM = 40;
const GROWTH = 1.5;
const MAX_SCALE = 8;
const NARROWING_STEPS = 4;
const MAX_ITERATIONS = 400;
/** How often (in iterations) the paths are worked out while the other goals are met. */
const ROUTE_EVERY = 20;
/**
 * The most simulation runs spent moving displays to cut down crossings, and the most iterations in each. Each run works
 * out the path of every link, so a network with more links gets fewer runs: no more than UNTANGLE_PATHS paths in all.
 */
const UNTANGLE_RUNS = 60;
const UNTANGLE_ITERATIONS = 100;
const UNTANGLE_PATHS = 600;
/** How many positions, evenly spaced around its linked displays, a display is moved to when cutting down crossings. */
const UNTANGLE_ANGLES = 12;
/** The most passes over the displays the alignment bias makes, and (as for untangling) the most paths worked out in all. */
const ALIGN_PASSES = 20;
/** The simulation `settle` runs: its iterations, how often it checks, its pull towards alignment and the most a display moves in a step (times the scale). */
const ALIGN_ITERATIONS = 300;
const ALIGN_CHECK = 10;
const ALIGN_BIAS = 0.1;
const ALIGN_STEP = 3;
const ALIGN_PATHS = 300;

/** The range of link distances for a weight at a scale (9.3): continuous, highest weight shortest, all as wide. */
export function distanceRange(weight: number, scale: number): [number, number] {
  const min = (w: number) => (RANGE_START + RANGE_WIDTH * (10 - w)) * scale;
  return [min(weight), weight === 1 ? min(1) + RANGE_WIDTH * scale - 1 : min(weight - 1) - 1];
}

/** The gaps between two displays along x and along y (negative where they overlap on that axis). */
function gaps(a: LayoutNode, pa: Point, b: LayoutNode, pb: Point): [number, number] {
  return [Math.abs(pb.x - pa.x) - (a.width + b.width) / 2, Math.abs(pb.y - pa.y) - (a.height + b.height) / 2];
}

/** The distance between the nearest edges of two displays (D14); negative if they overlap. */
export function linkDistance(a: LayoutNode, pa: Point, b: LayoutNode, pb: Point): number {
  const [gx, gy] = gaps(a, pa, b, pb);
  return gx <= 0 && gy <= 0 ? Math.max(gx, gy) : Math.hypot(Math.max(gx, 0), Math.max(gy, 0));
}

/** The space between two displays, for the minimum space: the larger of the gaps along x and along y. */
function space(a: LayoutNode, pa: Point, b: LayoutNode, pb: Point): number {
  return Math.max(...gaps(a, pa, b, pb));
}

function centroid(points: Iterable<Point>): Point {
  let x = 0, y = 0, n = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
    n += 1;
  }
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

/** A starting position for a display that has none: near its linked displays (or the middle), clear of the others. */
function place(node: LayoutNode, near: Point, placed: { node: LayoutNode; at: Point }[]): Point {
  for (let radius = 0; ; radius += 10) {
    const steps = radius === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * radius) / 20));
    for (let i = 0; i < steps; i += 1) {
      const angle = (2 * Math.PI * i) / steps;
      const at = { x: near.x + radius * Math.cos(angle), y: near.y + radius * Math.sin(angle) };
      if (placed.every((other) => space(node, at, other.node, other.at) >= ROOM)) return at;
    }
  }
}

interface Network {
  nodes: LayoutNode[];
  links: { link: LayoutLink; a: number; b: number }[];
}

interface Trial {
  positions: Point[];
  scale: number;
  met: boolean;
  /** For a trial that did not meet its goals: whether it met all but the link distances, and by how far it missed those. */
  routedAndSpaced: boolean;
  miss: number;
  /** The paths of the links at these positions, if they were worked out (always, for a trial that met its goals). */
  paths?: LinkPath[];
}

function check(network: Network, positions: Point[], scale: number): { spaced: boolean; miss: number } {
  const { nodes, links } = network;
  const minSpace = MIN_SPACE * scale;
  let spaced = true;
  for (let i = 0; i < nodes.length && spaced; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (space(nodes[i], positions[i], nodes[j], positions[j]) < minSpace - 1e-6) {
        spaced = false;
        break;
      }
    }
  }
  let miss = 0;
  for (const { link, a, b } of links) {
    const [lo, hi] = distanceRange(link.weight, scale);
    const d = linkDistance(nodes[a], positions[a], nodes[b], positions[b]);
    miss += d < lo ? lo - d : d > hi ? d - hi : 0;
  }
  return { spaced, miss };
}

/** The paths of the network's links, in the order of its links. */
function routes(network: Network, positions: Point[]): LinkPath[] {
  const rects: Rect[] = network.nodes.map((node, i) => ({ x: positions[i].x - node.width / 2, y: positions[i].y - node.height / 2, width: node.width, height: node.height }));
  return [...routeLinks(rects, network.links.map(({ link, a, b }) => ({ id: link.id, source: a, target: b }))).values()];
}

/**
 * One step of the simulation: moves the displays by the forces on them, no more than `temperature` each, then moves apart any
 * that are closer than the minimum space. With a `bias`, each link also pulls its two displays towards lining up (see
 * alignmentCost), by that fraction of their misalignment.
 */
function advance(network: Network, positions: Point[], scale: number, temperature: number, bias = 0): void {
  const { nodes, links } = network;
  const n = nodes.length;
  const minSpace = MIN_SPACE * scale;
  const room = ROOM * scale;
  const moves = positions.map(() => ({ x: 0, y: 0 }));
  const push = (i: number, j: number, amount: number) => {
    // Moves i and j apart (or, for a negative amount, together) by `amount` in all, along the line between them.
    let dx = positions[j].x - positions[i].x;
    let dy = positions[j].y - positions[i].y;
    let length = Math.hypot(dx, dy);
    if (length < 1e-6) {
      dx = Math.cos(i + j);
      dy = Math.sin(i + j);
      length = 1;
    }
    moves[i].x -= (dx / length) * amount * 0.5;
    moves[i].y -= (dy / length) * amount * 0.5;
    moves[j].x += (dx / length) * amount * 0.5;
    moves[j].y += (dy / length) * amount * 0.5;
  };

  // Links pull or push their displays towards the middle of their range.
  for (const { link, a, b } of links) {
    const [lo, hi] = distanceRange(link.weight, scale);
    const margin = (hi - lo) / 4;
    const d = linkDistance(nodes[a], positions[a], nodes[b], positions[b]);
    if (d < lo + margin) push(a, b, (lo + margin - d) * 0.8);
    else if (d > hi - margin) push(a, b, -(d - (hi - margin)) * 0.8);
  }
  // Close displays push each other away.
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const s = space(nodes[i], positions[i], nodes[j], positions[j]);
      if (s < room) push(i, j, (room - s) * 0.2);
    }
  }
  // Each link pulls its displays across towards the nearest ideal axis between them.
  if (bias > 0) {
    for (const { a, b } of links) {
      const [dx, dy] = [positions[b].x - positions[a].x, positions[b].y - positions[a].y];
      const [ax, ay] = [Math.abs(dx), Math.abs(dy)];
      const diagonal = Math.abs(ax - ay) / Math.SQRT2 + DIAGONAL_PENALTY;
      const [px, py] =
        diagonal < Math.min(ax, ay) ? [(Math.sign(dx) * (ax - ay)) / 2, (Math.sign(dy) * (ay - ax)) / 2] : ay <= ax ? [0, dy] : [dx, 0];
      moves[a].x += px * bias * 0.5;
      moves[a].y += py * bias * 0.5;
      moves[b].x -= px * bias * 0.5;
      moves[b].y -= py * bias * 0.5;
    }
  }
  // A weak pull towards the middle keeps the network together.
  const middle = centroid(positions);
  for (let i = 0; i < n; i += 1) {
    moves[i].x += (middle.x - positions[i].x) * 0.002;
    moves[i].y += (middle.y - positions[i].y) * 0.002;
  }
  for (let i = 0; i < n; i += 1) {
    const length = Math.hypot(moves[i].x, moves[i].y);
    const k = length > temperature ? temperature / length : 1;
    positions[i].x += moves[i].x * k;
    positions[i].y += moves[i].y * k;
  }
  separate(nodes, positions, minSpace);
}

/** One run of the simulation at a fixed scale, from the given positions, until the goals are met or it has cooled. */
function simulate(network: Network, start: Point[], scale: number, maxIterations = MAX_ITERATIONS): Trial {
  const positions = start.map((p) => ({ ...p }));
  const startTemperature = 40 * scale;
  let lastRouted = -Infinity;

  for (let iteration = 0; ; iteration += 1) {
    const { spaced, miss } = check(network, positions, scale);
    if (spaced && miss === 0 && iteration - lastRouted >= ROUTE_EVERY) {
      lastRouted = iteration;
      const paths = routes(network, positions);
      if (paths.every((path) => path.clear)) return { positions, scale, met: true, routedAndSpaced: true, miss: 0, paths };
    }
    if (iteration >= maxIterations) break;

    advance(network, positions, scale, startTemperature * (1 - iteration / maxIterations) + 1);
  }
  const { spaced, miss } = check(network, positions, scale);
  const paths = spaced ? routes(network, positions) : undefined;
  return { positions, scale, met: false, routedAndSpaced: !!paths && paths.every((path) => path.clear), miss: miss / scale, paths };
}

/** Moves displays that are closer than the minimum space apart, along whichever axis needs the smaller move. */
function separate(nodes: LayoutNode[], positions: Point[], minSpace: number): void {
  for (let pass = 0; pass < 20; pass += 1) {
    let moved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const [gx, gy] = gaps(nodes[i], positions[i], nodes[j], positions[j]);
        if (Math.max(gx, gy) >= minSpace) continue;
        moved = true;
        const alongX = minSpace - gx <= minSpace - gy;
        const amount = ((alongX ? minSpace - gx : minSpace - gy) + 1e-3) / 2;
        const delta = alongX ? positions[j].x - positions[i].x : positions[j].y - positions[i].y;
        const sign = delta > 0 || (delta === 0 && i < j) ? 1 : -1;
        if (alongX) {
          positions[i].x -= sign * amount;
          positions[j].x += sign * amount;
        } else {
          positions[i].y -= sign * amount;
          positions[j].y += sign * amount;
        }
      }
    }
    if (!moved) return;
  }
}

/**
 * Other positions for display i: UNTANGLE_ANGLES evenly spaced around the middle of its linked displays, as far from
 * that middle as it is now, nearest to where it is first.
 */
function around(network: Network, positions: Point[], i: number): Point[] {
  const middle = centroid(network.links.flatMap(({ a, b }) => (a === i ? [positions[b]] : b === i ? [positions[a]] : [])));
  const radius = Math.hypot(positions[i].x - middle.x, positions[i].y - middle.y);
  const angle = Math.atan2(positions[i].y - middle.y, positions[i].x - middle.x);
  const steps = Array.from({ length: UNTANGLE_ANGLES - 1 }, (_, k) => k + 1).sort((p, q) => Math.min(p, UNTANGLE_ANGLES - p) - Math.min(q, UNTANGLE_ANGLES - q));
  return steps.map((k) => {
    const turned = angle + (2 * Math.PI * k) / UNTANGLE_ANGLES;
    return { x: middle.x + radius * Math.cos(turned), y: middle.y + radius * Math.sin(turned) };
  });
}

/**
 * How many links cross display i's links, taking each link as a straight line between the middles of its displays: a
 * quick guide to whether a position for i is worth a simulation run.
 */
function straightCrossings(network: Network, positions: Point[], i: number): number {
  let count = 0;
  for (const own of network.links) {
    if (own.a !== i && own.b !== i) continue;
    for (const other of network.links) {
      if (other.a === own.a || other.a === own.b || other.b === own.a || other.b === own.b) continue;
      if (segmentsCross(positions[own.a], positions[own.b], positions[other.a], positions[other.b])) count += 1;
    }
  }
  return count;
}

/**
 * Whether trial a came at least as close to the goals as trial b: meeting them is closest, then being routed and
 * spaced, then missing the link distances by less.
 */
function asClose(a: Trial, b: Trial): boolean {
  const rank = (t: Trial) => (t.met ? 0 : t.routedAndSpaced ? 1 : 2);
  return rank(a) < rank(b) || (rank(a) === rank(b) && a.miss <= b.miss);
}

/** Cuts down the number of links that cross each other, keeping only moves that come at least as close to the goals. */
function untangle(network: Network, trial: Trial): Trial {
  const linkCount = network.nodes.map((_, i) => network.links.filter(({ a, b }) => a === i || b === i).length);
  let best = trial;
  let { count, crossed } = countCrossings(best.paths ?? routes(network, best.positions));
  let runs = Math.min(UNTANGLE_RUNS, Math.floor(UNTANGLE_PATHS / Math.max(network.links.length, 1)));
  search: while (count > 0) {
    // The displays at the ends of crossing links, those with the fewest links first: moving them disturbs the least.
    const movable = [...new Set([...crossed].flatMap((k) => [network.links[k].a, network.links[k].b]))].sort((i, j) => linkCount[i] - linkCount[j]);
    for (const i of movable) {
      const now = straightCrossings(network, best.positions, i);
      for (const at of around(network, best.positions, i)) {
        const start = best.positions.map((p) => ({ ...p }));
        start[i] = at;
        // Worth a run only if, as straight lines, i's links would cross no others, or fewer than they do now.
        const estimate = straightCrossings(network, start, i);
        if (estimate > 0 && estimate >= now) continue;
        if (runs === 0) break search;
        runs -= 1;
        const attempt = simulate(network, start, best.scale, UNTANGLE_ITERATIONS);
        if (!asClose(attempt, best)) continue;
        const result = countCrossings(attempt.paths ?? routes(network, attempt.positions));
        if (result.count < count) {
          best = attempt;
          ({ count, crossed } = result);
          continue search;
        }
      }
    }
    break;
  }
  return best;
}

/** The links' misalignment (see alignmentCost) summed over the links of display i, or over all links if `i` is not given. */
function misalignment(network: Network, positions: Point[], i?: number): number {
  let total = 0;
  for (const { a, b } of network.links) {
    if (i === undefined || a === i || b === i) total += alignmentCost(positions[b].x - positions[a].x, positions[b].y - positions[a].y);
  }
  return total;
}

/**
 * Other positions for display i that would line it up with a display it is linked to: for each such display, the
 * position on its horizontal, vertical and diagonal axes nearest i (keeping either how far i is along the axis or how far
 * it is from that display's centre, or putting it in the middle of the link's range of distances), and the middle of those
 * on each link's nearest axis; each also part of the way there.
 */
function alignedPositions(network: Network, positions: Point[], i: number, scale: number): Point[] {
  const here = positions[i];
  const targets: Point[] = [];
  const nearest: Point[] = [];
  for (const { link, a, b } of network.links) {
    if (a !== i && b !== i) continue;
    const j = a === i ? b : a;
    const other = positions[j];
    const [dx, dy] = [here.x - other.x, here.y - other.y];
    const [sx, sy] = [Math.sign(dx) || 1, Math.sign(dy) || 1];
    const [ax, ay] = [Math.abs(dx), Math.abs(dy)];
    const length = Math.hypot(dx, dy);
    const [lo, hi] = distanceRange(link.weight, scale);
    const along = (ux: number, uy: number, reach: number) => ({ x: other.x + ux * reach, y: other.y + uy * reach });
    // How far along (ux, uy) from the other display i is when the link's distance is the middle of its range.
    const middle = (ux: number, uy: number) => {
      let [near, far] = [0, 4 * (length + hi + network.nodes[i].width + network.nodes[i].height)];
      for (let step = 0; step < 30; step += 1) {
        const reach = (near + far) / 2;
        if (linkDistance(network.nodes[i], along(ux, uy, reach), network.nodes[j], other) < (lo + hi) / 2) near = reach;
        else far = reach;
      }
      return along(ux, uy, far);
    };
    const axes = [
      { cost: ay, projected: along(sx, 0, ax), rotated: along(sx, 0, length), centred: middle(sx, 0) },
      { cost: ax, projected: along(0, sy, ay), rotated: along(0, sy, length), centred: middle(0, sy) },
      { cost: Math.abs(ax - ay) / Math.SQRT2 + DIAGONAL_PENALTY, projected: along(sx, sy, (ax + ay) / 2), rotated: along(sx / Math.SQRT2, sy / Math.SQRT2, length), centred: middle(sx / Math.SQRT2, sy / Math.SQRT2) },
    ];
    for (const axis of axes) targets.push(axis.projected, axis.rotated, axis.centred);
    nearest.push(axes.reduce((best, axis) => (axis.cost < best.cost ? axis : best)).projected);
  }
  if (nearest.length > 1) targets.push(centroid(nearest));
  return targets.flatMap((target) => [1, 0.5, 0.25].map((t) => ({ x: here.x + (target.x - here.x) * t, y: here.y + (target.y - here.y) * t })));
}

/**
 * Lets the simulation run on from a layout that meets its goals with each link also pulling its displays towards lining up
 * (see advance), checking every ALIGN_CHECK iterations whether the positions are better aligned than the best so far and
 * still as close to the goals (see asClose) with no more crossing links; the best such positions are kept. This moves
 * several displays at once, which `align` (below) cannot.
 */
function settle(network: Network, trial: Trial): Trial {
  if (network.links.length === 0) return trial;
  let best = trial;
  let crossings = countCrossings(best.paths ?? routes(network, best.positions)).count;
  let cost = misalignment(network, best.positions);
  let runs = Math.max(1, Math.floor(ALIGN_PATHS / network.links.length));
  const positions = best.positions.map((p) => ({ ...p }));
  for (let iteration = 1; iteration <= ALIGN_ITERATIONS && cost > 0 && runs > 0; iteration += 1) {
    advance(network, positions, best.scale, ALIGN_STEP * best.scale, ALIGN_BIAS);
    if (iteration % ALIGN_CHECK !== 0) continue;
    const now = misalignment(network, positions);
    if (now >= cost - 1e-6) continue;
    const { spaced, miss } = check(network, positions, best.scale);
    if (!spaced || miss / best.scale > best.miss + 1e-9) continue;
    runs -= 1;
    const paths = routes(network, positions);
    const clear = paths.every((path) => path.clear);
    const attempt: Trial = { positions: positions.map((p) => ({ ...p })), scale: best.scale, met: miss === 0 && clear, routedAndSpaced: clear, miss: miss / best.scale, paths };
    if (!asClose(attempt, best)) continue;
    const result = countCrossings(paths).count;
    if (result > crossings) continue;
    best = attempt;
    crossings = result;
    cost = now;
  }
  return best;
}

/**
 * Biases the positions towards the ideal (see alignmentCost): nodes joined by a link line up on a horizontal or vertical
 * axis, with each centred across it, or failing that on a diagonal one. It moves one display at a time to the position
 * that lines it up best, and keeps the move only if the layout stays as close to its goals as it was (see asClose) and has
 * no more crossing links, so the goals always win and the bias gets the layout as close to the ideal as they allow.
 */
function align(network: Network, trial: Trial): Trial {
  if (network.links.length === 0) return trial;
  let best = trial;
  let crossings = countCrossings(best.paths ?? routes(network, best.positions)).count;
  let runs = Math.max(1, Math.floor(ALIGN_PATHS / network.links.length));
  for (let pass = 0; pass < ALIGN_PASSES; pass += 1) {
    let improved = false;
    for (let i = 0; i < network.nodes.length; i += 1) {
      const now = misalignment(network, best.positions, i);
      if (now === 0) continue;
      const moves = alignedPositions(network, best.positions, i, best.scale)
        .map((at) => ({ at, cost: misalignment(network, best.positions.map((p, k) => (k === i ? at : p)), i) }))
        .filter(({ cost }) => cost < now - 1e-6)
        .sort((p, q) => p.cost - q.cost);
      for (const { at } of moves) {
        const positions = best.positions.map((p, k) => (k === i ? at : { ...p }));
        const { spaced, miss } = check(network, positions, best.scale);
        if (!spaced || miss / best.scale > best.miss + 1e-9) continue;
        if (runs === 0) return best;
        runs -= 1;
        const paths = routes(network, positions);
        const clear = paths.every((path) => path.clear);
        const attempt: Trial = { positions, scale: best.scale, met: miss === 0 && clear, routedAndSpaced: clear, miss: miss / best.scale, paths };
        if (!asClose(attempt, best)) continue;
        const result = countCrossings(paths).count;
        if (result > crossings) continue;
        best = attempt;
        crossings = result;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return best;
}

/** `points` stretched (or shrunk) about their middle by `factor`. */
function stretch(points: Point[], factor: number): Point[] {
  const middle = centroid(points);
  return points.map((p) => ({ x: middle.x + (p.x - middle.x) * factor, y: middle.y + (p.y - middle.y) * factor }));
}

/** Runs the layout for the network, starting from `previous` positions where it has them. */
export function runLayout(nodes: LayoutNode[], links: LayoutLink[], previous: Map<string, Point>): Layout {
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const network: Network = {
    nodes,
    links: links.flatMap((link) => {
      const a = index.get(link.source);
      const b = index.get(link.target);
      return a === undefined || b === undefined || a === b ? [] : [{ link, a, b }];
    }),
  };

  // Starting positions: the previous ones, then a place for each display without one.
  const start: (Point | undefined)[] = nodes.map((node) => previous.get(node.id));
  const placed = nodes.flatMap((node, i) => (start[i] ? [{ node, at: start[i]! }] : []));
  nodes.forEach((node, i) => {
    if (start[i]) return;
    const linked = network.links.flatMap(({ a, b }) => (a === i && start[b] ? [start[b]!] : b === i && start[a] ? [start[a]!] : []));
    start[i] = place(node, centroid(linked.length ? linked : placed.map((p) => p.at)), placed);
    placed.push({ node, at: start[i]! });
  });

  // Grow the scale until the goals are met, then narrow down to the smallest scale that meets them (D13).
  const trials: Trial[] = [];
  let trial = simulate(network, start as Point[], 1);
  trials.push(trial);
  let failed: number | undefined;
  while (!trial.met && trial.scale * GROWTH <= MAX_SCALE) {
    failed = trial.scale;
    trial = simulate(network, stretch(trial.positions, GROWTH), trial.scale * GROWTH);
    trials.push(trial);
  }
  if (trial.met && failed !== undefined) {
    let [low, best] = [failed, trial];
    for (let step = 0; step < NARROWING_STEPS; step += 1) {
      const scale = (low + best.scale) / 2;
      const attempt = simulate(network, stretch(best.positions, scale / best.scale), scale);
      if (attempt.met) best = attempt;
      else low = scale;
    }
    trial = best;
  }
  if (!trial.met) {
    // No scale met every goal (for instance, two links between the same nodes with far-apart weights): keep the trial
    // that came closest, and of those that came about as close, the one with the smallest scale.
    const routedAndSpaced = trials.filter((t) => t.routedAndSpaced);
    const closest = Math.min(...routedAndSpaced.map((t) => t.miss));
    trial = routedAndSpaced.find((t) => t.miss <= closest * 1.05 + 1) ?? trial;
  }
  trial = untangle(network, trial);
  // The bias only has goals to keep when they were met.
  if (trial.met) trial = align(network, settle(network, trial));
  return {
    positions: new Map(nodes.map((node, i) => [node.id, trial.positions[i]])),
    scale: trial.scale,
    minSpace: MIN_SPACE * trial.scale,
    satisfied: trial.met,
  };
}
