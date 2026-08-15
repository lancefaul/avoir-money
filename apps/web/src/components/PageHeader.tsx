import { useEffect } from 'react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { useUIStore } from '../store/ui.js';

interface Props {
  title: React.ReactNode;
  subtitle?: string;
  action?: React.ReactNode;
  search?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, action, search }: Props) {
  const setPageTitle = useUIStore((s) => s.setPageTitle);
  const setPageAction = useUIStore((s) => s.setPageAction);
  const setPageSearch = useUIStore((s) => s.setPageSearch);

  useEffect(() => {
    setPageTitle(title);
    return () => setPageTitle('');
  }, [title, setPageTitle]);

  useEffect(() => {
    setPageAction(action ?? null);
    return () => setPageAction(null);
  }, [action, setPageAction]);

  useEffect(() => {
    setPageSearch(search ?? null);
    return () => setPageSearch(null);
  }, [search, setPageSearch]);

  if (!subtitle) return null;

  return (
    <div
      style={{
        marginBottom: vars.space['6'],
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
      }}
    >
      <div>
        <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary, margin: 0 }}>
          {subtitle}
        </p>
      </div>
    </div>
  );
}
