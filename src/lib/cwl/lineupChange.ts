/**
 * What changed in a round's in-game lineup SINCE THE LAST POLL.
 *
 * This is a different question from lineup.ts, and it exists because that one stopped being able to
 * answer it. `lineup.ts` diffs the war against the PLAN, which worked while the plan was a frozen
 * artefact of roster night. It no longer is: from sign-up onward signupReconcile.ts rewrites the
 * board from the in-game signup list on every sync — recommendation and bench flag alike — so the
 * plan chases reality and a mid-preparation swap shows up as "as planned" one poll later.
 *
 * So the comparison that still carries information is lineup-vs-lineup: whoever was in the war when
 * we last looked, against whoever is in it now. A leader swapping a player in on prep day is exactly
 * that, and it is the one CWL roster change that is both consequential and easy to miss — the war
 * roster locks when battle day starts.
 *
 * Pure and side-effect free, in the same shape as the rest of cwl/. lineupNotify.ts is its DB half.
 */

/** One account observed in a round's war lineup. */
export interface FieldedSlot {
  playerTag: string;
  name: string;
}

export interface LineupChange {
  swappedIn: FieldedSlot[];
  swappedOut: FieldedSlot[];
  /** True when either list is non-empty — i.e. the lineup is not the one we last saw. */
  changed: boolean;
}

/** Tags compare case-insensitively; stored tags arrive from several paths. */
function key(tag: string): string {
  return tag.trim().toUpperCase();
}

/**
 * Diff the lineup we last recorded against the one just polled.
 *
 * Both lists come back in the order supplied, so callers control presentation. A member who merely
 * moved map position is NOT a change — this is about who is in the war, not where they sit; position
 * shuffles are routine and would drown the real signal.
 */
export function diffFieldedLineups(previous: FieldedSlot[], current: FieldedSlot[]): LineupChange {
  const before = new Set(previous.map((p) => key(p.playerTag)));
  const after = new Set(current.map((c) => key(c.playerTag)));

  const swappedIn = current.filter((c) => !before.has(key(c.playerTag)));
  const swappedOut = previous.filter((p) => !after.has(key(p.playerTag)));

  return { swappedIn, swappedOut, changed: swappedIn.length > 0 || swappedOut.length > 0 };
}

/**
 * How many lineup changes a round's recorded history amounts to, counted in PLAYERS rather than in
 * recorded events.
 *
 * The round card badge used to print the length of `lineup_changes`, which is the number of times a
 * poll happened to notice a difference — not the number of changes a leader made. Three players
 * swapped between two syncs land in one event, so a collapsed round read "1 swap" and expanded to
 * three names. The event boundary is an artefact of polling frequency and means nothing to anyone.
 *
 * A swap is one body out and one body in, but which out pairs with which in is unknowable from a
 * membership diff — so this counts POSITIONS changed: the larger side of the two. It also dedupes by
 * tag across events, because a player swapped out and later brought back is one position that
 * churned, not two.
 */
export function countSwappedPositions(events: readonly LineupChange[]): number {
  const inTags = new Set<string>();
  const outTags = new Set<string>();
  for (const e of events) {
    for (const s of e.swappedIn) inTags.add(key(s.playerTag));
    for (const s of e.swappedOut) outTags.add(key(s.playerTag));
  }
  // An account that went out and came back is not a net change on either side.
  for (const tag of Array.from(inTags)) {
    if (outTags.has(tag)) { inTags.delete(tag); outTags.delete(tag); }
  }
  return Math.max(inTags.size, outTags.size);
}
