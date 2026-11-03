import { useCallback, useEffect, useState } from 'react';
import { ab } from './ab';
import { AddDialog } from './AddDialog';
import { AddMenu } from './AddMenu';
import { Canvas } from './Canvas';
import { isInformationNode } from './handlers';
import { NewWorkspaceDialog } from './NewWorkspaceDialog';
import { CreateNoteDialog, UpdateNoteDialog } from './NoteDialogs';
import { Toolbar } from './Toolbar';

/**
 * A toolbar (new workspace, open workspace, plus) above the canvas, which shows the network. Workspaces are created and opened
 * the framework's way (`ab.workspace`); the main process reopens the last one at startup.
 */
export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [error, setError] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  /** The dialog being shown: a new `.txt` file, a new note (linked to a node, if `linkTo` is given), or an existing note's update. */
  const [dialog, setDialog] = useState<{ kind: 'text' } | { kind: 'note'; linkTo?: string } | { kind: 'update'; nodeId: string; text: string }>();
  /** The location the "new workspace" dialog starts with; `null` while the dialog is closed. */
  const [newWorkspaceLocation, setNewWorkspaceLocation] = useState<string | null>(null);

  const showWorkspace = useCallback(() => window.workspaceBridge.current().then(setWorkspace), []);

  const newWorkspace = async () => {
    setError(undefined);
    setNewWorkspaceLocation((await ab.workspace.beginNew()).location);
  };

  const openWorkspace = useCallback(async () => {
    setError(undefined);
    try {
      await ab.workspace.open();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    await showWorkspace();
  }, [showWorkspace]);

  /** Runs a change to the network and shows the workspace it leaves (or the error). */
  const change = async (action: () => Promise<WorkspaceResult>) => {
    setError(undefined);
    const result = await action();
    setWorkspace(result.workspace);
    if (result.status === 'failed') setError(result.message);
  };

  const add = async (action: () => Promise<WorkspaceResult>) => {
    setMenu(undefined);
    setDialog(undefined);
    await change(action);
  };

  const closeMenu = useCallback(() => setMenu(undefined), []);

  /** Opens the add popup with its top left corner just under the Add button. */
  const openMenuAtButton = useCallback(() => {
    const box = document.querySelector('[data-testid=add]')?.getBoundingClientRect();
    setMenu({ x: box?.left ?? 0, y: box?.bottom ?? 0 });
  }, []);

  useEffect(() => {
    void showWorkspace();
  }, [showWorkspace]);

  // Hotkeys for the toolbar buttons: Ctrl+O opens a workspace, Ctrl+N adds. Like the buttons, they do nothing while a
  // dialog is open. (Electron's default menu, which Terrane keeps, uses neither.)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || document.querySelector('dialog[open], [role=dialog]')) return;
      const key = event.key.toLowerCase();
      if (key === 'o') {
        event.preventDefault();
        void openWorkspace();
      } else if (key === 'n') {
        event.preventDefault();
        openMenuAtButton();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openWorkspace, openMenuAtButton]);

  return (
    <div className="flex h-screen flex-col">
      <Toolbar onNewWorkspace={() => void newWorkspace()} onOpenWorkspace={() => void openWorkspace()} onAdd={openMenuAtButton} />
      {menu && (
        <AddMenu
          x={menu.x}
          y={menu.y}
          onCreateText={() => {
            setMenu(undefined);
            setDialog({ kind: 'text' });
          }}
          onCreateInformation={() => {
            setMenu(undefined);
            setDialog({ kind: 'note' });
          }}
          onImport={() => void add(() => window.workspaceBridge.addFile())}
          onClose={closeMenu}
        />
      )}
      {dialog?.kind === 'text' && <AddDialog onCreateText={(name, text) => void add(() => window.workspaceBridge.createText(name, text))} onCancel={() => setDialog(undefined)} />}
      {dialog?.kind === 'note' && (
        <CreateNoteDialog
          onCreate={(text) => void add(() => (dialog.linkTo ? window.workspaceBridge.createInformationLinked(text, dialog.linkTo) : window.workspaceBridge.createInformation(text)))}
          onCancel={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === 'update' && (
        <UpdateNoteDialog text={dialog.text} onUpdate={(text) => void add(() => window.workspaceBridge.updateInformation(dialog.nodeId, text))} onCancel={() => setDialog(undefined)} />
      )}
      {newWorkspaceLocation !== null && (
        <NewWorkspaceDialog
          initialLocation={newWorkspaceLocation}
          onChooseLocation={async () => (await ab.workspace.chooseLocation())?.location ?? null}
          onCreate={async (name) => {
            await ab.workspace.create({ name });
            setNewWorkspaceLocation(null);
            await showWorkspace();
          }}
          onCancel={() => setNewWorkspaceLocation(null)}
        />
      )}
      {error && <p role="alert" data-testid="error" className="m-4 rounded bg-red-50 p-3 text-red-800">{error}</p>}
      {workspace?.open && (
        <Canvas
          nodes={workspace.nodes}
          links={workspace.links}
          onCreateLink={(source, target) => void change(() => window.workspaceBridge.createLink(source, target))}
          onSetWeight={(link, weight) => void change(() => window.workspaceBridge.setLinkWeight(link, weight))}
          onEmptyContextMenu={(x, y) => setMenu({ x, y })}
          onNodeContextMenu={(nodeId) => {
            setMenu(undefined);
            setDialog({ kind: 'note', linkTo: nodeId });
          }}
          onOpenNode={(node) => (isInformationNode(node) ? setDialog({ kind: 'update', nodeId: node.id, text: node.items[0] }) : void change(() => window.workspaceBridge.openNode(node.id)))}
        />
      )}
    </div>
  );
}
