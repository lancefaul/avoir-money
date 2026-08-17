import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, Smile } from 'lucide-react';
import emojiData from 'unicode-emoji-json';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from './DropdownMenu.js';
import { ButtonGroup } from './ButtonGroup.js';
import { SearchInput } from './SearchInput.js';
import * as cs from './emoji-picker.css.js';
import * as inp from './inputs.css.js';

/* ── Emoji data ── */

const EMOJI_GROUPS = [
  'Smileys & Emotion',
  'People & Body',
  'Animals & Nature',
  'Food & Drink',
  'Travel & Places',
  'Activities',
  'Objects',
  'Symbols',
  'Flags',
] as const;

const GROUP_OPTIONS = EMOJI_GROUPS.map((g) => ({
  value: g,
  label:
    (
      {
        'Smileys & Emotion': '😀',
        'People & Body': '👋',
        'Animals & Nature': '🐶',
        'Food & Drink': '🍕',
        'Travel & Places': '✈️',
        Activities: '⚽',
        Objects: '💡',
        Symbols: '❤️',
        Flags: '🏁',
      } as Record<string, string>
    )[g] ?? g,
}));

interface EmojiEntry {
  char: string;
  name: string;
  group: string;
}

const ALL_EMOJIS: EmojiEntry[] = Object.entries(emojiData).map(([char, meta]) => ({
  char,
  name: (meta as { name: string; group: string }).name,
  group: (meta as { name: string; group: string }).group,
}));

const GROUPED_EMOJIS = EMOJI_GROUPS.reduce<Record<string, EmojiEntry[]>>((acc, group) => {
  acc[group] = ALL_EMOJIS.filter((e) => e.group === group);
  return acc;
}, {});

/** Lookup map for finding emoji name by character */
const EMOJI_NAME_MAP = new Map(ALL_EMOJIS.map((e) => [e.char, e.name]));

/* ── Props ── */

export interface EmojiPickerProps {
  /** Currently selected emoji character */
  value?: string;
  /** Callback when an emoji is selected */
  onChange?: (emoji: string) => void;
  /** Callback when the emoji is cleared (enables the clear option) */
  onClear?: () => void;
  /** Placeholder text when no emoji is selected */
  placeholder?: string;
  /** Whether to show the emoji name in the trigger */
  showLabel?: boolean;
  /** HTML id attribute forwarded to the trigger element */
  id?: string;
}

/* ── Component ── */

export function EmojiPicker({
  value,
  onChange,
  onClear,
  placeholder = 'Pick an emoji…',
  showLabel = true,
  id,
}: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeGroup, setActiveGroup] = useState<string>(EMOJI_GROUPS[0]);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) setSearch('');
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return ALL_EMOJIS.filter((e) => e.name.includes(q));
  }, [search]);

  const handleSelect = useCallback(
    (emoji: string) => {
      onChange?.(emoji);
      setIsOpen(false);
      setSearch('');
    },
    [onChange],
  );

  const handleGroupChange = useCallback((group: string) => {
    setActiveGroup(group);
    setSearch('');
    if (gridRef.current) gridRef.current.scrollTop = 0;
  }, []);

  const handleClear = useCallback(() => {
    onClear?.();
    setIsOpen(false);
  }, [onClear]);

  const displayEmojis = filtered ?? GROUPED_EMOJIS[activeGroup] ?? [];
  const selectedName = value ? EMOJI_NAME_MAP.get(value) : undefined;

  const triggerCls = [cs.trigger, isOpen ? cs.triggerOpen : ''].filter(Boolean).join(' ');

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <div
          id={id}
          className={triggerCls}
          tabIndex={0}
          role="combobox"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-label={value ? `Selected emoji: ${value} ${selectedName ?? ''}` : 'Emoji picker'}
        >
          {value ? (
            <>
              <span className={cs.triggerEmoji}>{value}</span>
              {showLabel && selectedName && <span className={cs.triggerLabel}>{selectedName}</span>}
            </>
          ) : (
            <>
              <span className={cs.triggerPlaceholder}>
                <Smile size={16} />
              </span>
              {showLabel && <span className={cs.triggerPlaceholderText}>{placeholder}</span>}
            </>
          )}
          <span className={`${cs.triggerChevron} ${isOpen ? cs.triggerChevronOpen : ''}`}>
            <ChevronDown size={14} />
          </span>
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" noPadding maxWidth="22.25rem">
        <div className={cs.panel} role="dialog" aria-label="Emoji picker">
          {/* Search — uses SearchInput DS component */}
          <div className={inp.searchWrap}>
            <SearchInput
              ref={searchRef}
              value={search}
              onChange={setSearch}
              placeholder="Search emoji…"
              aria-label="Search emoji"
            />
          </div>

          {/* Group tabs — ButtonGroup */}
          {!search.trim() && (
            <div className={cs.groupTabsWrap}>
              <ButtonGroup
                options={GROUP_OPTIONS}
                value={activeGroup}
                onChange={handleGroupChange}
                size="sm"
                ariaLabel="Emoji category"
              />
            </div>
          )}

          {/* Emoji grid */}
          <div ref={gridRef} className={cs.grid}>
            {displayEmojis.length === 0 && <p className={cs.noResults}>No emoji found</p>}
            {displayEmojis.map((e) => (
              <button
                key={e.char}
                type="button"
                onClick={() => handleSelect(e.char)}
                className={cs.emojiButton}
                title={e.name}
                aria-label={e.name}
              >
                {e.char}
              </button>
            ))}
          </div>

          {/* Footer with result count during search */}
          {filtered && (
            <div className={cs.footer}>
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* Clear emoji option */}
        {onClear && (
          <div style={{ paddingBottom: '0.25rem' }}>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleClear} disabled={!value}>
              Clear emoji
            </DropdownMenuItem>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
