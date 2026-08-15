import { useState } from 'react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';
import { Tabs, TabPanel, VerticalTabPanel, type TabItem } from '@budget-tracker/ui';
import {
  LayoutDashboard,
  Receipt,
  PiggyBank,
  TrendingUp,
  CreditCard,
  Heart,
  Zap,
  Settings,
} from 'lucide-react';

const basicTabs: TabItem[] = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'budgets', label: 'Budgets' },
  { value: 'investments', label: 'Investments' },
];

const iconTabs: TabItem[] = [
  { value: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={14} /> },
  { value: 'transactions', label: 'Transactions', icon: <Receipt size={14} /> },
  { value: 'budgets', label: 'Budgets', icon: <PiggyBank size={14} /> },
  { value: 'investments', label: 'Investments', icon: <TrendingUp size={14} /> },
];

const disabledTabs: TabItem[] = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived', disabled: true },
  { value: 'deleted', label: 'Deleted', disabled: true },
];

/**
 * The unread dot. `software-updates` carries one; select it and it goes.
 *
 * Both halves are worth seeing side by side, because the second is the one that
 * surprises people: the dot is danger red at rest and **not drawn at all** on
 * the selected tab. Selecting a tab is reading it, so the marker has nothing
 * left to say — and not drawing it sidesteps a problem that has no good answer,
 * since `navItemSelected` inverts across the palette (a dark teal in Empire, a
 * light gold in Empire Dark) and no single colour survives both grounds.
 */
const dotTabs: TabItem[] = [
  { value: 'backups', label: 'Backups' },
  {
    value: 'software-updates',
    label: 'Software Updates',
    dot: true,
    dotLabel: 'An update is available',
  },
  { value: 'theme', label: 'Theme' },
];

const manyTabs: TabItem[] = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'budgets', label: 'Budgets' },
  { value: 'investments', label: 'Investments' },
  { value: 'debts', label: 'Debts' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'income', label: 'Income' },
  { value: 'settings', label: 'Settings' },
  { value: 'import', label: 'Import / Export' },
  { value: 'reports', label: 'Reports' },
  { value: 'history', label: 'History' },
];

const overflowIconTabs: TabItem[] = [
  { value: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={14} /> },
  { value: 'transactions', label: 'Transactions', icon: <Receipt size={14} /> },
  { value: 'budgets', label: 'Budgets', icon: <PiggyBank size={14} /> },
  { value: 'investments', label: 'Investments', icon: <TrendingUp size={14} /> },
  { value: 'debts', label: 'Debts', icon: <CreditCard size={14} /> },
  { value: 'healthcare', label: 'Healthcare', icon: <Heart size={14} /> },
  { value: 'utilities', label: 'Utilities', icon: <Zap size={14} /> },
  { value: 'settings', label: 'Settings', icon: <Settings size={14} /> },
];

export default function TabsPage() {
  const [basic, setBasic] = useState('dashboard');
  const [icon, setIcon] = useState('dashboard');
  const [disabled, setDisabled] = useState('active');
  // Starts on a tab that is NOT the one wearing the dot, so the dot is visible
  // on load and disappears when selected — which is the behaviour being shown.
  const [dot, setDot] = useState('backups');
  const [overflow, setOverflow] = useState('dashboard');
  const [overflowIcon, setOverflowIcon] = useState('dashboard');
  const [overflowActive, setOverflowActive] = useState('settings');
  const [vertical, setVertical] = useState('dashboard');

  return (
    <>
      <div className={s.section}>
        <div className={s.sectionLabel}>Underline tabs</div>
        <Tabs tabs={basicTabs} value={basic} onChange={setBasic} />
        <TabPanel value="dashboard" activeValue={basic}>
          <div
            style={{
              color: vars.color.textSecondary,
              fontSize: vars.font.base,
            }}
          >
            Dashboard content goes here.
          </div>
        </TabPanel>
        <TabPanel value="transactions" activeValue={basic}>
          <div
            style={{
              color: vars.color.textSecondary,
              fontSize: vars.font.base,
            }}
          >
            Transactions content goes here.
          </div>
        </TabPanel>
        <TabPanel value="budgets" activeValue={basic}>
          <div
            style={{
              color: vars.color.textSecondary,
              fontSize: vars.font.base,
            }}
          >
            Budgets content goes here.
          </div>
        </TabPanel>
        <TabPanel value="investments" activeValue={basic}>
          <div
            style={{
              color: vars.color.textSecondary,
              fontSize: vars.font.base,
            }}
          >
            Investments content goes here.
          </div>
        </TabPanel>
        <span className={s.ann}>←→ keyboard nav · emerald active indicator</span>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Tabs with icons</div>
        <Tabs tabs={iconTabs} value={icon} onChange={setIcon} />
        <span className={s.ann}>icon + label</span>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Disabled tabs</div>
        <Tabs tabs={disabledTabs} value={disabled} onChange={setDisabled} />
        <span className={s.ann}>archived and deleted are disabled</span>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Attention dot</div>
        <Tabs tabs={dotTabs} value={dot} onChange={setDot} />
        <span className={s.ann}>
          select Software Updates — the dot is not drawn on the selected tab, because selecting it
          is reading it
        </span>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Overflow – many tabs</div>
        <Tabs tabs={manyTabs} value={overflow} onChange={setOverflow} />
        <span className={s.ann}>resize the window to see tabs collapse into "More" dropdown</span>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Overflow with icons</div>
        <Tabs tabs={overflowIconTabs} value={overflowIcon} onChange={setOverflowIcon} />
        <span className={s.ann}>icon tabs with overflow</span>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Active tab in overflow</div>
        <Tabs tabs={manyTabs} value={overflowActive} onChange={setOverflowActive} />
        <span className={s.ann}>
          active tab is in the "More" menu – indicator shows on the button
        </span>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Vertical variant</div>
        <div
          style={{
            position: 'relative',
            height: '18rem',
            border: `1px solid ${vars.color.border}`,
            borderRadius: vars.radius.md,
            overflow: 'hidden',
          }}
        >
          <Tabs
            tabs={iconTabs}
            value={vertical}
            onChange={setVertical}
            variant="vertical"
            ariaLabel="Vertical demo"
          >
            {(activeValue) => (
              <>
                <VerticalTabPanel value="dashboard" activeValue={activeValue}>
                  <div style={{ color: vars.color.textSecondary, fontSize: vars.font.base }}>
                    Dashboard content in vertical layout.
                  </div>
                </VerticalTabPanel>
                <VerticalTabPanel value="transactions" activeValue={activeValue}>
                  <div style={{ color: vars.color.textSecondary, fontSize: vars.font.base }}>
                    Transactions content in vertical layout.
                  </div>
                </VerticalTabPanel>
                <VerticalTabPanel value="budgets" activeValue={activeValue}>
                  <div style={{ color: vars.color.textSecondary, fontSize: vars.font.base }}>
                    Budgets content in vertical layout.
                  </div>
                </VerticalTabPanel>
                <VerticalTabPanel value="investments" activeValue={activeValue}>
                  <div style={{ color: vars.color.textSecondary, fontSize: vars.font.base }}>
                    Investments content in vertical layout.
                  </div>
                </VerticalTabPanel>
              </>
            )}
          </Tabs>
        </div>
        <span className={s.ann}>
          side nav style · ↑↓ keyboard nav · icon + label · page-level tab switching
        </span>
      </div>
    </>
  );
}
