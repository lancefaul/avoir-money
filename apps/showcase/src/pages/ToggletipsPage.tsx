import { Info, HelpCircle, AlertCircle } from 'lucide-react';
import { Toggletip, IconButton, buttonStyles as btn } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';

export default function ToggletipsPage() {
  return (
    <>
      {/* ── Section 1: Basic usage ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Basic – click to toggle</div>
        <div className={s.row}>
          <div className={s.col}>
            <Toggletip trigger={<IconButton icon={<Info size={14} />} tooltip="More info" />}>
              <p style={{ margin: 0 }}>
                This is a toggletip with <strong>structured content</strong>. It supports rich
                markup like bold, links, and lists.
              </p>
            </Toggletip>
            <span className={s.ann}>IconButton trigger</span>
          </div>
          <div className={s.col}>
            <Toggletip
              trigger={
                <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnSecondary}`}>
                  Learn more
                </button>
              }
            >
              <p style={{ margin: 0, marginBottom: vars.space['2'] }}>
                Toggletips are click-activated and can contain interactive content.
              </p>
              <p style={{ margin: 0, fontSize: vars.font.xs, color: vars.color.textSecondary }}>
                Press <kbd style={{ fontFamily: vars.font.code }}>Esc</kbd> or click outside to
                close.
              </p>
            </Toggletip>
            <span className={s.ann}>Text button trigger</span>
          </div>
        </div>
      </div>

      {/* ── Section 2: Placement ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Placement – side prop</div>
        <div className={s.row}>
          {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
            <div className={s.col} key={side}>
              <Toggletip
                side={side}
                trigger={
                  <button
                    type="button"
                    className={`${btn.btnBase} ${btn.btnMd} ${btn.btnSecondary}`}
                  >
                    {side.charAt(0).toUpperCase() + side.slice(1)}
                  </button>
                }
              >
                <p style={{ margin: 0 }}>
                  Panel placed on the <strong>{side}</strong> side.
                </p>
              </Toggletip>
              <span className={s.ann}>{side}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 3: Rich content ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Rich content – lists, links, multiple paragraphs</div>
        <div className={s.row}>
          <div className={s.col}>
            <Toggletip
              trigger={<IconButton icon={<HelpCircle size={14} />} tooltip="How it works" />}
            >
              <p style={{ margin: 0, marginBottom: vars.space['2'], fontWeight: vars.font.medium }}>
                How budget tracking works
              </p>
              <ul style={{ margin: 0, paddingLeft: vars.space['4'] }}>
                <li>Expenses are matched to budget categories</li>
                <li>Spending is tracked against monthly limits</li>
                <li>Alerts fire when you hit 80% of a budget</li>
              </ul>
            </Toggletip>
            <span className={s.ann}>List content</span>
          </div>
          <div className={s.col}>
            <Toggletip
              trigger={
                <IconButton
                  icon={<AlertCircle size={14} />}
                  tooltip="Important note"
                  variant="trueGhostDanger"
                />
              }
              side="right"
            >
              <p
                style={{
                  margin: 0,
                  marginBottom: vars.space['1'],
                  fontWeight: vars.font.medium,
                  color: vars.color.danger400,
                }}
              >
                Irreversible action
              </p>
              <p style={{ margin: 0 }}>
                Deleting this account will remove all associated transactions and cannot be undone.
              </p>
            </Toggletip>
            <span className={s.ann}>Warning content</span>
          </div>
        </div>
      </div>

      {/* ── Section 4: Behavior notes ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Behavior</div>
        <div className={s.note}>
          Toggletips open on click (not hover), close on Escape, click outside, scroll, or resize.
          Content is interactive – links and buttons inside the panel are focusable and clickable.
          The panel auto-flips to the opposite side when it would overflow the viewport.
        </div>
      </div>
    </>
  );
}
