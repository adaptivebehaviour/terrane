import { useCallback, useEffect, useRef, useState } from 'react';
import { AddDialog } from './AddDialog';
import { handlerFor } from './handlers';
import folderOpenIcon from './icons/folder-open.svg';
import plusIcon from './icons/plus.svg';

/**
 * A toolbar (open workspace, plus) above the content area. The workspace is the folder the user selects: the main
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

  const add = async (action: () => Promise<WorkspaceResult>) => {
    setAdding(false);
    setError(undefined);
    const result = await action();
    setWorkspace(result.workspace);
    if (result.status === 'failed') setError(result.message);
  };

  useEffect(() => {
    void window.workspaceBridge.current().then(setWorkspace);
  }, []);

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
    <>
      <nav className="flex items-center gap-1 border-b border-slate-200 p-1" data-testid="toolbar">
        <ToolbarButton label="Open workspace" icon={folderOpenIcon} testId="open-workspace" onClick={() => void openWorkspace()} />
        <ToolbarButton label="Add" icon={plusIcon} testId="add" onClick={() => setAdding(true)} />
      </nav>
      {adding && (
        <AddDialog
          onSelectFile={() => void add(() => window.workspaceBridge.addFile())}
          onCreateText={(name, text) => void add(() => window.workspaceBridge.createText(name, text))}
          onCancel={() => setAdding(false)}
        />
      )}
      {error && <p role="alert" data-testid="error" className="m-4 rounded bg-red-50 p-3 text-red-800">{error}</p>}
      {workspace?.open && (
        <main className="flex flex-wrap content-start gap-4 p-4" data-testid="workspace">
          {workspace.nodes.map((node) => {
            const { Component } = handlerFor(node.filename);
            return <Component key={node.id} node={node} />;
          })}
        </main>
      )}
    </>
  );
}

function ToolbarButton({ label, icon, testId, onClick }: { label: string; icon: string; testId: string; onClick?: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} data-testid={testId} onClick={onClick} className="rounded p-1.5 hover:bg-slate-100">
      <img src={icon} alt="" className="h-5 w-5" />
    </button>
  );
}
