import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton } from './IconButton.js';

const icon = <span data-testid="icon">X</span>;

describe('IconButton', () => {
  it('renders with icon and aria-label matching tooltip', () => {
    render(<IconButton icon={icon} tooltip="Delete item" />);
    const button = screen.getByRole('button', { name: 'Delete item' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', 'Delete item');
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it.each(['sm', 'md', 'lg'] as const)('renders size="%s" without errors', (size) => {
    render(<IconButton icon={icon} tooltip="Action" size={size} />);
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
  });

  it.each([
    'primary',
    'secondary',
    'trueGhost',
    'danger',
    'trueGhostDanger',
    'trueGhostBrand',
  ] as const)('renders variant="%s" without errors', (variant) => {
    render(<IconButton icon={icon} tooltip="Action" variant={variant} />);
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
  });

  it('disabled={true} sets disabled attribute and blocks onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton icon={icon} tooltip="Delete" disabled onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
