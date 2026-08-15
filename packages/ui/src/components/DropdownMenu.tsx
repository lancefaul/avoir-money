import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useId,
  useMemo,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from 'react';
import { Check, MoreVertical } from 'lucide-react';
import * as dm from './dropdown-menu.css.js';
import { Ctx, useDropdown } from './dropdown-menu-shared.js';

// Sub-menu compound components live in their own module; re-exported here so the
// package index (and consumers) keep a single import surface.
export {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from './DropdownMenuSub.js';
export { DropdownMenuContent } from './DropdownMenuContent.js';

/* ─── Root ─── */

interface DropdownMenuProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/* ─── Global registry: close other open menus when one opens ─── */

const openMenuClosers = new Set<() => void>();

export function DropdownMenu({ children, open: controlledOpen, onOpenChange }: DropdownMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [focusLast, setFocusLast] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = useCallback(
    (v: boolean) => {
      if (v) {
        // Close all other open menus before opening this one
        openMenuClosers.forEach((fn) => fn());
        openMenuClosers.clear();
      }
      if (!isControlled) setInternalOpen(v);
      onOpenChange?.(v);
    },
    [isControlled, onOpenChange],
  );

  // Register this menu's closer when open
  useEffect(() => {
    if (!open) return;
    const closer = () => setOpen(false);
    openMenuClosers.add(closer);
    return () => {
      openMenuClosers.delete(closer);
    };
  }, [open, setOpen]);

  const ctxValue = useMemo(
    () => ({
      open,
      setOpen,
      triggerId: `dm-trigger-${id}`,
      menuId: `dm-menu-${id}`,
      triggerRef,
      focusLast,
      setFocusLast,
    }),
    [open, setOpen, id, focusLast, setFocusLast],
  );

  return <Ctx.Provider value={ctxValue}>{children}</Ctx.Provider>;
}

/* ─── Trigger ─── */

interface DropdownMenuTriggerProps {
  children?: ReactNode;
  asChild?: boolean;
}

export function DropdownMenuTrigger({ children, asChild }: DropdownMenuTriggerProps) {
  const { open, setOpen, triggerId, menuId, triggerRef, setFocusLast } = useDropdown();

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusLast(false);
        setOpen(true);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusLast(true);
        setOpen(true);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setFocusLast(false);
        setOpen(!open);
      }
    },
    [open, setOpen, setFocusLast],
  );

  const sharedProps = {
    id: triggerId,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => {
      setFocusLast(false);
      setOpen(!open);
    },
    onKeyDown: handleKeyDown,
  };

  if (asChild && isValidElement(children)) {
    return cloneElement(children as ReactElement<Record<string, unknown>>, {
      ...sharedProps,
      ref: triggerRef,
    });
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      aria-label="More options"
      className={`${dm.trigger} ${open ? dm.triggerOpen : ''}`}
      {...sharedProps}
    >
      {children ?? <MoreVertical size={14} />}
    </button>
  );
}

/* ─── Menu Item ─── */

interface DropdownMenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  variant?: 'default' | 'danger';
  disabled?: boolean;
  shortcut?: string;
  badge?: string;
  checked?: boolean;
  checkStyle?: 'dot' | 'check';
  closeOnSelect?: boolean;
}

export function DropdownMenuItem({
  children,
  onSelect,
  icon,
  variant = 'default',
  disabled = false,
  shortcut,
  badge,
  checked,
  checkStyle = 'dot',
  closeOnSelect = true,
}: DropdownMenuItemProps) {
  const { setOpen, triggerRef } = useDropdown();

  const handleClick = useCallback(() => {
    if (disabled) return;
    onSelect?.();
    if (closeOnSelect) {
      setOpen(false);
      setTimeout(() => triggerRef.current?.focus(), 0);
    }
  }, [disabled, onSelect, closeOnSelect, setOpen, triggerRef]);

  const isDanger = variant === 'danger';
  const isChecked = checked === true;

  let className = dm.item;
  if (disabled) className += ` ${isDanger ? dm.itemDangerDisabled : dm.itemDisabled}`;
  else if (isDanger) className += ` ${dm.itemDanger}`;
  else if (isChecked) className += ` ${dm.itemChecked}`;

  return (
    <button
      role={checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={checked !== undefined ? checked : undefined}
      type="button"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={handleClick}
      className={className}
    >
      {icon && <span className={dm.itemIcon}>{icon}</span>}
      <span style={{ flex: 1 }}>{children}</span>
      {shortcut && <span className={dm.itemKbd}>{shortcut}</span>}
      {badge && <span className={dm.itemBadge}>{badge}</span>}
      {checked !== undefined && (
        <span className={`${dm.itemCheck} ${!checked ? dm.itemCheckHidden : ''}`}>
          {checkStyle === 'check' ? (
            <Check size={13} />
          ) : (
            <svg width="6" height="6" viewBox="0 0 6 6">
              <circle cx="3" cy="3" r="3" fill="currentColor" />
            </svg>
          )}
        </span>
      )}
    </button>
  );
}

/* ─── Separator ─── */

export function DropdownMenuSeparator() {
  return <div role="separator" aria-orientation="horizontal" className={dm.separator} />;
}

/* ─── Label ─── */

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return <div className={dm.label}>{children}</div>;
}
