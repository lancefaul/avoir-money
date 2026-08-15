import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { OFFICIAL_THEMES, type ThemeKey } from '../store/ui.js';

interface ThemePreview {
  key: ThemeKey;
  label: string;
  colors: {
    background: string;
    surface: string;
    sidebar: string;
    sidebarActive: string;
    accent: string;
    textPrimary: string;
    textSecondary: string;
    border: string;
  };
}

/**
 * Previews for every theme that exists, retired ones included.
 *
 * What the user is offered is `OFFICIAL_THEMES`, filtered below — the previews
 * are kept so that un-retiring a theme is a one-line change to that list rather
 * than a rebuild of its swatch.
 */
const ALL_PREVIEWS: ThemePreview[] = [
  {
    key: 'light',
    label: 'Dune',
    colors: {
      background: 'oklch(98.23% 0.0028 84.60)',
      surface: 'oklch(100% 0 0)',
      sidebar: 'oklch(98.23% 0.0028 84.60)',
      sidebarActive: 'oklch(23.07% 0.0058 91.64)',
      accent: 'oklch(42% 0.12 155)',
      textPrimary: 'oklch(23.07% 0.0058 91.64)',
      textSecondary: 'oklch(51.52% 0.0119 81.78)',
      border: 'oklch(91.04% 0.0086 84.59)',
    },
  },
  {
    key: 'arctic',
    label: 'Arctic',
    colors: {
      background: 'oklch(98% 0.003 220)',
      surface: 'oklch(100% 0 0)',
      sidebar: 'oklch(98% 0.003 220)',
      sidebarActive: 'oklch(23% 0.014 220)',
      accent: 'oklch(42% 0.12 155)',
      textPrimary: 'oklch(23% 0.014 220)',
      textSecondary: 'oklch(52% 0.012 220)',
      border: 'oklch(92% 0.008 220)',
    },
  },
  {
    key: 'dark',
    label: 'Ash',
    colors: {
      background: 'oklch(14.50% 0.004 260)',
      surface: 'oklch(18.50% 0.006 260)',
      sidebar: 'oklch(14.50% 0.004 260)',
      sidebarActive: 'rgba(255,255,255,0.14)',
      accent: 'oklch(65% 0.12 155)',
      textPrimary: 'oklch(86% 0.005 260)',
      textSecondary: 'oklch(63% 0.009 260)',
      border: 'oklch(26.50% 0.008 260)',
    },
  },
  {
    key: 'midnight',
    label: 'Midnight',
    colors: {
      background: 'oklch(5.8% 0.015 250)',
      surface: 'oklch(14% 0.014 250)',
      sidebar: 'oklch(5.8% 0.015 250)',
      sidebarActive: 'rgba(255,255,255,0.14)',
      accent: 'oklch(65% 0.12 155)',
      textPrimary: 'oklch(84% 0.008 250)',
      textSecondary: 'oklch(58% 0.012 250)',
      border: 'oklch(20% 0.014 250)',
    },
  },
  {
    key: 'empire',
    label: 'Empire',
    colors: {
      background: 'oklch(95.2% 0.012 91.5)', // = neutral100
      surface: 'oklch(100% 0 0)', // = neutral0
      // The rail, not the canvas. This swatch read the canvas colour until
      // 2026-08-09 — the preview showed a cream rail for a theme whose rail has
      // been deep green since sidebarSurface became a semantic token.
      sidebar: 'oklch(28.4% 0.039 168)', // = brand800
      sidebarActive: 'oklch(37.4% 0.054 169.5)', // = brand600 (navItemSelected)
      // The preview's "accent" swatch shows the theme's INTERACTIVE colour,
      // which is brand since 2026-08-09. `accent` itself is brass now and is
      // deliberately not what this mock advertises.
      accent: 'oklch(37.4% 0.054 169.5)', // = brand600
      textPrimary: 'oklch(17.7% 0.014 169.6)', // = neutral900
      textSecondary: 'oklch(40.5% 0.018 94.5)', // = neutral700
      border: 'oklch(90.7% 0.017 91.6)', // = neutral200
    },
  },
  {
    key: 'empire-dark',
    label: 'Empire Dark',
    colors: {
      background: 'oklch(19.9% 0.015 172.2)', // = neutral50
      surface: 'oklch(22.6% 0.019 171.9)', // = neutral0
      sidebar: 'oklch(19.9% 0.015 172.2)', // = neutral900
      sidebarActive: 'rgba(255,255,255,0.14)',
      accent: 'oklch(78% 0.05 170.9)', // = brand600 (the value here was stale)
      textPrimary: 'oklch(86.4% 0.016 166.7)', // = neutral800
      textSecondary: 'oklch(76.9% 0.02 162.8)', // = neutral600
      border: 'oklch(35.3% 0.027 165.8)', // = neutral200
    },
  },
  /*
   * Empire Midnight and Empire OLED are Empire Dark wearing a different grey — only
   * the neutral ramp differs, so only the neutral-derived swatches below differ.
   * `accent` is deliberately the same brand600 all three share.
   *
   * `sidebarActive` reads the real `navItemSelected` (gold) rather than the
   * translucent white above it: Empire Dark's swatch predates that token going
   * gold and is stale, and copying it would have propagated the staleness.
   */
  {
    key: 'empire-midnight',
    label: 'Empire Midnight',
    colors: {
      background: 'oklch(14.50% 0.004 260)', // = neutral50
      surface: 'oklch(18.50% 0.006 260)', // = neutral0
      sidebar: 'oklch(14.50% 0.004 260)', // = neutral900
      sidebarActive: 'oklch(83.9% 0.054 87.9)', // = accent600 (navItemSelected)
      accent: 'oklch(78% 0.05 170.9)', // = brand600
      textPrimary: 'oklch(86.00% 0.005 260)', // = neutral800
      textSecondary: 'oklch(74.50% 0.009 260)', // = neutral600
      border: 'oklch(26.50% 0.008 260)', // = neutral200
    },
  },
  {
    key: 'empire-oled',
    label: 'Empire OLED',
    colors: {
      background: 'oklch(5.8% 0.015 250)', // = neutral50
      surface: 'oklch(14% 0.014 250)', // = neutral0
      sidebar: 'oklch(5.8% 0.015 250)', // = neutral900
      sidebarActive: 'oklch(83.9% 0.054 87.9)', // = accent600 (navItemSelected)
      accent: 'oklch(78% 0.05 170.9)', // = brand600
      textPrimary: 'oklch(84% 0.008 250)', // = neutral800
      textSecondary: 'oklch(72.60% 0.012 250)', // = neutral600
      border: 'oklch(20% 0.014 250)', // = neutral200
    },
  },
];

