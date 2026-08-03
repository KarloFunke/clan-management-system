import type { CWLAllocationStatus, CWLTransferStatus, CWLLeagueTierId } from '@/types/database';
import type { AvailabilityWindow } from '@/lib/cwl/availability';

// One ACCOUNT on the roster board: its allocation joined with the account's live stats. CWL signs up
// accounts, so a person's main and alts each appear as their own row; `personName` is what visually
// groups them back together (and links to the profile).
export interface RosterPlayer {
  allocationId: string;
  playerTag: string;
  personId: string;
  name: string; // the account's in-game name — what a leader reads on a war map
  personName: string; // the family display name behind the account
  isAlt: boolean; // this person has more than one account in the season pool
  thLevel: number;
  leagueTier: CWLLeagueTierId | null;
  recommendedClanId: string | null;
  actualClanId: string | null;
  status: CWLAllocationStatus;
  isBench: boolean;
  // The engine's reason for excluding this account (no eligible clan, family full, active strike,
  // not participating), or the signup reconciler's reason for adding it. Null for a normally placed
  // account and for a leader's manual removal.
  note: string | null;
  // Leadership has marked this account unavailable (cwl_season_optouts, migrations 031/032), or null
  // if they have not. Held apart from `status` because it outlives the allocation row: a
  // re-allocation rebuilds every row, and this decision is re-applied to the fresh one.
  //
  // An unbounded window ({ null, null }) is the whole season and keeps the account off the roster
  // entirely; a bounded one is a span of rounds and leaves it ON the roster, because it still fights
  // the rounds it can. Use isFullSeason() rather than testing the ends — see lib/cwl/availability.ts.
  unavailable: AvailabilityWindow | null;
}

// A required in-game move. Clan ids (not names) — the panel resolves them through ClanContext, the
// same source the rest of the page names clans from.
export interface TransferItem {
  id: string;
  playerName: string; // the account being moved
  personName: string;
  fromClanId: string | null;
  toClanId: string | null;
  status: CWLTransferStatus;
}

// One clan in the season pool, in fill-priority order (index 0 = filled first).
export interface SeasonClan {
  clanId: string;
  warSize: number;
  priority: number;
}

export type MoveAction = 'assign' | 'bench' | 'unbench' | 'remove' | 'opt_out' | 'opt_in';

/** Extra body for an 'opt_out' that covers only part of the season. */
export interface MoveOptions {
  fromRound?: number | null;
  toRound?: number | null;
}
