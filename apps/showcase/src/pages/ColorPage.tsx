import { useState } from 'react';
import { Tabs, TabPanel, type TabItem } from '@budget-tracker/ui';
import ColorPalettesPage from './ColorPalettesPage.js';
import DataVizPalettePage from './DataVizPalettePage.js';

const tabs: TabItem[] = [
  { value: 'palettes', label: 'Color Palettes' },
  { value: 'data-viz', label: 'Data Viz Palette' },
];

export default function ColorPage() {
  const [tab, setTab] = useState('palettes');

  return (
    <>
      <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Color palettes" />
      <TabPanel value="palettes" activeValue={tab}>
        <ColorPalettesPage />
      </TabPanel>
      <TabPanel value="data-viz" activeValue={tab}>
        <DataVizPalettePage />
      </TabPanel>
    </>
  );
}
