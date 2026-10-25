# Terrane Implementation Plan (PRD v2.4.0)

## Scope
This plan continues the development of the existing `terrane` project (`projects/terrane/`). It does not create a new project, scaffold anything, or re-implement features that already exist: every phase is built into the current codebase, changing existing files where needed and adding new files alongside them.

It covers the parts of the PRD (`terrane-prd-v2.4.0.md`) marked "not yet built". Everything else in the PRD already exists in the application.

**Kept as they are.** These existing features are not changed by this plan, except where a phase says so:
- the workspace: selecting and opening a folder, `workspace.json`, reopening the last workspace at startup, and the single-instance lock (`src/main/workspace.ts`, `src/main/lock.ts`);
- file nodes: creating a text file, selecting a file, filename rules and file node records;
- the image and default node types (`src/renderer/handlers/image.tsx`, `src/renderer/handlers/default.tsx`);
- the toolbar and its two buttons, the Add dialog's existing two options, and the error banner;
- the security and privacy setup, packaging (`electron-builder.yml`) and the existing end-to-end tests (except where phase 3's canvas changes what they check; see section 8).

**Changed.** The phases change these existing features:
- `workspace.json` gains information node records (phase 1) and a `links` array (phase 4); the existing node records are unchanged;
- the Add dialog gains a third option (phase 1);
- the wrapping grid that shows node displays is replaced by the canvas (phase 3).

Each phase lists the PRD sections it implements and the files it changes, marked **(existing)** or **(new)**. Section 7 records the decisions taken on points the PRD does not settle.

The framework in `vendor/` is not changed by any phase (see the project `CLAUDE.md`).

## 1. Phase 1 — Information nodes and the text type
**PRD:** 4 (Information node, Node type), 7.2, 7.4, 7.5, 10.2 step 4.

**Main process**
- `src/main/workspace.ts` **(existing)**
  - Add the information node record — `id`, `addedAt`, and the string in an `items` array (D1) — alongside the existing file node record (`WorkspaceNode`), so that `nodes` can hold both.
  - Add a method that creates an information node: it writes a new record into the `nodes` of `workspace.json` (through the existing `writeNodes`), and creates no file. An empty string is refused (D2).
  - `readNode` refuses information nodes, since they have no node file.
- `src/main/index.ts` **(existing)** — register an IPC channel for creating an information node, with the same trusted-sender check and input checks as `terrane:workspace.createText`.

**Preload and types**
- `src/preload/index.ts` **(existing)** — expose the new channel on `workspaceBridge`.
- `src/renderer/env.d.ts` **(existing)** — add the information node record type and the new `workspaceBridge` function.

**Renderer**
- `src/renderer/AddDialog.tsx` **(existing)** — add the third option to the choice step, and a step where the user enters the node's string in a multi-line field (D2). The create button is available only once the string is not empty (D2).
- `src/renderer/App.tsx` **(existing)** — pass the new option's result through the existing `add()` function.
- `src/renderer/handlers/text.tsx` **(new)** — the text handler (`id: 'text'`), extending the default handler: the same display as `default.tsx`, showing the node's string instead of a filename.
- `src/renderer/handlers/index.ts` **(existing)** — information nodes are given the text handler; file nodes are still chosen by extension, so `.txt` files stay with the default handler.

## 2. Phase 2 — Hotkeys
**PRD:** 10.1.

- `src/renderer/App.tsx` **(existing)** — Ctrl+O runs the same action as the Open workspace button; Ctrl+N runs the same action as the Add button.
- Terrane sets no application menu, so Electron's default menu applies; neither Ctrl+O nor Ctrl+N is used by it.

## 3. Phase 3 — Canvas and layout of node displays
**PRD:** 4 (Canvas, Layout), 9.1, 9.4, 9.5, 12 (Performance).

The current workspace view (`<main>` in `App.tsx`) places displays in a wrapping grid. This phase replaces it with a canvas, built from scratch in HTML and SVG (D5), on which the layout positions each display.

- `src/renderer/App.tsx` **(existing)** — replace the grid with the canvas.
- A canvas component **(new)**, in `src/renderer/`:
  - holds the layout's coordinate space and maps it onto the canvas, starting at 1 distance unit = 1 px (9.5);
  - positions each node's display at the position the layout gives it;
  - shows scrollbars when the displays take up more room than the canvas shows (9.5).
- A layout module **(new)**, in `src/renderer/`:
  - a layout algorithm written for Terrane's goals, starting from the Fruchterman-Reingold algorithm (D4);
  - runs whenever the network changes, and stops once its goals are satisfied (9.1, 12);
  - keeps at least the minimum space between node displays, never less than 16 px (9.4);
  - positions are not saved: the layout works them out again each time a workspace is opened (D3).

  With no links yet, the only goal that applies in this phase is the minimum space; the link goals are added in phases 4–6.

## 4. Phase 4 — Creating links
**PRD:** 8.1, 8.2 (default weight).

- `src/main/workspace.ts` **(existing)** — store links in a `links` array in `workspace.json`, a sibling of `nodes` (D7). Each link is an object with:
  - `id`, like the nodes;
  - `source` and `target`: the `id`s of its source and target nodes;
  - `weight` (5 for a new link).
- `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/env.d.ts` **(existing)** — a channel for creating a link, and links included in the workspace state sent to the renderer.
- The canvas **(new in phase 3)**:
  - hovering over a node's display shows the four connection points, at the midpoints of its edges (8.1);
  - pressing on a connection point and dragging to another node's display, then releasing over it, creates a link from the source (where the drag started) to the target (where it ended) (8.1);
  - releasing over the source node's own display creates no link, and shows no message (D6);
  - releasing over a node that is already linked to the source creates another link (D6).

## 5. Phase 5 — Link displays and paths
**PRD:** 8.3, 8.4, 9.2 goal 1.

- A link display component **(new)**, in `src/renderer/`: a black line, 2 px thick (8.3, D9).
- A path module **(new)**, in `src/renderer/`, that works out each link's path from the display positions, and again whenever a display moves (8.4):
  1. the path never crosses a display other than its own two, and keeps a clearance of 12 px from every other display (D9);
  2. it is a straight line between aligned displays (centres lined up horizontally or vertically) when that line is clear;
  3. otherwise it is a smooth curve around the displays in its way;
  - it leaves and enters a display at the midpoint of one of its edges, at right angles to that edge;
  - it may cross other links.

  Paths around displays are found with an established routing algorithm where one fits, written into Terrane; otherwise with one written from scratch (D10).
- Clicking a link selects it (D8). A selected link is shown with a soft blue glow around its line (`drop-shadow(0 0 2px #2563eb)`) (D15).
- Arrowheads: the arrowhead options are not shown anywhere yet (D8), so every link is displayed with no arrowheads, its default (8.3). The options, and storing them on links, are left for a later plan.
- The layout module **(new in phase 3)**: goal 1 (no link crosses a node display) is added to the layout's goals.

## 6. Phase 6 — Weights and link distances
**PRD:** 8.2, 9.2 goal 2, 9.3, 11 (F3, F4).

- The layout module **(new in phase 3)**:
  - each weight value (1–10) is represented by a range of link distances; higher weights have shorter distances (9.3);
  - the ranges are continuous: if the minimum distance for weight *w* is *x*, the maximum for weight *w* + 1 is *x* − 1 distance unit (9.3);
  - a range is never narrower than the range of the next higher weight (9.3);
  - a link distance is measured between the nearest edges of the two nodes' displays (D14);
  - starting ranges: each range is 30 px wide, and the range for weight 10 starts at 30 px — weight 10 is 30–59 px, weight 9 is 60–89 px, and so on up to weight 1 at 300–329 px — to be adjusted during development (D12);
  - while it runs, the layout continually scales the link distances of every weight, and the range widths stretch or shrink with the scale (9.3);
  - it ends with the smallest distance scale needed to meet its goals (9.3), found by growing the scale until the goals are met, then narrowing down to the smallest scale that still meets them (D13);
  - goal 2 (nodes joined by higher-weight links are closer) is added to the layout's goals (9.2).
- Editing a link's weight (F4): double-clicking a link's display opens a dialog with a slider for its weight (1–10) in its centre (D11, D16). A **Close** button sets the value and closes the dialog (D16). The new weight is saved to the link in `workspace.json`, and the layout runs again.

## 7. Decisions
### 7.1 Taken
| ID  | Phase | Point                                                         | Decision                                                                                                          |
| --- | ----- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| D1  | 1     | Field for an information node's string                        | The string is stored in an `items` array.                                                                         |
| D2  | 1     | Entering the string                                           | Multiple lines; an empty string is not allowed.                                                                   |
| D3  | 3     | Saving display positions                                      | Not saved: the layout works them out again each time a workspace is opened.                                      |
| D4  | 3     | Layout method                                                 | An algorithm written to achieve the layout goals, starting from the Fruchterman-Reingold algorithm.             |
| D5  | 3     | Canvas and link displays                                      | Built from scratch.                                                                                               |
| D6  | 4     | Drag released over the source's own display / an already-linked node | Own display: no link is created, silently. Already-linked node: another link is created.                  |
| D7  | 4     | Link format in `workspace.json`                               | Objects in a `links` array, a sibling of `nodes`, each with an `id`, the source and target node `id`s (`source`, `target`), and the `weight`. |
| D8  | 5     | Selecting a link; where the arrowhead options are shown       | A link is selected by clicking it. The arrowhead options are not shown anywhere yet.                              |
| D9  | 5     | Clearance and line thickness                                  | Clearance between a link and other displays: 12 px. Line thickness: 2 px.                                       |
| D10 | 5     | Routing method                                                | Based on an off-the-shelf algorithm if one is available; otherwise written from scratch.                          |
| D11 | 6     | Editing a weight                                              | Double-click the link; the weight is set with a slider.                                                           |
| D12 | 6     | Starting distance ranges                                      | Each range is 30 px wide, and the range for weight 10 starts at 30 px, adjusted during development if necessary. |
| D13 | 6     | Searching for the smallest distance scale                     | Trial and error: the layout grows the scale until its goals are met, then narrows down to the smallest scale that still meets them. |
| D14 | 5, 6  | Measuring a link distance                                     | Between the nearest edges of the two nodes' displays.                                                             |
| D15 | 5     | What a selected link looks like                               | A soft blue glow around its line: `drop-shadow(0 0 2px #2563eb)`.                                                 |
| D16 | 6     | Where the weight slider appears, and how it is closed         | In the centre of a dialog that opens when the user double-clicks the link display. A **Close** button sets the value and closes the dialog. |

### 7.2 Still open
None.

## 8. Verification
After each phase:
- `npm run typecheck`.
- `npm run build`, then `npm run test:e2e` (the existing end-to-end tests). Phase 3 replaces the grid, so any existing tests that depend on the grid's layout will need updating to match the canvas.
