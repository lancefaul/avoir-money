import { useState, useId, useRef } from 'react';
import {
  HardDrive,
  Database,
  KeyRound,
  Calendar,
  ArrowLeftRight,
  Palette,
  Play,
  RotateCcw,
  Merge,
  RefreshCw,
} from 'lucide-react';
import {
  Tabs,
  VerticalTabPanel,
  Toggle,
  DisplayHeading,
  inputStyles,
  buttonStyles,
} from '@budget-tracker/ui';
import type { TabItem } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { useUIStore } from '../store/ui.js';
import PageHeader from '../components/PageHeader.js';
import PayScheduleSettings from '../components/PayScheduleSettings.js';
import ThemeGallery from '../components/ThemeGallery.js';
import DescriptionManager from './settings/DescriptionManager.js';
import type { DescriptionManagerActions } from './settings/DescriptionManager.js';
import BackupSettings from './settings/BackupSettings.js';
import type { BackupActions } from './settings/BackupSettings.js';
import DataManagement from './settings/DataManagement.js';
import ConnectedServices from './settings/ConnectedServices.js';
import SoftwareUpdates from './settings/SoftwareUpdates.js';
import { useUpdateAnnouncement } from '../hooks/useUpdateAnnouncement.js';
import * as s from './settings.css.js';

type SettingsTab =
  | 'backups'
  | 'connected-services'
  | 'data-management'
  | 'pay-schedule'
  | 'software-updates'
  | 'theme'
  | 'transactions';

/**
 * The tab list is a function of updater state, because one tab wears a dot.
 *
 * Built per render rather than hoisted to a constant: `dot` depends on whether
 * an update is waiting, and a module-level array cannot see that.
 */
function tabItems(updateWaiting: boolean): TabItem[] {
  return TAB_ITEMS.map((t) =>
    t.value === 'software-updates'
      ? { ...t, dot: updateWaiting, dotLabel: 'An update is available' }
      : t,
  );
}

const TAB_ITEMS: TabItem[] = [
  { value: 'backups', label: 'Backups', icon: <HardDrive size={16} /> },
  { value: 'connected-services', label: 'Connected Services', icon: <KeyRound size={16} /> },
  { value: 'data-management', label: 'Data Management', icon: <Database size={16} /> },
  { value: 'pay-schedule', label: 'Pay Schedule', icon: <Calendar size={16} /> },
  { value: 'software-updates', label: 'Software Updates', icon: <RefreshCw size={16} /> },
  { value: 'theme', label: 'Theme', icon: <Palette size={16} /> },
  { value: 'transactions', label: 'Transactions', icon: <ArrowLeftRight size={16} /> },
];

export default function SettingsPage() {
  const fid = useId();
  const { theme, setTheme, useSystemTheme, setUseSystemTheme } = useUIStore();
  const [tab, setTab] = useState<SettingsTab>('backups');
  // Drives the dot on the Software Updates tab, and fires the one-per-version
  // toast. Mounted here rather than in the page below it so the dot exists
  // whether or not that pane has ever been opened.
  const { updateWaiting } = useUpdateAnnouncement();
  const [descMergeCount, setDescMergeCount] = useState(0);
  const backupActionsRef = useRef<BackupActions | null>(null);
  const descActionsRef = useRef<DescriptionManagerActions | null>(null);

  return (
    <>
      <PageHeader title="Settings" />
      <Tabs
        tabs={tabItems(updateWaiting)}
        value={tab}
        onChange={(val) => setTab(val as SettingsTab)}
        variant="vertical"
        ariaLabel="Settings"
      >
        {(activeValue) => (
          <>
            <VerticalTabPanel value="backups" activeValue={activeValue} flush>
              <BackupSettings
                onActions={(actions) => {
                  backupActionsRef.current = actions;
                }}
              />
            </VerticalTabPanel>

            <VerticalTabPanel value="connected-services" activeValue={activeValue} flush>
              <ConnectedServices />
            </VerticalTabPanel>

            <VerticalTabPanel value="software-updates" activeValue={activeValue} flush>
              <SoftwareUpdates />
            </VerticalTabPanel>

            <VerticalTabPanel value="transactions" activeValue={activeValue} flush>
              <DescriptionManager
                onActions={(actions) => {
                  descActionsRef.current = actions;
                  setDescMergeCount(actions.mergeCount);
                }}
              />
            </VerticalTabPanel>

            <VerticalTabPanel value="data-management" activeValue={activeValue} flush>
              <DataManagement />
            </VerticalTabPanel>

            <VerticalTabPanel value="pay-schedule" activeValue={activeValue}>
              <div style={{ maxWidth: '75rem', margin: '0 auto' }}>
                <PayScheduleSettings />
              </div>
            </VerticalTabPanel>

            <VerticalTabPanel value="theme" activeValue={activeValue}>
              <div style={{ maxWidth: '75rem', margin: '0 auto' }}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: vars.space['5'],
                  }}
                >
                  <DisplayHeading size="sm" as="h1">
                    Theme
                  </DisplayHeading>
                  <div className={inputStyles.field}>
                    <label className={inputStyles.fieldLabel}>Match System Settings</label>
                    <Toggle
                      id={`${fid}-system-theme`}
                      label="Enable match system settings"
                      checked={useSystemTheme}
                      onChange={setUseSystemTheme}
                    />
                  </div>
                  {!useSystemTheme && <ThemeGallery value={theme} onChange={(v) => setTheme(v)} />}
                </div>
              </div>
            </VerticalTabPanel>

            {/* Pinned action bar */}
            {tab === 'backups' && (
              <div className={s.actionBar}>
                <button
                  type="button"
                  className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
                  onClick={() => backupActionsRef.current?.openBackup()}
                >
                  <Play size={14} />
                  Backup Now
                </button>
                <button
                  type="button"
                  className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
                  onClick={() => backupActionsRef.current?.openRestore()}
                >
                  <RotateCcw size={14} />
                  Restore
                </button>
              </div>
            )}
            {tab === 'transactions' && (
              <div className={s.actionBar}>
                <button
                  type="button"
                  className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
                  onClick={() => descActionsRef.current?.openMerge()}
                  disabled={descMergeCount < 2}
                >
                  <Merge size={14} />
                  Merge {descMergeCount >= 2 ? `${descMergeCount} selected` : 'selected'}
                </button>
              </div>
            )}
          </>
        )}
      </Tabs>
    </>
  );
}
