import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';

const palette = [
  { token: 'dataViz1', name: 'Rose', color: vars.color.dataViz1 },
  { token: 'dataViz2', name: 'Clay', color: vars.color.dataViz2 },
  { token: 'dataViz3', name: 'Brass', color: vars.color.dataViz3 },
  { token: 'dataViz4', name: 'Olive', color: vars.color.dataViz4 },
  { token: 'dataViz5', name: 'Fern', color: vars.color.dataViz5 },
  { token: 'dataViz6', name: 'Green', color: vars.color.dataViz6 },
  { token: 'dataViz7', name: 'Teal', color: vars.color.dataViz7 },
  { token: 'dataViz8', name: 'Steel', color: vars.color.dataViz8 },
  { token: 'dataViz9', name: 'Slate Blue', color: vars.color.dataViz9 },
  { token: 'dataViz10', name: 'Indigo', color: vars.color.dataViz10 },
  { token: 'dataViz11', name: 'Violet', color: vars.color.dataViz11 },
  { token: 'dataViz12', name: 'Plum', color: vars.color.dataViz12 },
] as const;

const colorScales = [
  {
    name: 'Rose',
    baseToken: 'rose',
    colors: [
      vars.color.rose50,
      vars.color.rose100,
      vars.color.rose200,
      vars.color.rose300,
      vars.color.rose400,
      vars.color.rose500,
      vars.color.rose600,
      vars.color.rose700,
      vars.color.rose800,
      vars.color.rose900,
    ],
  },
  {
    name: 'Clay',
    baseToken: 'clay',
    colors: [
      vars.color.clay50,
      vars.color.clay100,
      vars.color.clay200,
      vars.color.clay300,
      vars.color.clay400,
      vars.color.clay500,
      vars.color.clay600,
      vars.color.clay700,
      vars.color.clay800,
      vars.color.clay900,
    ],
  },
  {
    name: 'Brass',
    baseToken: 'brass',
    colors: [
      vars.color.brass50,
      vars.color.brass100,
      vars.color.brass200,
      vars.color.brass300,
      vars.color.brass400,
      vars.color.brass500,
      vars.color.brass600,
      vars.color.brass700,
      vars.color.brass800,
      vars.color.brass900,
    ],
  },
  {
    name: 'Olive',
    baseToken: 'olive',
    colors: [
      vars.color.olive50,
      vars.color.olive100,
      vars.color.olive200,
      vars.color.olive300,
      vars.color.olive400,
      vars.color.olive500,
      vars.color.olive600,
      vars.color.olive700,
      vars.color.olive800,
      vars.color.olive900,
    ],
  },
  {
    name: 'Fern',
    baseToken: 'fern',
    colors: [
      vars.color.fern50,
      vars.color.fern100,
      vars.color.fern200,
      vars.color.fern300,
      vars.color.fern400,
      vars.color.fern500,
      vars.color.fern600,
      vars.color.fern700,
      vars.color.fern800,
      vars.color.fern900,
    ],
  },
  {
    name: 'Green',
    baseToken: 'green',
    colors: [
      vars.color.green50,
      vars.color.green100,
      vars.color.green200,
      vars.color.green300,
      vars.color.green400,
      vars.color.green500,
      vars.color.green600,
      vars.color.green700,
      vars.color.green800,
      vars.color.green900,
    ],
  },
  {
    name: 'Teal',
    baseToken: 'teal',
    colors: [
      vars.color.teal50,
      vars.color.teal100,
      vars.color.teal200,
      vars.color.teal300,
      vars.color.teal400,
      vars.color.teal500,
      vars.color.teal600,
      vars.color.teal700,
      vars.color.teal800,
      vars.color.teal900,
    ],
  },
  {
    name: 'Steel',
    baseToken: 'steel',
    colors: [
      vars.color.steel50,
      vars.color.steel100,
      vars.color.steel200,
      vars.color.steel300,
      vars.color.steel400,
      vars.color.steel500,
      vars.color.steel600,
      vars.color.steel700,
      vars.color.steel800,
      vars.color.steel900,
    ],
  },
  {
    name: 'Slate Blue',
    baseToken: 'slateBlue',
    colors: [
      vars.color.slateBlue50,
      vars.color.slateBlue100,
      vars.color.slateBlue200,
      vars.color.slateBlue300,
      vars.color.slateBlue400,
      vars.color.slateBlue500,
      vars.color.slateBlue600,
      vars.color.slateBlue700,
      vars.color.slateBlue800,
      vars.color.slateBlue900,
    ],
  },
  {
    name: 'Indigo',
    baseToken: 'indigo',
    colors: [
      vars.color.indigo50,
      vars.color.indigo100,
      vars.color.indigo200,
      vars.color.indigo300,
      vars.color.indigo400,
      vars.color.indigo500,
      vars.color.indigo600,
      vars.color.indigo700,
      vars.color.indigo800,
      vars.color.indigo900,
    ],
  },
  {
    name: 'Violet',
    baseToken: 'violet',
    colors: [
      vars.color.violet50,
      vars.color.violet100,
      vars.color.violet200,
      vars.color.violet300,
      vars.color.violet400,
      vars.color.violet500,
      vars.color.violet600,
      vars.color.violet700,
      vars.color.violet800,
      vars.color.violet900,
    ],
  },
  {
    name: 'Plum',
    baseToken: 'plum',
    colors: [
      vars.color.plum50,
      vars.color.plum100,
      vars.color.plum200,
      vars.color.plum300,
      vars.color.plum400,
      vars.color.plum500,
      vars.color.plum600,
      vars.color.plum700,
      vars.color.plum800,
      vars.color.plum900,
    ],
  },
] as const;

