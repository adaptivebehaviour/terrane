import { useEffect, useRef, useState } from 'react';

interface WeightDialogProps {
  weight: number;
  /** The dialog was closed; `weight` is the slider's value. */
  onClose: (weight: number) => void;
}

/** What double-clicking a link opens (D11, D16): a slider for the link's weight (1–10) in its centre, and a Close button that sets it. */
export function WeightDialog({ weight, onClose }: WeightDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(weight);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} onClose={() => onClose(value)} data-testid="weight-dialog" className="m-auto w-80 rounded p-4 shadow-lg backdrop:bg-black/30">
      <div className="flex flex-col items-center gap-4">
        <input type="range" min={1} max={10} step={1} aria-label="Weight" data-testid="weight-slider" value={value} onChange={(event) => setValue(Number(event.target.value))} className="w-48" />
        <button type="button" data-testid="weight-close" className="rounded bg-slate-900 px-3 py-1.5 text-white" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </div>
    </dialog>
  );
}
