import type { CWLLeagueTierId, CWLRound, CWLWarMember } from '@/types/database';
import { tierOrder } from './leagues';

/**
 * CWL bench-rotation suggester (Phase 4).
 *
 * A CWL season is TOTAL_ROUNDS war days, and each war day a clan fields only `warSize` of its signed
 * roster. When the roster is bigger than the war size, someone has to sit every round — and doing that
 * fairly (so the same people don't always bench) is exactly what leaders were eyeballing by hand.
 *
 * This is the forward-looking counterpart to performance.ts / history.ts (which RECORD rounds already
 * played): given each ACCOUNT's rounds-played SO FAR (from synced actuals) it recommends, for every
 * round not yet locked, who plays and who benches — always letting the under-played catch up first so
 * everyone lands on a similar number of war days by the end of the season.
 *
 * Pure and side-effect free (no Supabase/I/O) so the fairness maths is unit-testable and the panel
 * stays thin — same shape as the other cwl/ engines. `roundsPlayedByAccount` is the one small bridge
 * from the stored round/member rows to this engine's `playedSoFar` input.
 */

/** A CWL season is always seven war days. */
export const TOTAL_ROUNDS = 7;

/** Best a single CWL attack can score — the ceiling every reachability check is measured against. */
const MAX_STARS_PER_ATTACK = 3;

/**
 * A round counts as PLAYED, and as locked against further planning, only once battle day has begun.
 *
 * This is the same line performance.ts draws, and for the same reason: the lineup is published at the
 * start of prep day, so a round in `preparation` has a roster but no war. Treating it as locked is
 * what made the panel suggest round 4 while round 3 was still on prep day — the one round the leader
 * could still actually change was the one it refused to talk about.
 */
export function isRoundSettled(state: string | null): boolean {
  return state === 'inWar' || state === 'warEnded';
}

/**
 * The family's CWL bonus-medal rule: a member qualifies by playing enough war days AND scoring
 * enough stars. It is a house rule, not something the game reports, so it lives here as data the
 * rotation can chase rather than as a number buried in a comparator.
 *
 * The rotation's PRIMARY fairness is still rounds played — that is what a benched player counts. The
 * bonus condition is the tiebreak beneath it: between two equally-rested accounts, the one still
 * short of qualifying (and still able to get there) takes the slot, because for them the round is
 * worth something it is not worth to someone already qualified.
 */
export interface BonusCondition {
  minRounds: number;
  minStars: number;
}

/** Four of seven war days and eight stars. Surfaced in the panel header so a wrong guess is visible. */
export const DEFAULT_BONUS_CONDITION: BonusCondition = { minRounds: 4, minStars: 8 };

/** One signed roster member, with the rounds they have ALREADY been fielded in this season. */
export interface RotationPlayer {
  playerTag: string;
  name: string;
  thLevel: number;
  leagueTier: CWLLeagueTierId | null;
  playedSoFar: number; // rounds already fought (seeds fairness so under-played players catch up)
  // Rounds this account has been marked unavailable for (cwl_season_optouts' partial window,
  // migration 032). Empty for everyone the leader has said nothing about.
  unavailableRounds?: ReadonlySet<number>;
  // Season performance so far, from the same war-member rows the performance panel reads. All
  // optional: an account with nothing recorded yet simply has no performance signal, and falls
  // through to the strength tiebreak rather than being ranked as if it had scored zero.
  starsSoFar?: number;
  attacksUsed?: number;
  missedAttacks?: number;
}

/** An account referenced inside a round plan or summary (a thin slice of RotationPlayer). */
export interface RotationSlot {
  playerTag: string;
  name: string;
  thLevel: number;
}

/** The suggested lineup for one not-yet-locked round. */
export interface RotationRoundPlan {
  roundNumber: number;
  playing: RotationSlot[]; // exactly warSize (or the whole AVAILABLE roster when it is smaller)
  bench: RotationSlot[]; // everyone sitting this round — the actionable "who to bench" list
  // Marked unavailable for this round, so not an option either way. Held apart from `bench` because
  // benching is a decision the leader is making and this is one already made for them — and because
  // a lineup that comes up short needs to name who is missing, not just be quietly small.
  unavailable: RotationSlot[];
}

