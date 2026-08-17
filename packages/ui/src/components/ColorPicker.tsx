import { useState, useCallback, useId } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from './DropdownMenu.js';
import { Tooltip } from './Tooltip.js';
import { vars } from '../theme/contract.css.js';
import * as cs from './color-picker.css.js';

/* ── Color definitions ── */

export interface ColorSwatchDef {
  /** Unique identifier for this color (e.g., 'neutral900', 'dataViz1') */
  id: string;
  /** Human-readable label shown in tooltip */
  label: string;
  /** CSS color value (uses the theme token variable) */
  value: string;
  /** Whether this is a light color that needs a visible border */
  light?: boolean;
}

/** Neutral palette — warm gray ramp (dark to light) */
const NEUTRAL_COLORS: ColorSwatchDef[] = [
  { id: 'neutral900', label: 'Neutral 900', value: vars.color.neutral900 },
  { id: 'neutral800', label: 'Neutral 800', value: vars.color.neutral800 },
  { id: 'neutral700', label: 'Neutral 700', value: vars.color.neutral700 },
  { id: 'neutral600', label: 'Neutral 600', value: vars.color.neutral600 },
  { id: 'neutral450', label: 'Neutral 450', value: vars.color.neutral450 },
  { id: 'neutral400', label: 'Neutral 400', value: vars.color.neutral400 },
  { id: 'neutral300', label: 'Neutral 300', value: vars.color.neutral300 },
  { id: 'neutral200', label: 'Neutral 200', value: vars.color.neutral200, light: true },
  { id: 'neutral100', label: 'Neutral 100', value: vars.color.neutral100, light: true },
  { id: 'neutral50', label: 'Neutral 50', value: vars.color.neutral50, light: true },
];

/**
 * Hue names for data viz scales (column order), in hue order.
 *
 * These strings are NOT decoration — they are the persisted identity of a
 * colour. `BudgetGroup.color` stores exactly one of these ids in the database,
 * and every consumer resolves it back through `vars.color as Record<…>`, a cast
 * that defeats typecheck. Renaming a hue here without migrating the stored rows
 * leaves those rows pointing at a token that no longer exists, and the fallback
 * hands the raw string to CSS as a colour, which paints nothing.
 */
const HUES = [
  'rose',
  'clay',
  'brass',
  'olive',
  'fern',
  'green',
  'teal',
  'steel',
  'slateBlue',
  'indigo',
  'violet',
  'plum',
] as const;
type Hue = (typeof HUES)[number];

/** Shade levels (row order, light to dark) */
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;

/** Hue display names for tooltips */
const HUE_LABELS: Record<Hue, string> = {
  rose: 'Rose',
  clay: 'Clay',
  brass: 'Brass',
  olive: 'Olive',
  fern: 'Fern',
  green: 'Green',
  teal: 'Teal',
  steel: 'Steel',
  slateBlue: 'Slate Blue',
  indigo: 'Indigo',
  violet: 'Violet',
  plum: 'Plum',
};

/** Build the data viz grid: rows = shade levels, columns = hues */
function buildDataVizRows(): ColorSwatchDef[][] {
  const colorMap = vars.color as Record<string, string | undefined>;
  return SHADES.map((shade) => {
    const isLight = Number(shade) <= 200;
    return HUES.map((hue) => ({
      id: `${hue}${shade}`,
      label: `${HUE_LABELS[hue]} ${shade}`,
      value: colorMap[`${hue}${shade}`] ?? '',
      light: isLight,
    }));
  });
}

const DATA_VIZ_ROWS = buildDataVizRows();

/** Flat list of all selectable colors for lookup */
const ALL_COLORS: ColorSwatchDef[] = [...NEUTRAL_COLORS, ...DATA_VIZ_ROWS.flat()];

/* ── Props ── */

