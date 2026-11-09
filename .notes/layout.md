# Terrane: rules and guidelines for the layout of the network on the canvas

Source: the application code only, mainly `src/renderer/layout.ts` (node positions), `src/renderer/paths.ts` (link paths) and `src/renderer/Canvas.tsx` (the canvas), with `App.tsx`, `handlers/default.tsx`, `handlers/image.tsx`, `LinkDisplay.tsx` and `src/main/workspace.ts` where they affect the layout.

**Rule** = something the code always enforces, or a goal it works until it meets. **Guideline** = a preference the code pursues only while the rules above it still hold.

## 1. Priority order

Where two items conflict, the one higher in this list wins. The order comes from how the code compares candidate layouts (`asClose`) and from the order of its steps in `runLayout`.

| Priority | Item | Kind | Detail in |
| --- | --- | --- | --- |
| 1 | Minimum space between node displays: at least 16 × scale | Rule | 2.1 |
| 2 | Goal 1: every link has a clear path (no link crosses a display, 12 px clearance) | Rule (goal) | 2.2, 3 |
| 3 | Goal 2: every link's distance is within the range for its weight | Rule (goal) | 2.3 |
| 4 | Use the smallest distance scale that meets goals 1 and 2 | Rule | 2.4 |
| 5 | Fewest possible links crossing each other | Guideline | 5.1 |
| 6 | Linked nodes line up on a horizontal or vertical axis (diagonal if they cannot) | Guideline | 5.2 |
| 7 | Simulation preferences: room between close displays, a weak pull to the middle, new displays placed near their neighbours | Guideline | 5.3 |

How the order shows up in the code:
- Spacing is enforced at the end of every simulation step (`separate`). A layout is only counted as having clear paths or in-range distances if its displays are spaced; paths are not even worked out for a layout that is not.
- Layouts are ranked: all goals met, then paths clear and displays spaced (but some distances out of range), then anything else. Layouts of the same rank are compared by how far the distances are out of range. So **goal 1 (clear paths) beats goal 2 (distances)** when both cannot be met.
- The scale is settled (priority 4) before crossings are reduced and before alignment, and both of those work at that scale, so neither can cause a larger scale.
- Crossing-reduction and alignment keep a move only if the layout is still at least as close to the goals as before (so a layout that met the goals still meets them).
- Alignment keeps a move only if it causes no more crossings than before, and runs only if the goals were met.

## 2. Rules

### 2.1 Space between node displays
- The space between two displays is the larger of their gaps along x and along y, and must be at least `16 × scale` (16 px at scale 1).
- Displays that are closer are moved apart along whichever axis needs the smaller move.

### 2.2 Goal 1: no link crosses a node display
- A link touches only the displays of its own two nodes, at its two ends, and keeps a clearance of 12 px from every other display. (The line is 2 px thick, so the middle of the line keeps 13 px.)
- A layout meets this goal only when every link has a clear path (see 3).
- Links may cross other links; see 5.1.

### 2.3 Goal 2: link distances follow weights
- A link's distance is measured between the nearest edges of its two displays; it is negative if they overlap.
- Higher weight, shorter distance. Each weight has a range of distances, and the goal is met only when every link's distance is within its range (no tolerance).
- For a weight *w* at scale *s*, the range starts at `(30 + 30 × (10 − w)) × s`, and ends 1 before the start of the range for weight *w* − 1. For weight 1 it ends at `start + 30 × s − 1`. So the ranges are continuous, one distance unit apart, and all 30 × *s* wide.

| Weight | Range at scale 1 (px) |
| --- | --- |
| 10 | 30–59 |
| 9 | 60–89 |
| 8 | 90–119 |
| 7 | 120–149 |
| 6 | 150–179 |
| 5 | 180–209 |
| 4 | 210–239 |
| 3 | 240–269 |
| 2 | 270–299 |
| 1 | 300–329 |

- A new link has weight 5. A weight is any number from 1 to 10 (the main process refuses others; the slider is continuous), and the ranges are worked out for any such value.
- Links from a node to itself, or to a node that is not on the canvas, are ignored by the layout.
- Two links between the same pair of nodes with far-apart weights cannot both be met. See 2.4 for what then happens.

### 2.4 Distance scale
- The ranges of every weight are scaled together. The scale starts at 1 and is never less than 1.
- If the goals are not met at scale 1, the scale is multiplied by 1.5 until they are met, but never goes above 8 (so the last scale tried is 7.59375).
- Once they are met at a larger scale, the layout narrows down between the last scale that failed and the first that worked (4 steps) and ends at the smallest scale found that meets the goals.
- If no scale meets the goals, the layout keeps, from the trials that had clear paths and spaced displays, the one that missed the distances by least (any within 5% of the least, plus 1, count as equal, and the smallest scale of those is used). If none had clear paths and spaced displays, it keeps the last trial. The result is then marked as not satisfied.

