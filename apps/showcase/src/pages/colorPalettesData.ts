import { lightTheme } from '@budget-tracker/ui/theme/theme-light.css.js';
import { arcticTheme } from '@budget-tracker/ui/theme/theme-arctic.css.js';
import { darkTheme } from '@budget-tracker/ui/theme/theme-dark.css.js';
import { midnightTheme } from '@budget-tracker/ui/theme/theme-midnight.css.js';
import { cipherpunkTheme } from '@budget-tracker/ui/theme/theme-cipherpunk.css.js';
import { empireTheme } from '@budget-tracker/ui/theme/theme-empire.css.js';
import { empireDarkTheme } from '@budget-tracker/ui/theme/theme-empire-dark.css.js';
import { empireMidnightTheme } from '@budget-tracker/ui/theme/theme-empire-midnight.css.js';
import { empireOledTheme } from '@budget-tracker/ui/theme/theme-empire-oled.css.js';
import type { vars } from '@budget-tracker/ui/theme/contract.css.js';

/* Token data tables for the Color Palettes showcase page — extracted from
   ColorPalettesPage.tsx. */

export type ColorToken = keyof typeof vars.color;

export const THEMES = [
  { key: 'light', label: 'Light (Dune)', className: lightTheme },
  { key: 'arctic', label: 'Arctic', className: arcticTheme },
  { key: 'dark', label: 'Dark (Ash)', className: darkTheme },
  { key: 'midnight', label: 'Midnight', className: midnightTheme },
  { key: 'cipherpunk', label: 'Cipherpunk', className: cipherpunkTheme },
  { key: 'empire', label: 'Empire', className: empireTheme },
  { key: 'empire-dark', label: 'Empire Dark', className: empireDarkTheme },
  { key: 'empire-midnight', label: 'Empire Midnight', className: empireMidnightTheme },
  { key: 'empire-oled', label: 'Empire OLED', className: empireOledTheme },
] as const;

/* ── Token groups — theme-independent, resolved per ancestor theme class ── */

export const brandTokens: ColorToken[] = [
  'brand50',
  'brand100',
  'brand200',
  'brand300',
  'brand400',
  'brand500',
  'brand600',
  'brand700',
  'brand800',
  'brand900',
];

export const accentTokens: ColorToken[] = [
  'accent50',
  'accent100',
  'accent200',
  'accent300',
  'accent400',
  'accent500',
  'accent600',
  'accent700',
  'accent800',
  'accent900',
];

export const brandButtonTokens: ColorToken[] = [
  'brandButtonFrom',
  'brandButtonTo',
  'brandButtonHoverFrom',
  'brandButtonHoverTo',
  'brandButtonActiveFrom',
  'brandButtonActiveTo',
  'brandButtonBorder',
];

export const secondaryButtonTokens: ColorToken[] = [
  'secondaryButtonFrom',
  'secondaryButtonTo',
  'secondaryButtonHoverFrom',
  'secondaryButtonHoverTo',
  'secondaryButtonBorder',
];

export const dangerButtonTokens: ColorToken[] = [
  'dangerButtonFrom',
  'dangerButtonTo',
  'dangerButtonHoverFrom',
  'dangerButtonHoverTo',
  'dangerButtonBorder',
];

export const neutralTokens: ColorToken[] = [
  'neutral0',
  'neutral25',
  'neutral50',
  'neutral100',
  'neutral200',
  'neutral300',
  'neutral400',
  'neutral450',
  'neutral500',
  'neutral600',
  'neutral700',
  'neutral800',
  'neutral900',
];

export const surfaceTokens: ColorToken[] = [
  'background',
  'surface',
  'surfaceRaised',
  'surfaceOverlay',
  'surfaceHover',
  'sidebarSurface',
  'navItemSelected',
];

export const borderTokens: ColorToken[] = ['border', 'borderStrong', 'borderFocus', 'borderError'];

export const semanticScales: { name: string; tokens: ColorToken[] }[] = [
  {
    name: 'Success',
    tokens: [
      'success50',
      'success100',
      'success200',
      'success300',
      'success400',
      'success500',
      'success600',
      'success700',
    ],
  },
  {
    name: 'Warning',
    tokens: [
      'warning50',
      'warning100',
      'warning200',
      'warning300',
      'warning400',
      'warning500',
      'warning600',
      'warning700',
    ],
  },
  {
    name: 'Danger',
    tokens: [
      'danger50',
      'danger100',
      'danger200',
      'danger300',
      'danger400',
      'danger500',
      'danger600',
      'danger700',
    ],
  },
  {
    name: 'Info',
    tokens: ['info50', 'info100', 'info200', 'info300', 'info400', 'info500', 'info600', 'info700'],
  },
];
export const semanticSteps = ['50', '100', '200', '300', '400', '500', '600', '700'];

export const onColorTokens: { token: ColorToken; bg: ColorToken }[] = [
  { token: 'onSuccess', bg: 'success500' },
  { token: 'onWarning', bg: 'warning500' },
  { token: 'onDanger', bg: 'danger500' },
  { token: 'onInfo', bg: 'info500' },
  { token: 'onNeutral', bg: 'neutral800' },
];

