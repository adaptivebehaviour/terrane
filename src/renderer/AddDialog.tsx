import { useEffect, useRef, useState } from 'react';

interface AddDialogProps {
  /** The user chose to select a file: the caller runs the file picker. */
  onSelectFile: () => void;
  /** The user closed the text-file dialog with "Create". */
  onCreateText: (name: string, text: string) => void;
  onCancel: () => void;
}

/** What the plus button opens: a choice between creating a `.txt` file and selecting a file, then (for the former) a name and text. */
export function AddDialog({ onSelectFile, onCreateText, onCancel }: AddDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<'choose' | 'text'>('choose');
  const [name, setName] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} onClose={onCancel} data-testid="add-dialog" className="m-auto w-80 rounded p-4 shadow-lg backdrop:bg-black/30">
      {step === 'choose' ? (
        <div className="flex flex-col gap-2">
          <button type="button" data-testid="choose-text" className="rounded border border-slate-300 px-3 py-2 hover:bg-slate-100" onClick={() => setStep('text')}>
            Create a text file
          </button>
          <button type="button" data-testid="choose-file" className="rounded border border-slate-300 px-3 py-2 hover:bg-slate-100" onClick={onSelectFile}>
            Select a file
          </button>
          <button type="button" className="rounded px-3 py-2 text-slate-600 hover:bg-slate-100" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onCreateText(name, text);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Filename
            <input autoFocus required data-testid="text-name" value={name} onChange={(event) => setName(event.target.value)} className="rounded border border-slate-300 px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Text
            <textarea data-testid="text-body" rows={8} value={text} onChange={(event) => setText(event.target.value)} className="rounded border border-slate-300 px-2 py-1" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded px-3 py-1.5 text-slate-600 hover:bg-slate-100" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" data-testid="text-create" disabled={!name.trim()} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-40">
              Create
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
