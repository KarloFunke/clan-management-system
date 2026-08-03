'use client';

import { useMemo } from 'react';
import { useClan } from '@/lib/ClanContext';

/**
 * Which clan the CWL screen is currently reading.
 *
 * The season is a family-wide object — the engine allocates across every clan at once and the
 * transfer list is inherently cross-clan — but almost nothing a leader DOES with it is family-wide.
 * Checking a lineup, chasing a missed attack, deciding who benches next round: all of those are one
 * clan's business, and showing three clans' worth of rows meant scrolling past two of them every
 * time. So the panels scope down to a single clan by default and the family view stays one click
 * away, for the reads that genuinely span it (the fill order, the whole transfer call).
 *
 * It deliberately reuses the dashboard header's existing clan switcher rather than adding a
 * CWL-only one: the app already has exactly this control, a leader has usually already set it to
 * the clan they are working on, and a second selector on the page would let the two disagree.
 * `'all'` in that switcher is the family view.
 */
export interface CWLScope {
  /** The clan being viewed, or null for the whole family. */
  clanId: string | null;
  isFamily: boolean;
  /** Does this clan-scoped row belong in the current view? Always true in the family view. */
  includes: (clanId: string | null | undefined) => boolean;
}

// Memoised so the returned object is referentially stable while the selection holds — several
// panels feed it straight into a useMemo dependency list, and a fresh object each render would
// silently recompute every rotation and performance table on every keystroke elsewhere on the page.
export function useCwlScope(): CWLScope {
  const { selectedClanId } = useClan();
  return useMemo(() => {
    const clanId = selectedClanId === 'all' ? null : selectedClanId;
    return {
      clanId,
      isFamily: clanId === null,
      includes: (id: string | null | undefined) => clanId === null || id === clanId,
    };
  }, [selectedClanId]);
}
