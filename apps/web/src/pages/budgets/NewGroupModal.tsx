import { useId } from 'react';
import { Info } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { ColorPicker, Modal, inputStyles, buttonStyles } from '@budget-tracker/ui';

interface GroupFormValues {
  name: string;
  color: string;
}

interface NewGroupModalProps {
  form: UseFormReturn<GroupFormValues>;
  onSubmit: (v: GroupFormValues) => void;
  onClose: () => void;
  title?: string;
}

export default function NewGroupModal({ form, onSubmit, onClose, title }: NewGroupModalProps) {
  const fid = useId();

  const footerContent = (
    <>
      <button
        type="submit"
        form="new-group-form"
        className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
      >
        {title ? 'Save' : 'Add'}
      </button>
      <button
        type="button"
        onClick={onClose}
        className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
      >
        Cancel
      </button>
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={title ?? 'Add Budget Group'}
      closeButton="none"
      footer={footerContent}
    >
      <form id="new-group-form" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <div className={inputStyles.formStack}>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-group-name`} className={inputStyles.fieldLabel}>
              Name <span className={inputStyles.fieldRequired}>*</span>
            </label>
            <input
              id={`${fid}-group-name`}
              {...form.register('name')}
              className={`${inputStyles.input} ${form.formState.errors.name ? inputStyles.inputError : ''}`}
              placeholder="e.g. Housing, Transportation"
              autoFocus
            />
            {form.formState.errors.name?.message && (
              <div className={inputStyles.fieldError}>
                <Info size={12} /> {form.formState.errors.name.message}
              </div>
            )}
          </div>

          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Color</label>
            <ColorPicker
              id={`${fid}-group-color`}
              value={form.watch('color')}
              onChange={(colorId) => form.setValue('color', colorId)}
              onClear={() => form.setValue('color', '')}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
