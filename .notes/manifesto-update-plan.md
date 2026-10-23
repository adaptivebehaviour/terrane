# terrane: update to manifesto 2.2.0

Current: `@adaptivebehaviour/desktop` 2.1.0 (`vendor/adaptivebehaviour-desktop-2.1.0.tgz`, `scaffolded-from.json` release 2.1.0).
Target: manifesto v2.2.0. 2.2.0 removes the framework workspace functionality that 2.1.0 added to the desktop packages.

## What breaks

| terrane file | Removed in 2.2.0 |
|---|---|
| `src/main/index.ts` | `WorkspaceManager`, `SettingsStore` (from `desktop/src/main/index`); `createHandlers` no longer takes `workspaces` |
| `src/main/workspace.ts` | `acquireLock`, `FORMAT_VERSION`, `WorkspaceLock` (from `desktop/src/workspace/index`; the whole `src/workspace/` folder is gone) |

Unchanged and still fine: `net`, `ipc`, `sidecar`, the `desktop` collection (`backend-status`). Not used by terrane: the removed chooser/fetch components.

## Steps

U0. Preconditions: `git status --short` clean in terrane; keep `.notes/` (never `git clean` / `git stash -u`).
1. Make terrane's `Workspace` self-contained (do this before the upgrade, against 2.1.0, so the e2e suite proves nothing changed):
   - Add a small lock helper to terrane, based on `v2.1.0:js/workshop/desktop/src/workspace/lock.ts` (manifesto repo).
   - Define `FORMAT_VERSION` locally, with the same value. The folder format on disk must stay identical so existing workspaces still open.
   - Update `src/main/workspace.ts` imports.
2. In `src/main/index.ts`: remove the `WorkspaceManager` / `SettingsStore` construction and the `workspaces` argument to `createHandlers`. Move its `onOpened`/`onClosed` sidecar start/stop (start unless read-only) into terrane's own `Workspace` options, and check the sidecar still starts when the folder opens and stops on close.
3. Run terrane's tests (`app.e2e.ts`, `packaged.e2e.ts`); they should pass unchanged.
4. Tag the rollback point `pre-manifesto-2.2.0`, then run `update-project` (Package upgrade mode): replace the vendored 2.1.0 files with the 2.2.0 ones from `projects/manifesto/dist/`, check the sha256 values against `RELEASE.json`, update `package.json`, the lockfile and `scaffolded-from.json` (release 2.2.0).
5. Re-run typecheck and the e2e tests; confirm a pre-existing workspace still opens.

## Open items
- Confirm the sidecar-start behaviour in step 2 matches what terrane did before.
- 2.2.0 must be pushed to GitHub and CI green before terrane takes it.
