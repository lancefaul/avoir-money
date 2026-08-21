import { useState, useId } from 'react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';
import { inputStyles as inp, buttonStyles as btn, Modal, Dialog } from '@budget-tracker/ui';

export default function ModalsPage() {
  const fid = useId();
  const [flat, setFlat] = useState(false);
  const [flatClose, setFlatClose] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [neutral, setNeutral] = useState(false);
  const [positive, setPositive] = useState(false);
  const [negative, setNegative] = useState(false);
  const [destructive, setDestructive] = useState(false);

  const triggerCls = `${btn.btnBase} ${btn.btnMd} ${btn.btnSecondary}`;

  const longContent = Array.from({ length: 20 }, (_, i) => (
    <p key={`lorem-${i}`} style={{ marginBottom: vars.space['3'] }}>
      Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut
      labore. Paragraph {i + 1}.
    </p>
  ));

  const formContent = (
    <div className={inp.formStack}>
      <div className={inp.field}>
        <label htmlFor={`${fid}-name`} className={inp.fieldLabel}>
          Name
        </label>
        <input id={`${fid}-name`} className={inp.input} placeholder="Enter name" />
      </div>
      <div className={inp.field}>
        <label htmlFor={`${fid}-amount`} className={inp.fieldLabel}>
          Amount
        </label>
        <input id={`${fid}-amount`} className={inp.input} placeholder="0.00" />
      </div>
      <div className={inp.field}>
        <label htmlFor={`${fid}-notes`} className={inp.fieldLabel}>
          Notes
        </label>
        <input id={`${fid}-notes`} className={inp.input} placeholder="Optional notes" />
      </div>
    </div>
  );

  const grid: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: vars.space['3'],
  };

  return (
    <>
      <div className={s.section}>
        <div className={s.sectionLabel}>Modals</div>
        <div style={grid}>
          <button type="button" className={triggerCls} onClick={() => setFlat(true)}>
            Flat (X close)
          </button>
          <button type="button" className={triggerCls} onClick={() => setFlatClose(true)}>
            Flat (footer close)
          </button>
          <button type="button" className={triggerCls} onClick={() => setPinned(true)}>
            Pinned
          </button>
          <button type="button" className={triggerCls} onClick={() => setDrawer(true)}>
            Drawer
          </button>
        </div>
        <span className={s.ann}>Esc to close · click backdrop to close</span>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Dialog messages</div>
        <div style={grid}>
          <button type="button" className={triggerCls} onClick={() => setNeutral(true)}>
            Neutral
          </button>
          <button type="button" className={triggerCls} onClick={() => setPositive(true)}>
            Positive
          </button>
          <button type="button" className={triggerCls} onClick={() => setNegative(true)}>
            Negative
          </button>
          <button type="button" className={triggerCls} onClick={() => setDestructive(true)}>
            With destructive
          </button>
        </div>
      </div>

      <Modal open={flat} onClose={() => setFlat(false)} title="Add transaction" closeButton="x">
        {formContent}
      </Modal>
      <Modal
        open={flatClose}
        onClose={() => setFlatClose(false)}
        title="Add transaction"
        closeButton="none"
        footer={
          <button
            type="button"
            className={`${btn.btnBase} ${btn.btnMd} ${btn.btnSecondary}`}
            onClick={() => setFlatClose(false)}
          >
            Close
          </button>
        }
      >
        {formContent}
      </Modal>
      <Modal
        open={pinned}
        onClose={() => setPinned(false)}
        title="Long scrollable content"
        variant="pinned"
        footer={
          <button
            type="button"
            className={`${btn.btnBase} ${btn.btnMd} ${btn.btnPrimary}`}
            onClick={() => setPinned(false)}
          >
            Done
          </button>
        }
      >
        {longContent}
      </Modal>
      <Modal
        open={drawer}
        onClose={() => setDrawer(false)}
        title="Transaction details"
        variant="drawer"
      >
        {formContent}
        <div style={{ marginTop: vars.space['6'] }}>{longContent.slice(0, 5)}</div>
      </Modal>

      <Dialog
        open={neutral}
        onClose={() => setNeutral(false)}
        onConfirm={() => setNeutral(false)}
        title="Save changes?"
        message="You have unsaved changes. Would you like to save before leaving?"
        confirmLabel="Save"
        cancelLabel="Discard"
      />
      <Dialog
        open={positive}
        onClose={() => setPositive(false)}
        onConfirm={() => setPositive(false)}
        title="Confirm payment"
        message="This will process a payment of $1,234.56 to your mortgage account."
        variant="positive"
        confirmLabel="Pay now"
        cancelLabel="Cancel"
      />
      <Dialog
        open={negative}
        onClose={() => setNegative(false)}
        onConfirm={() => setNegative(false)}
        title="Delete transaction?"
        message="This action cannot be undone. The transaction and all associated records will be permanently removed."
        variant="negative"
        confirmLabel="Delete"
        cancelLabel="Keep"
      />
      <Dialog
        open={destructive}
        onClose={() => setDestructive(false)}
        onConfirm={() => setDestructive(false)}
        title="Archive budget?"
        message="This will archive the budget and remove it from active tracking."
        confirmLabel="Archive"
        cancelLabel="Cancel"
        destructiveLabel="Delete permanently"
        onDestructive={() => setDestructive(false)}
      />
    </>
  );
}
