# Terrane Product Requirements Document

**Version**: 2.4.0
**Last updated:** 25/10/26 11:08 AEDT

## 1. Purpose
An application that allows users to create a network of files, information and ideas with a visual map of linked nodes.

## 2. Goals and Non-Goals
**Goals**
- Allow the user to create and edit a network that links a variety of documents.
- Create a visual layout of nodes and links that shows the topology of the network.
- Create tools that allow the user to interact with the network.

**Non-goals (v1)**
- Online version

## 3. Target Users
- Academics, students.
- Anyone creating documents that require synthesis.

## 4. Core Concepts
| Concept     | Definition                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------- |
| Node        | An graph vertex representing a file or information, made up of a node record, a node type, a display and, for a file node, a node file (see 7.1). |
| Information node | A node that is not a file: it stores a single string in the `items` array of its node record, and is of the text type (see 7.2). |
| Node type   | The functionality specific to a type of node: the file extensions it covers (or, for the text type, information nodes) and the display it uses (e.g. image, default, text). Implemented in the application as a handler. |
| Node record | The entry for a node in the `nodes` of `workspace.json` (see 7.4).                                  |
| Link        | A connection between nodes.                                                                         |
| Link record | The entry for a link in the `links` of `workspace.json` (see 8.5).                                  |
| Weight      | The strength of the connection between nodes that determines the length of the link: a value from 1 to 10 (see 8.2). |
| Workspace   | A folder containing all of the files that define a network.                                         |
| Node file   | A file in a workspace that is listed in the `nodes` of `workspace.json`, and so is represented by a node. Other files in the workspace folder are not node files. |
| Display     | A UI element that visually represents a node or link.                                               |
| Canvas      | The main area of the application screen that shows the displays (see 9.5).                          |
| Layout      | An algorithm that positions displays (see 9).                                                       |
| Network     | All of the nodes and links.                                                                         |
| Landscape   | An interpretation of the network that identifies clusters and holes.                                |

## 5. Platform and Stack
- Electron desktop application with a React renderer.
- Scaffolded from manifesto release 2.2.0; the framework is kept in the project's `vendor/` folder.
- The canvas and the link displays are built from scratch (HTML and SVG), without a third-party graph or canvas library.

## 6. Workspace
### 6.1 Selecting a workspace
- Any folder the user picks becomes a workspace. Anything already in the folder is left alone.
- If the folder has no `workspace.json`, one is written into it.

### 6.2 `workspace.json`
| Field           | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| `formatVersion` | The version of the `workspace.json` format (currently `1`).  |
| `workspaceId`   | A unique id for the workspace.                               |
| `appId`         | The application that created the workspace (`terrane`).      |
| `createdAt`     | When the workspace was created.                              |
| `createdBy`     | The application and version that created the workspace.      |
| `nodes`         | The node records (see 7.4).                                  |
| `links`         | The link records (see 8.5). Not yet built.                   |

- Display positions are not saved in `workspace.json`: the layout works them out again each time a workspace is opened (see 9.1).

### 6.3 Startup
- The last workspace opened is reopened when the application starts.
- If no workspace is open, the folder dialog is shown, and is shown again each time it is cancelled, until a workspace is opened.

### 6.4 Single instance
- Only one instance of the application can have a given workspace open at a time.
- A second instance that tries to open a workspace already in use shows no workspace.

## 7. Nodes
### 7.1 Parts of a node
| Part                                 | Belongs to                              | Description                                              |
| ------------------------------------ | --------------------------------------- | -------------------------------------------------------- |
| Node file                            | Each file node (not information nodes)  | The file in the workspace folder (see 7.2).              |
| Node record (including the filename) | Each node                               | The entry in the `nodes` of `workspace.json` (see 7.4).  |
| Node type                            | Each type of node                       | Implemented as a handler (see 7.5).                      |
| Display                              | Each type of node, drawn once per node  | Defined by the node type (see 7.5).                      |

### 7.2 Creating nodes
A node is created in one of two ways:
- **Create a text file:** the user enters a filename and text, and a new `.txt` file is written into the workspace (`.txt` is added to the filename if it is missing).
- **Select a file:** the user selects an existing file, which is copied into the workspace. The original file is left untouched; the node refers to the copy, not the original.

The user can also create nodes that are not files (not yet built):
- **Information node:** a node that stores a single string. It lives in the `nodes` of `workspace.json` and has no node file. The user creates one with the third option of the Add dialog (see 10.2).
  - The string can have multiple lines.
  - An empty string is not allowed.

### 7.3 Filenames
- Filenames that are empty, `.` or `..`, or that contain `< > : " / \ | ? *` or control characters are refused.
- If the filename is already taken in the workspace, the new file is named `name (1).ext`, `name (2).ext`, and so on.

