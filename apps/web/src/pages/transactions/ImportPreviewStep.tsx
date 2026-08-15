import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from './import-modal.css.js';
import type { Row } from './importExportShared.js';

interface ImportPreviewStepProps {
  rows: Row[];
  headers: string[];
  previewRows: Row[];
  /** Header of the column mapped to the transaction date (drives date formatting). */
  dateHeader: string | undefined;
}

/** Preview step of the import flow — extracted verbatim from TransactionImportExport.tsx. */
export default function ImportPreviewStep({
  rows,
  headers,
  previewRows,
  dateHeader,
}: ImportPreviewStepProps) {
  /** Format cell values for display — normalizes dates to MM/DD/YYYY */
  function formatCellValue(header: string, value: string | number | null): string {
    if (value == null) return '';
    const str = String(value);
    // Only attempt date formatting on the column mapped to 'date'
    if (header === dateHeader) {
      // Try parsing as a date string
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${mm}/${dd}/${yyyy}`;
      }
      // Try numeric formats like M/D/YY or M/D/YYYY
      const parts = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
      if (parts) {
        const mm = parts[1]!.padStart(2, '0');
        const dd = parts[2]!.padStart(2, '0');
        const yr = parts[3]!.length === 2 ? `20${parts[3]}` : parts[3]!;
        return `${mm}/${dd}/${yr}`;
      }
    }
    return str;
  }

  return (
    <div className={s.contentFlush}>
      {/* Pinned header */}
      <div className={s.contentHeader}>
        <h2 className={s.sectionHeading}>Preview</h2>
        <p className={s.sectionDescription}>
          Review the data before importing. Showing distinct rows by type, account, and budget.
        </p>
      </div>
      {/* Scrollable table */}
      <div className={s.contentBody}>
        {rows.length > 0 && (
          <table
            style={{
              width: '100%',
              fontSize: vars.font.base,
              tableLayout: 'auto',
              borderCollapse: 'collapse',
            }}
            aria-label="Import preview"
          >
            <thead>
              <tr
                style={{
                  height: '2.5rem',
                  background: vars.color.neutral100,
                  position: 'sticky',
                  top: 0,
                }}
              >
                {headers.map((h, i) => (
                  <th
                    key={h}
                    style={{
                      paddingTop: 0,
                      paddingBottom: 0,
                      paddingLeft: i === 0 ? vars.space['6'] : vars.space['6'],
                      paddingRight: i === headers.length - 1 ? vars.space['6'] : vars.space['6'],
                      textAlign: 'left',
                      fontWeight: vars.font.semibold,
                      fontSize: vars.font.xs,
                      letterSpacing: vars.font.trackingLabel,
                      fontFamily: vars.font.label,
                      textTransform: 'uppercase',
                      color: vars.color.textPrimary,
                      borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => (
                <tr
                  key={headers.map((h) => row[h] ?? '').join('|')}
                  style={{
                    height: '2.5rem',
                    background: vars.color.neutral0,
                    borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
                  }}
                >
                  {headers.map((h, i) => (
                    <td
                      key={h}
                      style={{
                        paddingTop: 0,
                        paddingBottom: 0,
                        paddingLeft: i === 0 ? vars.space['6'] : vars.space['6'],
                        paddingRight: i === headers.length - 1 ? vars.space['6'] : vars.space['6'],
                        color: vars.color.textPrimary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row[h] != null ? formatCellValue(h, row[h]) : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {/* Footer */}
      {rows.length > 0 && (
        <div
          style={{
            flexShrink: 0,
            borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
            background: vars.color.neutral50,
          }}
        >
          <p
            style={{
              padding: `${vars.space['2']} ${vars.space['3']}`,
              fontSize: vars.font.base,
              color: vars.color.textTertiary,
              margin: 0,
            }}
          >
            {previewRows.length < rows.length
              ? `Showing ${previewRows.length} distinct rows of ${rows.length} total`
              : `Showing all ${rows.length} rows`}
          </p>
        </div>
      )}
    </div>
  );
}
