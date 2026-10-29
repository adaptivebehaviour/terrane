import { useEffect, useRef, useState, type FormEvent } from 'react';
import { workspaceNameProblem } from '@adaptivebehaviour/desktop/src/workspace/names';

interface Props {
  /** The workspace location path the dialog starts with. */
  initialLocation: string;
  /** Shows the folder picker; resolves with the chosen location path, or `null` if the user cancels. */
  onChooseLocation(): Promise<string | null>;
  /** Creates the workspace; rejects with the reason it could not be created. */
  onCreate(name: string): Promise<void>;
  onCancel(): void;
}

/** Asks for the new workspace's name and location. The workspace path is the location plus the name. */
export function NewWorkspaceDialog({ initialLocation, onChooseLocation, onCreate, onCancel }: Props) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState(initialLocation);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const problem = workspaceNameProblem(name);

  useEffect(() => input.current?.focus(), []);

  const chooseLocation = async () => {
    setBusy(true);
    try {
      const chosen = await onChooseLocation();
      if (chosen !== null) setLocation(chosen);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    try {
      await onCreate(name);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-workspace-title"
        onSubmit={(event) => void submit(event)}
        onKeyDown={(event) => event.key === 'Escape' && !busy && onCancel()}
        className="w-[28rem] rounded bg-white p-4 shadow-lg"
      >
        <h2 id="new-workspace-title" className="mb-3 text-base font-semibold">
          New workspace
        </h2>
        <label className="mb-1 block text-sm" htmlFor="new-workspace-name">
          Name
        </label>
        <input
          id="new-workspace-name"
          ref={input}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setFailure('');
          }}
          aria-invalid={name !== '' && problem !== null}
          className="w-full rounded border border-gray-400 px-2 py-1"
        />
        <p className="mt-1 min-h-5 text-sm text-red-700" role="alert">
          {failure || (name !== '' && problem ? problem : '')}
        </p>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <button type="button" disabled={busy} onClick={() => void chooseLocation()} className="rounded border border-gray-400 px-3 py-1 hover:bg-gray-100 disabled:opacity-40">
            Location
          </button>
          <span className="min-w-0 flex-1 truncate" title={location} data-testid="workspace-location">
            {location}
          </span>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onCancel} className="rounded px-3 py-1 hover:bg-gray-200 disabled:opacity-40">
            Cancel
          </button>
          <button type="submit" disabled={problem !== null || busy} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-40">
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
