import { useCallback, useEffect, useRef, useState } from 'react';
import { AddDialog } from './AddDialog';
import { Canvas } from './Canvas';
import folderOpenIcon from './icons/folder-open.svg';
import plusIcon from './icons/plus.svg';

/**
 * A toolbar (open workspace, plus) above the canvas, which shows the network. The workspace is the folder the user selects: the main
 * process reopens the last one at startup, and when none is open the folder dialog is shown until one is chosen.
 */
export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState(false);
  const forced = useRef(false);

  const openWorkspace = useCallback(async (): Promise<'opened' | 'cancelled' | 'failed'> => {
    setError(undefined);
    const result = await window.workspaceBridge.open();
    setWorkspace(result.workspace);
    if (result.status === 'failed') setError(result.message);
    return result.status;
  }, []);

  /** Runs a change to the network and shows the workspace it leaves (or the error). */
  const change = async (action: () => Promise<WorkspaceResult>) => {
    setError(undefined);
    const result = await action();
    setWorkspace(result.workspace);
    if (result.status === 'failed') setError(result.message);
  };

  const add = async (action: () => Promise<WorkspaceResult>) => {
    setAdding(false);
    await change(action);
  };

  useEffect(() => {
    void window.workspaceBridge.current().then(setWorkspace);
  }, []);

  // Hotkeys for the toolbar buttons: Ctrl+O opens a workspace, Ctrl+N adds. Like the buttons, they do nothing while a
  // dialog is open. (Electron's default menu, which Terrane keeps, uses neither.)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || document.querySelector('dialog[open]')) return;
      const key = event.key.toLowerCase();
      if (key === 'o') {
        event.preventDefault();
        void openWorkspace();
      } else if (key === 'n') {
        event.preventDefault();
        setAdding(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openWorkspace]);

  // With no workspace open, keep asking for a folder until one is opened. An error (shown below) ends the loop;
  // the folder button remains available.
  useEffect(() => {
    if (!workspace || workspace.open || forced.current) return;
    forced.current = true;
    void (async () => {
      while ((await openWorkspace()) === 'cancelled');
    })();
  }, [workspace, openWorkspace]);

  return (
    <div className="flex h-screen flex-col">
      <nav className="flex items-center gap-1 border-b border-slate-200 p-1" data-testid="toolbar">
        <ToolbarButton label="Open workspace" icon={folderOpenIcon} testId="open-workspace" onClick={() => void openWorkspace()} />
        <ToolbarButton label="Add" icon={plusIcon} testId="add" onClick={() => setAdding(true)} />
      </nav>
      {adding && (
        <AddDialog
          onSelectFile={() => void add(() => window.workspaceBridge.addFile())}
          onCreateText={(name, text) => void add(() => window.workspaceBridge.createText(name, text))}
          onCreateInformation={(text) => void add(() => window.workspaceBridge.createInformation(text))}
          onCancel={() => setAdding(false)}
        />
      )}
      {error && <p role="alert" data-testid="error" className="m-4 rounded bg-red-50 p-3 text-red-800">{error}</p>}
      {workspace?.open && (
        <Canvas
          nodes={workspace.nodes}
          links={workspace.links}
          onCreateLink={(source, target) => void change(() => window.workspaceBridge.createLink(source, target))}
          onSetWeight={(link, weight) => void change(() => window.workspaceBridge.setLinkWeight(link, weight))}
        />
      )}
    </div>
  );
}

function ToolbarButton({ label, icon, testId, onClick }: { label: string; icon: string; testId: string; onClick?: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} data-testid={testId} onClick={onClick} className="rounded p-1.5 hover:bg-slate-100">
      <img src={icon} alt="" className="h-5 w-5" />
    </button>
  );
}
