import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { resyncTransfer } from '@/lib/cwl/roster';
import { describeAvailability } from '@/lib/cwl/availability';

/**
 * Apply a leader's manual edit to one allocation and keep its transfer record consistent.
 *
 * Body: { allocationId, action, clanId? }
 *  - assign  (clanId): move the player to that clan's fighting roster; status re-derived vs their
 *    actual clan (matches | transfer_required) and the pending transfer resynced.
 *  - bench / unbench:   toggle the player between bench and fighting roster within their clan.
 *  - remove:            pull the player from the season (status 'removed', pending transfer cleared).
 *  - opt_out / opt_in:  mark the ACCOUNT as not participating, and undo that. An optional
 *    { fromRound, toRound } window narrows it to a span of rounds (migration 032) — a partially
 *    available account KEEPS its roster place, since it still fights the rounds it can.
 *
 * opt_out is 'remove' plus a durable record. 'remove' only writes status onto the allocation row,
 * and every allocation row is deleted and rebuilt by a re-allocation — so a leader who sat someone
 * out found them back on the board the next time the clan order changed. opt_out additionally writes
 * cwl_season_optouts (migration 031), which is an INPUT to the engine, so the decision is re-applied
 * on every regeneration instead of being overwritten by one.
 *
 * Returns the updated allocation row so the client can splice just that card into place instead of
 * refetching (and re-rendering) the whole board.
 */
const ALLOCATION_FIELDS = 'id, player_account_tag, person_id, recommended_clan_id, actual_clan_id, status, is_bench, rank, note';
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { allocationId, action, clanId, reason, fromRound, toRound } = await request.json();
    if (!allocationId || !action) {
      return NextResponse.json({ error: 'allocationId and action are required' }, { status: 400 });
    }

    const { data: alloc, error: fetchErr } = await supabase
      .from('cwl_allocations')
      .select('id, actual_clan_id, recommended_clan_id, season_id, player_account_tag')
      .eq('id', allocationId)
      .single();
    if (fetchErr) throw fetchErr;

    switch (action) {
      case 'assign': {
        if (!clanId) return NextResponse.json({ error: 'clanId is required to assign' }, { status: 400 });
        const status = clanId === alloc.actual_clan_id ? 'matches' : 'transfer_required';
        const { error } = await supabase
          .from('cwl_allocations')
          .update({ recommended_clan_id: clanId, is_bench: false, status })
          .eq('id', allocationId);
        if (error) throw error;
        await resyncTransfer(allocationId, alloc.actual_clan_id, clanId);
        break;
      }
      case 'bench':
      case 'unbench': {
        if (action === 'bench' && !alloc.recommended_clan_id) {
          return NextResponse.json({ error: 'Assign the player to a clan before benching' }, { status: 400 });
        }
        const { error } = await supabase
          .from('cwl_allocations')
          .update({ is_bench: action === 'bench' })
          .eq('id', allocationId);
        if (error) throw error;
        break;
      }
      case 'remove': {
        const { error } = await supabase
          .from('cwl_allocations')
          .update({ recommended_clan_id: null, is_bench: false, status: 'removed', rank: null })
          .eq('id', allocationId);
        if (error) throw error;
        await resyncTransfer(allocationId, alloc.actual_clan_id, null);
        break;
      }
      case 'opt_out': {
        // A window (migration 032) narrows this to a span of rounds. Validate it here rather than
        // leaning on the CHECK constraint, so a bad request reads as a 400 and not a 500.
        const partial = fromRound != null || toRound != null;
        if (partial && !(Number.isInteger(fromRound) && Number.isInteger(toRound) && fromRound >= 1 && toRound >= fromRound)) {
          return NextResponse.json({ error: 'An unavailability window needs both ends, with toRound >= fromRound >= 1' }, { status: 400 });
        }
        // Record the decision first — if the allocation update fails the account is still marked,
        // which is the safe direction: over-excluding is visible on the board, under-excluding puts
        // someone in a war they said they could not play.
        const window = partial ? { fromRound, toRound } : { fromRound: null, toRound: null };
        const { error: optErr } = await supabase
          .from('cwl_season_optouts')
          .upsert(
            {
              season_id: alloc.season_id,
              player_account_tag: alloc.player_account_tag,
              reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
              created_by: auth.actorTag,
              unavailable_from_round: window.fromRound,
              unavailable_to_round: window.toRound,
            },
            { onConflict: 'season_id,player_account_tag' },
          );
        if (optErr) throw optErr;
        // A PARTIAL window leaves the allocation alone: the account still fights the rounds it is
        // available for, so it has to keep its clan. Pulling it off the roster would cost the clan a
        // body all season to solve a problem that lasts two rounds. Only the note changes, so the
        // board can say what the marker means; the constraint itself is the rotation's to honour.
        const update = partial
          ? { note: describeAvailability(window) }
          : {
              recommended_clan_id: null,
              is_bench: false,
              status: 'removed' as const,
              rank: null,
              note: 'Not participating this season (marked by leadership)',
            };
        const { error } = await supabase.from('cwl_allocations').update(update).eq('id', allocationId);
        if (error) throw error;
        if (!partial) await resyncTransfer(allocationId, alloc.actual_clan_id, null);
        break;
      }
      case 'opt_in': {
        // Clears the flag only. The account is back in the pool for the next re-allocation, but it
        // is NOT auto-placed: dropping a body straight back into a clan would push it over its war
        // size with no leader deciding who that displaces. Assigning it is a separate, explicit act.
        const { error: optErr } = await supabase
          .from('cwl_season_optouts')
          .delete()
          .eq('season_id', alloc.season_id)
          .eq('player_account_tag', alloc.player_account_tag);
        if (optErr) throw optErr;
        const { error } = await supabase
          .from('cwl_allocations')
          .update({ note: null })
          .eq('id', allocationId);
        if (error) throw error;
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
    }

    const { data: updated, error: readErr } = await supabase
      .from('cwl_allocations')
      .select(ALLOCATION_FIELDS)
      .eq('id', allocationId)
      .single();
    if (readErr) throw readErr;

    return NextResponse.json({ success: true, allocation: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
