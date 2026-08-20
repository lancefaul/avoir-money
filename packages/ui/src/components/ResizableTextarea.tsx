import { useRef, useCallback, useId, type TextareaHTMLAttributes } from 'react';
import { GripHorizontal } from 'lucide-react';
import * as inp from './inputs.css.js';

interface ResizableTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  minHeight?: number;
  /**
   * Render the drag-to-resize handle. Set false for a plain, fixed-height
   * textarea with no handle. @default true
   */
  resizable?: boolean;
}

export function ResizableTextarea({
  minHeight = 88,
  resizable = true,
  className,
  style,
  id,
  name,
  ...props
}: ResizableTextareaProps) {
  const autoId = useId();
  const textareaId = id ?? autoId;
  const textareaName = name ?? textareaId;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const startY = useRef(0);
  const startH = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const ta = textareaRef.current;
      if (!ta) return;

      startY.current = e.clientY;
      startH.current = ta.offsetHeight;

      const onPointerMove = (ev: PointerEvent) => {
        const delta = ev.clientY - startY.current;
        const next = Math.max(minHeight, startH.current + delta);
        ta.style.height = `${next}px`;
      };

      const onPointerUp = () => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
      };

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    },
    [minHeight],
  );

  // Plain, fixed-height textarea: no drag handle and no reserved handle padding.
  if (!resizable) {
    return (
      <textarea
        id={textareaId}
        name={textareaName}
        className={`${inp.textarea} ${className ?? ''}`}
        style={{ resize: 'none', ...style }}
        {...props}
      />
    );
  }

  return (
    <div className={inp.textareaWrap}>
      <textarea
        ref={textareaRef}
        id={textareaId}
        name={textareaName}
        className={`${inp.textarea} ${className ?? ''}`}
        style={{ paddingBottom: '1.25rem', ...style }}
        {...props}
      />
      <div
        className={inp.textareaHandle}
        onPointerDown={onPointerDown}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize textarea"
        tabIndex={0}
      >
        <span className={inp.textareaHandleIcon}>
          <GripHorizontal size={10} />
        </span>
      </div>
    </div>
  );
}
