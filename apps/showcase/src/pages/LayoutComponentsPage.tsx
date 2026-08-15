import { useState } from 'react';
import * as s from '../showcase.css.js';
import {
  SectionHeading,
  DisplayHeading,
  TypeToConfirmInput,
  ActionBar,
  buttonStyles,
  inputStyles,
} from '@budget-tracker/ui';

export default function LayoutComponentsPage() {
  const [confirmValue, setConfirmValue] = useState('');

  return (
    <>
      {/* ── DisplayHeading ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>DisplayHeading</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <DisplayHeading size="lg" as="h2">
            Large (4xl) — Portfolio Overview
          </DisplayHeading>
          <DisplayHeading size="md" as="h3">
            Medium (3xl) — Transaction History
          </DisplayHeading>
          <DisplayHeading size="sm" as="h4">
            Small (2xl) — Data Backups
          </DisplayHeading>
        </div>
        <span className={s.ann}>
          Display font heading with 3 sizes. Used for page section titles, tab panel headings, and
          settings panel headers.
        </span>
      </div>

      {/* ── SectionHeading ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>SectionHeading</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '25rem' }}>
          <SectionHeading>Transaction Information</SectionHeading>
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Name</label>
            <input
              type="text"
              className={inputStyles.input}
              placeholder="e.g. Mortgage Payment"
              readOnly
            />
          </div>
          <SectionHeading>Payment Information</SectionHeading>
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Account</label>
            <input
              type="text"
              className={inputStyles.input}
              placeholder="Select account…"
              readOnly
            />
          </div>
          <SectionHeading>Extra Information</SectionHeading>
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Note</label>
            <input
              type="text"
              className={inputStyles.input}
              placeholder="Optional note…"
              readOnly
            />
          </div>
        </div>
        <span className={s.ann}>
          Uppercase section divider used inside form drawers to separate field groups. Renders as xs
          text with border-bottom.
        </span>
      </div>

      {/* ── TypeToConfirmInput ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>TypeToConfirmInput</div>
        <div style={{ maxWidth: '20rem' }}>
          <TypeToConfirmInput
            confirmWord="DELETE"
            value={confirmValue}
            onChange={setConfirmValue}
          />
        </div>
        <span className={s.ann}>
          Used in destructive confirmation modals. The confirm button should be disabled until value
          === confirmWord. Currently typed: &ldquo;{confirmValue}&rdquo; — matches:{' '}
          {confirmValue === 'DELETE' ? 'yes' : 'no'}.
        </span>
      </div>

      {/* ── ActionBar ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>ActionBar</div>
        <div
          style={{
            border: '1px dashed var(--color-border)',
            borderRadius: '0.5rem',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--color-text-tertiary)',
              fontSize: '0.8125rem',
            }}
          >
            Panel content above the action bar
          </div>
          <ActionBar>
            <button
              type="button"
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              Backup Now
            </button>
            <button
              type="button"
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              Restore
            </button>
          </ActionBar>
        </div>
        <span className={s.ann}>
          Bottom-pinned toolbar with border-top separator. Used at the bottom of settings tabs,
          modal panels, and list views for primary actions.
        </span>
      </div>
    </>
  );
}