### 7.4 Node record
Each node is recorded in the `nodes` of `workspace.json`:
| Field      | Description                                     |
| ---------- | ----------------------------------------------- |
| `id`       | A unique id for the node.                       |
| `filename` | The name of the node file in the workspace.     |
| `size`     | The size of the node file in bytes.             |
| `addedAt`  | When the node was added.                        |

An information node's record (not yet built) contains only:
| Field      | Description                                     |
| ---------- | ----------------------------------------------- |
| `id`       | A unique id for the node.                       |
| `addedAt`  | When the node was added.                        |
| `items`    | An array holding the string the node stores.    |

### 7.5 Node types
- A node's type is chosen by the node file's extension (case-insensitive). A file type without a node type of its own (including `.txt`) is the default type.

| Node type | File extensions         | Display                                                                                                          |
| --------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Image     | jpeg, jpg, png, svg     | A 100×125 portrait tile: the image in the top 80%, at its own aspect ratio and fully visible; the filename in the bottom 20%. |
| Default   | Any other file          | A 100×100 white square showing the filename.                                                                     |
| Text (not yet built) | Information nodes | Extends the default type. The same display as the default type, but showing the node's string instead of a filename. |

- The text type applies only to information nodes; `.txt` files remain of the default type.

## 8. Links
Not yet built.

### 8.1 Creating links
- Hovering over a node's display shows four small circles (connection points), one at the midpoint of each edge of the display.
- The user presses on a connection point and drags to another node's display; releasing the pointer anywhere over that display creates a link between the two nodes.
- The node the drag starts from is the link's **source**; the node it ends on is the link's **target**.
- Releasing the pointer over the source node's own display creates no link, and shows no message.
- Releasing the pointer over a node that is already linked to the source creates another link: two nodes can have more than one link between them.

### 8.2 Weights
- Every link has a weight from 1 to 10. A new link has a weight of 5.
- The higher a link's weight, the closer the layout (see 9) positions the two nodes it connects.
- Each weight value is represented by a range of link distances, not a fixed distance (see 9.3).
- **Editing a weight:** double-clicking a link's display opens a dialog with a slider (1–10) for the link's weight in its centre. A **Close** button sets the value and closes the dialog. The new weight is saved to the link record, and the layout runs again.

### 8.3 Appearance
- A link is displayed as a black line, 2 px thick, between the two nodes' displays. Black is the only colour.
- **Selecting a link:** clicking a link selects it. A selected link is shown with a soft blue glow around its line (`drop-shadow(0 0 2px #2563eb)`).
- A link can have arrowheads at its endpoints. A new link has no arrowheads.
- When a link is selected, the user can choose one of four arrowhead options. These options are not shown anywhere yet, so for now every link has no arrowheads.

| Option             | Arrowheads                  |
| ------------------ | --------------------------- |
| No arrows (default)| None                        |
| Arrow at target    | At the target end           |
| Arrow at source    | At the source end           |
| Arrows at both ends| At both ends                |

- An arrowhead is a filled black triangle pointing into the node at that end.

### 8.4 Paths
A link's path is worked out from the positions of the displays, and is worked out again whenever a display moves. The rules, in priority order:
1. **A link never crosses a display.** It touches only the displays of its own two nodes, at its two ends, and keeps a clearance of 12 px from every other display.
2. **A link between aligned displays is a straight line**, as long as that line is clear under rule 1. Two displays are aligned when their centres line up horizontally or vertically. If another display sits between two aligned displays, rule 1 wins and the link curves around it.
3. **Otherwise the link is a smooth curve** that goes around any displays in its way.

- A link leaves and enters a display at the midpoint of one of its edges, at right angles to that edge.
- Links may cross other links between node displays; they only avoid node displays. Crossing other links lets a link wind its way around any network.
- Together with the layout's scaling of link distances (see 9.3), this means a clear path always exists, so a link never needs to cross a node display.
- Paths around displays are found with an established (off-the-shelf) routing algorithm where one is available; otherwise with one written from scratch.

### 8.5 Link record
Each link is recorded as an object in the `links` of `workspace.json`, a sibling of `nodes`:
| Field    | Description                                     |
| -------- | ----------------------------------------------- |
| `id`     | A unique id for the link, like a node's `id`.   |
| `source` | The `id` of the link's source node.             |
| `target` | The `id` of the link's target node.             |
| `weight` | The link's weight (1–10).                       |

## 9. Layout
Not yet built.

### 9.1 When the layout runs
- The layout runs whenever the user makes a change to the network, and each time a workspace is opened (display positions are not saved).
- It ends when its goals (see 9.2) are satisfied.

### 9.2 Goals
1. Link displays are positioned so that no link ever crosses a node display.
2. Node displays are positioned so that nodes joined by a link with a higher weight are closer to each other.

