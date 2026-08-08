'use client';

import { useState } from 'react';
import { Swords, ChevronDown, ChevronRight, Star, ArrowUp, ArrowDown, Repeat } from 'lucide-react';
import type { CWLLineupChangeEvent, CWLRound, CWLWarMember } from '@/types/database';
import { useCWLStore } from '@/lib/stores/cwlStore';
import { diffLineup, type LineupDiff } from '@/lib/cwl/lineup';
import { countSwappedPositions, diffFieldedLineups, type FieldedSlot, type LineupChange } from '@/lib/cwl/lineupChange';
import { useClanName } from './useClanName';
import { useCwlScope } from './useCwlScope';
import type { RosterPlayer } from './types';

const STATE_LABEL: Record<string, string> = {
  preparation: 'Prep', inWar: 'Battle Day', warEnded: 'Ended',
};

/**
 * How the in-game lineup differed from the roster we formed. The wars are fought by whoever is
 * actually in the war — everything downstream (performance, rotation, strikes) already reads the
 * real lineup — so this is purely so a leader can SEE the drift instead of trusting a roster board
 * that stopped being true on day one.
 */
function LineupDrift({ diff, basis }: { diff: LineupDiff; basis: 'plan' | 'previous_round' }) {
  const vsPlan = basis === 'plan';
  if (diff.matchesPlan) {
    return (
      <span className="text-muted" style={{ fontSize: '0.68rem' }}>{vsPlan ? 'as planned' : 'unchanged'}</span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.68rem' }}>
      {diff.swappedIn.length > 0 && (
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--color-warning)', fontWeight: 700 }}
          title={diff.swappedIn
            .map((p) => (vsPlan ? `${p.name} (${p.reason === 'from_bench' ? 'from bench' : 'not on this roster'})` : p.name))
            .join('\n')}
        >
          <ArrowUp size={11} />{diff.swappedIn.length} in
        </span>
      )}
      {diff.swappedOut.length > 0 && (
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--color-muted)' }}
          title={diff.swappedOut.map((p) => p.name).join('\n')}
        >
          <ArrowDown size={11} />{diff.swappedOut.length} out
        </span>
      )}
    </span>
  );
}

/**
 * The most recent EARLIER round this clan actually fielded. Walks backwards rather than taking N-1
 * blindly: a round can be revealed but not yet polled, and an empty lineup would read as the whole
 * war rotating in. Mirrors previousRoundLineup() in lineupNotify.ts — same question, client side.
 */
function previousFieldedLineup(
  clanRounds: CWLRound[],
  membersByRound: Map<string, CWLWarMember[]>,
  roundNumber: number,
): FieldedSlot[] | null {
  const earlier = clanRounds.filter((r) => r.round_number < roundNumber).sort((a, b) => b.round_number - a.round_number);
  for (const r of earlier) {
    const rows = membersByRound.get(r.id) || [];
    if (rows.length) return rows.map((m) => ({ playerTag: m.player_tag, name: m.name || m.player_tag }));
  }
  return null;
}

/**
 * Shape a rotation diff into the LineupDiff the badge renders. `reason` is forced to 'unplanned':
 * "from the bench" is a claim about the plan, and this comparison is not against the plan.
 */
function asLineupDiff(change: LineupChange, actualSize: number, previousSize: number): LineupDiff {
  return {
    swappedIn: change.swappedIn.map((s) => ({ ...s, reason: 'unplanned' as const })),
    swappedOut: change.swappedOut,
    asPlanned: actualSize - change.swappedIn.length,
    plannedSize: previousSize,
    actualSize,
    matchesPlan: !change.changed,
  };
}

/** Hover text for the swap badge — one line per recorded change. */
function swapSummary(changes: CWLLineupChangeEvent[]): string {
  return changes
    .map((c) => {
      const parts: string[] = [];
      if (c.swappedIn.length) parts.push(`in: ${c.swappedIn.map((p) => p.name).join(', ')}`);
      if (c.swappedOut.length) parts.push(`out: ${c.swappedOut.map((p) => p.name).join(', ')}`);
      return `${new Date(c.at).toLocaleString()} — ${parts.join(' · ')}`;
    })
    .join('\n');
}

