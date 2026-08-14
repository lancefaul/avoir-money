import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Checkbox, Tooltip, inputStyles } from '@budget-tracker/ui';
import { formatCurrency, formatDateNumeric } from '../../lib/utils.js';
import * as s from './reconcile-page.css.js';

export interface MatchCandidate {
  /** Statement row id or transaction id, depending on which side is listed. */
  id: string;
  label: string;
  date: string;
  amount: number;
}

interface MatchCandidatesProps {
  candidates: MatchCandidate[];
  /** The amount we are trying to explain, used to rank by closeness. */
  targetAmount: number;
  targetDate: string;
  emptyMessage: string;
  isBusy: boolean;
  /** Currently ticked candidates. Several may combine to explain one row. */
  selected: string[];
  onToggle: (candidateId: string) => void;
}

/**
 * Days since epoch, or NaN for an unreadable date.
 *
 * Callers must treat NaN as "no date signal" rather than letting it reach a
 * comparator: `NaN - NaN` is NaN, a comparator returning NaN is treated as 0,
 * and the result is an arbitrary order that looks like a ranking bug.
 */
const dayNumber = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000;

const dayDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b);
  return Number.isFinite(d) ? d : 0;
};

/**
 * The other side's unmatched rows, ranked by how plausibly they explain this one.
 *
 * Ranking is by amount first, then date distance: an exact amount on a distant
 * date is nearly always the right pairing (banks post late), whereas a close
 * date with a different amount usually is not. Names are deliberately not part
 * of the ranking — the whole reason a row reaches this screen is that the
 * automatic matcher could not reconcile the names, so ranking by them again
 * would reproduce the same failure.
 */
export default function MatchCandidates({
  candidates,
  targetAmount,
  targetDate,
  emptyMessage,
  isBusy,
  selected,
  onToggle,
}: MatchCandidatesProps) {
  const [query, setQuery] = useState('');

  const ranked = useMemo(() => {
    const target = dayNumber(targetDate);
    const q = query.trim().toLowerCase();
    return candidates
      .filter((c) => (q ? c.label.toLowerCase().includes(q) : true))
      .map((c) => ({
        c,
        amountDelta: Math.abs(Math.round((c.amount - targetAmount) * 100) / 100),
        dayDelta: dayDistance(dayNumber(c.date), target),
      }))
      .sort((a, b) => a.amountDelta - b.amountDelta || a.dayDelta - b.dayDelta)
      .slice(0, 50);
  }, [candidates, targetAmount, targetDate, query]);

  const selectedTotal = useMemo(
    () =>
      Math.round(
        candidates.filter((c) => selected.includes(c.id)).reduce((sum, c) => sum + c.amount, 0) *
          100,
      ) / 100,
    [candidates, selected],
  );

  if (candidates.length === 0) {
    return <p className={inputStyles.fieldHelper}>{emptyMessage}</p>;
  }

  return (
    <div className={inputStyles.formStack}>
      <div className={inputStyles.field}>
        <label className={inputStyles.fieldLabel} htmlFor="match-search">
          Find the row this pairs with
        </label>
        <div className={s.searchWrap}>
          <Search size={14} aria-hidden className={s.searchIcon} />
          <input
            id="match-search"
            className={inputStyles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by description…"
          />
        </div>
      </div>

      <ul className={s.candidateList}>
        {ranked.map(({ c, amountDelta, dayDelta }) => (
          <li key={c.id}>
            <label className={s.candidate}>
              <Checkbox
                checked={selected.includes(c.id)}
                onChange={() => onToggle(c.id)}
                disabled={isBusy}
                aria-label={`${c.label} ${formatCurrency(c.amount)}`}
              />
              <span className={s.candidateMain}>
                <Tooltip content={c.label} truncate>
                  <span className={s.candidateName}>{c.label}</span>
                </Tooltip>
                <span className={s.candidateMeta}>
                  {formatDateNumeric(c.date)}
                  {amountDelta < 0.005 ? ' · exact amount' : ''}
                  {amountDelta < 0.005 && dayDelta > 0
                    ? ` · ${dayDelta} day${dayDelta === 1 ? '' : 's'} apart`
                    : ''}
                </span>
              </span>
              <span className={s.candidateAmount}>{formatCurrency(c.amount)}</span>
            </label>
          </li>
        ))}
        {ranked.length === 0 && (
          <li>
            <p className={inputStyles.fieldHelper}>Nothing matches that search.</p>
          </li>
        )}
      </ul>

      {selected.length > 0 && <RunningTotal selected={selectedTotal} target={targetAmount} />}
    </div>
  );
}

/**
 * Running total of the ticked rows against the row being explained.
 *
 * Several app entries adding up to one bank line is the whole point of a
 * multi-select pairing, and "do these actually add up" is a question the user
 * should not have to answer with mental arithmetic.
 */
function RunningTotal({ selected, target }: { selected: number; target: number }) {
  const delta = Math.round((selected - target) * 100) / 100;
  const exact = Math.abs(delta) < 0.005;
  return (
    <p className={inputStyles.fieldHelper}>
      Selected {formatCurrency(selected)} of {formatCurrency(target)} —{' '}
      {exact
        ? 'matches exactly'
        : `${formatCurrency(Math.abs(delta))} ${delta > 0 ? 'over' : 'short'}`}
    </p>
  );
}
