import { useState } from 'react';
import { X } from 'lucide-react';
import * as s from '../showcase.css.js';
import { tagStyles as t, buttonStyles as btn } from '@budget-tracker/ui';

interface CloseableTag {
  id: string;
  label: string;
  dotClass: string;
}

const CLOSEABLE_TAGS: CloseableTag[] = [
  { id: 'food', label: 'Food & Dining', dotClass: t.dotPositive },
  { id: 'transport', label: 'Transport', dotClass: t.dotInfo },
  { id: 'tax', label: 'Tax deductible', dotClass: t.dotWarning },
  { id: 'recurring', label: 'Recurring', dotClass: t.dotPositive },
  { id: 'business', label: 'Business', dotClass: t.dotBrand },
];

interface SelectableTagData {
  id: string;
  label: string;
  dotClass: string;
  selectedClass: string;
  dotSelectedClass: string;
}

const SELECTABLE_TAGS: SelectableTagData[] = [
  {
    id: 'recurring',
    label: 'Recurring',
    dotClass: t.dotPositive,
    selectedClass: t.tagSelectedPositive,
    dotSelectedClass: t.dotSelected,
  },
  {
    id: 'overdue',
    label: 'Overdue',
    dotClass: t.dotNegative,
    selectedClass: t.tagSelectedNegative,
    dotSelectedClass: t.dotSelected,
  },
  {
    id: 'due-soon',
    label: 'Due soon',
    dotClass: t.dotWarning,
    selectedClass: t.tagSelectedWarning,
    dotSelectedClass: t.dotSelectedWarning,
  },
  {
    id: 'auto-loan',
    label: 'Auto loan',
    dotClass: t.dotInfo,
    selectedClass: t.tagSelectedInfo,
    dotSelectedClass: t.dotSelected,
  },
  {
    id: 'inactive',
    label: 'Inactive',
    dotClass: t.dotNeutral,
    selectedClass: t.tagSelectedNeutral,
    dotSelectedClass: t.dotSelected,
  },
  {
    id: 'monthly',
    label: 'Monthly',
    dotClass: t.dotBrand,
    selectedClass: t.tagSelectedBrand,
    dotSelectedClass: t.dotSelected,
  },
];

