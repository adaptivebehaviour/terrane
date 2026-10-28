import { useEffect, useRef, useState } from 'react';

interface NoteDialogProps {
  testId: string;
  /** The text the field starts with. */
  initial: string;
  /** The submit button's text and test id suffix: "Create" or "Update". */
  action: 'Create' | 'Update';
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

/** A note's text in a field, with Cancel and a submit button (disabled while the field is empty). The two dialogs below differ only in what they start with and what the button says. */
function NoteDialog({ testId, initial, action, onSubmit, onCancel }: NoteDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(initial);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} onClose={onCancel} data-testid={testId} className="m-auto w-80 rounded p-4 shadow-lg backdrop:bg-black/30">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(text);
        }}
      >
        <textarea autoFocus aria-label="Note" data-testid="information-text" rows={8} value={text} onChange={(event) => setText(event.target.value)} className="rounded border border-slate-300 px-2 py-1" />
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1.5 text-slate-600 hover:bg-slate-100" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" data-testid={`information-${action.toLowerCase()}`} disabled={text === ''} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-40">
            {action}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** What choosing "note" in the add popup, or right-clicking a node, opens: an empty field and a "Create" button, which creates a new note. */
export function CreateNoteDialog({ onCreate, onCancel }: { onCreate: (text: string) => void; onCancel: () => void }) {
  return <NoteDialog testId="add-dialog" initial="" action="Create" onSubmit={onCreate} onCancel={onCancel} />;
}

/** What double-clicking a note opens: the note's text in the field and an "Update" button, which saves the text into that note. */
export function UpdateNoteDialog({ text, onUpdate, onCancel }: { text: string; onUpdate: (text: string) => void; onCancel: () => void }) {
  return <NoteDialog testId="update-dialog" initial={text} action="Update" onSubmit={onUpdate} onCancel={onCancel} />;
}
