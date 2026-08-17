import { useEffect, useRef, useCallback, useState, useMemo, type MutableRefObject } from 'react';
import { convertToFrequency } from './budget-utils.js';
import type { DisplayFrequency } from './types.js';

interface UseLinkedBaselineArgs {
  /** Current budget frequency (drives the derived baseline conversion). */
  frequency: string | undefined;
  /** Current amount field value (used for the high-water-mark auto-fill). */
  currentAmount: number | undefined;
  /** Narrow setter for the amount field — decouples this hook from react-hook-form. */
  setAmount: (value: number, shouldValidate?: boolean) => void;
  /** Whether the budget already had a manual override (skips auto-fill). */
  initialManualOverride: boolean;
}

export interface UseLinkedBaselineReturn {
  /** Combined baseline for the current frequency, or null when no links exist. */
  derivedBaseline: number | null;
  /** Ref flag: true once the user has manually edited the amount. */
  hasUserEdited: MutableRefObject<boolean>;
  /** Commit the baseline from already-linked expenses. */
  handleBaselineChange: (
    baseline: number,
    suggestedFrequency: string | null,
    nativeBaseline: number | null,
  ) => void;
  /** Commit the baseline from staged (not-yet-linked) expenses. */
  handleStagedBaselineChange: (
    monthly: number,
    nativeAmount: number | null,
    sharedFrequency: string | null,
  ) => void;
  /** Reset the amount field back to the derived baseline. */
  handleResetToDerived: () => void;
}

/**
 * Encapsulates the linked-expense baseline tracking for the budget item form:
 * committed vs. staged baselines, the frequency-aware derived baseline, and the
 * high-water-mark auto-fill of the amount field. Extracted from BudgetItemForm.
 */
export function useLinkedBaseline({
  frequency,
  currentAmount,
  setAmount,
  initialManualOverride,
}: UseLinkedBaselineArgs): UseLinkedBaselineReturn {
  const [committedBaseline, setCommittedBaseline] = useState<number | null>(null);
  const [committedNativeBaseline, setCommittedNativeBaseline] = useState<number | null>(null);
  const [committedSuggestedFreq, setCommittedSuggestedFreq] = useState<string | null>(null);
  const [stagedBaseline, setStagedBaseline] = useState(0);
  const [stagedNativeBaseline, setStagedNativeBaseline] = useState<number | null>(null);
  const [stagedSuggestedFreq, setStagedSuggestedFreq] = useState<string | null>(null);

  const monthlyBaseline =
    committedBaseline !== null
      ? committedBaseline + stagedBaseline
      : stagedBaseline > 0
        ? stagedBaseline
        : null;

  const derivedBaseline = useMemo(() => {
    if (monthlyBaseline === null) return null;
    const freq = (frequency ?? 'MONTHLY') as DisplayFrequency;
    if (committedNativeBaseline !== null && committedSuggestedFreq === freq && stagedBaseline === 0)
      return committedNativeBaseline;
    if (stagedNativeBaseline !== null && stagedSuggestedFreq === freq && committedBaseline === null)
      return stagedNativeBaseline;
    if (
      committedNativeBaseline !== null &&
      stagedNativeBaseline !== null &&
      committedSuggestedFreq === freq &&
      stagedSuggestedFreq === freq
    ) {
      return Math.round((committedNativeBaseline + stagedNativeBaseline) * 100) / 100;
    }
    return Math.round(convertToFrequency(monthlyBaseline, freq) * 100) / 100;
  }, [
    monthlyBaseline,
    frequency,
    committedBaseline,
    committedNativeBaseline,
    committedSuggestedFreq,
    stagedBaseline,
    stagedNativeBaseline,
    stagedSuggestedFreq,
  ]);

  const handleBaselineChange = useCallback(
    (baseline: number, suggestedFrequency: string | null, nativeBaseline: number | null) => {
      setCommittedBaseline(baseline);
      setCommittedNativeBaseline(nativeBaseline);
      setCommittedSuggestedFreq(suggestedFrequency);
    },
    [],
  );

  const handleStagedBaselineChange = useCallback(
    (monthly: number, nativeAmount: number | null, sharedFrequency: string | null) => {
      setStagedBaseline(monthly);
      setStagedNativeBaseline(nativeAmount);
      setStagedSuggestedFreq(sharedFrequency);
    },
    [],
  );

  // Update amount field when combined baseline changes — but only if:
  // 1. User hasn't manually overridden
  // 2. The derived baseline exceeds the current amount (high-water mark)
  const hasUserEdited = useRef(initialManualOverride);
  useEffect(() => {
    if (derivedBaseline !== null && derivedBaseline > 0 && !hasUserEdited.current) {
      const current = currentAmount ?? 0;
      if (derivedBaseline > current) {
        setAmount(derivedBaseline);
      }
    }
  }, [derivedBaseline, setAmount, currentAmount]);

  const handleResetToDerived = useCallback(() => {
    if (derivedBaseline !== null) {
      hasUserEdited.current = false;
      setAmount(derivedBaseline, true);
    }
  }, [derivedBaseline, setAmount]);

  return {
    derivedBaseline,
    hasUserEdited,
    handleBaselineChange,
    handleStagedBaselineChange,
    handleResetToDerived,
  };
}
