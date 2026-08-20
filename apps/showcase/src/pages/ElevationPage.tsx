import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';

export default function ElevationPage() {
  return (
    <div className={s.section}>
      <div className={s.sectionLabel}>Elevation</div>
      <div className={s.shadowGrid}>
        <div>
          <div
            className={s.shadowDemo}
            style={{ border: `${vars.border.hairline} solid ${vars.color.border}` }}
          >
            <span className={s.shadowName}>flat</span>
          </div>
          <div className={s.ann}>border only – tables, inline elements</div>
        </div>
        <div>
          <div className={s.shadowDemo} style={{ boxShadow: vars.shadow.sm }}>
            <span className={s.shadowName}>sm</span>
          </div>
          <div className={s.ann}>cards, dropdowns</div>
        </div>
        <div>
          <div className={s.shadowDemo} style={{ boxShadow: vars.shadow.md }}>
            <span className={s.shadowName}>md</span>
          </div>
          <div className={s.ann}>modals, floating panels</div>
        </div>
      </div>
    </div>
  );
}
