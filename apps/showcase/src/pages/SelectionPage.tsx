import { useState } from 'react';
import { Tabs, TabPanel, type TabItem } from '@budget-tracker/ui';
import SelectPage from './SelectPage.js';
import DatePickerPage from './DatePickerPage.js';
import ColorPickerPage from './ColorPickerPage.js';
import EmojiPickerPage from './EmojiPickerPage.js';

const tabs: TabItem[] = [
  { value: 'select', label: 'Select' },
  { value: 'date-pickers', label: 'Date Pickers' },
  { value: 'color-picker', label: 'Color Picker' },
  { value: 'emoji-picker', label: 'Emoji Picker' },
];

export default function SelectionPage() {
  const [tab, setTab] = useState('select');

  return (
    <>
      <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Selection components" />
      <TabPanel value="select" activeValue={tab}>
        <SelectPage />
      </TabPanel>
      <TabPanel value="date-pickers" activeValue={tab}>
        <DatePickerPage />
      </TabPanel>
      <TabPanel value="color-picker" activeValue={tab}>
        <ColorPickerPage />
      </TabPanel>
      <TabPanel value="emoji-picker" activeValue={tab}>
        <EmojiPickerPage />
      </TabPanel>
    </>
  );
}
