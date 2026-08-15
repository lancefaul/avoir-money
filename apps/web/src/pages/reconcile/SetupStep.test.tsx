/**
 * Step 1 holds a choice; it does not act on it.
 *
 * Picking a file used to import it immediately, which announced work the user
 * had not asked for and left a half-built session behind if they changed their
 * mind. Nothing here reaches the server — Analyze does all of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SetupStep from './SetupStep.js';

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const csv = () => new File(['a,b\n1,2'], 'chase-july.csv', { type: 'text/csv' });

function renderStep(file: File | null = null) {
  const onFileChange = vi.fn();
  const onStatementEndingBalanceChange = vi.fn();
  const onCutoffDateChange = vi.fn();
  render(
    <SetupStep
      file={file}
      onFileChange={onFileChange}
      statementEndingBalance={0}
      onStatementEndingBalanceChange={onStatementEndingBalanceChange}
      cutoffDate="2026-07-21"
      onCutoffDateChange={onCutoffDateChange}
    />,
  );
  return { onFileChange, onStatementEndingBalanceChange, onCutoffDateChange };
}

describe('choosing a statement', () => {
  it('offers the drop zone when nothing is chosen', () => {
    renderStep(null);
    expect(screen.getByText('Choose a statement export')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /remove file/i })).toBeNull();
  });

  it('reports the chosen file rather than swapping helper text', () => {
    renderStep(csv());
    expect(screen.getByText('chase-july.csv')).toBeTruthy();
    // The drop zone is replaced by the card, not annotated.
    expect(screen.queryByText('Choose a statement export')).toBeNull();
  });

  it('can remove the chosen file', async () => {
    const user = userEvent.setup();
    const { onFileChange } = renderStep(csv());
    await user.click(screen.getByRole('button', { name: /remove file/i }));
    expect(onFileChange).toHaveBeenCalledWith(null);
  });

  it('reports a newly picked file without reading it', async () => {
    const user = userEvent.setup();
    const { onFileChange } = renderStep(null);
    const input = document.getElementById('statement-file') as HTMLInputElement;

    await user.upload(input, csv());

    expect(onFileChange).toHaveBeenCalledTimes(1);
    expect((onFileChange.mock.calls[0]![0] as File).name).toBe('chase-july.csv');
  });
});

describe('what step 1 deliberately does not show', () => {
  it('never shows a detected period', () => {
    // The period is a result of parsing, which has not happened yet. Showing it
    // here means showing nothing or showing a stale value from a previous run.
    renderStep(csv());
    expect(screen.queryByText(/period detected/i)).toBeNull();
  });

  it('never claims rows were imported', () => {
    renderStep(csv());
    expect(screen.queryByText(/imported/i)).toBeNull();
  });
});

describe('the anchor', () => {
  it('accepts a negative balance', () => {
    render(
      <SetupStep
        file={null}
        onFileChange={vi.fn()}
        statementEndingBalance={-1650.77}
        onStatementEndingBalanceChange={vi.fn()}
        cutoffDate="2026-07-21"
        onCutoffDateChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/ending balance/i)).toHaveValue('-1,650.77');
  });
});
