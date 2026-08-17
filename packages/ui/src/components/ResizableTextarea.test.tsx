import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResizableTextarea } from './ResizableTextarea.js';

describe('ResizableTextarea', () => {
  it('renders textarea and resize handle with role="separator" and aria-label', () => {
    render(<ResizableTextarea />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    const handle = screen.getByRole('separator');
    expect(handle).toBeInTheDocument();
    expect(handle).toHaveAttribute('aria-label', 'Resize textarea');
  });

  it('typing updates textarea value', async () => {
    const user = userEvent.setup();
    render(<ResizableTextarea />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello world');
    expect(textarea).toHaveValue('Hello world');
  });

  it('custom placeholder is visible', () => {
    render(<ResizableTextarea placeholder="Enter notes here…" />);
    expect(screen.getByPlaceholderText('Enter notes here…')).toBeInTheDocument();
  });

  it('passes rows, disabled, and readOnly through to the textarea element', () => {
    render(<ResizableTextarea rows={5} disabled readOnly />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('rows', '5');
    expect(textarea).toBeDisabled();
    expect(textarea).toHaveAttribute('readonly');
  });

  it('resizable={false} renders a plain textarea with no resize handle', () => {
    render(<ResizableTextarea resizable={false} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });
});