/** Only what is currently offered, in the order `OFFICIAL_THEMES` declares. */
const THEMES: ThemePreview[] = OFFICIAL_THEMES.map((key) => {
  const preview = ALL_PREVIEWS.find((p) => p.key === key);
  if (!preview) throw new Error(`ThemeGallery: no preview defined for official theme "${key}"`);
  return preview;
});

interface ThemeGalleryProps {
  value: ThemeKey;
  onChange: (theme: ThemeKey) => void;
}

export default function ThemeGallery({ value, onChange }: ThemeGalleryProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: vars.space['4'],
      }}
    >
      {THEMES.map((t) => {
        const isActive = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: vars.space['2'],
              padding: vars.space['3'],
              borderRadius: vars.radius.lg,
              border: `2px solid ${isActive ? vars.color.brand600 : vars.color.border}`,
              background: isActive ? vars.color.brand50 : vars.color.surface,
              cursor: 'pointer',
              transition: `border-color ${vars.duration.fast} ${vars.easing.default}, background ${vars.duration.fast} ${vars.easing.default}`,
              outline: 'none',
            }}
            aria-label={`${t.label} theme`}
            aria-pressed={isActive}
          >
            {/* Mini app preview */}
            <div
              style={{
                width: '100%',
                aspectRatio: '4 / 3',
                borderRadius: vars.radius.md,
                overflow: 'hidden',
                display: 'flex',
                border: `1px solid ${t.colors.border}`,
              }}
            >
              {/* Sidebar mock */}
              <div
                style={{
                  width: '20%',
                  background: t.colors.sidebar,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '6%',
                  gap: '4%',
                }}
              >
                {/* Nav items */}
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    style={{
                      height: '12%',
                      borderRadius: '2px',
                      background: i === 1 ? t.colors.sidebarActive : t.colors.border,
                      opacity: i === 1 ? 1 : 0.5,
                    }}
                  />
                ))}
              </div>
              {/* Main content mock */}
              <div
                style={{
                  flex: 1,
                  background: t.colors.background,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '4%',
                  gap: '4%',
                }}
              >
                {/* Top bar */}
                <div
                  style={{
                    height: '10%',
                    borderRadius: '2px',
                    background: t.colors.textPrimary,
                    width: '40%',
                    opacity: 0.8,
                  }}
                />
                {/* Stat cards row */}
                <div style={{ display: 'flex', gap: '3%', height: '25%' }}>
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        background: t.colors.surface,
                        borderRadius: '3px',
                        border: `1px solid ${t.colors.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: '2px',
                      }}
                    >
                      <div
                        style={{
                          width: '50%',
                          height: '3px',
                          borderRadius: '1px',
                          background: t.colors.textSecondary,
                          opacity: 0.6,
                        }}
                      />
                      <div
                        style={{
                          width: '35%',
                          height: '4px',
                          borderRadius: '1px',
                          background: i === 0 ? t.colors.accent : t.colors.textPrimary,
                          opacity: 0.9,
                        }}
                      />
                    </div>
                  ))}
                </div>
                {/* Table rows */}
                <div
                  style={{
                    flex: 1,
                    background: t.colors.surface,
                    borderRadius: '3px',
                    border: `1px solid ${t.colors.border}`,
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '4%',
                    gap: '6%',
                  }}
                >
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4%',
                      }}
                    >
                      <div
                        style={{
                          width: '45%',
                          height: '3px',
                          borderRadius: '1px',
                          background: t.colors.textPrimary,
                          opacity: 0.7,
                        }}
                      />
                      <div style={{ flex: 1 }} />
                      <div
                        style={{
                          width: '20%',
                          height: '3px',
                          borderRadius: '1px',
                          background: i % 2 === 0 ? t.colors.accent : t.colors.textSecondary,
                          opacity: 0.7,
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Label */}
            <span
              style={{
                fontSize: vars.font.sm,
                fontWeight: isActive ? vars.font.semibold : vars.font.regular,
                color: isActive ? vars.color.brand600 : vars.color.textPrimary,
                textAlign: 'center',
              }}
            >
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