export interface ColorPickerProps {
  /** Currently selected color ID */
  value?: string;
  /** Callback when a color is selected */
  onChange?: (colorId: string) => void;
  /** Callback when the color is cleared (enables the clear option) */
  onClear?: () => void;
  /** Placeholder text when no color is selected */
  placeholder?: string;
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Whether to show the color label in the trigger */
  showLabel?: boolean;
  /** HTML id attribute forwarded to the trigger element. */
  id?: string;
}

/* ── Component ── */

export function ColorPicker({
  value,
  onChange,
  onClear,
  placeholder = 'Pick a color…',
  disabled = false,
  showLabel = true,
  id,
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const listboxId = useId();

  const selectedColor = value ? ALL_COLORS.find((c) => c.id === value) : undefined;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (disabled && open) return;
      setIsOpen(open);
    },
    [disabled],
  );

  const handleSelect = useCallback(
    (colorId: string) => {
      onChange?.(colorId);
      setIsOpen(false);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onClear?.();
    setIsOpen(false);
  }, [onClear]);

  const triggerCls = [cs.trigger, isOpen ? cs.triggerOpen : '', disabled ? cs.triggerDisabled : '']
    .filter(Boolean)
    .join(' ');

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <div
          id={id}
          className={triggerCls}
          tabIndex={disabled ? -1 : 0}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-label="Color picker"
          data-disabled={disabled || undefined}
        >
          {selectedColor ? (
            <>
              <span className={cs.triggerSwatch} style={{ background: selectedColor.value }} />
              {showLabel && <span className={cs.triggerLabel}>{selectedColor.label}</span>}
            </>
          ) : (
            <>
              <span className={`${cs.triggerSwatch} ${cs.triggerSwatchEmpty}`} />
              {showLabel && (
                <span className={`${cs.triggerLabel} ${cs.triggerPlaceholder}`}>{placeholder}</span>
              )}
            </>
          )}
          <span className={`${cs.triggerChevron} ${isOpen ? cs.triggerChevronOpen : ''}`}>
            <ChevronDown size={14} />
          </span>
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" noPadding maxWidth="22.25rem">
        <div className={cs.panel} role="listbox" id={listboxId} aria-label="Color options">
          {/* Neutral row */}
          <div className={cs.row}>
            {NEUTRAL_COLORS.map((color) => (
              <Tooltip key={color.id} content={color.label} side="top">
                <button
                  type="button"
                  className={[
                    cs.swatch,
                    value === color.id ? cs.swatchSelected : '',
                    color.light ? cs.swatchLight : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ background: color.value }}
                  onClick={() => handleSelect(color.id)}
                  role="option"
                  aria-selected={value === color.id}
                  aria-label={color.label}
                >
                  {value === color.id && (
                    <Check
                      size={12}
                      strokeWidth={3}
                      style={{ color: color.light ? vars.color.textPrimary : vars.color.neutral0 }}
                    />
                  )}
                </button>
              </Tooltip>
            ))}
          </div>

          {/* Divider */}
          <div className={cs.divider} />

          {/* Data viz rows — one row per shade level */}
          {DATA_VIZ_ROWS.map((rowColors) => (
            <div key={rowColors[0]?.id ?? ''} className={cs.row}>
              {rowColors.map((color) => (
                <Tooltip key={color.id} content={color.label} side="top">
                  <button
                    type="button"
                    className={[
                      cs.swatch,
                      value === color.id ? cs.swatchSelected : '',
                      color.light ? cs.swatchLight : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ background: color.value }}
                    onClick={() => handleSelect(color.id)}
                    role="option"
                    aria-selected={value === color.id}
                    aria-label={color.label}
                  >
                    {value === color.id && (
                      <Check
                        size={12}
                        strokeWidth={3}
                        style={{
                          color: color.light ? vars.color.textPrimary : vars.color.neutral0,
                        }}
                      />
                    )}
                  </button>
                </Tooltip>
              ))}
            </div>
          ))}

          {/* Clear color option */}
        </div>
        {onClear && (
          <div style={{ paddingBottom: '0.25rem' }}>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleClear} disabled={!value}>
              Clear color
            </DropdownMenuItem>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
