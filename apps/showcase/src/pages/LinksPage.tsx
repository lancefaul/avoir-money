import { ExternalLink } from 'lucide-react';
import * as s from '../showcase.css.js';
import { linkStyles as link, InfoLink } from '@budget-tracker/ui';

export default function LinksPage() {
  return (
    <>
      <div className={s.section}>
        <div className={s.sectionLabel}>Link styles</div>
        <div className={s.card}>
          {/* Default link */}
          <div className={s.sizeRow}>
            <div className={s.sizeDemo} style={{ minWidth: '17.5rem' }}>
              <a href="#" className={link.linkDefault}>
                View amortization schedule
              </a>
            </div>
            <span className={s.patternLabel}>default link</span>
            <span className={s.sizeSpec}>
              color: accent-400 · underline always · offset 2px · thickness 1px · decoration-color:
              accent-200 at rest, accent-400 on hover
            </span>
          </div>

          {/* External link */}
          <div className={s.sizeRow}>
            <div className={s.sizeDemo} style={{ minWidth: '17.5rem' }}>
              <a
                href="https://login.example.com"
                target="_blank"
                rel="noopener noreferrer"
                className={link.linkExternal}
              >
                login.example.com
                <ExternalLink size={10} />
              </a>
            </div>
            <span className={s.patternLabel}>link-external</span>
            <span className={s.sizeSpec}>
              same as default + auto external arrow icon · always opens in new tab
            </span>
          </div>

          {/* Info link */}
          <div className={s.sizeRow}>
            <div className={s.sizeDemo} style={{ minWidth: '17.5rem' }}>
              <span>
                Your{' '}
                <InfoLink tooltip="The annual percentage rate applied to your outstanding balance each billing cycle.">
                  APR
                </InfoLink>{' '}
                determines your monthly interest charge.
              </span>
            </div>
            <span className={s.patternLabel}>InfoLink</span>
            <span className={s.sizeSpec}>
              dotted underline · help cursor · tooltip required · color: textSecondary at rest,
              textPrimary on hover
            </span>
          </div>
        </div>

        <div className={s.note}>
          Rule: Every link must be underlined in body and UI contexts – no exceptions. Underline
          color is muted at rest and matches the text color on hover, creating a subtle but clear
          interaction cue.
        </div>
      </div>
    </>
  );
}
