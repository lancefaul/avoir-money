import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';

export default function RadiusPage() {
  return (
    <div className={s.section}>
      <div className={s.sectionLabel}>Border radius</div>
      <div className={s.radiusGrid}>
        <div>
          <div className={s.radiusDemo} style={{ borderRadius: vars.radius.xs }}>
            <span className={s.radiusName}>xs</span>
          </div>
          <div className={s.ann}>badges, tags</div>
        </div>
        <div>
          <div className={s.radiusDemo} style={{ borderRadius: vars.radius.sm }}>
            <span className={s.radiusName}>sm</span>
          </div>
          <div className={s.ann}>small buttons, chips</div>
        </div>
        <div>
          <div className={s.radiusDemo} style={{ borderRadius: vars.radius.md }}>
            <span className={s.radiusName}>md</span>
          </div>
          <div className={s.ann}>inputs, buttons</div>
        </div>
        <div>
          <div className={s.radiusDemo} style={{ borderRadius: vars.radius.lg }}>
            <span className={s.radiusName}>lg</span>
          </div>
          <div className={s.ann}>cards, modals</div>
        </div>
        <div>
          <div className={s.radiusDemo} style={{ borderRadius: vars.radius.xl }}>
            <span className={s.radiusName}>xl</span>
          </div>
          <div className={s.ann}>large panels</div>
        </div>
        <div>
          <div className={s.radiusDemo} style={{ borderRadius: vars.radius.full }}>
            <span className={s.radiusName}>full</span>
          </div>
          <div className={s.ann}>status pills, tags</div>
        </div>
      </div>
    </div>
  );
}
