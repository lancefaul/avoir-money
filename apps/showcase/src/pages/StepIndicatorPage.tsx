import { useState } from 'react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';
import { StepIndicator, ButtonGroup } from '@budget-tracker/ui';

const basicSteps = [
  { label: 'Step 1', description: 'Map your data' },
  { label: 'Step 2', description: 'Sign conventions' },
  { label: 'Step 3', description: 'Preview import' },
  { label: 'Step 4', description: 'Run import' },
];

const shortSteps = [
  { label: 'Account', description: 'Choose account' },
  { label: 'Details', description: 'Fill in details' },
  { label: 'Confirm', description: 'Review & submit' },
];

const manySteps = [
  { label: 'Step 1', description: 'Gather info' },
  { label: 'Step 2', description: 'Configure' },
  { label: 'Step 3', description: 'Validate' },
  { label: 'Step 4', description: 'Preview' },
  { label: 'Step 5', description: 'Import' },
  { label: 'Step 6', description: 'Verify' },
];

export default function StepIndicatorPage() {
  const [current, setCurrent] = useState(2);

  return (
    <>
      <div className={s.section}>
        <div className={s.sectionLabel}>Interactive demo</div>
        <div style={{ maxWidth: '40rem' }}>
          <StepIndicator steps={basicSteps} currentStep={current} />
        </div>
        <div style={{ marginTop: vars.space['6'] }}>
          <ButtonGroup
            options={[
              { value: '0', label: 'Step 1' },
              { value: '1', label: 'Step 2' },
              { value: '2', label: 'Step 3' },
              { value: '3', label: 'Step 4' },
              { value: '4', label: 'Done' },
            ]}
            value={String(current)}
            onChange={(v) => setCurrent(Number(v))}
            ariaLabel="Set current step"
          />
        </div>
        <span className={s.ann}>
          Use the buttons to change the active step. Steps before current are completed, after are
          pending.
        </span>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>3 steps – compact</div>
        <div style={{ maxWidth: '30rem' }}>
          <StepIndicator steps={shortSteps} currentStep={1} />
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>6 steps – extended</div>
        <div style={{ maxWidth: '50rem' }}>
          <StepIndicator steps={manySteps} currentStep={3} />
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>All completed</div>
        <div style={{ maxWidth: '40rem' }}>
          <StepIndicator steps={basicSteps} currentStep={4} />
        </div>
        <span className={s.ann}>
          When currentStep equals steps.length, all steps show as completed.
        </span>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>First step active (none completed)</div>
        <div style={{ maxWidth: '40rem' }}>
          <StepIndicator steps={basicSteps} currentStep={0} />
        </div>
      </div>
    </>
  );
}
