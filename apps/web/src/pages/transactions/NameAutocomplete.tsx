import { useState, useCallback, useRef, useEffect, useId } from 'react';
import { Plus } from 'lucide-react';
import type { UseFormRegisterReturn, UseFormSetValue } from 'react-hook-form';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@budget-tracker/ui';
import { api } from '../../lib/api.js';

interface Description {
  id: string;
  name: string;
}

interface NameAutocompleteProps {
  /**
   * react-hook-form binding. Omit it and supply `value` + `onValueChange`
   * instead — the reconciler edits a single field outside any form, and
   * standing up a form just to reuse this dropdown would be the wrong shape.
   */
  registration?: UseFormRegisterReturn;
  // Accepts any form that has a 'name' field
  setValue?: (
    field: 'name',
    value: string,
    options?: Parameters<UseFormSetValue<{ name: string }>>[2],
  ) => void;
  /** Controlled value. Presence of this switches off the uncontrolled path. */
  value?: string;
  onValueChange?: (name: string) => void;
  suggestions?: string[];
  className: string;
  placeholder?: string;
  onDescriptionSelect?: (name: string) => void;
  id?: string;
}

export default function NameAutocomplete({
  registration,
  setValue,
  value,
  onValueChange,
  className,
  placeholder,
  onDescriptionSelect,
  id,
}: NameAutocompleteProps) {
  const controlled = value !== undefined;
  const [open, setOpen] = useState(false);
  const [uncontrolledValue, setUncontrolledValue] = useState('');
  const inputValue = controlled ? value : uncontrolledValue;
  const setInputValue = useCallback(
    (next: string) => {
      if (controlled) onValueChange?.(next);
      else setUncontrolledValue(next);
    },
    [controlled, onValueChange],
  );
  const [descriptions, setDescriptions] = useState<Description[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const justSelectedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listboxId = useId();

  // Fetch descriptions when input changes
  useEffect(() => {
    if (inputValue.length < 1) {
      setDescriptions([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      api.descriptions
        .list(inputValue)
        .then(setDescriptions)
        .catch(() => {});
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [inputValue]);

  const filtered = descriptions.slice(0, 8);
  const exactMatch = filtered.some((d) => d.name.toLowerCase() === inputValue.toLowerCase());
  const showCreateOption = inputValue.length >= 1 && !exactMatch;
  const showList = open && (filtered.length > 0 || showCreateOption);

  const select = useCallback(
    (name: string) => {
      setValue?.('name', name, { shouldValidate: true });
      setInputValue(name);
      setOpen(false);
      justSelectedRef.current = true;
      onDescriptionSelect?.(name);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [setValue, onDescriptionSelect],
  );

  const createAndSelect = useCallback(async () => {
    try {
      const desc = await api.descriptions.create(inputValue.trim());
      select(desc.name);
    } catch {
      // If creation fails (e.g. duplicate), just use the typed value
      select(inputValue.trim());
    }
  }, [inputValue, select]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === ' ') {
        e.stopPropagation();
        return;
      }

      if (!showList) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.stopPropagation();
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        const menu = document.querySelector('[role="menu"]');
        const firstItem = menu?.querySelector<HTMLElement>('[role="menuitem"]');
        firstItem?.focus();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }

      if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        select(filtered[0]!.name);
      }
    },
    [showList, filtered, select],
  );

  const setRef = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      registration?.ref(el);
    },
    [registration],
  );

  return (
    <DropdownMenu open={showList} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <div style={{ width: '100%' }}>
          <input
            {...registration}
            {...(controlled ? { value: inputValue } : {})}
            ref={setRef}
            id={id}
            className={className}
            placeholder={placeholder}
            autoComplete="off"
            aria-expanded={showList}
            aria-autocomplete="list"
            aria-controls={listboxId}
            onChange={(e) => {
              void registration?.onChange(e);
              setInputValue(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              if (justSelectedRef.current) {
                justSelectedRef.current = false;
                return;
              }
              if (inputValue.length >= 1) setOpen(true);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
      </DropdownMenuTrigger>

      {/* Stays anchored to the input on narrow screens — a bottom sheet would
          cover the very field being typed into. */}
      <DropdownMenuContent
        align="start"
        matchTriggerWidth
        autoFocusFirst={false}
        sheetOnNarrow={false}
      >
        <div id={listboxId} role="listbox">
          {filtered.map((d) => (
            <DropdownMenuItem key={d.id} onSelect={() => select(d.name)}>
              {d.name}
            </DropdownMenuItem>
          ))}
          {showCreateOption && filtered.length > 0 && <DropdownMenuSeparator />}
          {showCreateOption && (
            <DropdownMenuItem icon={<Plus size={13} />} onSelect={createAndSelect}>
              Create "{inputValue.trim()}"
            </DropdownMenuItem>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
