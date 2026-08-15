import { useEffect, useRef, useCallback, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './IconButton.js';
import * as m from './modal.css.js';

function getPortal(): HTMLElement {
  return document.getElementById('tooltip-portal') ?? document.body;
}

export type ModalVariant = 'flat' | 'pinned' | 'drawer';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  subheader?: ReactNode;
  footer?: ReactNode;
  variant?: ModalVariant;
  closeButton?: 'x' | 'none';
  footerAlign?: 'start' | 'end';
  headerClassName?: string;
  bodyClassName?: string;
  panelClassName?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  subheader,
  footer,
  variant = 'flat',
  closeButton = 'x',
  footerAlign = 'start',
  headerClassName,
  bodyClassName,
  panelClassName,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  const isDrawer = variant === 'drawer';
  const isPinned = variant === 'pinned';

  const handleClose = useCallback(() => {
    setClosing(true);
    closeTimerRef.current = setTimeout(
      () => {
        setClosing(false);
        onClose();
      },
      isDrawer ? 200 : 100,
    );
  }, [onClose, isDrawer]);

  // Cleanup close timer on unmount
  useEffect(() => () => clearTimeout(closeTimerRef.current), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, handleClose]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open && !closing) return null;

  const overlayCls = [m.overlay, isDrawer ? m.overlayDrawer : '', closing ? m.overlayClosing : '']
    .filter(Boolean)
    .join(' ');
  const panelCls = isDrawer
    ? `${m.drawerPanel} ${closing ? m.drawerPanelClosing : ''}`
    : [m.panel, isPinned ? m.panelPinned : '', panelClassName].filter(Boolean).join(' ');
  const headerCls = [headerClassName ?? m.header, isPinned || isDrawer ? m.headerBorder : '']
    .filter(Boolean)
    .join(' ');
  const isFlat = !isPinned && !isDrawer;
  const bodyCls = [
    bodyClassName ?? m.body,
    isPinned || isDrawer ? m.bodyScroll : '',
    isDrawer ? m.bodyDrawer : '',
    isFlat && !footer ? m.bodyFlatKeepBottom : '',
    isFlat && footer ? m.bodyFlat : '',
  ]
    .filter(Boolean)
    .join(' ');
  const footerCls =
    `${m.footer} ${footerAlign === 'end' ? m.footerEnd : ''} ${isPinned || isDrawer ? m.footerBorder : ''} ${isFlat ? m.footerFlat : ''}`.trim();

  return createPortal(
    <div
      className={overlayCls}
      onMouseDown={(e) => {
        mouseDownTargetRef.current = e.target;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget)
          handleClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div ref={panelRef} className={panelCls} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className={headerCls}>
          <h2 className={m.title}>{title}</h2>
          {closeButton === 'x' && (
            <IconButton
              icon={<X size={16} />}
              tooltip="Close"
              size="sm"
              variant="trueGhost"
              onClick={handleClose}
            />
          )}
        </div>
        {subheader && <div className={m.subheader}>{subheader}</div>}
        <div className={bodyCls}>{children}</div>
        {footer && <div className={footerCls}>{footer}</div>}
      </div>
    </div>,
    getPortal(),
  );
}

/* ═══════════════════════════════════════
   Dialog — confirmation/action dialogs
   ═══════════════════════════════════════ */

import * as btn from './buttons.css.js';

export type DialogVariant = 'neutral' | 'positive' | 'negative';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  variant?: DialogVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  destructiveLabel?: string;
  onDestructive?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  disabled?: boolean;
  footerAlign?: 'start' | 'end';
}

const confirmClsMap: Record<DialogVariant, string> = {
  neutral: btn.btnPrimary,
  positive: btn.btnPrimary,
  negative: btn.btnDanger,
};

export function Dialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  variant = 'neutral',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructiveLabel,
  onDestructive,
  secondaryLabel,
  onSecondary,
  disabled,
  footerAlign = 'end',
}: DialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => cancelRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  const baseMd = `${btn.btnBase} ${btn.btnMd}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      closeButton="none"
      footerAlign={footerAlign}
      headerClassName={m.dialogHeader}
      bodyClassName={m.dialogBody}
      footer={
        <>
          {onDestructive && destructiveLabel && (
            <button
              type="button"
              className={`${baseMd} ${btn.btnTrueGhostDanger}`}
              style={{ marginRight: 'auto' }}
              onClick={onDestructive}
            >
              {destructiveLabel}
            </button>
          )}
          <button
            ref={cancelRef}
            type="button"
            className={`${baseMd} ${btn.btnSecondary}`}
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          {onSecondary && secondaryLabel && (
            <button
              type="button"
              className={`${baseMd} ${btn.btnSecondary}`}
              onClick={onSecondary}
              disabled={disabled}
            >
              {secondaryLabel}
            </button>
          )}
          <button
            type="button"
            className={`${baseMd} ${confirmClsMap[variant]}`}
            onClick={onConfirm}
            disabled={disabled}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
