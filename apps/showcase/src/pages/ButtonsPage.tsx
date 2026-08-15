import { useState } from 'react';
import { Plus, Pencil, MoreHorizontal, Filter, Search, Trash2, Copy } from 'lucide-react';
import { Tooltip, ButtonGroup, buttonStyles as btn } from '@budget-tracker/ui';
import * as s from '../showcase.css.js';

import { DemoButton, DemoIconButton, InstantIconButton } from './buttonDemos.js';

export default function ButtonsPage() {
  const [bgUnit, setBgUnit] = useState('BTC');
  const [bgPeriod, setBgPeriod] = useState('Monthly');
  const [bgRange, setBgRange] = useState('Month');

  return (
    <>
      {/* ── Section 1: Variants ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Variants</div>
        <div className={s.row}>
          <div className={s.col}>
            <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnPrimary}`}>
              <Plus size={14} /> Add holding
            </button>
            <span className={s.ann}>Primary</span>
          </div>

          <div className={s.col}>
            <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnSecondary}`}>
              Edit
            </button>
            <span className={s.ann}>Secondary</span>
          </div>

          <div className={s.col}>
            <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnTrueGhost}`}>
              Cancel
            </button>
            <span className={s.ann}>True ghost</span>
          </div>

          <div className={s.col}>
            <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnDanger}`}>
              Delete
            </button>
            <span className={s.ann}>Danger</span>
          </div>

          <div className={s.col}>
            <button
              type="button"
              className={`${btn.btnBase} ${btn.btnMd} ${btn.btnTrueGhostDanger}`}
            >
              Remove
            </button>
            <span className={s.ann}>True ghost danger</span>
          </div>
        </div>
      </div>

      {/* ── Section 2: Sizes ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Sizes</div>
        <div className={s.row}>
          <div className={s.col}>
            <button type="button" className={`${btn.btnBase} ${btn.btnSm} ${btn.btnPrimary}`}>
              <Plus size={12} /> Add holding
            </button>
            <span className={s.ann}>sm · 30px</span>
          </div>

          <div className={s.col}>
            <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnPrimary}`}>
              <Plus size={14} /> Add holding
            </button>
            <span className={s.ann}>md · 36px</span>
          </div>

          <div className={s.col}>
            <button type="button" className={`${btn.btnBase} ${btn.btnLg} ${btn.btnPrimary}`}>
              <Plus size={16} /> Add holding
            </button>
            <span className={s.ann}>lg · 42px</span>
          </div>
        </div>
      </div>

      {/* ── Section 3: Square icon buttons ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Square icon buttons</div>
        <div className={s.row}>
          <div className={s.col}>
            <Tooltip content="Add">
              <button type="button" className={`${btn.btnBase} ${btn.btnIconSm} ${btn.btnPrimary}`}>
                <Plus size={12} />
              </button>
            </Tooltip>
            <span className={s.ann}>Primary sm</span>
          </div>

          <div className={s.col}>
            <Tooltip content="Add">
              <button type="button" className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnPrimary}`}>
                <Plus size={14} />
              </button>
            </Tooltip>
            <span className={s.ann}>Primary md</span>
          </div>

          <div className={s.col}>
            <Tooltip content="Add">
              <button type="button" className={`${btn.btnBase} ${btn.btnIconLg} ${btn.btnPrimary}`}>
                <Plus size={16} />
              </button>
            </Tooltip>
            <span className={s.ann}>Primary lg</span>
          </div>

          <div className={s.col}>
            <Tooltip content="Edit">
              <button
                type="button"
                className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnSecondary}`}
              >
                <Pencil size={14} />
              </button>
            </Tooltip>
            <span className={s.ann}>Secondary md</span>
          </div>

          <div className={s.col}>
            <Tooltip content="More options">
              <button
                type="button"
                className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnTrueGhost}`}
              >
                <MoreHorizontal size={14} />
              </button>
            </Tooltip>
            <span className={s.ann}>Ghost · more</span>
          </div>

          <div className={s.col}>
            <Tooltip content="Filter">
              <button
                type="button"
                className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnTrueGhost}`}
              >
                <Filter size={14} />
              </button>
            </Tooltip>
            <span className={s.ann}>Ghost · filter</span>
          </div>

          <div className={s.col}>
            <Tooltip content="Search">
              <button
                type="button"
                className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnTrueGhost}`}
              >
                <Search size={14} />
              </button>
            </Tooltip>
            <span className={s.ann}>Ghost · search</span>
          </div>

          <div className={s.col}>
            <Tooltip content="Delete">
              <button
                type="button"
                className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnTrueGhostDanger}`}
              >
                <Trash2 size={14} />
              </button>
            </Tooltip>
            <span className={s.ann}>Ghost danger</span>
          </div>
        </div>
      </div>

      {/* ── Section 4: Interactive states ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Interactive states – click to demo</div>
        <div className={s.row}>
          <div className={s.col}>
            <DemoButton variant={btn.btnPrimary} size={btn.btnMd} outcome="success">
              <Plus size={14} /> Save
            </DemoButton>
            <span className={s.ann}>Primary → success</span>
          </div>

          <div className={s.col}>
            <DemoButton variant={btn.btnPrimary} size={btn.btnMd} outcome="failure">
              <Plus size={14} /> Save
            </DemoButton>
            <span className={s.ann}>Primary → failure</span>
          </div>

          <div className={s.col}>
            <DemoButton variant={btn.btnSecondary} size={btn.btnMd} outcome="success">
              Edit
            </DemoButton>
            <span className={s.ann}>Secondary → success</span>
          </div>

          <div className={s.col}>
            <DemoButton variant={btn.btnDanger} size={btn.btnMd} outcome="success">
              Delete
            </DemoButton>
            <span className={s.ann}>Danger → success</span>
          </div>

          <div className={s.col}>
            <DemoButton variant={btn.btnDanger} size={btn.btnMd} outcome="failure">
              Delete
            </DemoButton>
            <span className={s.ann}>Danger → failure</span>
          </div>

          <div className={s.col}>
            <DemoButton variant={btn.btnTrueGhost} size={btn.btnMd} outcome="success">
              Cancel
            </DemoButton>
            <span className={s.ann}>Ghost → success</span>
          </div>

          <div className={s.col}>
            <DemoButton variant={btn.btnTrueGhostDanger} size={btn.btnMd} outcome="success">
              Remove
            </DemoButton>
            <span className={s.ann}>Ghost danger → success</span>
          </div>
        </div>
      </div>

      {/* ── Section 5: Icon button states ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Icon button states – click to demo</div>
        <div className={s.row}>
          <div className={s.col}>
            <Tooltip content="Add">
              <DemoIconButton
                variant={btn.btnPrimary}
                size={btn.btnIconMd}
                outcome="success"
                icon={Plus}
              />
            </Tooltip>
            <span className={s.ann}>Add → success</span>
          </div>

          <div className={s.col}>
            <Tooltip content="Add">
              <DemoIconButton
                variant={btn.btnPrimary}
                size={btn.btnIconMd}
                outcome="failure"
                icon={Plus}
              />
            </Tooltip>
            <span className={s.ann}>Add → failure</span>
          </div>

          <div className={s.col}>
            <Tooltip content="Delete">
              <DemoIconButton
                variant={btn.btnTrueGhostDanger}
                size={btn.btnIconMd}
                outcome="success"
                icon={Trash2}
              />
            </Tooltip>
            <span className={s.ann}>Delete → success</span>
          </div>

          <div className={s.col}>
            <Tooltip content="Edit">
              <DemoIconButton
                variant={btn.btnSecondary}
                size={btn.btnIconMd}
                outcome="success"
                icon={Pencil}
              />
            </Tooltip>
            <span className={s.ann}>Edit → success</span>
          </div>

          <div className={s.col}>
            <Tooltip content="Filter">
              <DemoIconButton
                variant={btn.btnTrueGhost}
                size={btn.btnIconMd}
                outcome="success"
                icon={Filter}
              />
            </Tooltip>
            <span className={s.ann}>Filter → success</span>
          </div>

          <div className={s.col}>
            <Tooltip content="Delete">
              <DemoIconButton
                variant={btn.btnDanger}
                size={btn.btnIconMd}
                outcome="success"
                icon={Trash2}
              />
            </Tooltip>
            <span className={s.ann}>Danger → success</span>
          </div>

          <div className={s.col}>
            <Tooltip content="Copy">
              <InstantIconButton
                variant={btn.btnTrueGhost}
                size={btn.btnIconMd}
                outcome="success"
                icon={Copy}
              />
            </Tooltip>
            <span className={s.ann}>Copy → instant ✓</span>
          </div>

          <div className={s.col}>
            <Tooltip content="Copy">
              <InstantIconButton
                variant={btn.btnTrueGhost}
                size={btn.btnIconMd}
                outcome="failure"
                icon={Copy}
              />
            </Tooltip>
            <span className={s.ann}>Copy → instant ✗</span>
          </div>
        </div>
      </div>

      {/* ── Section 6: Disabled ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Disabled</div>
        <div className={s.row}>
          <div className={s.col}>
            <button
              type="button"
              disabled
              className={`${btn.btnBase} ${btn.btnMd} ${btn.btnPrimary}`}
            >
              <Plus size={14} /> Add holding
            </button>
            <span className={s.ann}>Disabled primary</span>
          </div>
          <div className={s.col}>
            <button
              type="button"
              disabled
              className={`${btn.btnBase} ${btn.btnMd} ${btn.btnSecondary}`}
            >
              Edit
            </button>
            <span className={s.ann}>Disabled secondary</span>
          </div>
          <div className={s.col}>
            <button
              type="button"
              disabled
              className={`${btn.btnBase} ${btn.btnMd} ${btn.btnTrueGhost}`}
            >
              Cancel
            </button>
            <span className={s.ann}>Disabled ghost</span>
          </div>
          <div className={s.col}>
            <button
              type="button"
              disabled
              className={`${btn.btnBase} ${btn.btnMd} ${btn.btnDanger}`}
            >
              Delete
            </button>
            <span className={s.ann}>Disabled danger</span>
          </div>
          <div className={s.col}>
            <button
              type="button"
              disabled
              className={`${btn.btnBase} ${btn.btnMd} ${btn.btnTrueGhostDanger}`}
            >
              Remove
            </button>
            <span className={s.ann}>Disabled ghost danger</span>
          </div>
        </div>
      </div>
      {/* ── Section 7: Button group – segmented control ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Button group – segmented control</div>
        <div className={s.row}>
          <div className={s.col}>
            <ButtonGroup
              size="sm"
              options={[
                { value: 'BTC', label: 'BTC' },
                { value: 'sats', label: 'sats' },
              ]}
              value={bgUnit}
              onChange={setBgUnit}
              ariaLabel="Bitcoin unit"
            />
            <span className={s.ann}>sm · BTC / sats</span>
          </div>

          <div className={s.col}>
            <ButtonGroup
              size="md"
              options={[
                { value: 'Monthly', label: 'Monthly' },
                { value: 'Yearly', label: 'Yearly' },
              ]}
              value={bgPeriod}
              onChange={setBgPeriod}
              ariaLabel="Billing period"
            />
            <span className={s.ann}>md · Monthly / Yearly</span>
          </div>

          <div className={s.col}>
            <ButtonGroup
              size="md"
              options={[
                { value: 'Day', label: 'Day' },
                { value: 'Week', label: 'Week' },
                { value: 'Month', label: 'Month' },
              ]}
              value={bgRange}
              onChange={setBgRange}
              ariaLabel="Date range"
            />
            <span className={s.ann}>md · Day / Week / Month</span>
          </div>
        </div>
      </div>
    </>
  );
}
