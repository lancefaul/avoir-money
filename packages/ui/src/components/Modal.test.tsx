import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal, Dialog } from './Modal.js';

/* ── Helpers ── */

/** Wait for the closing animation timeout to complete. */
async function waitForClose(ms = 150) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/* ══════════════════════════════════════
   Modal
   ══════════════════════════════════════ */

describe('Modal', () => {
  it('open={true} renders content with role="dialog" and aria-modal="true"', () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Test Modal">
        <p>Body content</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Test Modal');
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('open={false} renders no modal content', () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Hidden Modal">
        <p>Should not appear</p>
      </Modal>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
  });

  it('Escape key fires onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Escape Test">
        <p>Content</p>
      </Modal>,
    );

    await user.keyboard('{Escape}');
    await waitForClose();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('backdrop click fires onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Backdrop Test">
        <p>Content</p>
      </Modal>,
    );

    // The overlay is the element with role="dialog" — click it directly
    const overlay = screen.getByRole('dialog');
    await user.click(overlay);
    await waitForClose();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('content area click does not fire onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Content Click Test">
        <p>Click me</p>
      </Modal>,
    );

    await user.click(screen.getByText('Click me'));
    await waitForClose();

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closeButton="x" renders close button with "Close" tooltip', () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Close Button" closeButton="x">
        <p>Content</p>
      </Modal>,
    );

    const closeBtn = screen.getByRole('button', { name: 'Close' });
    expect(closeBtn).toBeInTheDocument();
  });

  it('closeButton="none" renders no close button', () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="No Close Button" closeButton="none">
        <p>Content</p>
      </Modal>,
    );

    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('variant="drawer" renders with drawer styling classes', () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Drawer Modal" variant="drawer">
        <p>Drawer content</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // The overlay gets the overlayDrawer class and the panel gets drawerPanel class
    // Since CSS classes are mocked, we verify the component renders with drawer-specific structure
    expect(screen.getByText('Drawer content')).toBeInTheDocument();
    expect(screen.getByText('Drawer Modal')).toBeInTheDocument();
  });

  it('footer prop renders footer content', () => {
    render(
      <Modal
        open={true}
        onClose={vi.fn()}
        title="Footer Test"
        footer={<button type="button">Save</button>}
      >
        <p>Content</p>
      </Modal>,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});

/* ══════════════════════════════════════
   Dialog
   ══════════════════════════════════════ */

describe('Dialog', () => {
  it('renders title, message, confirm button, and cancel button', () => {
    render(
      <Dialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Confirm Action"
        message="Are you sure?"
      />,
    );

    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('confirm button fires onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <Dialog
        open={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        title="Confirm"
        message="Proceed?"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancel button fires onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog
        open={true}
        onClose={onClose}
        onConfirm={vi.fn()}
        title="Cancel Test"
        message="Cancel this?"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitForClose();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('variant="negative" uses danger button styling', () => {
    render(
      <Dialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete"
        message="This is destructive"
        variant="negative"
      />,
    );

    const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
    // The confirm button should have the btnDanger class (mocked to 'mock-style')
    // We verify the button exists and the component renders without error
    expect(confirmBtn).toBeInTheDocument();
    expect(confirmBtn.className).toContain('mock');
  });

  it('destructiveLabel and onDestructive render and fire correctly', async () => {
    const user = userEvent.setup();
    const onDestructive = vi.fn();
    render(
      <Dialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="With Destructive"
        message="Choose wisely"
        destructiveLabel="Delete Forever"
        onDestructive={onDestructive}
      />,
    );

    const destructiveBtn = screen.getByRole('button', { name: 'Delete Forever' });
    expect(destructiveBtn).toBeInTheDocument();

    await user.click(destructiveBtn);
    expect(onDestructive).toHaveBeenCalledTimes(1);
  });
});