### 2.5 When the layout runs and stops
- The canvas runs the layout whenever its network changes: the nodes shown, the size of a display, or a link's id, source, target or weight. This includes when a workspace is opened.
- It waits until every display has been measured, and until a spinner has been painted. A spinner shows in the centre of the canvas while a layout is pending.
- A simulation run stops as soon as its goals are met (checked every 20 iterations), or after 400 iterations. The steps that follow (crossings, alignment) run on fixed budgets of simulation runs and iterations, shared out by the number of links.
- Positions are not stored. Each run starts from the positions of the previous run, and places any display without one (see 5.3).

## 3. Rules for the path of each link (`paths.ts`)

Paths are worked out from the display positions on the canvas, and again whenever they change. In priority order:

1. **A clear path.** A path never goes inside a display other than at its own two ends, and keeps at least 12 px (13 px from the middle of the line) from every other display.
2. **The ideal anchors, if a clear single curve joins them.** Each display has eight anchors: the midpoints of its edges and its corners. A path leaves and enters at an anchor, at right angles to the edge (diagonally at a corner). The ideal anchors are the ones facing each other along the axis (horizontal, vertical or diagonal) nearest the line between the display centres. Between displays that sit on that axis, facing anchors give a straight line.
3. **Any other clear single curve** (a cubic Bézier between two anchors), shortest first.
4. **A path routed around the displays,** if no single curve is clear: the shortest path among the displays (inflated by 16 px), found with a visibility graph and Dijkstra's algorithm, with its corners rounded (radius 32, 16, 8, 4 or 0, the largest that stays clear). Pairs of anchors are tried nearest first, and the shortest clear path wins.
5. **Spreading.** Where two or more paths meet a display at the same anchor, all but the shortest move to a neighbouring anchor if that anchor has no more paths than are left at this one and a clear path exists there. Each end of a path moves at most once, and a path that is not clear does not move.
6. **Fallback.** A link with no clear path is drawn as its shortest single curve and marked not clear. That leaves goal 1 unmet.

## 4. The canvas (`Canvas.tsx`, `App.tsx`)
- Only nodes that have at least one link are on the canvas; the others appear only in the node list.
- One distance unit is one pixel (`UNIT_PX = 1`). The layout uses the measured pixel size of each display, and runs again if a display changes size (for example, when its font loads).
- Display sizes: a default or text node is a golden-ratio rectangle, 162×100 or the smallest larger one that holds its text; an image node is 100×125 (portrait) when it shows its image, or 100×100 when it shows its body.
- The content takes in every display and every point on every link's path, with a 16 px margin. A curve that bows out beyond the displays adds to the content.
- The canvas has scrollbars when the content is larger than it. When the content is smaller, it is centred; when larger, the canvas scrolls to the centre of the network each time a layout settles.
- Eight connection points show on a display when the pointer is over it (edge midpoints and corners). For now they do nothing. A link is made by pressing anywhere else on a display and releasing over another node's display.

## 5. Guidelines

### 5.1 Few links crossing each other (priority 5)
- Done by `untangle`, at the scale already found. Two links cross when their paths intersect anywhere except within 8 px of an end they share.
- While links cross, it takes a display at the end of a crossing link (those with the fewest links first) and tries 11 other positions around the middle of the displays it is linked to, at the same distance from that middle as now, nearest its current position first. A position is tried only if, taking links as straight lines, it would not give that display's links as many crossings as now (or none).
- Each try runs the simulation (100 iterations) from there. The result is kept only if it is at least as close to the goals as before and has fewer crossings.
- The most simulation runs is 60, or fewer for a network with many links (no more than 600 paths worked out in all).

### 5.2 Alignment (priority 6)
- Done only if every goal was met. Two steps, `settle` and then `align`, make nodes joined by a link line up, centred, on a horizontal or vertical axis, or failing that a diagonal one.
- The cost for a link is how far the second centre is from the nearest axis through the first. A diagonal axis counts as 8 px worse, so a diagonal is used only when it is more than 8 px closer than a horizontal or vertical axis.
- `settle` runs the simulation (300 iterations, in steps of at most `3 × scale`) with each link also pulling its displays towards lining up by 10% of the misalignment. It checks every 10 iterations and keeps the positions if they are better aligned.
- `align` moves one display at a time (up to 20 passes) to the position that lines it up best with the displays it is linked to, trying positions on its horizontal, vertical and diagonal axes, and part-way there.
- Both keep a change only if the displays stay spaced, no link's distance is further out of range than before, the paths are at least as close to the goals (see `asClose`), and the number of crossings does not rise. Each is limited to 300 divided by the number of links in path calculations.

### 5.3 Simulation preferences (priority 7)
- The simulation is a force simulation that starts from the Fruchterman-Reingold algorithm. The most a display moves in one step cools from `40 × scale` to 1 over the run.
- A link pushes or pulls its two displays towards the middle half of its range, when the distance is within a quarter of the range's width of either end.
- Displays closer than `40 × scale` push each other away, to leave room for links to pass between them.
- A weak pull towards the middle of all displays keeps the network together.
- A display with no previous position is placed near the middle of the displays it is linked to (or the middle of all displays if none has a position), at the nearest spot that is at least 40 px clear of the displays already placed.