/** Per-player projection across the remaining rounds. */
export interface PlayerRotationSummary {
  playerTag: string;
  name: string;
  thLevel: number;
  playedSoFar: number;
  suggestedPlays: number; // remaining rounds we recommend they play
  benchRounds: number; // remaining rounds we recommend they sit (excludes unavailable ones)
  unavailableRounds: number; // remaining rounds they cannot play at all
  projectedTotal: number; // playedSoFar + suggestedPlays — the season-end war-day count
  // Bonus-medal standing. `bonusStatus` is the one a leader reads:
  //   'qualified'   — already met both halves of the condition
  //   'chasing'     — short, but can still get there in the rounds left to them
  //   'unreachable' — short by more than the remaining rounds can deliver
  starsSoFar: number;
  starsShort: number; // stars still needed (0 once met)
  roundsShort: number; // war days still needed (0 once met)
  bonusStatus: 'qualified' | 'chasing' | 'unreachable';
}

/** A whole clan's rotation recommendation. */
export interface ClanRotation {
  clanId: string;
  warSize: number;
  rosterSize: number;
  totalRounds: number;
  remainingRoundNumbers: number[]; // round numbers we produced a plan for (not yet locked)
  rounds: RotationRoundPlan[];
  summary: PlayerRotationSummary[]; // sorted strongest-first for a stable read
  noBenchNeeded: boolean; // roster fits the war size — nobody ever has to sit
  bonus: BonusCondition; // the rule the suggestions were made against, so the panel can state it
}

// Strongest-first: higher TH, then higher Ranked sub-division, then name (matches allocation.ts).
function byStrength(a: RotationPlayer, b: RotationPlayer): number {
  if (b.thLevel !== a.thLevel) return b.thLevel - a.thLevel;
  const l = tierOrder(b.leagueTier) - tierOrder(a.leagueTier);
  if (l !== 0) return l;
  return a.name.localeCompare(b.name);
}

const toSlot = (p: RotationPlayer): RotationSlot => ({ playerTag: p.playerTag, name: p.name, thLevel: p.thLevel });

/**
 * How well an account has performed, as a comparator — better first.
 *
 * Missed attacks come before star rate deliberately. A miss is a different kind of fact from a weak
 * hit: it costs the clan a whole attack and it is what the strike system acts on, so an account that
 * showed up and two-starred outranks one that did not show up at all, however good its average.
 *
 * An account with no attacks yet has no signal, and returning 0 hands the decision down to strength
 * rather than ranking a newcomer as though it had performed badly.
 */
function byPerformance(a: RotationPlayer, b: RotationPlayer): number {
  const missedA = a.missedAttacks ?? 0;
  const missedB = b.missedAttacks ?? 0;
  if (missedA !== missedB) return missedA - missedB;

  const usedA = a.attacksUsed ?? 0;
  const usedB = b.attacksUsed ?? 0;
  if (usedA === 0 || usedB === 0) return 0; // no comparable record — fall through to strength
  const rateA = (a.starsSoFar ?? 0) / usedA;
  const rateB = (b.starsSoFar ?? 0) / usedB;
  if (rateA === rateB) return 0;
  return rateB - rateA;
}

/** Stars still needed for the bonus, and war days still needed. Zero once that half is met. */
function shortfall(p: RotationPlayer, bonus: BonusCondition, playedNow: number) {
  return {
    starsShort: Math.max(0, bonus.minStars - (p.starsSoFar ?? 0)),
    roundsShort: Math.max(0, bonus.minRounds - playedNow),
  };
}

/**
 * Can this account still reach the bonus, given the rounds it has left?
 *
 * Both halves have to be reachable: stars are capped at three per remaining round, and the round
 * count cannot exceed the rounds it is actually available for. Prioritising an account that cannot
 * get there would spend a war day chasing something already lost — and, worse, take that day from
 * someone who could still make it.
 */
function canStillQualify(starsShort: number, roundsShort: number, roundsLeft: number): boolean {
  return roundsShort <= roundsLeft && starsShort <= roundsLeft * MAX_STARS_PER_ATTACK;
}

/**
 * Count, per ACCOUNT, how many of a clan's rounds it has already been fielded in. An account
 * "played" a round if it appears in the lineup (whether or not the attack was used) — that is what
 * consumes a war-day slot. Only rounds belonging to `clanId` AND already at battle day are counted:
 * a round still in preparation has a lineup but no war, and crediting it made a prep-day roster look
 * like a fought one to the fairness maths (see isRoundSettled).
 *
 * Keyed on player_tag, not person_id: a war day is spent by a base, so a person fielding a main in
 * one clan and an alt in another has each account earning its own rotation credit. Keying on the
 * person would have made one player's two accounts share (and halve) a single fairness budget.
 */
