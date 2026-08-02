import { supabase } from '@/lib/supabase';
import type { CWLAllocationStatus } from '@/types/database';
import { reconcileSignups, type ClanSignup } from './signupReconcile';

/**
 * DB half of the in-game signup reconciliation (see signupReconcile.ts for the rules and the why).
 *
 * Called by live.ts once per poll, after every clan's rounds have been ingested — the bench is
 * derived from the revealed lineups, so it must read the war-member rows this poll just landed.
 *
 * Failures are logged and swallowed by the caller: reconciliation is a convenience over data the
 * dashboard can already show, and must never take down the sync.
 */

type AllocRow = {
  id: string;
  player_account_tag: string;
  recommended_clan_id: string | null;
  actual_clan_id: string | null;
  status: CWLAllocationStatus;
  is_bench: boolean;
};

export interface SignupSyncResult {
  updated: number;
  added: number;
  unknown: number;
}

export async function reconcileSeasonSignups(
  seasonId: string,
  signups: ClanSignup[],
): Promise<SignupSyncResult | null> {
  if (signups.length === 0) return null;

  const { data: allocRows, error: allocErr } = await supabase
    .from('cwl_allocations')
    .select('id, player_account_tag, recommended_clan_id, actual_clan_id, status, is_bench')
    .eq('season_id', seasonId);
  if (allocErr) throw allocErr;
  const allocations = ((allocRows as AllocRow[]) || []).map((r) => ({
    id: r.id,
    playerTag: r.player_account_tag,
    recommendedClanId: r.recommended_clan_id,
    actualClanId: r.actual_clan_id,
    status: r.status,
    isBench: r.is_bench,
  }));

  // Everyone who has appeared in a revealed lineup this season — the fielded half of the bench rule.
  const { data: roundRows } = await supabase.from('cwl_rounds').select('id').eq('season_id', seasonId);
  const roundIds = ((roundRows as { id: string }[]) || []).map((r) => r.id);
  let fieldedTags: string[] = [];
  if (roundIds.length) {
    const { data: memberRows } = await supabase
      .from('cwl_war_members')
      .select('player_tag')
      .in('round_id', roundIds);
    fieldedTags = ((memberRows as { player_tag: string }[]) || []).map((m) => m.player_tag);
  }

  // An unplanned signup can only become an allocation if we hold a linked account for it — the row
  // requires a person. Anyone else is reported as unknown rather than invented.
  const signedTags = signups.flatMap((s) => s.members.map((m) => m.playerTag));
  const personByTag: Record<string, string> = {};
  if (signedTags.length) {
    const { data: accts } = await supabase
      .from('player_accounts')
      .select('player_tag, person_id')
      .in('player_tag', signedTags);
    for (const a of (accts as { player_tag: string; person_id: string | null }[] | null) || []) {
      if (a.person_id) personByTag[a.player_tag.toUpperCase()] = a.person_id;
    }
  }

  const result = reconcileSignups({ signups, allocations, fieldedTags, personByTag });

  for (const u of result.updates) {
    const { error } = await supabase
      .from('cwl_allocations')
      .update({
        recommended_clan_id: u.recommendedClanId,
        actual_clan_id: u.actualClanId,
        status: u.status,
        is_bench: u.isBench,
      })
      .eq('id', u.id);
    if (error) console.error('CWL signup reconcile update failed:', error);
  }

  if (result.inserts.length) {
    const { error } = await supabase.from('cwl_allocations').insert(
      result.inserts.map((i) => ({
        season_id: seasonId,
        player_account_tag: i.playerTag,
        person_id: i.personId,
        recommended_clan_id: i.clanId,
        actual_clan_id: i.clanId,
        status: 'matches',
        is_bench: i.isBench,
        note: i.note,
      })),
    );
    if (error) console.error('CWL signup reconcile insert failed:', error);
  }

  await settleTransfers(seasonId, signups);

  if (result.unknownSignups.length) {
    console.warn(
      `CWL signup reconcile: ${result.unknownSignups.length} signed-up tag(s) have no linked account`,
      result.unknownSignups.map((u) => u.playerTag).join(', '),
    );
  }

  return { updated: result.updates.length, added: result.inserts.length, unknown: result.unknownSignups.length };
}

/**
 * Sign-up closing is the transfer deadline: a still-pending move either happened (the account is
 * signed into its destination) or it never will. Leaving the list "pending" through CWL week would
 * make the panel a permanent, un-actionable to-do.
 */
async function settleTransfers(seasonId: string, signups: ClanSignup[]) {
  const { data: rows } = await supabase
    .from('cwl_transfers')
    .select('id, to_clan_id, status, allocation:cwl_allocations!inner(season_id, player_account_tag)')
    .eq('allocation.season_id', seasonId)
    .eq('status', 'pending');

  type Row = { id: string; to_clan_id: string | null; allocation: { player_account_tag: string } | null };
  const pending = (rows as unknown as Row[]) || [];
  if (!pending.length) return;

  const clanByTag = new Map<string, string>();
  for (const s of signups) for (const m of s.members) clanByTag.set(m.playerTag.toUpperCase(), s.clanId);

  for (const t of pending) {
    const tag = t.allocation?.player_account_tag?.toUpperCase();
    if (!tag) continue;
    const status = clanByTag.get(tag) === t.to_clan_id ? 'done' : 'missed';
    const { error } = await supabase.from('cwl_transfers').update({ status }).eq('id', t.id);
    if (error) console.error('CWL transfer settle failed:', error);
  }
}
