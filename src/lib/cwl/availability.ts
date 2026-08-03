/**
 * Per-round availability for a CWL season — the PURE semantics of "unavailable until round 4" /
 * "unavailable after round 5". No DB, no React, unit-tested like the other cwl/ engines.
 *
 * Migration 031 gave a leader one lever: mark an account as not participating, full stop. That is
 * the right answer for a player who is gone for the week and the wrong one for the far more common
 * case — someone away for the first two war days, or an account that goes quiet before the last.
 * Spending a full opt-out on those throws away five playable rounds.
 *
 * The window (migration 032) records the rounds the account CANNOT fight, inclusive. A full-season
 * opt-out is the unbounded window: both ends null. That is not a cosmetic difference:
 *
 *  - A FULL opt-out is an allocation exclusion. The account plays nothing, so leaving it out of the
 *    roster is correct and its slot goes to the next-strongest player.
 *  - A PARTIAL one must NOT be excluded. It plays most of the season, so it has to be in a clan; the
 *    constraint belongs to the rotation suggester, which simply must not plan it into a round it
 *    already said it cannot fight. Excluding it from the roster would cost the clan a body for seven
 *    rounds to solve a problem that exists for two.
 *
 * `isFullSeason` is therefore the switch every consumer branches on, and it lives here rather than
 * being re-derived as `!from && !to` at each call site.
 */

/** The rounds an account cannot fight. Both null = the whole season. */
export interface AvailabilityWindow {
  fromRound: number | null;
  toRound: number | null;
}

/** A season is seven war days; kept local so this module stays free of rotation.ts's imports. */
export const SEASON_ROUNDS = 7;

/** True when the account is out for the entire season — the migration-031 shape. */
export function isFullSeason(w: AvailabilityWindow): boolean {
  return w.fromRound === null && w.toRound === null;
}

/**
 * Can this account fight round `round`?
 *
 * A full-season opt-out is unavailable for every round, which falls out of the window being
 * unbounded rather than needing its own branch at each caller.
 */
export function isAvailableForRound(w: AvailabilityWindow, round: number): boolean {
  if (isFullSeason(w)) return false;
  return round < w.fromRound! || round > w.toRound!;
}

/** Every round number the account is out for, within a season of `totalRounds` war days. */
export function unavailableRounds(w: AvailabilityWindow, totalRounds: number = SEASON_ROUNDS): number[] {
  const out: number[] = [];
  for (let n = 1; n <= totalRounds; n++) if (!isAvailableForRound(w, n)) out.push(n);
  return out;
}

/**
 * One sentence for the board, phrased the way the leader entered it.
 *
 * A window that starts at round 1 reads as "back for round N" and one that runs to the last round as
 * "gone after round N", because that is what the leader was told by the player — "until" and "after"
 * are the natural phrasings and re-deriving them keeps the stored shape single. Anything else is
 * printed as the literal span.
 */
export function describeAvailability(w: AvailabilityWindow, totalRounds: number = SEASON_ROUNDS): string {
  if (isFullSeason(w)) return 'Not participating this season';
  const from = w.fromRound!;
  const to = w.toRound!;
  if (from <= 1 && to >= totalRounds) return 'Not participating this season';
  if (from <= 1) return `Unavailable until round ${to + 1}`;
  if (to >= totalRounds) return `Unavailable after round ${from - 1}`;
  if (from === to) return `Unavailable for round ${from}`;
  return `Unavailable for rounds ${from}–${to}`;
}

/**
 * Build the window for "not available until round N" (available from N onwards).
 *
 * N must be past the first round: "unavailable until round 1" describes an empty window, which is
 * not an opt-out at all — the account is simply available, and the record should be deleted instead.
 * Throwing beats silently storing a window that excludes nothing and reads on the board as if it
 * excluded something.
 */
export function untilRound(round: number): AvailabilityWindow {
  if (round <= 1) throw new RangeError('untilRound needs a round past the first — round 1 excludes nothing');
  return { fromRound: 1, toRound: round - 1 };
}

/** Build the window for "not available after round N" (plays through N, then out). Same empty-window rule. */
export function afterRound(round: number, totalRounds: number = SEASON_ROUNDS): AvailabilityWindow {
  if (round >= totalRounds) throw new RangeError('afterRound needs a round before the last — the final round excludes nothing');
  return { fromRound: round + 1, toRound: totalRounds };
}
