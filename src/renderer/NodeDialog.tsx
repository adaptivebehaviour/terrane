import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { isFileNode } from './handlers';

const FIELDS: { field: DisplayField; label: string; rows: number }[] = [
  { field: 'title', label: 'Title', rows: 1 },
  { field: 'description', label: 'Description', rows: 2 },
  { field: 'body', label: 'Body', rows: 10 },
];

/** Whether `path` is absolute (Windows or POSIX); a file copied into the workspace has a path relative to it. */
const isAbsolutePath = (path: string) => /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(path);

/** The last part of a path. */
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

interface NodeDialogProps {
  /** The node being edited ("Save"); absent for a new node ("Create"). */
  node?: NodeRecord;
  onSubmit: (input: NodeInput) => void;
  onCancel: () => void;
}

/**
 * What the Add button (and Ctrl+N) opens to create a node, and double-clicking a node opens to edit it: a title, a
 * description and a body, each with a checkbox for whether it is shown in the node's display (a checkbox is disabled while
 * its field is empty, and fields left empty are stored as `null`), and a "File" button with a checkbox for copying the file
 * into the workspace. "Create" (or "Save") is disabled until at least one ticked field has text.
 *
 * Editing a node whose file was copied into the workspace: the copy checkbox stays ticked and disabled until another file
 * is chosen, and then saving asks whether to keep the old copy in the workspace.
 */
export function NodeDialog({ node, onSubmit, onCancel }: NodeDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const editing = node !== undefined;
  const fileNode = node && isFileNode(node) ? node : undefined;
  const copiedIn = fileNode !== undefined && !isAbsolutePath(fileNode.path);
  const [text, setText] = useState<Record<DisplayField, string>>({ title: node?.title ?? '', description: node?.description ?? '', body: node?.body ?? '' });
  const [ticked, setTicked] = useState<Record<DisplayField, boolean>>(
    node ? { title: node.display.includes('title'), description: node.display.includes('description'), body: node.display.includes('body') } : { title: true, description: false, body: false },
  );
  /** The node's file: its path, and whether it was just chosen (rather than being the edited node's current file). */
  const [file, setFile] = useState<{ path: string; picked: boolean } | undefined>(fileNode && { path: fileNode.path, picked: false });
  const [copy, setCopy] = useState(copiedIn);
  const [askKeep, setAskKeep] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const display = FIELDS.map(({ field }) => field).filter((field) => ticked[field] && text[field] !== '');
  const copyLocked = copiedIn && !file?.picked;

  const chooseFile = async () => {
    const path = await window.workspaceBridge.pickFile();
    if (!path) return;
    setFile({ path, picked: true });
    setText((current) => (current.title === '' ? { ...current, title: baseName(path) } : current));
  };

  const submit = (keepOldCopy?: boolean) =>
    onSubmit({ ...text, display, file: file && { source: file.picked ? file.path : undefined, copy }, ...(keepOldCopy === undefined ? {} : { keepOldCopy }) });

  /** Only the dialog's own close event (not one from a dialog inside it) cancels. */
  const onClose = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onCancel();
  };

  return (
    <>
      <dialog ref={dialog} onClose={onClose} data-testid="node-dialog" className="m-auto w-96 rounded p-4 shadow-lg backdrop:bg-black/30">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (display.length === 0) return;
            if (copiedIn && file?.picked) setAskKeep(true);
            else submit();
          }}
        >
          {FIELDS.map(({ field, label, rows }) => (
            <div key={field} className="flex flex-col gap-1 text-sm">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`Show ${label.toLowerCase()}`}
                  data-testid={`show-${field}`}
                  checked={ticked[field]}
                  disabled={text[field] === ''}
                  onChange={(event) => setTicked((current) => ({ ...current, [field]: event.target.checked }))}
                />
                <label htmlFor={`node-${field}`}>{label}</label>
              </div>
              <textarea
                id={`node-${field}`}
                data-testid={`node-${field}`}
                autoFocus={field === 'title'}
                rows={rows}
                value={text[field]}
                onChange={(event) => setText((current) => ({ ...current, [field]: event.target.value }))}
                className="resize-none rounded border border-slate-300 px-2 py-1"
              />
            </div>
          ))}
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-3">
              <button type="button" data-testid="node-file" className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100" onClick={() => void chooseFile()}>
                File
              </button>
              <label className="flex items-center gap-2">
                <input type="checkbox" data-testid="node-copy" checked={copy} disabled={copyLocked} onChange={(event) => setCopy(event.target.checked)} />
                Copy into workspace
              </label>
            </div>
            {file && (
              <span data-testid="node-path" className="break-all text-slate-600">
                {file.path}
              </span>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded px-3 py-1.5 text-slate-600 hover:bg-slate-100" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" data-testid="node-submit" disabled={display.length === 0} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-40">
              {editing ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </dialog>
      {askKeep && (
        <KeepCopyDialog
          onAnswer={(keep) => {
            setAskKeep(false);
            submit(keep);
          }}
          onCancel={() => setAskKeep(false)}
        />
      )}
    </>
  );
}

/** Asked on saving when another file replaces one copied into the workspace: keep the old copy in the workspace folder, or remove it. */
function KeepCopyDialog({ onAnswer, onCancel }: { onAnswer: (keep: boolean) => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} onClose={onCancel} data-testid="keep-copy-dialog" className="m-auto w-80 rounded p-4 shadow-lg backdrop:bg-black/30">
      <p className="text-sm">Keep the copy of the previous file in the workspace?</p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" data-testid="delete-copy" className="rounded px-3 py-1.5 text-slate-600 hover:bg-slate-100" onClick={() => onAnswer(false)}>
          Remove
        </button>
        <button type="button" data-testid="keep-copy" className="rounded bg-slate-900 px-3 py-1.5 text-white" onClick={() => onAnswer(true)}>
          Keep
        </button>
      </div>
    </dialog>
  );
}
