import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InfoLink } from './InfoLink.js';

describe('InfoLink', () => {
  it('renders text and shows tooltip on hover', async () => {
    const user = userEvent.setup();
    render(<InfoLink tooltip="Additional info">Learn more</InfoLink>);

    // Text is visible
    expect(screen.getByText('Learn more')).toBeInTheDocument();

    // Hover shows tooltip
    await user.hover(screen.getByText('Learn more'));
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('Additional info');
  });
});
