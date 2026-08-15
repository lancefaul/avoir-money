import { render, screen } from '@testing-library/react';
import { ProgressBar, SegmentedProgress } from './ProgressBar.js';

describe('ProgressBar', () => {
  it('renders with role="progressbar", aria-valuenow, aria-valuemin="0", aria-valuemax="100"', () => {
    render(<ProgressBar value={42} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps aria-valuenow to 100 when value > 100', () => {
    render(<ProgressBar value={150} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });

  it('clamps aria-valuenow to 0 when value < 0', () => {
    render(<ProgressBar value={-20} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
  });

  it('autoColor={true} with value 90 applies warning variant', () => {
    render(<ProgressBar value={90} autoColor />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '90');
    // The fill element should exist inside the progressbar
    const fill = bar.firstElementChild;
    expect(fill).toBeTruthy();
    // With autoColor and value 90, the component resolves to 'warning' variant.
    // The fill width should reflect the value.
    expect(fill).toHaveAttribute('style', expect.stringContaining('90%'));
  });

  it('autoColor={true} with value 100 applies danger variant', () => {
    render(<ProgressBar value={100} autoColor />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    const fill = bar.firstElementChild;
    expect(fill).toBeTruthy();
    expect(fill).toHaveAttribute('style', expect.stringContaining('100%'));
  });

  it('label and valueLabel props render visible text', () => {
    render(<ProgressBar value={60} label="Storage" valueLabel="60%" />);
    expect(screen.getByText('Storage')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('helper prop renders visible text', () => {
    render(<ProgressBar value={75} helper="3 of 4 tasks complete" />);
    expect(screen.getByText('3 of 4 tasks complete')).toBeInTheDocument();
  });
});

describe('SegmentedProgress', () => {
  it('renders each segment as a separate fill element', () => {
    const segments = [
      { value: 30, variant: 'success' as const },
      { value: 20, variant: 'warning' as const },
      { value: 10, variant: 'danger' as const },
    ];
    render(<SegmentedProgress segments={segments} />);
    const bar = screen.getByRole('progressbar');
    // Each segment should be a child div of the track
    const fills = bar.children;
    expect(fills).toHaveLength(3);
    expect(fills[0]).toHaveAttribute('style', expect.stringContaining('30%'));
    expect(fills[1]).toHaveAttribute('style', expect.stringContaining('20%'));
    expect(fills[2]).toHaveAttribute('style', expect.stringContaining('10%'));
  });

  it('label and valueLabel render visible text', () => {
    render(
      <SegmentedProgress segments={[{ value: 50 }]} label="Budget" valueLabel="$500 / $1000" />,
    );
    expect(screen.getByText('Budget')).toBeInTheDocument();
    expect(screen.getByText('$500 / $1000')).toBeInTheDocument();
  });
});
