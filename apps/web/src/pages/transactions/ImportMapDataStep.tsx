import { useId } from 'react';
import { Select, inputStyles } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import type { SelectOption } from '@budget-tracker/ui';
import * as s from './import-modal.css.js';
import { FIELDS, FIELD_LABELS } from './importExportShared.js';

interface ImportMapDataStepProps {
  mapping: Record<string, string>;
  onMappingChange: (field: string, value: string) => void;
  headerOptions: SelectOption[];
  accountOptions: SelectOption[];
  budgetOptions: SelectOption[];
  typeOptions: SelectOption[];
  defaultAccountId: string;
  setDefaultAccountId: (v: string) => void;
  defaultBudgetId: string;
  setDefaultCategoryId: (v: string) => void;
  defaultType: 'EXPENSE' | 'INCOME' | '';
  setDefaultType: (v: 'EXPENSE' | 'INCOME' | '') => void;
  stackFields: boolean;
  rows: unknown[];
}

/** Map Data step of the import flow — extracted verbatim from TransactionImportExport.tsx. */
export default function ImportMapDataStep({
  mapping,
  onMappingChange,
  headerOptions,
  accountOptions,
  budgetOptions,
  typeOptions,
  defaultAccountId,
  setDefaultAccountId,
  defaultBudgetId,
  setDefaultCategoryId,
  defaultType,
  setDefaultType,
  stackFields,
  rows,
}: ImportMapDataStepProps) {
  const fid = useId();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['5'] }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['2'] }}>
        <h2 className={s.sectionHeading}>Defaults</h2>
        <p className={s.sectionDescription}>
          Fallback values when the file doesn't specify a field.
        </p>
      </div>

      {rows.length > 0 ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: stackFields ? '1fr' : '1fr 1fr 1fr',
              gap: vars.space['3'],
            }}
          >
            <div className={inputStyles.field}>
              <label className={inputStyles.fieldLabel}>Default Account</label>
              <Select
                id={`${fid}-default-account`}
                options={accountOptions}
                value={defaultAccountId}
                onChange={(v) => setDefaultAccountId(Array.isArray(v) ? (v[0] ?? '') : (v ?? ''))}
                placeholder="None"
              />
            </div>
            <div className={inputStyles.field}>
              <label className={inputStyles.fieldLabel}>Default Budget</label>
              <Select
                id={`${fid}-default-budget`}
                options={budgetOptions}
                value={defaultBudgetId}
                onChange={(v) => setDefaultCategoryId(Array.isArray(v) ? (v[0] ?? '') : (v ?? ''))}
                placeholder="Select…"
              />
            </div>
            <div className={inputStyles.field}>
              <label className={inputStyles.fieldLabel}>Default Type</label>
              <Select
                id={`${fid}-default-type`}
                options={typeOptions}
                value={defaultType}
                onChange={(v) =>
                  setDefaultType(
                    (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')) as 'EXPENSE' | 'INCOME' | '',
                  )
                }
                placeholder="None"
              />
            </div>
          </div>

          <div
            style={{
              borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
              marginTop: vars.space['3'],
              paddingTop: vars.space['5'],
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['2'] }}>
              <h2 className={s.sectionHeading}>Column Mapping</h2>
              <p className={s.sectionDescription}>
                Map your file columns to transaction fields. Name, Amount, and Date are required.
              </p>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: stackFields ? '1fr' : '1fr 1fr',
              gap: vars.space['3'],
            }}
          >
            {FIELDS.map((f) => (
              <div key={f} className={inputStyles.field}>
                <label className={inputStyles.fieldLabel}>
                  {FIELD_LABELS[f]}{' '}
                  {(f === 'name' || f === 'amount' || f === 'date') && (
                    <span className={inputStyles.fieldRequired}>*</span>
                  )}
                </label>
                <Select
                  id={`${fid}-field-${f}`}
                  options={headerOptions}
                  value={mapping[f] ?? ''}
                  onChange={(v) => onMappingChange(f, Array.isArray(v) ? (v[0] ?? '') : (v ?? ''))}
                  placeholder="– skip –"
                />
              </div>
            ))}
          </div>
        </>
      ) : (
        <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary, margin: 0 }}>
          No file loaded. Close this window and select a file to import.
        </p>
      )}
    </div>
  );
}
