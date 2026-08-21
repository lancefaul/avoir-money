import { Settings } from 'lucide-react';
import {
  IconButton,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

// ─── Font options ────────────────────────────────────────────────────────────

const UI_FONTS = [
  { value: "'DM Sans Variable', 'DM Sans', sans-serif", label: 'DM Sans (current)' },
  { value: "'Libre Franklin Variable', 'Libre Franklin', sans-serif", label: 'Libre Franklin' },
  { value: "'Outfit Variable', 'Outfit', sans-serif", label: 'Outfit' },
  { value: "'Inter Variable', 'Inter', sans-serif", label: 'Inter' },
  {
    value: "'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', sans-serif",
    label: 'Plus Jakarta Sans',
  },
  { value: "'Nunito Sans Variable', 'Nunito Sans', sans-serif", label: 'Nunito Sans' },
  { value: "'Source Sans 3 Variable', 'Source Sans 3', sans-serif", label: 'Source Sans 3' },
  { value: "'Geist Variable', 'Geist', sans-serif", label: 'Geist' },
  { value: "'Manrope Variable', 'Manrope', sans-serif", label: 'Manrope' },
  { value: "'Albert Sans Variable', 'Albert Sans', sans-serif", label: 'Albert Sans' },
  { value: "'Figtree Variable', 'Figtree', sans-serif", label: 'Figtree' },
] as const;

const DISPLAY_FONTS = [
  { value: "'DM Serif Display', Georgia, serif", label: 'DM Serif Display (current)' },
  { value: "'Playfair Display Variable', 'Playfair Display', serif", label: 'Playfair Display' },
  { value: "'Libre Baskerville', Baskerville, serif", label: 'Libre Baskerville' },
  { value: "'Lora Variable', 'Lora', serif", label: 'Lora' },
  { value: "'Fraunces Variable', 'Fraunces', serif", label: 'Fraunces' },
  {
    value: "'Cormorant Garamond Variable', 'Cormorant Garamond', serif",
    label: 'Cormorant Garamond',
  },
  { value: "'Bitter Variable', 'Bitter', serif", label: 'Bitter' },
  { value: "'Merriweather', Georgia, serif", label: 'Merriweather' },
] as const;

/**
 * The `label` slot — labels, eyebrows and small uppercase run-ins.
 *
 * Empire and Empire Dark set this to Oswald; the retired themes still point it
 * at their UI stack. "(current)" throughout this file means what the Empire
 * pair actually renders, since those are the only selectable themes.
 */
const LABEL_FONTS = [
  { value: "'Oswald Variable', 'Oswald', sans-serif", label: 'Oswald (current)' },
  { value: "'DM Sans Variable', 'DM Sans', sans-serif", label: 'DM Sans' },
  { value: "'Libre Franklin Variable', 'Libre Franklin', sans-serif", label: 'Libre Franklin' },
  { value: "'Inter Variable', 'Inter', sans-serif", label: 'Inter' },
] as const;

const CODE_FONTS = [
  { value: "'Fira Code Variable', 'Fira Code', monospace", label: 'Fira Code (current)' },
  { value: "'IBM Plex Mono', monospace", label: 'IBM Plex Mono' },
  {
    value: "'JetBrains Mono Variable', 'JetBrains Mono', monospace",
    label: 'JetBrains Mono',
  },
  { value: "'Source Code Pro Variable', 'Source Code Pro', monospace", label: 'Source Code Pro' },
  { value: "'Inconsolata Variable', 'Inconsolata', monospace", label: 'Inconsolata' },
] as const;

type ThemeId = 'light' | 'dark' | 'cipherpunk';

const THEME_OPTIONS: { value: ThemeId; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'cipherpunk', label: 'Cipherpunk' },
];

// ─── Storage keys ────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  ui: 'showcase-font-ui',
  display: 'showcase-font-display',
  label: 'showcase-font-label',
  code: 'showcase-font-code',
} as const;

// ─── CSS var extraction ──────────────────────────────────────────────────────

function extractCssVarName(varRef: string): string {
  const match = varRef.match(/var\(([^)]+)\)/);
  return match?.[1] ?? '';
}

export const FONT_UI_VAR = extractCssVarName(vars.font.ui);
export const FONT_DISPLAY_VAR = extractCssVarName(vars.font.display);
export const FONT_LABEL_VAR = extractCssVarName(vars.font.label);
export const FONT_CODE_VAR = extractCssVarName(vars.font.code);

// ─── Initial values ──────────────────────────────────────────────────────────

export type FontSlot = 'ui' | 'display' | 'label' | 'code';

const DEFAULTS: Record<FontSlot, string> = {
  ui: UI_FONTS[0].value,
  display: DISPLAY_FONTS[0].value,
  label: LABEL_FONTS[0].value,
  code: CODE_FONTS[0].value,
};

export function getInitialFont(slot: FontSlot): string {
  if (typeof window === 'undefined') return DEFAULTS[slot];
  return localStorage.getItem(STORAGE_KEYS[slot]) ?? DEFAULTS[slot];
}

// ─── Component ───────────────────────────────────────────────────────────────

interface ShowcaseSettingsProps {
  theme: ThemeId;
  onThemeChange: (t: ThemeId) => void;
  uiFont: string;
  onUiFontChange: (f: string) => void;
  displayFont: string;
  onDisplayFontChange: (f: string) => void;
  labelFont: string;
  onLabelFontChange: (f: string) => void;
  codeFont: string;
  onCodeFontChange: (f: string) => void;
}

export function ShowcaseSettings({
  theme,
  onThemeChange,
  uiFont,
  onUiFontChange,
  displayFont,
  onDisplayFontChange,
  labelFont,
  onLabelFontChange,
  codeFont,
  onCodeFontChange,
}: ShowcaseSettingsProps) {
  const HANDLERS: Record<FontSlot, (f: string) => void> = {
    ui: onUiFontChange,
    display: onDisplayFontChange,
    label: onLabelFontChange,
    code: onCodeFontChange,
  };

  function setFont(slot: FontSlot, value: string) {
    localStorage.setItem(STORAGE_KEYS[slot], value);
    HANDLERS[slot](value);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon={<Settings size={16} />}
          tooltip="Showcase Settings"
          size="md"
          variant="secondary"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Theme */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Theme</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {THEME_OPTIONS.map((t) => (
              <DropdownMenuItem
                key={t.value}
                checked={theme === t.value}
                checkStyle="dot"
                onSelect={() => onThemeChange(t.value)}
              >
                {t.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* UI Font */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>UI Font</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {UI_FONTS.map((f) => (
              <DropdownMenuItem
                key={f.label}
                checked={uiFont === f.value}
                checkStyle="dot"
                onSelect={() => setFont('ui', f.value)}
              >
                {f.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Display Font */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Display Font</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {DISPLAY_FONTS.map((f) => (
              <DropdownMenuItem
                key={f.label}
                checked={displayFont === f.value}
                checkStyle="dot"
                onSelect={() => setFont('display', f.value)}
              >
                {f.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Label Font */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Label Font</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {LABEL_FONTS.map((f) => (
              <DropdownMenuItem
                key={f.label}
                checked={labelFont === f.value}
                checkStyle="dot"
                onSelect={() => setFont('label', f.value)}
              >
                {f.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Code Font */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Code Font</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {CODE_FONTS.map((f) => (
              <DropdownMenuItem
                key={f.label}
                checked={codeFont === f.value}
                checkStyle="dot"
                onSelect={() => setFont('code', f.value)}
              >
                {f.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
