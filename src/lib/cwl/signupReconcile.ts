import type { CWLAllocationStatus } from '@/types/database';

/**
 * Reconcile the formed roster against the IN-GAME CWL signup — the pure half.
 *
 * The allocation engine produces a plan, but the plan stops being true the moment sign-up closes:
 * players ignore their transfer call, a leader signs someone in from the clan chat, an alt is swapped
 * for a main. `/clans/{tag}/currentwar/leaguegroup` carries `clans[].members`, which is the
 * authoritative list of who a clan actually signed into this CWL — available from prep day and
 * independent of which round has been revealed. Once that list exists it outranks anything we
 * planned, so from `signed_up` onward the board is rewritten to match it (recommendation included):
 * a roster board that still shows the plan is a board nobody can act on.
 *
 * Bench is derived, not assumed. Who a clan benches is not in the signup list — it only becomes
 * observable when a round's lineup is revealed and some signed-up accounts are absent from it. So:
 *  - before any round is revealed for a clan, the planned bench flag is left alone;
 *  - once a lineup exists, bench = signed up but not fielded. That is why the real bench count can
 *    exceed the season's `maxBench` — the leader signed more players in than the plan allowed for,
 *    and the honest number is the one the game reports.
 *
 * Pure and I/O-free (mirrors allocation.ts / lineup.ts); src/lib/cwl/signupSync.ts is its DB half.
 */

export interface SignupMember {
  playerTag: string;
  name: string;
  thLevel: number | null;
}

/** One family clan's in-game signup list for this season. */
export interface ClanSignup {
  clanId: string;
  members: SignupMember[];
  /** True once at least one round lineup has been revealed for this clan (bench becomes knowable). */
  lineupRevealed: boolean;
}

export interface ExistingAllocation {
  id: string;
  playerTag: string;
  recommendedClanId: string | null;
  actualClanId: string | null;
  status: CWLAllocationStatus;
  isBench: boolean;
}

export interface AllocationUpdate {
  id: string;
  recommendedClanId: string | null;
  actualClanId: string | null;
  status: CWLAllocationStatus;
  isBench: boolean;
}

export interface AllocationInsert {
  playerTag: string;
  personId: string;
  clanId: string;
  isBench: boolean;
  note: string;
}

export interface ClanSignupSummary {
  clanId: string;
  signedUp: number;
  bench: number;
}

export interface ReconcileResult {
  /** Rows whose stored state differs from reality — only genuine changes are emitted. */
  updates: AllocationUpdate[];
  /** Signed-up accounts that were never rostered for this season. */
  inserts: AllocationInsert[];
  /** Signed-up tags we hold no account for (guests, or a roster sync that hasn't seen them yet). */
  unknownSignups: { playerTag: string; clanId: string }[];
  perClan: ClanSignupSummary[];
}

const UNPLANNED_NOTE = 'Signed up in-game without being on the formed roster';

const norm = (tag: string) => tag.trim().toUpperCase();

export function reconcileSignups(input: {
  signups: ClanSignup[];
  allocations: ExistingAllocation[];
  /** Tags that have appeared in a revealed round lineup, in any family clan. */
  fieldedTags: string[];
  /** person_id per known account tag — an insert needs one, so unknown tags cannot be added. */
  personByTag: Record<string, string>;
}): ReconcileResult {
  const fielded = new Set(input.fieldedTags.map(norm));

  // tag -> the clan it is signed into. A tag in two family clans is impossible in-game; last wins.
  const clanByTag = new Map<string, string>();
  const revealedByClan = new Map<string, boolean>();
  for (const s of input.signups) {
    revealedByClan.set(s.clanId, s.lineupRevealed);
    for (const m of s.members) clanByTag.set(norm(m.playerTag), s.clanId);
  }

  /** Bench is only knowable once this clan has fielded a lineup; before that, keep the plan's flag. */
  const benchFor = (clanId: string, tag: string, planned: boolean) =>
    revealedByClan.get(clanId) ? !fielded.has(tag) : planned;

  const updates: AllocationUpdate[] = [];
  const allocatedTags = new Set<string>();

  for (const a of input.allocations) {
    const tag = norm(a.playerTag);
    allocatedTags.add(tag);
    const clanId = clanByTag.get(tag) ?? null;

    const next: AllocationUpdate = clanId
      ? {
          id: a.id,
          recommendedClanId: clanId,
          actualClanId: clanId,
          status: 'matches',
          isBench: benchFor(clanId, tag, a.isBench),
        }
      : {
          // Rostered but not signed up anywhere in the family — out of this season. The actual clan
          // is left alone: it is roster-sync truth about where they sit, which we cannot see here.
          id: a.id,
          recommendedClanId: null,
          actualClanId: a.actualClanId,
          status: 'removed',
          isBench: false,
        };

    if (
      next.recommendedClanId !== a.recommendedClanId ||
      next.actualClanId !== a.actualClanId ||
      next.status !== a.status ||
      next.isBench !== a.isBench
    ) {
      updates.push(next);
    }
  }

  const inserts: AllocationInsert[] = [];
  const unknownSignups: { playerTag: string; clanId: string }[] = [];
  for (const s of input.signups) {
    for (const m of s.members) {
      const tag = norm(m.playerTag);
      if (allocatedTags.has(tag)) continue;
      const personId = input.personByTag[tag];
      if (!personId) {
        unknownSignups.push({ playerTag: m.playerTag, clanId: s.clanId });
        continue;
      }
      inserts.push({
        playerTag: m.playerTag,
        personId,
        clanId: s.clanId,
        isBench: benchFor(s.clanId, tag, false),
        note: UNPLANNED_NOTE,
      });
    }
  }

  // Per-clan reality: how many were signed in, and how many of those are sitting out. Both are read
  // off the signup list rather than the season constraints, which is the point — the bench can be
  // deeper than the plan allowed.
  const perClan: ClanSignupSummary[] = input.signups.map((s) => ({
    clanId: s.clanId,
    signedUp: s.members.length,
    bench: s.lineupRevealed ? s.members.filter((m) => !fielded.has(norm(m.playerTag))).length : 0,
  }));

  return { updates, inserts, unknownSignups, perClan };
}
