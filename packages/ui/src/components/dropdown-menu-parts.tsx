/**
 * Internal building blocks for sheet mode, in their own module so both
 * DropdownMenuContent and DropdownMenuSub can use them without importing
 * DropdownMenu.tsx (which re-exports them both — that would be a cycle).
 *
 * Nothing here is exported from the package index.
 */
import { useCallback } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import * as dm from './dropdown-menu.css.js';
import { useDropdown } from './dropdown-menu-shared.js';

/** Divider identical to the public DropdownMenuSeparator. */
export function MenuSeparator() {
  return <div role="separator" aria-orientation="horizontal" className={dm.separator} />;
}

/**
 * Closes the whole menu. Appended to every sheet so there is a way out other
 * than tapping the scrim.
 */
export function SheetCancelItem() {
  const { setOpen, triggerRef } = useDropdown();

  const handleClick = useCallback(() => {
    setOpen(false);
    setTimeout(() => triggerRef.current?.focus(), 0);
  }, [setOpen, triggerRef]);

  return (
    <button role="menuitem" type="button" tabIndex={-1} onClick={handleClick} className={dm.item}>
      <span className={dm.itemIcon}>
        <X size={13} />
      </span>
      <span style={{ flex: 1 }}>Cancel</span>
    </button>
  );
}

/** Returns from a drilled-in sub-menu to the sheet's root page. */
export function SheetBackItem({ onBack }: { onBack: () => void }) {
  return (
    <button role="menuitem" type="button" tabIndex={-1} onClick={onBack} className={dm.item}>
      <span className={dm.itemIcon}>
        <ArrowLeft size={13} />
      </span>
      <span style={{ flex: 1 }}>Back</span>
    </button>
  );
}
