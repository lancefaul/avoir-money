import { useId, useRef, useCallback, forwardRef, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { IconButton } from './IconButton.js';
import * as inp from './inputs.css.js';

export interface SearchInputProps {
  /** Current search value. */
  value: string;
  /** Called when the value changes. */
  onChange: (value: string) => void;
  /** Placeholder text. @default "Search…" */
  placeholder?: string;
  /** Accessible label for the input. @default placeholder value */
  'aria-label'?: string;
  /** HTML id attribute. Auto-generated if not provided. */
  id?: string;
  /** HTML name attribute. Defaults to the resolved id. */
  name?: string;
  /** Additional className on the wrapper div. */
  className?: string;
  /** Inline styles on the wrapper div. */
  style?: React.CSSProperties;
  /** When true, input is disabled. */
  disabled?: boolean;
  /** Additional action elements rendered in the right slot (after the clear button). */
  actions?: ReactNode;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onChange,
    placeholder = 'Search…',
    'aria-label': ariaLabel,
    id,
    name,
    className,
    style,
    disabled = false,
    actions,
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const inputName = name ?? inputId;
  const internalRef = useRef<HTMLInputElement>(null);

  // Merge forwarded ref with internal ref
  const setRef = useCallback(
    (el: HTMLInputElement | null) => {
      (internalRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
    },
    [ref],
  );

  const handleClear = useCallback(() => {
    onChange('');
    internalRef.current?.focus();
  }, [onChange]);

  const hasActions = !!(value || actions);

  return (
    <div className={`${inp.inputWrap} ${className ?? ''}`} style={style}>
      <span className={inp.inputIconLeft}>
        <Search size={14} />
      </span>
      <input
        ref={setRef}
        id={inputId}
        name={inputName}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={inp.input}
        aria-label={ariaLabel ?? placeholder}
        style={{ paddingLeft: '2.25rem', paddingRight: hasActions ? '4.5rem' : undefined }}
      />
      {hasActions && (
        <div className={inp.inputActions}>
          {value && !disabled && (
            <IconButton
              icon={<X size={12} />}
              tooltip="Clear search"
              size="sm"
              onClick={handleClear}
            />
          )}
          {actions}
        </div>
      )}
    </div>
  );
});
