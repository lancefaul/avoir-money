import { Pencil, Trash2, Filter, Download, RefreshCw, ArrowDown } from 'lucide-react';
import { Tooltip, Badge, buttonStyles as btn } from '@budget-tracker/ui';
import * as s from '../showcase.css.js';

export default function TooltipsPage() {
  return (
    <>
      {/* ── Section 1: Positions ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Positions – hover to preview</div>
        <div className={s.row}>
          <div className={s.col}>
            <Tooltip content="Save changes" side="top">
              <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnSecondary}`}>
                Top
              </button>
            </Tooltip>
            <span className={s.ann}>top (default)</span>
          </div>
          <div className={s.col}>
            <Tooltip content="Save changes" side="bottom">
              <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnSecondary}`}>
                Bottom
              </button>
            </Tooltip>
            <span className={s.ann}>bottom</span>
          </div>
          <div className={s.col}>
            <Tooltip content="Save changes" side="left">
              <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnSecondary}`}>
                Left
              </button>
            </Tooltip>
            <span className={s.ann}>left</span>
          </div>
          <div className={s.col}>
            <Tooltip content="Save changes" side="right">
              <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnSecondary}`}>
                Right
              </button>
            </Tooltip>
            <span className={s.ann}>right</span>
          </div>
        </div>
      </div>

      {/* ── Section 2: On icon buttons ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>On icon buttons</div>
        <div className={s.row}>
          <div className={s.col}>
            <Tooltip content="Edit transaction">
              <button
                type="button"
                className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnTrueGhost}`}
              >
                <Pencil size={14} />
              </button>
            </Tooltip>
            <span className={s.ann}>Pencil</span>
          </div>
          <div className={s.col}>
            <Tooltip content="Delete">
              <button
                type="button"
                className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnTrueGhost}`}
              >
                <Trash2 size={14} />
              </button>
            </Tooltip>
            <span className={s.ann}>Trash2</span>
          </div>
          <div className={s.col}>
            <Tooltip content="Filter transactions">
              <button
                type="button"
                className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnTrueGhost}`}
              >
                <Filter size={14} />
              </button>
            </Tooltip>
            <span className={s.ann}>Filter</span>
          </div>
          <div className={s.col}>
            <Tooltip content="Download statement">
              <button
                type="button"
                className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnTrueGhost}`}
              >
                <Download size={14} />
              </button>
            </Tooltip>
            <span className={s.ann}>Download</span>
          </div>
          <div className={s.col}>
            <Tooltip content="Sync account">
              <button
                type="button"
                className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnTrueGhost}`}
              >
                <RefreshCw size={14} />
              </button>
            </Tooltip>
            <span className={s.ann}>RefreshCw</span>
          </div>
        </div>
      </div>

      {/* ── Section 3: Focusable non-interactive triggers ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Focusable non-interactive triggers</div>
        <div className={s.note}>
          When the trigger is not itself focusable (an icon-only badge, a plain span), pass the
          &quot;focusable&quot; prop so keyboard users can Tab to it and summon the tooltip. Leave
          it off for buttons and links — they already take focus.
        </div>
        <div className={s.row}>
          <div className={s.col}>
            <Tooltip content="Bought BTC on Cash Wallet" focusable>
              <Badge variant="positive" size="xl" iconOnly aria-label="Buy">
                <ArrowDown size={14} />
              </Badge>
            </Tooltip>
            <span className={s.ann}>focusable + aria-label — Tab to it</span>
          </div>
        </div>
      </div>

      {/* ── Section 4: Long content & wrapping ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Long content &amp; wrapping</div>
        <div className={s.row}>
          <Tooltip content="Delete permanently – this cannot be undone" side="top">
            <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnDanger}`}>
              Delete
            </button>
          </Tooltip>
          <Tooltip content="Vanguard Total Stock Market Index Fund Admiral Shares" side="top">
            <span
              tabIndex={0}
              style={{
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                width: '7.5rem',
                cursor: 'default',
                display: 'inline-block',
              }}
            >
              Vanguard Total Stock Market…
            </span>
          </Tooltip>
        </div>
      </div>

      {/* ── Section 5: Screen edge detection ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Screen edge detection</div>
        <div className={s.note}>
          Tooltips automatically flip to the opposite side when they would overflow the viewport.
          Try hovering the buttons near the edges of the page.
        </div>
      </div>
    </>
  );
}
