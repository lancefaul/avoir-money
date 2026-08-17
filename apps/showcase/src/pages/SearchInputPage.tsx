import { useState } from 'react';
import * as s from '../showcase.css.js';
import { SearchInput, IconButton } from '@budget-tracker/ui';
import { SlidersHorizontal } from 'lucide-react';

export default function SearchInputPage() {
  const [basic, setBasic] = useState('');
  const [withActions, setWithActions] = useState('transactions');
  const [disabled, setDisabled] = useState('can not edit');
  const [custom, setCustom] = useState('');

  return (
    <>
      <div className={s.section}>
        <div className={s.sectionLabel}>Basic</div>
        <div style={{ maxWidth: '25rem' }}>
          <SearchInput value={basic} onChange={setBasic} />
        </div>
        <span className={s.ann}>
          Auto-generates id and name attributes. Clear button appears when value is non-empty.
        </span>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>With actions slot</div>
        <div style={{ maxWidth: '25rem' }}>
          <SearchInput
            value={withActions}
            onChange={setWithActions}
            aria-label="Search transactions"
            actions={
              <IconButton icon={<SlidersHorizontal size={14} />} tooltip="Filters" size="sm" />
            }
          />
        </div>
        <span className={s.ann}>
          Pass additional buttons (filter menus, sort toggles) via the actions prop.
        </span>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Custom placeholder</div>
        <div style={{ maxWidth: '25rem' }}>
          <SearchInput
            value={custom}
            onChange={setCustom}
            placeholder="Search descriptions…"
            aria-label="Search descriptions"
          />
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Disabled</div>
        <div style={{ maxWidth: '25rem' }}>
          <SearchInput value={disabled} onChange={setDisabled} disabled />
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Full width with max constraint</div>
        <SearchInput
          value={basic}
          onChange={setBasic}
          style={{ maxWidth: '40rem', width: '100%' }}
          aria-label="Full width search"
        />
      </div>
    </>
  );
}
