import { useEffect, useRef, useState } from 'react';

interface AddMenuProps {
  /** Where the popup's top left corner goes, in pixels from the window's top left. */
  x: number;
  y: number;
  /** The user chose "Create" › ".txt". */
  onCreateText: () => void;
  /** The user chose "Create" › "note". */
  onCreateInformation: () => void;
  /** The user chose "Import": the caller runs the file picker. */
  onImport: () => void;
  onClose: () => void;
}

const ITEM = 'block w-full px-3 py-1.5 text-left hover:bg-slate-100';
const POPUP = 'rounded border border-slate-300 bg-white py-1 shadow-lg';

/**
 * What the plus button and a right-click on an empty part of the canvas open: a popup offering "Create" and "Import".
 * Hovering over "Create" opens a second popup to its right, offering ".txt" and "note". The popup closes on Escape or
 * on a press anywhere outside it.
 */
export function AddMenu({ x, y, onCreateText, onCreateInformation, onImport, onClose }: AddMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div ref={menu} role="menu" data-testid="add-menu" className={`fixed z-10 w-32 ${POPUP}`} style={{ left: x, top: y }}>
      <div className="relative" onMouseEnter={() => setCreating(true)} onMouseLeave={() => setCreating(false)}>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={creating} data-testid="choose-create" className={ITEM}>
          Create
        </button>
        {creating && (
          <div role="menu" data-testid="create-menu" className={`absolute left-full top-0 w-32 ${POPUP}`}>
            <button type="button" role="menuitem" data-testid="choose-text" className={ITEM} onClick={onCreateText}>
              .txt
            </button>
            <button type="button" role="menuitem" data-testid="choose-information" className={ITEM} onClick={onCreateInformation}>
              note
            </button>
          </div>
        )}
      </div>
      <button type="button" role="menuitem" data-testid="choose-file" className={ITEM} onClick={onImport}>
        Import
      </button>
    </div>
  );
}
