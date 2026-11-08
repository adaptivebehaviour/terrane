import { useCallback, useEffect, useState } from 'react';
import { ab } from './ab';
import { Canvas } from './Canvas';
import { NewWorkspaceDialog } from './NewWorkspaceDialog';
import { NodeDialog } from './NodeDialog';
import { Toolbar } from './Toolbar';

/**
 * A toolbar (new workspace, open workspace, add) above the canvas, which shows the network. Workspaces are created and opened
 * the framework's way (`ab.workspace`); the main process reopens the last one at startup.
 */
export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [error, setError] = useState<string>();
  /** The node dialog being shown: for a new node, or for editing `node`. */
  const [dialog, setDialog] = useState<{ kind: 'create' } | { kind: 'edit'; node: NodeRecord }>();
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

  /** Closes the node dialog and runs the change it asked for. */
  const submit = async (action: () => Promise<WorkspaceResult>) => {
    setDialog(undefined);
    await change(action);
  };

  useEffect(() => {
    void showWorkspace();
  }, [showWorkspace]);

  // Hotkeys for the toolbar buttons: Ctrl+O opens a workspace, Ctrl+N opens the node dialog. Like the buttons, they do nothing while a
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
        setDialog({ kind: 'create' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openWorkspace]);

  return (
    <div className="flex h-screen flex-col">
      <Toolbar onNewWorkspace={() => void newWorkspace()} onOpenWorkspace={() => void openWorkspace()} onAdd={() => setDialog({ kind: 'create' })} />
      {dialog?.kind === 'create' && <NodeDialog onSubmit={(input) => void submit(() => window.workspaceBridge.createNode(input))} onCancel={() => setDialog(undefined)} />}
      {dialog?.kind === 'edit' && (
        <NodeDialog node={dialog.node} onSubmit={(input) => void submit(() => window.workspaceBridge.updateNode(dialog.node.id, input))} onCancel={() => setDialog(undefined)} />
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
          onOpenNode={(node) => setDialog({ kind: 'edit', node })}
        />
      )}
    </div>
  );
}
