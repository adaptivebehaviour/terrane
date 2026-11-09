import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

interface SplitViewProps {
  first: ReactNode;
  second: ReactNode;
  /** The first area's (left or top) starting share of the total width or height (0 to 1). */
  initialFirst: number;
  direction: 'row' | 'column';
  /** Size the first area to fit its content, and size it again whenever the content or the split view changes size. */
  fitFirst?: boolean;
}

/**
 * Two areas separated by a splitter that can be dragged to change how the space is shared between them: side by side
 * (`direction` "row", a vertical splitter) or one above the other ("column", a horizontal splitter). The first area is
 * never so large that the splitter is pushed out of view.
 */
export function SplitView({ first, second, initialFirst, direction, fitFirst = false }: SplitViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const firstArea = useRef<HTMLDivElement>(null);
  const splitter = useRef<HTMLDivElement>(null);
  const [firstShare, setFirstShare] = useState(initialFirst);
  const row = direction === 'row';

  /** Sets the first area's size (in pixels), kept between 0 and the room the splitter leaves. */
  const setFirstSize = (size: number) => {
    const total = row ? container.current!.clientWidth : container.current!.clientHeight;
    const room = total - (row ? splitter.current!.offsetWidth : splitter.current!.offsetHeight);
    if (total > 0) setFirstShare(Math.min(room, Math.max(0, size)) / total);
  };

  useLayoutEffect(() => {
    if (!fitFirst) return;
    const content = () => firstArea.current!.firstElementChild as HTMLElement | null;
    const fit = () => {
      const element = content();
      setFirstSize(element ? (row ? element.offsetWidth : element.offsetHeight) : 0);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container.current!);
    const element = content();
    if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [fitFirst, row]);

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !container.current) return;
    const box = container.current.getBoundingClientRect();
    setFirstSize(row ? event.clientX - box.left : event.clientY - box.top);
  };

  return (
    <div ref={container} className={`flex min-h-0 min-w-0 flex-1 ${row ? '' : 'flex-col'}`}>
      <div ref={firstArea} className="flex min-h-0 min-w-0 shrink-0 flex-col overflow-auto" style={row ? { width: `${firstShare * 100}%` } : { height: `${firstShare * 100}%` }}>
        {first}
      </div>
      <div
        ref={splitter}
        role="separator"
        aria-orientation={row ? 'vertical' : 'horizontal'}
        data-testid="splitter"
        className={`shrink-0 touch-none bg-slate-200 hover:bg-slate-400 ${row ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}`}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={onPointerMove}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">{second}</div>
    </div>
  );
}
