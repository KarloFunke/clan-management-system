'use client';

import { useMemo } from 'react';
import { Repeat } from 'lucide-react';
import { useCWLStore } from '@/lib/stores/cwlStore';
import {
  suggestClanRotation,
  roundsPlayedByAccount,
  performanceByAccount,
  isRoundSettled,
  type ClanRotation,
  type PlayerRotationSummary,
} from '@/lib/cwl/rotation';
import { useClanName } from './useClanName';
import { useCwlScope } from './useCwlScope';
import { unavailableRounds } from '@/lib/cwl/availability';

const th: React.CSSProperties = { textAlign: 'right', padding: '5px 8px', fontSize: '0.66rem', textTransform: 'uppercase', color: 'var(--color-muted)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { textAlign: 'right', padding: '5px 8px', fontSize: '0.82rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

/** Green once qualified; muted while still reachable; warning once the plan can no longer get there. */
function bonusColor(status: PlayerRotationSummary['bonusStatus']): string {
  if (status === 'qualified') return 'var(--color-success)';
  return status === 'unreachable' ? 'var(--color-warning)' : 'var(--color-muted)';
}

function bonusTitle(s: PlayerRotationSummary): string {
  if (s.bonusStatus === 'qualified') return 'On track for the bonus if the suggested plan is followed';
  if (s.bonusStatus === 'unreachable') return 'Cannot reach the bonus in the rounds they have left';
  const parts = [s.roundsShort ? `${s.roundsShort} more war day(s)` : '', s.starsShort ? `${s.starsShort} more star(s)` : ''];
  return `Still short: ${parts.filter(Boolean).join(' and ')} — still reachable`;
}

/**
 * Forward-looking bench rotation: for every not-yet-locked round it suggests who sits, distributing
 * bench days evenly using each ACCOUNT's rounds-played so far. Read-only planning aid — the leader
 * still sets lineups in-game.
 */
export default function RotationPanel() {
  const players = useCWLStore((s) => s.players);
  const seasonClans = useCWLStore((s) => s.seasonClans);
  const rounds = useCWLStore((s) => s.rounds);
  const members = useCWLStore((s) => s.warMembers);
  const clanName = useClanName();
  const scope = useCwlScope();

  const rotations = useMemo<ClanRotation[]>(() => {
    // Each clan's rotation is computed only from its own roster and rounds, so scoping the list is
    // a pure filter — no clan's suggestion depends on another's.
    return seasonClans.filter((sc) => scope.includes(sc.clanId)).map((sc) => {
      // The signed roster for this clan (recommended there, not removed from the season).
      const roster = players
        .filter((p) => p.recommendedClanId === sc.clanId && p.status !== 'removed')
        .map((p) => ({
          playerTag: p.playerTag,
          name: p.name,
          thLevel: p.thLevel,
          leagueTier: p.leagueTier,
          playedSoFar: 0,
          starsSoFar: 0,
          attacksUsed: 0,
          missedAttacks: 0,
          // A windowed opt-out stays on the roster — it fights the rounds it can — so the constraint
          // has to arrive here, or the fairness maths would plan it into a round it already declined
          // and bench someone who was available in its place.
          unavailableRounds: p.unavailable ? new Set(unavailableRounds(p.unavailable)) : undefined,
        }));

      // Seed each account's record so far, and lock only the rounds that have actually STARTED.
      // A round in preparation has a published lineup but is still changeable in game, so it is the
      // one the leader can most usefully be advised about — treating its existence as "decided" is
      // what made this panel skip past the round on the screen and suggest the next one.
      const played = roundsPlayedByAccount(rounds, members, sc.clanId);
      const perf = performanceByAccount(rounds, members, sc.clanId);
      for (const r of roster) {
        r.playedSoFar = played.get(r.playerTag) ?? 0;
        const p = perf.get(r.playerTag);
        if (p) Object.assign(r, p);
      }
      const lockedRoundNumbers = rounds
        .filter((r) => r.clan_id === sc.clanId && isRoundSettled(r.state))
        .map((r) => r.round_number);

      return suggestClanRotation(sc.clanId, roster, sc.warSize, lockedRoundNumbers);
    });
  }, [players, seasonClans, rounds, members, scope]);

  const anyRoster = rotations.some((r) => r.rosterSize > 0);
  if (!anyRoster) {
    return (
      <div className="card" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>
        <Repeat size={24} className="text-muted" style={{ marginBottom: 'var(--space-sm)' }} />
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: 0 }}>
          No roster yet — allocate accounts to suggest a bench rotation.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {rotations.map((rot) => (
        <div key={rot.clanId} className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{clanName(rot.clanId)}</div>
            <span className="text-muted" style={{ fontSize: '0.7rem', fontVariantNumeric: 'tabular-nums' }}>
              roster {rot.rosterSize} · war {rot.warSize} · {rot.remainingRoundNumbers.length} round{rot.remainingRoundNumbers.length === 1 ? '' : 's'} left
              {/* State the rule the suggestions were made against. It is a house rule the engine
                  cannot verify, so printing it is the only way a wrong number is ever noticed. */}
              {' · bonus '}{rot.bonus.minRounds} rounds &amp; {rot.bonus.minStars}★
            </span>
          </div>

          {rot.rosterSize === 0 ? (
            <p className="text-muted" style={{ fontSize: '0.82rem', margin: 0 }}>No accounts allocated to this clan.</p>
          ) : rot.noBenchNeeded ? (
            <p className="text-muted" style={{ fontSize: '0.82rem', margin: 0 }}>
              Roster fits the war size — everyone plays every round, no benching needed.
            </p>
          ) : rot.remainingRoundNumbers.length === 0 ? (
            <p className="text-muted" style={{ fontSize: '0.82rem', margin: 0 }}>
              All {rot.totalRounds} rounds already have live lineups — nothing left to plan.
            </p>
          ) : (
            <>
              {/* Upcoming round only — the single actionable "who sits next" call. */}
              <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.03)', marginBottom: 'var(--space-md)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-cta)', fontWeight: 700 }}>
                    Bench next · Round {rot.rounds[0].roundNumber}
                  </span>
                  <span style={{ fontSize: '0.85rem' }}>
                    {rot.rounds[0].bench.length === 0
                      ? <span className="text-muted">nobody — everyone plays</span>
                      : rot.rounds[0].bench.map((s, i) => (
                          <span key={s.playerTag}>
                            {i > 0 && <span className="text-muted">, </span>}
                            {s.name}<span className="text-muted" style={{ fontSize: '0.68rem' }}> TH{s.thLevel}</span>
                          </span>
                        ))}
                  </span>
                </div>
                {/* Named, not silently dropped: if the round comes up short of a full lineup, the
                    leader needs to know which absence caused it and who to chase. */}
                {rot.rounds[0].unavailable.length > 0 && (
                  <div className="text-muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>
                    Unavailable: {rot.rounds[0].unavailable.map((s) => s.name).join(', ')}
                    {rot.rounds[0].playing.length < rot.warSize && (
                      <span className="text-warning"> · lineup short by {rot.warSize - rot.rounds[0].playing.length}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Fairness summary — projected war days per player so leaders can see the balance. */}
              <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', color: 'var(--color-muted)', letterSpacing: '0.05em', marginBottom: 4 }}>Projected war days</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 360 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: 'left' }}>Member</th>
                      <th style={th} title="Rounds already fought">Played</th>
                      <th style={th} title="Rounds we suggest they play next">Suggested</th>
                      <th style={th} title="Rounds we suggest they sit">Bench</th>
                      <th style={th} title="Rounds they are marked unavailable for">Out</th>
                      <th style={th} title="Stars scored this season">Stars</th>
                      <th style={th} title={`Bonus standing if the suggested plan is followed (${rot.bonus.minRounds} rounds & ${rot.bonus.minStars}★)`}>Bonus</th>
                      <th style={th} title="Projected war days by season end">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rot.summary.map((s) => (
                      <tr key={s.playerTag} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 500 }}>{s.name}</td>
                        <td style={td}>{s.playedSoFar}</td>
                        <td style={td}>{s.suggestedPlays}</td>
                        <td style={{ ...td, color: s.benchRounds > 0 ? 'var(--color-muted)' : undefined }}>{s.benchRounds}</td>
                        <td style={{ ...td, color: s.unavailableRounds > 0 ? 'var(--color-warning)' : 'var(--color-muted)' }}>
                          {s.unavailableRounds || '—'}
                        </td>
                        <td style={td}>{s.starsSoFar}</td>
                        {/* What is still MISSING, not a tick — a leader acting on this row needs the
                            gap, and "3★ short" is a different instruction from "1 round short". */}
                        <td style={{ ...td, color: bonusColor(s.bonusStatus) }} title={bonusTitle(s)}>
                          {s.bonusStatus === 'qualified'
                            ? '✓'
                            : [s.roundsShort ? `${s.roundsShort}r` : '', s.starsShort ? `${s.starsShort}★` : '']
                                .filter(Boolean)
                                .join(' + ')}
                        </td>
                        <td style={{ ...td, fontWeight: 600 }}>{s.projectedTotal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