export function roundsPlayedByAccount(
  rounds: CWLRound[],
  members: CWLWarMember[],
  clanId: string,
): Map<string, number> {
  const clanRoundIds = new Set(
    rounds.filter((r) => r.clan_id === clanId && isRoundSettled(r.state)).map((r) => r.id),
  );
  // An account appears once per round; guard against dupes by counting distinct (tag, round) pairs.
  const seen = new Set<string>();
  const played = new Map<string, number>();
  for (const m of members) {
    if (!clanRoundIds.has(m.round_id)) continue;
    const pair = `${m.player_tag}::${m.round_id}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    played.set(m.player_tag, (played.get(m.player_tag) ?? 0) + 1);
  }
  return played;
}

/** What one account has scored so far this season, for the bonus condition and the tiebreak. */
export interface AccountPerformance {
  starsSoFar: number;
  attacksUsed: number;
  missedAttacks: number;
}

/**
 * Roll a clan's war-member rows up per ACCOUNT — the rotation's own small bridge from stored rows to
 * engine input, alongside roundsPlayedByAccount.
 *
 * Deliberately not reusing computeSeasonPerformance: that one groups by PERSON where a person is
 * linked, because the performance table is about people. The rotation is about bases — a person
 * fielding a main and an alt has two independent slots to fill — so collapsing their alts here would
 * hand both accounts the other's stars.
 *
 * A miss is only counted once its round has ENDED, matching performance.ts: an unused attack in a
 * war still being fought is not a miss yet.
 */
export function performanceByAccount(
  rounds: CWLRound[],
  members: CWLWarMember[],
  clanId: string,
): Map<string, AccountPerformance> {
  const clanRoundIds = new Set(rounds.filter((r) => r.clan_id === clanId).map((r) => r.id));
  const endedRoundIds = new Set(
    rounds.filter((r) => r.clan_id === clanId && r.state === 'warEnded').map((r) => r.id),
  );

  const out = new Map<string, AccountPerformance>();
  for (const m of members) {
    if (!clanRoundIds.has(m.round_id)) continue;
    let acc = out.get(m.player_tag);
    if (!acc) {
      acc = { starsSoFar: 0, attacksUsed: 0, missedAttacks: 0 };
      out.set(m.player_tag, acc);
    }
    acc.starsSoFar += m.stars;
    acc.attacksUsed += m.attacks_used;
    if (m.attacks_used === 0 && endedRoundIds.has(m.round_id)) acc.missedAttacks += 1;
  }
  return out;
}

/**
 * Suggest who benches in each not-yet-locked round for one clan.
 *
 * @param roster           the clan's signed roster, each with playedSoFar.
 * @param warSize          how many attack each round (15 | 30).
 * @param lockedRoundNumbers round numbers already decided (have a live lineup) — skipped.
 * @param totalRounds      war days in the season (default TOTAL_ROUNDS = 7).
 */
export function suggestClanRotation(
  clanId: string,
  roster: RotationPlayer[],
  warSize: number,
  lockedRoundNumbers: number[] = [],
  totalRounds: number = TOTAL_ROUNDS,
  bonus: BonusCondition = DEFAULT_BONUS_CONDITION,
): ClanRotation {
  const locked = new Set(lockedRoundNumbers);
  const remainingRoundNumbers: number[] = [];
  for (let n = 1; n <= totalRounds; n++) if (!locked.has(n)) remainingRoundNumbers.push(n);

  // Live tally of rounds each account will have played, seeded from actuals so the fairness engine
  // accounts for war days that already happened.
  const played = new Map<string, number>();
  const plays = new Map<string, number>(); // suggested plays across the remaining rounds
  for (const p of roster) {
    played.set(p.playerTag, p.playedSoFar);
    plays.set(p.playerTag, 0);
  }

  const isOut = (p: RotationPlayer, roundNumber: number) => p.unavailableRounds?.has(roundNumber) ?? false;
  const unavailableCount = new Map<string, number>();
  for (const p of roster) unavailableCount.set(p.playerTag, 0);

  // How many of the remaining rounds each account can still play, counted from each round onwards.
  // Built once by a reverse pass rather than re-derived per comparison, and it is what makes
  // "can still qualify" honest for a partially-unavailable account: someone gone after round 5 has
  // fewer chances left than the calendar suggests, and prioritising them for a bonus they can no
  // longer reach would take the slot from someone who can.
  const roundsLeftFrom = new Map<string, number[]>();
  for (const p of roster) {
    const counts = new Array<number>(remainingRoundNumbers.length).fill(0);
    let running = 0;
    for (let i = remainingRoundNumbers.length - 1; i >= 0; i--) {
      if (!isOut(p, remainingRoundNumbers[i])) running++;
      counts[i] = running;
    }
    roundsLeftFrom.set(p.playerTag, counts);
  }

  const rounds: RotationRoundPlan[] = remainingRoundNumbers.map((roundNumber, roundIndex) => {
    // Anyone marked unavailable is not a candidate at all — planning them in and then benching them
    // would spend a fairness slot on a round they were never going to fight, pushing a player who
    // COULD have played onto the bench in their place.
    const unavailable = roster.filter((p) => isOut(p, roundNumber));
    for (const p of unavailable) unavailableCount.set(p.playerTag, unavailableCount.get(p.playerTag)! + 1);
    const available = roster.filter((p) => !isOut(p, roundNumber));

    // Fairness order, in four tiers. Rounds played stays PRIMARY — it is the thing a benched player
    // actually counts, and letting anything outrank it would turn "fair rotation" into "best players
    // play". Everything below it only ever separates accounts that have had the same number of war
    // days, which is exactly where a leader currently flips a coin:
    //
    //   1. fewest rounds played           — catch-up, unchanged
    //   2. still chasing a reachable bonus — the round is worth more to them than to a qualified account
    //   3. better season performance       — fewer misses, then a higher star rate
    //   4. strength (TH, then tier, then name)
    const chasing = (p: RotationPlayer): boolean => {
      const playedNow = played.get(p.playerTag)!;
      const { starsShort, roundsShort } = shortfall(p, bonus, playedNow);
      if (starsShort === 0 && roundsShort === 0) return false; // already qualified
      return canStillQualify(starsShort, roundsShort, roundsLeftFrom.get(p.playerTag)![roundIndex]);
    };

    const order = available.slice().sort((a, b) => {
      const pa = played.get(a.playerTag)!;
      const pb = played.get(b.playerTag)!;
      if (pa !== pb) return pa - pb;
      const ca = chasing(a) ? 0 : 1;
      const cb = chasing(b) ? 0 : 1;
      if (ca !== cb) return ca - cb;
      const perf = byPerformance(a, b);
      if (perf !== 0) return perf;
      return byStrength(a, b);
    });
    const playing = order.slice(0, warSize);
    const bench = order.slice(warSize);
    for (const p of playing) {
      played.set(p.playerTag, played.get(p.playerTag)! + 1);
      plays.set(p.playerTag, plays.get(p.playerTag)! + 1);
    }
    return {
      roundNumber,
      playing: playing.map(toSlot),
      bench: bench.map(toSlot),
      unavailable: unavailable.map(toSlot),
    };
  });

  const remainingCount = remainingRoundNumbers.length;
  const summary: PlayerRotationSummary[] = roster
    .slice()
    .sort(byStrength)
    .map((p) => {
      const suggestedPlays = plays.get(p.playerTag)!;
      const out = unavailableCount.get(p.playerTag)!;
      // Reported against the PROJECTED season, not today: a leader reading "2 rounds short" wants to
      // know whether the plan in front of them fixes it, and a shortfall the suggestions already
      // close is not something to act on.
      const projectedTotal = p.playedSoFar + suggestedPlays;
      const { starsShort, roundsShort } = shortfall(p, bonus, projectedTotal);
      const roundsLeft = remainingCount - out;
      const bonusStatus: PlayerRotationSummary['bonusStatus'] =
        starsShort === 0 && roundsShort === 0
          ? 'qualified'
          : canStillQualify(starsShort, roundsShort, roundsLeft)
            ? 'chasing'
            : 'unreachable';
      return {
        playerTag: p.playerTag,
        name: p.name,
        thLevel: p.thLevel,
        playedSoFar: p.playedSoFar,
        suggestedPlays,
        // Rounds they were available for and we still sat them. Counting the unavailable ones as
        // bench would read as the rotation treating them unfairly when it never had the choice.
        benchRounds: remainingCount - suggestedPlays - out,
        unavailableRounds: out,
        projectedTotal,
        starsSoFar: p.starsSoFar ?? 0,
        starsShort,
        roundsShort,
        bonusStatus,
      };
    });

  return {
    clanId,
    warSize,
    rosterSize: roster.length,
    totalRounds,
    remainingRoundNumbers,
    rounds,
    summary,
    noBenchNeeded: roster.length <= warSize,
    bonus,
  };
}