export default function TagsPage() {
  const [visibleIds, setVisibleIds] = useState<Set<string>>(
    () => new Set(CLOSEABLE_TAGS.map((tag) => tag.id)),
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedCloseableIds, setSelectedCloseableIds] = useState<Set<string>>(new Set());
  const [visibleSelectableIds, setVisibleSelectableIds] = useState<Set<string>>(
    () => new Set(SELECTABLE_TAGS.map((tag) => tag.id)),
  );

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectedCloseable = (id: string) => {
    setSelectedCloseableIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeSelectableTag = (id: string) => {
    setVisibleSelectableIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSelectedCloseableIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const resetSelectableTags = () => {
    setVisibleSelectableIds(new Set(SELECTABLE_TAGS.map((tag) => tag.id)));
  };

  const removeTag = (id: string) => {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const resetTags = () => {
    setVisibleIds(new Set(CLOSEABLE_TAGS.map((tag) => tag.id)));
  };

  return (
    <>
      {/* ── Section 1: Semantic variants ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Semantic variants</div>
        <div className={s.row}>
          <span className={t.tag}>
            <span className={`${t.tagDot} ${t.dotPositive}`} />
            Recurring
          </span>
          <span className={t.tag}>
            <span className={`${t.tagDot} ${t.dotNegative}`} />
            Overdue
          </span>
          <span className={t.tag}>
            <span className={`${t.tagDot} ${t.dotWarning}`} />
            Due soon
          </span>
          <span className={t.tag}>
            <span className={`${t.tagDot} ${t.dotInfo}`} />
            Auto loan
          </span>
          <span className={t.tag}>
            <span className={`${t.tagDot} ${t.dotNeutral}`} />
            Inactive
          </span>
          <span className={t.tag}>
            <span className={`${t.tagDot} ${t.dotBrand}`} />
            Monthly
          </span>
        </div>
      </div>

      {/* ── Section 2: Sizes ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Sizes</div>
        <div className={s.row}>
          <div className={s.col}>
            <span className={`${t.tag} ${t.tagSm}`}>
              <span className={`${t.tagDot} ${t.dotPositive}`} />
              Small
            </span>
            <span className={s.ann}>sm</span>
          </div>
          <div className={s.col}>
            <span className={t.tag}>
              <span className={`${t.tagDot} ${t.dotPositive}`} />
              Default
            </span>
            <span className={s.ann}>md (default)</span>
          </div>
          <div className={s.col}>
            <span className={`${t.tag} ${t.tagLg}`}>
              <span className={`${t.tagDot} ${t.dotPositive}`} />
              Large
            </span>
            <span className={s.ann}>lg</span>
          </div>
        </div>
      </div>

      {/* ── Section 3: Closeable ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Closeable</div>
        <div className={s.row}>
          <div className={s.col}>
            <span className={`${t.tag} ${t.tagSm} ${t.tagCloseable} ${t.tagCloseableSm}`}>
              <span className={`${t.tagDot} ${t.dotPositive}`} />
              Small
              <button type="button" className={t.tagClose} aria-label="Remove">
                <X size={8} />
              </button>
            </span>
            <span className={s.ann}>sm</span>
          </div>
          <div className={s.col}>
            <span className={`${t.tag} ${t.tagCloseable}`}>
              <span className={`${t.tagDot} ${t.dotInfo}`} />
              Default
              <button type="button" className={t.tagClose} aria-label="Remove">
                <X size={10} />
              </button>
            </span>
            <span className={s.ann}>md</span>
          </div>
          <div className={s.col}>
            <span className={`${t.tag} ${t.tagLg} ${t.tagCloseable}`}>
              <span className={`${t.tagDot} ${t.dotWarning}`} />
              Large
              <button type="button" className={t.tagClose} aria-label="Remove">
                <X size={10} />
              </button>
            </span>
            <span className={s.ann}>lg</span>
          </div>
        </div>
      </div>

      {/* ── Section 4: Closeable – interactive ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Closeable – interactive</div>
        <div className={s.row}>
          {CLOSEABLE_TAGS.filter((tag) => visibleIds.has(tag.id)).map((tag) => (
            <span key={tag.id} className={`${t.tag} ${t.tagCloseable}`}>
              <span className={`${t.tagDot} ${tag.dotClass}`} />
              {tag.label}
              <button
                type="button"
                className={t.tagClose}
                aria-label={`Remove ${tag.label}`}
                onClick={() => removeTag(tag.id)}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {visibleIds.size < CLOSEABLE_TAGS.length && (
            <button
              type="button"
              className={`${btn.btnBase} ${btn.btnSm} ${btn.btnSecondary}`}
              onClick={resetTags}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* ── Section 5: Without close button ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Without close button</div>
        <div className={s.row}>
          {CLOSEABLE_TAGS.map((tag) => (
            <span key={tag.id} className={t.tag}>
              <span className={`${t.tagDot} ${tag.dotClass}`} />
              {tag.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Section 6: Selectable – click to toggle ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Selectable – click to toggle</div>
        <div className={s.row}>
          {SELECTABLE_TAGS.map((tag) => {
            const isSelected = selectedIds.has(tag.id);
            return (
              <button
                type="button"
                key={tag.id}
                className={`${t.tag} ${t.tagSelectable}${isSelected ? ` ${tag.selectedClass}` : ''}`}
                onClick={() => toggleSelected(tag.id)}
                aria-pressed={isSelected}
              >
                <span
                  className={`${t.tagDot} ${tag.dotClass}${isSelected ? ` ${tag.dotSelectedClass}` : ''}`}
                />
                {tag.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Section 7: Selectable + closeable ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Selectable + closeable</div>
        <div className={s.row}>
          {SELECTABLE_TAGS.filter((tag) => visibleSelectableIds.has(tag.id)).map((tag) => {
            const isSelected = selectedCloseableIds.has(tag.id);
            return (
              <button
                type="button"
                key={tag.id}
                className={`${t.tag} ${t.tagCloseable} ${t.tagSelectable}${isSelected ? ` ${tag.selectedClass}` : ''}`}
                onClick={() => toggleSelectedCloseable(tag.id)}
                aria-pressed={isSelected}
              >
                <span
                  className={`${t.tagDot} ${tag.dotClass}${isSelected ? ` ${tag.dotSelectedClass}` : ''}`}
                />
                {tag.label}
                <span
                  role="button"
                  tabIndex={0}
                  className={t.tagClose}
                  aria-label={`Remove ${tag.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSelectableTag(tag.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      removeSelectableTag(tag.id);
                    }
                  }}
                >
                  <X size={10} />
                </span>
              </button>
            );
          })}
          {visibleSelectableIds.size < SELECTABLE_TAGS.length && (
            <button
              type="button"
              className={`${btn.btnBase} ${btn.btnSm} ${btn.btnSecondary}`}
              onClick={resetSelectableTags}
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </>
  );
}