/** Live per-round CWL lineups for the season, grouped by family clan. Read-only — filled by sync. */
export default function LiveRoundsPanel() {
  const allRounds = useCWLStore((s) => s.rounds);
  const members = useCWLStore((s) => s.warMembers);
  const players = useCWLStore((s) => s.players);
  const clanName = useClanName();
  const scope = useCwlScope();

  const [open, setOpen] = useState<Record<string, boolean>>({});

  const rounds = allRounds.filter((r) => scope.includes(r.clan_id));

  if (rounds.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>
        <Swords size={24} className="text-muted" style={{ marginBottom: 'var(--space-sm)' }} />
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: 0 }}>
          {allRounds.length === 0
            ? 'No live rounds yet — run a sync during CWL week to pull lineups.'
            : 'No rounds for this clan yet. Switch to All Clans to see the rest of the family.'}
        </p>
      </div>
    );
  }

  const membersByRound = new Map<string, CWLWarMember[]>();
  for (const m of members) {
    if (!membersByRound.has(m.round_id)) membersByRound.set(m.round_id, []);
    membersByRound.get(m.round_id)!.push(m);
  }

  // The formed roster, per clan — the PLAN half of the drift check. Bench flag carried through, since
  // a benched account sitting out is the plan working rather than a swap.
  const plannedByClan = new Map<string, RosterPlayer[]>();
  for (const p of players) {
    if (!p.recommendedClanId) continue;
    if (!plannedByClan.has(p.recommendedClanId)) plannedByClan.set(p.recommendedClanId, []);
    plannedByClan.get(p.recommendedClanId)!.push(p);
  }

  // Group rounds by family clan, each sorted by round number.
  const byClan = new Map<string, CWLRound[]>();
  for (const r of rounds) {
    if (!byClan.has(r.clan_id)) byClan.set(r.clan_id, []);
    byClan.get(r.clan_id)!.push(r);
  }
  for (const list of byClan.values()) list.sort((a, b) => a.round_number - b.round_number);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {Array.from(byClan.entries()).map(([clanId, clanRounds]) => (
        <div key={clanId} className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>{clanName(clanId)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
            {clanRounds.map((r) => {
              const isOpen = !!open[r.id];
              const roster = (membersByRound.get(r.id) || []).slice().sort((a, b) => (a.map_position ?? 99) - (b.map_position ?? 99));
              const ended = r.state === 'warEnded';
              const actual = roster.map((m) => ({ playerTag: m.player_tag, name: m.name || m.player_tag, mapPosition: m.map_position }));
              // WHAT to compare against — the same correction the Discord reveal notice carries.
              // The plan is only honest for a clan's FIRST fielded round: signupReconcile.ts derives
              // `is_bench` from "has appeared in any revealed lineup", which is cumulative, so by
              // round 3 nearly the whole signed-up roster counts as a starter. Diffing a 15-man war
              // against 40 starters reported the rotating bench as swapped out every round while a
              // returning player — a starter by that rule — never registered as swapped in, which is
              // why the in count read low and the out count high. From the second fielded round the
              // comparison is lineup-vs-lineup against the previous one: symmetric by construction,
              // and the question a leader actually has is "who changed since last round".
              const previous = previousFieldedLineup(clanRounds, membersByRound, r.round_number);
              const diff = previous
                ? asLineupDiff(diffFieldedLineups(previous, actual), actual.length, previous.length)
                : diffLineup(
                    (plannedByClan.get(r.clan_id) || []).map((p) => ({ playerTag: p.playerTag, name: p.name, isBench: p.isBench })),
                    actual,
                  );
              // Only meaningful once a lineup exists; an unrevealed round would read as "everyone out".
              const showDrift = roster.length > 0;
              const swappedInTags = new Set(diff.swappedIn.map((p) => p.playerTag.toUpperCase()));
              // Swaps made after the reveal. The plan is rewritten from the in-game signup list on
              // every sync, so the drift badge beside it cannot see these — only this log can.
              const swaps = r.lineup_changes || [];
              // Counted in players, not in recorded events — several players swapped between two
              // syncs land in one event, which made a collapsed round say "1 swap" and expand to
              // three names. See countSwappedPositions.
              const swapCount = countSwappedPositions(swaps.map((c) => ({ ...c, changed: true })));
              // Anyone brought in after the reveal is tagged in the lineup itself too, not just in
              // the log — the plan-based check above cannot flag them once the plan has caught up.
              const swappedInLate = new Set(swaps.flatMap((c) => c.swappedIn.map((p) => p.playerTag.toUpperCase())));
              return (
                <div key={r.id}>
                  <button
                    onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}
                    style={{
                      display: 'grid', gridTemplateColumns: '18px 1fr auto', alignItems: 'center', gap: 'var(--space-sm)',
                      background: 'transparent', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
                      padding: '6px 4px', borderRadius: 'var(--radius-md)',
                    }}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                    <span style={{ fontSize: '0.85rem' }}>
                      <span style={{ fontWeight: 600 }}>Round {r.round_number}</span>
                      <span className="text-muted"> vs {r.opponent_name || '—'}</span>
                      <span className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', marginLeft: 6 }}>{STATE_LABEL[r.state] || r.state}</span>
                      {showDrift && <span style={{ marginLeft: 8 }}><LineupDrift diff={diff} basis={previous ? 'previous_round' : 'plan'} /></span>}
                      {swapCount > 0 && (
                        <span
                          title={`The lineup changed after it was revealed:\n${swapSummary(swaps)}`}
                          style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: '0.68rem', color: 'var(--color-warning)', fontWeight: 700 }}
                        >
                          <Repeat size={11} />{swapCount} swap{swapCount === 1 ? '' : 's'}
                        </span>
                      )}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>
                      <Star size={12} className="text-cta" /> {r.our_stars}
                      <span className="text-muted"> · {Math.round(r.our_destruction)}% · {r.our_attacks_used}/{r.team_size ?? '—'}</span>
                    </span>
                  </button>

                  {isOpen && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 4px 8px 26px' }}>
                      {roster.length === 0 && <span className="text-muted" style={{ fontSize: '0.8rem' }}>No lineup recorded.</span>}
                      {/* Planned starters who never made the war — they have no row of their own here,
                          so they are listed above the lineup rather than silently vanishing. */}
                      {/* Post-reveal swaps, oldest first — the durable record of a lineup change a
                          leader made on prep day, which the plan-based drift badge cannot show. */}
                      {swaps.map((c) => (
                        <div key={c.at} style={{ fontSize: '0.72rem', color: 'var(--color-warning)', paddingBottom: 2 }}>
                          <Repeat size={10} style={{ verticalAlign: -1, marginRight: 4 }} />
                          {new Date(c.at).toLocaleString()} —{' '}
                          {c.swappedIn.length > 0 && <>in: {c.swappedIn.map((p) => p.name).join(', ')}</>}
                          {c.swappedIn.length > 0 && c.swappedOut.length > 0 && ' · '}
                          {c.swappedOut.length > 0 && <>out: {c.swappedOut.map((p) => p.name).join(', ')}</>}
                        </div>
                      ))}
                      {showDrift && diff.swappedOut.length > 0 && (
                        <div className="text-muted" style={{ fontSize: '0.72rem', paddingBottom: 2 }}>
                          {previous ? 'Resting this round' : 'Not fielded'}: {diff.swappedOut.map((p) => p.name).join(', ')}
                        </div>
                      )}
                      {roster.map((m) => {
                        const missed = m.attacks_used === 0 && ended;
                        const tagKey = m.player_tag.toUpperCase();
                        const swappedIn = swappedInTags.has(tagKey) || swappedInLate.has(tagKey);
                        return (
                          // Name left, result right, with a dotted leader bridging them — a 15-name
                          // list of two far-apart columns is hard to read across, and the leader is
                          // the table-of-contents trick for exactly that.
                          <div key={m.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, auto) minmax(16px, 1fr) auto', alignItems: 'center', gap: 'var(--space-xs)', fontSize: '0.8rem' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <span className="text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{m.map_position ?? '—'}. </span>
                              {m.name || m.player_tag}
                              <span className="text-muted" style={{ fontSize: '0.7rem' }}> · TH{m.th_level ?? '—'}</span>
                              {swappedIn && (
                                <span
                                  title={previous ? 'Rotated in — not in the previous round\'s lineup' : 'In the war without being a planned starter for this clan'}
                                  style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--color-warning)', marginLeft: 5, letterSpacing: '0.04em' }}
                                >
                                  SWAP IN
                                </span>
                              )}
                            </span>
                            <span aria-hidden style={{ borderBottom: '1px dotted rgba(148, 163, 184, 0.3)', transform: 'translateY(-2px)' }} />
                            {missed ? (
                              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-danger)', letterSpacing: '0.04em' }}>MISSED</span>
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontVariantNumeric: 'tabular-nums' }}>
                                {m.attacks_used > 0 ? (
                                  <>
                                    <Star size={11} className="text-cta" /> {m.stars} <span className="text-muted">· {Math.round(m.destruction)}%</span>
                                  </>
                                ) : (
                                  <span className="text-muted" style={{ fontSize: '0.7rem' }}>not yet</span>
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
