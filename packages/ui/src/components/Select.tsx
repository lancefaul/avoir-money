import { useState, useRef, useEffect, useCallback, useId, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './DropdownMenu.js';
import { IconButton } from './IconButton.js';
import { SearchInput } from './SearchInput.js';
import * as btn from './buttons.css.js';
import * as inp from './inputs.css.js';
import * as cs from './select.css.js';
import * as ch from './chip.css.js';

/* ── Types ── */

export interface SelectOption {
  value: string;
  label: string;
  meta?: string;
  group?: string;
}

interface BaseProps {
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
  error?: boolean;
  id?: string;
  /** HTML name attribute for the combobox. Defaults to the resolved id if not provided. */
  name?: string;
  /** Accessible label for the combobox trigger when no visible label is associated. */
  'aria-label'?: string;
  /**
   * Custom trigger element, rendered via `DropdownMenuTrigger asChild` in place
   * of the default combobox box. The element must forward its ref and spread the
   * injected props (onClick, aria-*) onto its root — e.g. a `<Badge chevron>`.
   */
  trigger?: ReactNode;
  /**
   * Explicit width for the dropdown panel, e.g. `'16rem'`.
   *
   * By default the panel matches its trigger. That is right for a normal
   * field, and wrong when the trigger is deliberately small — a Badge, say —
   * because the options then sit in a panel far narrower than they need.
   */
  menuWidth?: string;
}

interface SingleProps extends BaseProps {
  multi?: false;
  value?: string;
  onChange?: (value: string) => void;
}

interface MultiProps extends BaseProps {
  multi: true;
  value?: string[];
  onChange?: (value: string[]) => void;
  showFooter?: boolean;
  /** Size of the selected-value chips. Defaults to 'sm'. */
  chipSize?: 'sm' | 'lg';
}

type SelectProps = SingleProps | MultiProps;

/* ── Helpers ── */

function groupOptions(opts: SelectOption[]): { group?: string; items: SelectOption[] }[] {
  const groups: { group?: string; items: SelectOption[] }[] = [];
  let cur: { group?: string; items: SelectOption[] } | null = null;
  for (const o of opts) {
    if (!cur || cur.group !== o.group) {
      cur = { group: o.group, items: [] };
      groups.push(cur);
    }
    cur.items.push(o);
  }
  return groups;
}

/* ── Component ── */

export function Select(props: SelectProps) {
  const {
    options,
    placeholder = 'Select…',
    searchable = false,
    searchPlaceholder = 'Search…',
    disabled = false,
    error = false,
    multi,
    id,
    name,
    'aria-label': ariaLabel,
    trigger,
    menuWidth,
  } = props;

  const searchRef = useRef<HTMLInputElement>(null);
  const autoId = useId();
  const inputId = id ?? autoId;
  const _inputName = name ?? inputId;
  const listboxId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Accessible name for the default combobox trigger. A consumer's
  // `<label htmlFor={id}>` targets this combobox, but `<label for>` is inert
  // against a `<div role="combobox">` (a div is not a labelable element), so a
  // screen reader announces nothing. When no explicit `aria-label` is supplied,
  // find that label on mount, give it an id if it lacks one, and point the
  // combobox at it via `aria-labelledby` — fixing every existing
  // `<label htmlFor> + <Select id>` pair with no consumer change. Client-only
  // progressive enhancement (this app is a Vite SPA; there is no SSR pass).
  const [autoLabelledBy, setAutoLabelledBy] = useState<string | undefined>();
  useEffect(() => {
    if (ariaLabel) return;
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(inputId)}"]`);
    if (!label) return;
    if (!label.id) label.id = `${inputId}-label`;
    setAutoLabelledBy(label.id);
  }, [inputId, ariaLabel]);

  const selectedSet = new Set(
    multi
      ? ((props as MultiProps).value ?? [])
      : (props as SingleProps).value
        ? [(props as SingleProps).value!]
        : [],
  );

  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (disabled && open) return;
      setIsOpen(open);
      if (!open) setSearch('');
    },
    [disabled],
  );

  const handleSelect = useCallback(
    (val: string) => {
      if (multi) {
        const cur = (props as MultiProps).value ?? [];
        const next = cur.includes(val) ? cur.filter((v) => v !== val) : [...cur, val];
        (props as MultiProps).onChange?.(next);
      } else {
        (props as SingleProps).onChange?.(val);
      }
    },
    [multi, props],
  );

  // Auto-focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchable) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => searchRef.current?.focus());
      });
    }
  }, [isOpen, searchable]);

  // Trigger label
  let triggerContent: React.ReactNode;
  if (multi) {
    const vals = (props as MultiProps).value ?? [];
    if (vals.length === 0) {
      triggerContent = (
        <span className={`${cs.csLabel} ${cs.csPlaceholder} ${cs.csMultiPlaceholder}`}>
          {placeholder}
        </span>
      );
    } else {
      const chipLarge = (props as MultiProps).chipSize === 'lg';
      const chipCls = chipLarge ? `${ch.chip} ${ch.chipLg}` : ch.chip;
      const chipXCls = chipLarge ? `${ch.chipX} ${ch.chipXLg}` : ch.chipX;
      triggerContent = (
        <div className={ch.chipGroup}>
          {vals.map((v) => {
            const opt = options.find((o) => o.value === v);
            return (
              <span key={v} className={chipCls}>
                {opt?.label ?? v}
                <IconButton
                  icon={<X size={chipLarge ? 12 : 10} />}
                  tooltip={`Remove ${opt?.label ?? v}`}
                  size="sm"
                  className={chipXCls}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelect(v);
                  }}
                  onKeyDown={(e) => {
                    // The chip lives inside the combobox trigger, whose keydown
                    // handler opens the menu on Enter/Space and preventDefaults the
                    // button's native click. Remove the chip here and stop the
                    // event before it reaches the trigger.
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSelect(v);
                    }
                  }}
                />
              </span>
            );
          })}
        </div>
      );
    }
  } else {
    const sel = options.find((o) => o.value === (props as SingleProps).value);
    triggerContent = (
      <span className={`${cs.csLabel} ${!sel ? cs.csPlaceholder : ''}`}>
        {sel?.label ?? placeholder}
      </span>
    );
  }

  const triggerCls = [
    cs.csTrigger,
    multi ? cs.csTriggerMulti : '',
    multi && (props as MultiProps).chipSize === 'lg' ? cs.csTriggerMultiLg : '',
    isOpen ? cs.csTriggerOpen : '',
    disabled ? cs.csTriggerDisabled : '',
    error ? cs.csTriggerError : '',
  ]
    .filter(Boolean)
    .join(' ');

  const groups = groupOptions(filtered);

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <div
            id={inputId}
            className={triggerCls}
            tabIndex={disabled ? -1 : 0}
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-label={ariaLabel}
            aria-labelledby={autoLabelledBy}
            data-disabled={disabled || undefined}
          >
            {triggerContent}
            <span className={`${cs.csChevron} ${isOpen ? cs.csChevronOpen : ''}`}>
              <ChevronDown size={14} />
            </span>
          </div>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        matchTriggerWidth
        width={menuWidth}
        autoFocusFirst={!searchable}
        noPadding
      >
        {searchable && (
          <div className={inp.searchWrap}>
            <SearchInput
              ref={searchRef}
              value={search}
              onChange={setSearch}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder || 'Search options'}
            />
          </div>
        )}

        {filtered.length === 0 ? (
          <div className={cs.csEmpty}>No results found</div>
        ) : (
          <div className={cs.csItemsScroll} role="listbox" id={listboxId} tabIndex={-1}>
            {groups.map((g, gi) => (
              <div key={g.group ?? `group-${gi}`}>
                {gi > 0 && (g.group || groups[gi - 1]?.group) && <DropdownMenuSeparator />}
                {g.group && <DropdownMenuLabel>{g.group}</DropdownMenuLabel>}
                {g.items.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    checked={selectedSet.has(opt.value)}
                    checkStyle={multi ? 'check' : 'dot'}
                    closeOnSelect={!multi}
                    onSelect={() => handleSelect(opt.value)}
                    badge={opt.meta}
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </div>
        )}

        {multi && (props as MultiProps).showFooter !== false && (
          <div className={cs.csFooter}>
            <button
              type="button"
              className={`${btn.btnBase} ${btn.btnSm} ${btn.btnTrueGhost} ${cs.csFooterBtnStart}`}
              onClick={() => (props as MultiProps).onChange?.(options.map((o) => o.value))}
            >
              Select all
            </button>
            <span className={cs.csCount}>
              {((props as MultiProps).value ?? []).length} of {options.length}
            </span>
            <button
              type="button"
              className={`${btn.btnBase} ${btn.btnSm} ${btn.btnTrueGhost} ${cs.csFooterBtnEnd}`}
              onClick={() => (props as MultiProps).onChange?.([])}
            >
              Clear
            </button>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
