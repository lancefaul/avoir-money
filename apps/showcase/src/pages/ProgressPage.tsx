import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';
import { ProgressBar, SegmentedProgress } from '@budget-tracker/ui';

export default function ProgressPage() {
  return (
    <>
      <div className={s.section}>
        <div className={s.sectionLabel}>Sizes</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['6'],
            maxWidth: '25rem',
          }}
        >
          <ProgressBar value={60} size="sm" label="Small" valueLabel="60%" />
          <ProgressBar value={60} size="md" label="Medium (default)" valueLabel="60%" />
          <ProgressBar value={60} size="lg" label="Large" valueLabel="60%" />
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Color variants</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['6'],
            maxWidth: '25rem',
          }}
        >
          <ProgressBar value={45} variant="default" label="Default (emerald)" valueLabel="45%" />
          <ProgressBar value={45} variant="success" label="Success" valueLabel="45%" />
          <ProgressBar value={75} variant="warning" label="Warning" valueLabel="75%" />
          <ProgressBar value={92} variant="danger" label="Danger" valueLabel="92%" />
          <ProgressBar value={60} variant="brand" label="Brand" valueLabel="60%" />
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Auto-color by value</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['6'],
            maxWidth: '25rem',
          }}
        >
          <ProgressBar value={25} autoColor label="25% – success" valueLabel="25%" />
          <ProgressBar value={60} autoColor label="60% – default" valueLabel="60%" />
          <ProgressBar value={85} autoColor label="85% – warning" valueLabel="85%" />
          <ProgressBar value={100} autoColor label="100% – danger" valueLabel="100%" />
        </div>
        <span className={s.ann}>
          color shifts automatically: &lt;50 success · 50–79 default · 80–99 warning · 100 danger
        </span>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Budget tracking</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['6'],
            maxWidth: '25rem',
          }}
        >
          <ProgressBar
            value={35}
            autoColor
            label="Groceries"
            valueLabel="$420 / $1,200"
            helper="$780 remaining"
          />
          <ProgressBar
            value={78}
            autoColor
            label="Dining out"
            valueLabel="$312 / $400"
            helper="$88 remaining"
          />
          <ProgressBar
            value={95}
            autoColor
            label="Entertainment"
            valueLabel="$190 / $200"
            helper="$10 remaining – near limit"
          />
          <ProgressBar
            value={100}
            autoColor
            label="Shopping"
            valueLabel="$520 / $500"
            helper="$20 over budget"
          />
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Healthcare – deductible progress</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: vars.space['6'],
            maxWidth: '32rem',
          }}
        >
          <ProgressBar
            value={62}
            variant="warning"
            size="lg"
            label="Deductible"
            valueLabel="$1,860 / $3,000"
            helper="$1,140 remaining"
          />
          <ProgressBar
            value={28}
            variant="default"
            size="lg"
            label="Out-of-Pocket Max"
            valueLabel="$2,240 / $8,000"
            helper="$5,760 remaining"
          />
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Segmented progress</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['6'],
            maxWidth: '25rem',
          }}
        >
          <SegmentedProgress
            label="Storage usage"
            valueLabel="7.2 GB / 10 GB"
            size="lg"
            segments={[
              { value: 40, variant: 'brand' },
              { value: 20, variant: 'warning' },
              { value: 12, variant: 'danger' },
            ]}
            helper="Documents 4 GB · Media 2 GB · Other 1.2 GB"
          />
          <SegmentedProgress
            label="Portfolio allocation"
            valueLabel="$214,269"
            size="md"
            segments={[
              { value: 55, variant: 'default' },
              { value: 25, variant: 'brand' },
              { value: 15, variant: 'warning' },
              { value: 5, variant: 'danger' },
            ]}
            helper="Stocks 55% · Bonds 25% · Crypto 15% · Cash 5%"
          />
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Striped</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['6'],
            maxWidth: '25rem',
          }}
        >
          <ProgressBar
            value={45}
            variant="default"
            striped
            label="Default striped"
            valueLabel="45%"
          />
          <ProgressBar
            value={45}
            variant="success"
            striped
            label="Success striped"
            valueLabel="45%"
          />
          <ProgressBar
            value={75}
            variant="warning"
            striped
            label="Warning striped"
            valueLabel="75%"
          />
          <ProgressBar
            value={92}
            variant="danger"
            striped
            label="Danger striped"
            valueLabel="92%"
          />
          <ProgressBar value={60} variant="brand" striped label="Brand striped" valueLabel="60%" />
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Striped sizes</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['6'],
            maxWidth: '25rem',
          }}
        >
          <ProgressBar value={60} striped size="sm" label="Small striped" valueLabel="60%" />
          <ProgressBar value={60} striped size="md" label="Medium striped" valueLabel="60%" />
          <ProgressBar value={60} striped size="lg" label="Large striped" valueLabel="60%" />
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Edge cases</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['6'],
            maxWidth: '25rem',
          }}
        >
          <ProgressBar value={0} label="Empty" valueLabel="0%" />
          <ProgressBar value={100} variant="success" label="Complete" valueLabel="100%" />
          <ProgressBar
            value={150}
            variant="danger"
            label="Overflow (clamped to 100)"
            valueLabel="150%"
          />
          <ProgressBar value={3} variant="default" label="Very small" valueLabel="3%" size="sm" />
        </div>
      </div>
    </>
  );
}
