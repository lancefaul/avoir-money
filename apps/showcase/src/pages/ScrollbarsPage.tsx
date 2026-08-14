import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';

export default function ScrollbarsPage() {
  return (
    <div className={s.section}>
      <div className={s.sectionLabel}>Scrollbars – transparent track, themed thumb</div>
      <div className={s.row} style={{ gap: vars.space['6'] }}>
        <div className={s.col} style={{ gap: vars.space['2'] }}>
          <div
            style={{
              width: '15rem',
              height: '7.5rem',
              overflowY: 'auto',
              background: vars.color.surface,
              border: `${vars.border.hairline} solid ${vars.color.border}`,
              borderRadius: vars.radius.md,
              padding: vars.space['3'],
              fontSize: vars.font.sm,
              color: vars.color.textSecondary,
              lineHeight: vars.font.leadingRelaxed,
              scrollbarColor: `${vars.scrollbar.thumb} ${vars.scrollbar.track}`,
              scrollbarWidth: 'thin',
            }}
          >
            <div style={{ height: '18.75rem' }}>
              Scroll me – the track is transparent and the thumb uses the theme token. This text is
              intentionally long to force a scrollbar to appear so you can see the styling. The
              thumb color adapts per theme.
            </div>
          </div>
          <span className={s.ann}>on surface</span>
        </div>
        <div className={s.col} style={{ gap: vars.space['2'] }}>
          <div
            style={{
              width: '15rem',
              height: '7.5rem',
              overflowY: 'auto',
              background: vars.color.background,
              border: `${vars.border.hairline} solid ${vars.color.border}`,
              borderRadius: vars.radius.md,
              padding: vars.space['3'],
              fontSize: vars.font.sm,
              color: vars.color.textSecondary,
              lineHeight: vars.font.leadingRelaxed,
              scrollbarColor: `${vars.scrollbar.thumb} ${vars.scrollbar.track}`,
              scrollbarWidth: 'thin',
            }}
          >
            <div style={{ height: '18.75rem' }}>
              Scroll me – same thumb on the page background. No visible track, just the floating
              thumb. Works on any surface because the track is always transparent.
            </div>
          </div>
          <span className={s.ann}>on background</span>
        </div>
      </div>
      <div className={s.row} style={{ marginTop: vars.space['4'] }}>
        <div className={s.swatch}>
          <div className={s.swatchBlock} style={{ background: vars.scrollbar.thumb }} />
          <div className={s.swatchMeta}>
            <div className={s.swatchName}>scrollbar.thumb</div>
            <div className={s.swatchRole}>Default thumb</div>
          </div>
        </div>
        <div className={s.swatch}>
          <div className={s.swatchBlock} style={{ background: vars.scrollbar.thumbHover }} />
          <div className={s.swatchMeta}>
            <div className={s.swatchName}>scrollbar.thumbHover</div>
            <div className={s.swatchRole}>Hovered thumb</div>
          </div>
        </div>
        <div className={s.swatch}>
          <div
            className={s.swatchBlock}
            style={{
              background: vars.scrollbar.track,
              border: `1px dashed ${vars.color.border}`,
            }}
          />
          <div className={s.swatchMeta}>
            <div className={s.swatchName}>scrollbar.track</div>
            <div className={s.swatchRole}>Track – always transparent</div>
          </div>
        </div>
      </div>
      <div className={s.note} style={{ marginTop: vars.space['3'] }}>
        Width: {`{scrollbar.width}`} · Radius: {`{scrollbar.radius}`} · Firefox uses scrollbar-color
        + scrollbar-width: thin. Webkit uses ::-webkit-scrollbar pseudo-elements.
      </div>
    </div>
  );
}
