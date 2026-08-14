import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';

/**
 * Color Palettes — full token audit, rendered once per theme.
 *
 * Unlike the "Tokens" page (which demos usage in the ambient showcase theme),
 * this page renders EVERY color token from the contract inside a wrapper div
 * carrying each theme's actual class name. Vanilla-extract themes work by
 * scoping CSS custom properties to a class selector, so nesting `vars.color.X`
 * references inside a themed wrapper resolves them to that theme's real value
 * via normal CSS cascade — no per-theme JS branching, no hardcoded literals.
 */
import {
  type ColorToken,
  THEMES,
  brandTokens,
  accentTokens,
  brandButtonTokens,
  secondaryButtonTokens,
  dangerButtonTokens,
  neutralTokens,
  surfaceTokens,
  borderTokens,
  semanticScales,
  semanticSteps,
  onColorTokens,
  inputColorTokens,
  inputShadowTokens,
  dataVizPalette,
  dataVizScales,
  dataVizSteps,
} from './colorPalettesData.js';

function SwatchGrid({ tokens, groupLabel }: { tokens: ColorToken[]; groupLabel: string }) {
  return (
    <div className={s.row}>
      {tokens.map((token) => (
        <div key={token} className={s.swatch}>
          <div
            className={s.swatchBlock}
            style={{
              background: vars.color[token],
              border: `${vars.border.hairline} solid ${vars.color.border}`,
            }}
          />
          <div className={s.swatchMeta}>
            <div className={s.swatchName}>{token}</div>
            <div className={s.swatchRole}>{groupLabel}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: vars.font.sm,
        fontWeight: vars.font.medium,
        marginBottom: vars.space['2'],
        color: vars.color.textPrimary,
      }}
    >
      {children}
    </div>
  );
}

function TextSampleGrid({ tokens, bg }: { tokens: ColorToken[]; bg: ColorToken }) {
  return (
    <div className={s.row}>
      {tokens.map((token) => (
        <div key={token} className={s.swatch}>
          <div
            className={s.swatchBlock}
            style={{
              background: vars.color[bg],
              border: `${vars.border.hairline} solid ${vars.color.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: vars.font.lg,
              fontWeight: vars.font.medium,
              color: vars.color[token],
            }}
          >
            Aa
          </div>
          <div className={s.swatchMeta}>
            <div className={s.swatchName}>{token}</div>
            <div className={s.swatchRole}>on {bg}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BorderSwatchGrid({ tokens }: { tokens: ColorToken[] }) {
  return (
    <div className={s.row}>
      {tokens.map((token) => (
        <div key={token} className={s.swatch}>
          <div
            className={s.swatchBlock}
            style={{
              background: vars.color.surface,
              border: `${vars.border.thick} solid ${vars.color[token]}`,
            }}
          />
          <div className={s.swatchMeta}>
            <div className={s.swatchName}>{token}</div>
            <div className={s.swatchRole}>Border</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OnColorGrid({ items }: { items: { token: ColorToken; bg: ColorToken }[] }) {
  return (
    <div className={s.row}>
      {items.map(({ token, bg }) => (
        <div key={token} className={s.swatch}>
          <div
            className={s.swatchBlock}
            style={{
              background: vars.color[bg],
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: vars.font.sm,
              fontWeight: vars.font.semibold,
              color: vars.color[token],
            }}
          >
            Aa
          </div>
          <div className={s.swatchMeta}>
            <div className={s.swatchName}>{token}</div>
            <div className={s.swatchRole}>on {bg}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ShadowDemoGrid({ tokens }: { tokens: ColorToken[] }) {
  return (
    <div className={s.row}>
      {tokens.map((token) => (
        <div key={token} className={s.swatch} style={{ overflow: 'visible' }}>
          <div
            className={s.swatchBlock}
            style={{
              background: vars.color.surface,
              boxShadow: vars.color[token],
              borderRadius: vars.radius.md,
            }}
          />
          <div className={s.swatchMeta} style={{ marginTop: vars.space['2'] }}>
            <div className={s.swatchName}>{token}</div>
            <div className={s.swatchRole}>box-shadow</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RampRow({
  tokens,
  steps,
  darkTextCutoff,
}: {
  tokens: ColorToken[];
  steps: string[];
  darkTextCutoff: number;
}) {
  return (
    <div className={s.ramp}>
      {tokens.map((token, idx) => (
        <div key={token} className={s.rampStop} style={{ background: vars.color[token] }}>
          <span
            className={s.rampStopLabel}
            style={{ color: idx < darkTextCutoff ? vars.color.textPrimary : vars.color.neutral0 }}
          >
            {steps[idx]}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── The 12 token categories, rendered once per theme ── */

function TokenCategories() {
  return (
    <>
      <div className={s.section}>
        <div className={s.sectionLabel}>1. Brand ramp</div>
        <SwatchGrid tokens={brandTokens} groupLabel="Brand ramp" />
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>2. Accent ramp</div>
        <SwatchGrid tokens={accentTokens} groupLabel="Accent ramp" />
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>3. Button surfaces</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['5'] }}>
          <div>
            <SubLabel>Brand button</SubLabel>
            <SwatchGrid tokens={brandButtonTokens} groupLabel="Brand button" />
          </div>
          <div>
            <SubLabel>Secondary button</SubLabel>
            <SwatchGrid tokens={secondaryButtonTokens} groupLabel="Secondary button" />
          </div>
          <div>
            <SubLabel>Danger button</SubLabel>
            <SwatchGrid tokens={dangerButtonTokens} groupLabel="Danger button" />
          </div>
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>4. Neutral ramp</div>
        <SwatchGrid tokens={neutralTokens} groupLabel="Neutral ramp" />
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>5. Surfaces</div>
        <SwatchGrid tokens={surfaceTokens} groupLabel="Surface" />
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>6. Text hierarchy</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['3'] }}>
          <TextSampleGrid
            tokens={['textPrimary', 'textSecondary', 'textTertiary', 'textPlaceholder']}
            bg="surface"
          />
          <TextSampleGrid tokens={['textInverse']} bg="neutral900" />
          <TextSampleGrid tokens={['textOnBrand']} bg="brand600" />
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>7. Borders</div>
        <BorderSwatchGrid tokens={borderTokens} />
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>8. Semantic status ramps</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
          {semanticScales.map((scale) => (
            <div key={scale.name}>
              <SubLabel>{scale.name}</SubLabel>
              <RampRow tokens={scale.tokens} steps={semanticSteps} darkTextCutoff={4} />
            </div>
          ))}
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>9. On-color tokens</div>
        <OnColorGrid items={onColorTokens} />
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>10. Overlay &amp; input tokens</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
          <div>
            <SubLabel>overlay (shown over a busy background to reveal transparency)</SubLabel>
            <div className={s.row}>
              <div className={s.swatch}>
                <div
                  className={s.swatchBlock}
                  style={{
                    position: 'relative',
                    background: `linear-gradient(135deg, ${vars.color.dataViz3} 0%, ${vars.color.dataViz9} 100%)`,
                  }}
                >
                  <div style={{ position: 'absolute', inset: 0, background: vars.color.overlay }} />
                </div>
                <div className={s.swatchMeta}>
                  <div className={s.swatchName}>overlay</div>
                  <div className={s.swatchRole}>Modal / drawer backdrop</div>
                </div>
              </div>
            </div>
          </div>
          <div>
            <SubLabel>Input surfaces</SubLabel>
            <SwatchGrid tokens={inputColorTokens} groupLabel="Input" />
          </div>
          <div>
            <SubLabel>Input shadows (box-shadow values, not solid colors)</SubLabel>
            <ShadowDemoGrid tokens={inputShadowTokens} />
          </div>
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>11. Data visualization — categorical</div>
        <div className={s.row}>
          {dataVizPalette.map((item) => (
            <div key={item.token} className={s.swatch}>
              <div className={s.swatchBlock} style={{ background: vars.color[item.token] }} />
              <div className={s.swatchMeta}>
                <div className={s.swatchName}>{item.name}</div>
                <div className={s.swatchRole}>{item.token}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>12. Data visualization — scales (10 steps per hue)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
          {dataVizScales.map((scale) => (
            <div key={scale.baseToken}>
              <SubLabel>{scale.name}</SubLabel>
              <RampRow tokens={scale.tokens} steps={dataVizSteps} darkTextCutoff={5} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default function ColorPalettesPage() {
  return (
    <>
      {/* ── Jump nav ── */}
      <nav
        className={s.nav}
        style={{
          position: 'sticky',
          top: 0,
          zIndex: vars.z.sticky,
          background: vars.color.surface,
          border: `${vars.border.hairline} solid ${vars.color.border}`,
          borderRadius: vars.radius.md,
          padding: vars.space['2'],
          marginBottom: vars.space['8'],
          boxShadow: vars.shadow.sm,
          flexWrap: 'wrap',
        }}
      >
        {THEMES.map((theme) => (
          <a key={theme.key} href={`#theme-${theme.key}`} className={s.navTab}>
            {theme.label}
          </a>
        ))}
      </nav>

      {/* ── Fixed constant, shown once (not theme-dependent) ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Fixed brand constant — identical across all themes</div>
        <div className={s.row}>
          <div className={s.swatch}>
            <div
              className={s.swatchBlock}
              style={{
                background: vars.color.bitcoinOrange,
                border: `${vars.border.hairline} solid ${vars.color.border}`,
              }}
            />
            <div className={s.swatchMeta}>
              <div className={s.swatchName}>bitcoinOrange</div>
              <div className={s.swatchRole}>Fixed hex constant — never varies per theme</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Per-theme sections ── */}
      {THEMES.map((theme) => (
        <section
          key={theme.key}
          id={`theme-${theme.key}`}
          style={{ marginBottom: vars.space['16'] }}
        >
          <div
            className={theme.className}
            style={{
              background: vars.color.background,
              padding: vars.space['8'],
              borderRadius: vars.radius.lg,
            }}
          >
            <h2
              style={{
                fontFamily: vars.font.display,
                fontSize: vars.font['3xl'],
                color: vars.color.textPrimary,
                marginBottom: vars.space['8'],
              }}
            >
              {theme.label}
            </h2>
            <TokenCategories />
          </div>
        </section>
      ))}
    </>
  );
}
