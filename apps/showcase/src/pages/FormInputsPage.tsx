import { useState } from 'react';
import { Tabs, TabPanel, type TabItem } from '@budget-tracker/ui';
import InputsPage from './InputsPage.js';
import FormControlsPage from './FormControlsPage.js';
import SearchInputPage from './SearchInputPage.js';

const tabs: TabItem[] = [
  { value: 'inputs', label: 'Inputs' },
  { value: 'form-controls', label: 'Form Controls' },
  { value: 'search-input', label: 'Search Input' },
];

export default function FormInputsPage() {
  const [tab, setTab] = useState('inputs');

  return (
    <>
      <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Form input components" />
      <TabPanel value="inputs" activeValue={tab}>
        <InputsPage />
      </TabPanel>
      <TabPanel value="form-controls" activeValue={tab}>
        <FormControlsPage />
      </TabPanel>
      <TabPanel value="search-input" activeValue={tab}>
        <SearchInputPage />
      </TabPanel>
    </>
  );
}