export const inputColorTokens: ColorToken[] = [
  'inputBg',
  'inputBgHover',
  'inputBgDisabled',
  'inputBorder',
  'inputBorderHover',
];

export const inputShadowTokens: ColorToken[] = [
  'inputShadow',
  'inputShadowFocus',
  'inputShadowError',
];

export const dataVizPalette = [
  { token: 'dataViz1' as ColorToken, name: 'Rose' },
  { token: 'dataViz2' as ColorToken, name: 'Clay' },
  { token: 'dataViz3' as ColorToken, name: 'Brass' },
  { token: 'dataViz4' as ColorToken, name: 'Olive' },
  { token: 'dataViz5' as ColorToken, name: 'Fern' },
  { token: 'dataViz6' as ColorToken, name: 'Green' },
  { token: 'dataViz7' as ColorToken, name: 'Teal' },
  { token: 'dataViz8' as ColorToken, name: 'Steel' },
  { token: 'dataViz9' as ColorToken, name: 'Slate Blue' },
  { token: 'dataViz10' as ColorToken, name: 'Indigo' },
  { token: 'dataViz11' as ColorToken, name: 'Violet' },
  { token: 'dataViz12' as ColorToken, name: 'Plum' },
];

export const dataVizScales: { name: string; baseToken: string; tokens: ColorToken[] }[] = [
  {
    name: 'Rose',
    baseToken: 'rose',
    tokens: [
      'rose50',
      'rose100',
      'rose200',
      'rose300',
      'rose400',
      'rose500',
      'rose600',
      'rose700',
      'rose800',
      'rose900',
    ],
  },
  {
    name: 'Clay',
    baseToken: 'clay',
    tokens: [
      'clay50',
      'clay100',
      'clay200',
      'clay300',
      'clay400',
      'clay500',
      'clay600',
      'clay700',
      'clay800',
      'clay900',
    ],
  },
  {
    name: 'Brass',
    baseToken: 'brass',
    tokens: [
      'brass50',
      'brass100',
      'brass200',
      'brass300',
      'brass400',
      'brass500',
      'brass600',
      'brass700',
      'brass800',
      'brass900',
    ],
  },
  {
    name: 'Olive',
    baseToken: 'olive',
    tokens: [
      'olive50',
      'olive100',
      'olive200',
      'olive300',
      'olive400',
      'olive500',
      'olive600',
      'olive700',
      'olive800',
      'olive900',
    ],
  },
  {
    name: 'Fern',
    baseToken: 'fern',
    tokens: [
      'fern50',
      'fern100',
      'fern200',
      'fern300',
      'fern400',
      'fern500',
      'fern600',
      'fern700',
      'fern800',
      'fern900',
    ],
  },
  {
    name: 'Green',
    baseToken: 'green',
    tokens: [
      'green50',
      'green100',
      'green200',
      'green300',
      'green400',
      'green500',
      'green600',
      'green700',
      'green800',
      'green900',
    ],
  },
  {
    name: 'Teal',
    baseToken: 'teal',
    tokens: [
      'teal50',
      'teal100',
      'teal200',
      'teal300',
      'teal400',
      'teal500',
      'teal600',
      'teal700',
      'teal800',
      'teal900',
    ],
  },
  {
    name: 'Steel',
    baseToken: 'steel',
    tokens: [
      'steel50',
      'steel100',
      'steel200',
      'steel300',
      'steel400',
      'steel500',
      'steel600',
      'steel700',
      'steel800',
      'steel900',
    ],
  },
  {
    name: 'Slate Blue',
    baseToken: 'slateBlue',
    tokens: [
      'slateBlue50',
      'slateBlue100',
      'slateBlue200',
      'slateBlue300',
      'slateBlue400',
      'slateBlue500',
      'slateBlue600',
      'slateBlue700',
      'slateBlue800',
      'slateBlue900',
    ],
  },
  {
    name: 'Indigo',
    baseToken: 'indigo',
    tokens: [
      'indigo50',
      'indigo100',
      'indigo200',
      'indigo300',
      'indigo400',
      'indigo500',
      'indigo600',
      'indigo700',
      'indigo800',
      'indigo900',
    ],
  },
  {
    name: 'Violet',
    baseToken: 'violet',
    tokens: [
      'violet50',
      'violet100',
      'violet200',
      'violet300',
      'violet400',
      'violet500',
      'violet600',
      'violet700',
      'violet800',
      'violet900',
    ],
  },
  {
    name: 'Plum',
    baseToken: 'plum',
    tokens: [
      'plum50',
      'plum100',
      'plum200',
      'plum300',
      'plum400',
      'plum500',
      'plum600',
      'plum700',
      'plum800',
      'plum900',
    ],
  },
];

/** The authored palette ships a real 7-step diverging scale, so the showcase shows it as one. */
export const dataVizDiverging: ColorToken[] = [
  'dataVizDiverging1',
  'dataVizDiverging2',
  'dataVizDiverging3',
  'dataVizDiverging4',
  'dataVizDiverging5',
  'dataVizDiverging6',
  'dataVizDiverging7',
];

export const dataVizSteps = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];

/* ── Shared render helpers ── */
