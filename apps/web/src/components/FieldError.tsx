import { Info } from 'lucide-react';
import { inputStyles } from '@budget-tracker/ui';

export default function FieldError({ error }: { error?: { message?: string } }) {
  if (!error?.message) return null;
  return (
    <p className={inputStyles.fieldError}>
      <Info size={12} />
      {error.message}
    </p>
  );
}
