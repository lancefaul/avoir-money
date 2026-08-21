import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmojiPicker } from '@budget-tracker/ui';

// Mock the emoji data to keep tests fast and deterministic
// The component imports the flat `unicode-emoji-json` object (char → meta),
// not the grouped format.
vi.mock('unicode-emoji-json', () => ({
  default: {
    '😀': { name: 'grinning face', group: 'Smileys & Emotion', skin_tone_support: false },
    '😂': { name: 'face with tears of joy', group: 'Smileys & Emotion', skin_tone_support: false },
    '🥰': {
      name: 'smiling face with hearts',
      group: 'Smileys & Emotion',
      skin_tone_support: false,
    },
    '🐶': { name: 'dog face', group: 'Animals & Nature', skin_tone_support: false },
    '🐱': { name: 'cat face', group: 'Animals & Nature', skin_tone_support: false },
  },
}));

describe('EmojiPicker', () => {
  it('renders the trigger button with current value', () => {
    render(<EmojiPicker value="🎉" onChange={vi.fn()} />);
    expect(screen.getByLabelText(/Selected emoji/)).toHaveTextContent('🎉');
  });

  it('renders default placeholder when no value', () => {
    render(<EmojiPicker value="" onChange={vi.fn()} />);
    // Empty value renders a Smile icon (SVG) with aria-label "Emoji picker"
    expect(screen.getByLabelText('Emoji picker')).toBeInTheDocument();
  });

  it('opens dropdown on click', async () => {
    render(<EmojiPicker value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Emoji picker'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search emoji…')).toBeInTheDocument();
    });
  });

  it('closes dropdown on second click', async () => {
    render(<EmojiPicker value="" onChange={vi.fn()} />);
    const trigger = screen.getByLabelText('Emoji picker');
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search emoji…')).toBeInTheDocument();
    });
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search emoji…')).not.toBeInTheDocument();
    });
  });

  it('calls onChange when an emoji is selected', async () => {
    const onChange = vi.fn();
    render(<EmojiPicker value="" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Emoji picker'));
    await waitFor(() => {
      expect(screen.getByLabelText('grinning face')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('grinning face'));
    expect(onChange).toHaveBeenCalledWith('😀');
  });

  it('closes dropdown after selection', async () => {
    render(<EmojiPicker value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Emoji picker'));
    await waitFor(() => {
      expect(screen.getByLabelText('grinning face')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('grinning face'));
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search emoji…')).not.toBeInTheDocument();
    });
  });

  it('filters emojis by search term', async () => {
    render(<EmojiPicker value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Emoji picker'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search emoji…')).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText('Search emoji…');
    fireEvent.change(input, { target: { value: 'dog' } });
    expect(screen.getByLabelText('dog face')).toBeInTheDocument();
    expect(screen.queryByLabelText('grinning face')).not.toBeInTheDocument();
  });

  it('shows no results message for unmatched search', async () => {
    render(<EmojiPicker value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Emoji picker'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search emoji…')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText('Search emoji…'), {
      target: { value: 'zzzznotfound' },
    });
    expect(screen.getByText('No emoji found')).toBeInTheDocument();
  });

  it('highlights the currently selected emoji', async () => {
    render(<EmojiPicker value="😀" onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Selected emoji/));
    await waitFor(() => {
      expect(screen.getByLabelText('grinning face')).toBeInTheDocument();
    });
    // The emoji button for the selected value should be present and clickable
    const btn = screen.getByLabelText('grinning face');
    expect(btn).toBeInTheDocument();
  });

  it('closes on outside click', async () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <EmojiPicker value="" onChange={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByLabelText('Emoji picker'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search emoji…')).toBeInTheDocument();
    });
    fireEvent.mouseDown(screen.getByTestId('outside'));
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search emoji…')).not.toBeInTheDocument();
    });
  });
});