### 9.3 Link distances
- A link distance is measured between the nearest edges of the two nodes' displays.
- Each weight value is represented by a range of link distances. The higher the weight, the shorter the distances in its range.
- The ranges are continuous from one weight value to the next: if the minimum distance for a weight of 3 is *x*, the maximum distance for a weight of 4 is *x* − 1 distance unit.
- A range's width is the span between its minimum and maximum distances. A range is never narrower than the range of the next higher weight value: for example, the range for a weight of 2 is never narrower than the range for a weight of 3.
- While the layout runs, it continually scales the link distances of every weight, on the principle that longer links make the goals easier to achieve. The range widths stretch or shrink with the scale.
- The layout always ends with the smallest distance scale needed to achieve its goals. It finds it by trial and error: it grows the scale until the goals are met, then narrows down to the smallest scale that still meets them.
- **Starting ranges:** each range is 30 px wide, and the range for a weight of 10 starts at 30 px. These are to be adjusted during development if necessary.

| Weight | Starting range (px) |
| ------ | ------------------- |
| 10     | 30–59               |
| 9      | 60–89               |
| 8      | 90–119              |
| 7      | 120–149             |
| 6      | 150–179             |
| 5      | 180–209             |
| 4      | 210–239             |
| 3      | 240–269             |
| 2      | 270–299             |
| 1      | 300–329             |

### 9.4 Space between node displays
- There is always a minimum amount of space between node displays.
- The minimum space is set dynamically by what the layout needs to meet its goals, and is never less than 16 px.

### 9.5 Coordinates and the canvas
- Distances are measured in **distance units**: units of the layout's own coordinate space.
- The layout's coordinate space is mapped onto the canvas. The scale of distance units to pixels is set dynamically by what the layout needs to meet its goals. Starting value: 1 distance unit = 1 px, to be refined during development.
- When the displays take up more room than the canvas shows, the canvas has scrollbars.

## 10. User Interface
### 10.1 Toolbar
Two icon-only buttons:
- **Open workspace** — shows the folder dialog.
- **Add** — opens the Add dialog.

Hotkeys (not yet built):
| Action         | Hotkey   |
| -------------- | -------- |
| Open workspace | Ctrl+O   |
| Add            | Ctrl+N   |

### 10.2 Add dialog
1. The user chooses **Create a text file** or **Select a file** (or cancels).
2. **Create a text file** asks for a filename and text; **Create** is available once a filename has been entered.
3. **Select a file** shows the file dialog.
4. A third option (not yet built) creates an information node: the user enters the node's string, which can have multiple lines and cannot be empty.

### 10.3 Errors
Errors are shown in an alert banner.

## 11. Functional Requirements
| ID  | Requirement                               | Priority |
| --- | ----------------------------------------- | -------- |
| F1  | User creates nodes and links              | Must     |
| F2  | Nodes represent a variety of common files | Must     |
| F3  | Links are weighted                        | Must     |
| F4  | Users edit weights                        | Must     |
| F5  | Layout positions displays                 | Must     |

## 12. Non-Functional Requirements
- **Performance:** The layout stops running once its goals are satisfied (see 9.1).
- **Accessibility:** Actions are linked to keyboard (hotkeys) and mouse.
- **Responsiveness:** Usable on screens from 640 px wide.
- **Security and privacy:** The application makes no network requests; a Content Security Policy blocks all remote origins; links to external sites do nothing; the renderer is sandboxed.

## 13. User Flow
1. Player opens the application and either sees the most recent workspace or is shown the folder dialog until a workspace is opened (see 6.3).
2. Users add and edit nodes and links.
3. The layout runs with every change the user makes to the network.

## 14. Success Metrics
- Users report successful attempts to create networks.
- Users report success in perceiving landscapes.

## 15. Assumptions and Constraints
- Desktop only version for now.
- All data is stored locally.
- The application can be obtained in two ways:
  - **From source:** the GitHub repo (`adaptivebehaviour/terrane`), run with `install.cmd` and then `terrane.cmd`.
  - **Installer:** a Windows-only NSIS installer — per-user (no administrator rights), unsigned, with no auto-update. Uninstalling keeps the user's workspaces.

## 16. Decisions
| ID  | Decision                                                                 |
| --- | ------------------------------------------------------------------------ |
| D5  | v1 builds are unsigned and for internal use, with no auto-update feed.   |

## 17. Risks and Open Questions
- Which node types are needed? Currently: image (jpeg, jpg, png, svg) and default (any other file) (see 7.5).
- Should a workspace created by another application (a different `appId`) be refused? This is not currently checked.
- What should happen when `formatVersion` changes?
- Which way should users obtain the application: from source (the GitHub repo) or the installer?