/** The palette ships a real 7-step diverging scale; it is not two categorical ramps stitched together. */
const diverging = [
  vars.color.dataVizDiverging1,
  vars.color.dataVizDiverging2,
  vars.color.dataVizDiverging3,
  vars.color.dataVizDiverging4,
  vars.color.dataVizDiverging5,
  vars.color.dataVizDiverging6,
  vars.color.dataVizDiverging7,
] as const;

const scaleSteps = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];

export default function DataVizPalettePage() {
  return (
    <>
      {/* ── Primary categorical colors ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Data visualization palette – 12 categorical colors</div>
        <div className={s.ramp}>
          {palette.map((item) => (
            <div key={item.token} className={s.rampStop} style={{ background: item.color }}>
              <span className={s.rampStopLabel} style={{ color: vars.color.neutral0 }}>
                {item.token.replace('dataViz', '')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Individual swatches ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Individual swatches</div>
        <div className={s.row}>
          {palette.map((item) => (
            <div key={item.token} className={s.swatch}>
              <div className={s.swatchBlock} style={{ background: item.color }} />
              <div className={s.swatchMeta}>
                <div className={s.swatchName}>{item.name}</div>
                <div className={s.swatchRole}>{item.token}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Color scales (10 steps per color) ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>
          Color scales – 10 steps per color (50 = lightest, 500 = primary, 900 = darkest)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
          {colorScales.map((scale) => (
            <div key={scale.baseToken}>
              <div
                style={{
                  fontSize: vars.font.sm,
                  fontWeight: vars.font.medium,
                  marginBottom: vars.space['2'],
                  color: vars.color.textPrimary,
                }}
              >
                {scale.name}
              </div>
              <div className={s.ramp}>
                {scale.colors.map((color, idx) => (
                  <div
                    key={`${scale.baseToken}-${scaleSteps[idx]}`}
                    className={s.rampStop}
                    style={{ background: color }}
                  >
                    <span
                      className={s.rampStopLabel}
                      style={{
                        color: idx < 5 ? vars.color.textPrimary : vars.color.neutral0,
                      }}
                    >
                      {scaleSteps[idx]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Usage examples ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Usage examples</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['6'] }}>
          {/* Categorical chart example */}
          <div>
            <div
              style={{
                fontSize: vars.font.base,
                fontWeight: vars.font.medium,
                marginBottom: vars.space['3'],
                color: vars.color.textPrimary,
              }}
            >
              Categorical data (12 distinct series)
            </div>
            <div style={{ display: 'flex', gap: vars.space['2'], height: '8rem' }}>
              {palette.map((item) => (
                <div
                  key={item.token}
                  style={{
                    flex: 1,
                    background: item.color,
                    borderRadius: vars.radius.sm,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Sequential scale example */}
          <div>
            <div
              style={{
                fontSize: vars.font.base,
                fontWeight: vars.font.medium,
                marginBottom: vars.space['3'],
                color: vars.color.textPrimary,
              }}
            >
              Sequential scale (heatmap, choropleth)
            </div>
            <div style={{ display: 'flex', gap: vars.space['1'], height: '4rem' }}>
              {colorScales[8].colors.map((color, idx) => (
                <div
                  key={idx}
                  style={{
                    flex: 1,
                    background: color,
                    borderRadius: vars.radius.xs,
                  }}
                />
              ))}
            </div>
            <div
              style={{
                fontSize: vars.font.xs,
                color: vars.color.textSecondary,
                marginTop: vars.space['2'],
              }}
            >
              Example: Blueberry scale (50→900)
            </div>
          </div>

          {/* Diverging scale example */}
          <div>
            <div
              style={{
                fontSize: vars.font.base,
                fontWeight: vars.font.medium,
                marginBottom: vars.space['3'],
                color: vars.color.textPrimary,
              }}
            >
              Diverging scale (positive/negative values)
            </div>
            <div style={{ display: 'flex', gap: vars.space['1'], height: '4rem' }}>
              {diverging.map((color, idx) => (
                <div
                  key={`div-${idx}`}
                  style={{
                    flex: 1,
                    background: color,
                    borderRadius: vars.radius.xs,
                  }}
                />
              ))}
            </div>
            <div
              style={{
                fontSize: vars.font.xs,
                color: vars.color.textSecondary,
                marginTop: vars.space['2'],
              }}
            >
              dataVizDiverging1–7: over budget ← neutral → under budget
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
