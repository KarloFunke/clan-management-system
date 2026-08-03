'use client';

import { useState } from 'react';
import { MoreVertical, ArrowRightLeft, Users, Info } from 'lucide-react';
import { useClan } from '@/lib/ClanContext';
import { useCWLStore } from '@/lib/stores/cwlStore';
import { tierLabel, tierOrder } from '@/lib/cwl/leagues';
import { benchReason, groupExclusions } from '@/lib/cwl/rosterReason';
import { SEASON_ROUNDS, afterRound, describeAvailability, isFullSeason, untilRound } from '@/lib/cwl/availability';
import { useClanName } from './useClanName';
import { useCwlScope } from './useCwlScope';
import type { RosterPlayer, MoveAction, MoveOptions } from './types';

// Strongest-first, matching the engine's ordering, so the board reads consistently after edits.
function byStrength(a: RosterPlayer, b: RosterPlayer): number {
  if (b.thLevel !== a.thLevel) return b.thLevel - a.thLevel;
  const l = tierOrder(b.leagueTier) - tierOrder(a.leagueTier);
  if (l !== 0) return l;
  return a.name.localeCompare(b.name);
}

function PlayerRow({
  player,
  currentClanId,
  reason,
}: {
  player: RosterPlayer;
  currentClanId: string | null; // the clan column this row sits in (null = unassigned)
  reason?: string; // why this account is not in the fighting lineup, shown under the name
}) {
  const [open, setOpen] = useState(false);
  // Which round picker is expanded, if any. Kept in the menu rather than opened as a modal: picking
  // a round is a single click and a dialog would put a confirmation step in front of it.
  const [picking, setPicking] = useState<'until' | 'after' | null>(null);
  const { clans } = useClan();
  const seasonClans = useCWLStore((s) => s.seasonClans);
  const moveAllocation = useCWLStore((s) => s.moveAllocation);
  const busy = useCWLStore((s) => s.movingAllocationId === player.allocationId);

  const poolClans = clans.filter((c) => seasonClans.some((sc) => sc.clanId === c.id));
  const otherClans = poolClans.filter((c) => c.id !== currentClanId);

  const act = (action: MoveAction, clanId?: string, options?: MoveOptions) => {
    setOpen(false);
    setPicking(null);
    moveAllocation(player.allocationId, action, clanId, options);
  };

  return (
    <div style={{ padding: '5px 6px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.02)', opacity: busy ? 0.5 : 1 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
      <span
        style={{ flex: 1, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={player.isAlt ? `${player.name} — one of ${player.personName}'s accounts` : player.name}
      >
        {player.name}
        {/* CWL is per account, so one person can hold several rows. The marker names the human. */}
        {player.isAlt && (
          <span className="text-muted" style={{ fontSize: '0.65rem' }}> · {player.personName}</span>
        )}
      </span>
      {/* A full-season opt-out is off the roster entirely; a windowed one is still fighting most of
          the season, so it gets a softer marker naming the rounds rather than "NOT PLAYING". */}
      {player.unavailable && (
        <span
          title={
            isFullSeason(player.unavailable)
              ? 'Marked as not participating this season — the roster engine leaves this account out on every re-allocation'
              : `${describeAvailability(player.unavailable)} — still rostered for the rounds they can play, and the rotation will not plan them into the ones they cannot`
          }
          style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--color-muted)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 999, padding: '1px 6px', whiteSpace: 'nowrap' }}
        >
          {isFullSeason(player.unavailable)
            ? 'NOT PLAYING'
            : player.unavailable.fromRound === 1
              ? `FROM R${player.unavailable.toRound! + 1}`
              : `TO R${player.unavailable.fromRound! - 1}`}
        </span>
      )}
      <span className="text-muted" style={{ fontSize: '0.65rem', fontVariantNumeric: 'tabular-nums' }}>TH{player.thLevel}</span>
      <span className="text-muted" title={tierLabel(player.leagueTier)} style={{ fontSize: '0.6rem', width: 86, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tierLabel(player.leagueTier)}</span>
      {player.status === 'transfer_required' && (
        <ArrowRightLeft size={12} className="text-warning" aria-label="Transfer required" />
      )}
      <div style={{ position: 'relative' }}>
        <button aria-label="Move account" disabled={busy} onClick={() => setOpen((v) => !v)} style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: busy ? 'default' : 'pointer', display: 'flex', padding: 2 }}>
          <MoreVertical size={15} />
        </button>
        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--color-secondary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', width: 190, zIndex: 60, overflow: 'hidden', padding: '4px 0' }}>
              {otherClans.map((c) => (
                <MenuItem key={c.id} label={`Move to ${c.display_name}`} onClick={() => act('assign', c.id)} />
              ))}
              {currentClanId && (player.isBench
                ? <MenuItem label="Move to fighting" onClick={() => act('unbench')} />
                : <MenuItem label="Send to bench" onClick={() => act('bench')} />)}
              {/* "Remove" is a one-off edit to this roster; "not participating" is a statement about
                  the player that the engine re-reads, so it survives a re-allocation. Both are
                  offered because they answer different questions. */}
              {player.unavailable ? (
                <MenuItem label="Mark as available" onClick={() => act('opt_in')} />
              ) : picking ? (
                <RoundPicker
                  mode={picking}
                  onPick={(round) =>
                    act('opt_out', undefined, picking === 'until' ? untilRound(round) : afterRound(round))
                  }
                  onCancel={() => setPicking(null)}
                />
              ) : (
                <>
                  <MenuItem label="Not playing (whole season)" onClick={() => act('opt_out')} />
                  {/* The partial cases are the common ones — away for the first war days, or gone
                      before the last. Spending a full opt-out on either throws away rounds the
                      account could have fought. */}
                  <MenuItem label="Unavailable until round…" onClick={() => setPicking('until')} />
                  <MenuItem label="Unavailable after round…" onClick={() => setPicking('after')} />
                </>
              )}
              {currentClanId && <MenuItem label="Remove from season" danger onClick={() => act('remove')} />}
            </div>
          </>
        )}
      </div>
    </div>
    {/* The answer to "why isn't this account playing", on the row itself rather than in a tooltip —
        a leader reads this board to decide who to go and message, and a reason nobody hovers over
        is a reason nobody acts on. */}
    {reason && (
      <div className="text-muted" style={{ fontSize: '0.66rem', lineHeight: 1.35, paddingLeft: 2, marginTop: 2 }}>
        {reason}
      </div>
    )}
    </div>
  );
}

/**
 * Round chooser inside the account menu.
 *
 * "Until" offers rounds 2-7 and "after" offers 1-6: "unavailable until round 1" and "after round 7"
 * are empty windows — the account is simply available — so offering them would only produce a marker
 * standing for no missed rounds (availability.ts rejects them outright).
 */
function RoundPicker({
  mode,
  onPick,
  onCancel,
}: {
  mode: 'until' | 'after';
  onPick: (round: number) => void;
  onCancel: () => void;
}) {
  const rounds =
    mode === 'until'
      ? Array.from({ length: SEASON_ROUNDS - 1 }, (_, i) => i + 2)
      : Array.from({ length: SEASON_ROUNDS - 1 }, (_, i) => i + 1);
  return (
    <div style={{ padding: '4px 8px 8px' }}>
      <div className="text-muted" style={{ fontSize: '0.66rem', padding: '2px 4px 6px' }}>
        {mode === 'until' ? 'Back in for round…' : 'Last round they play…'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {rounds.map((n) => (
          <button
            key={n}
            onClick={() => onPick(n)}
            style={{ flex: '0 0 auto', minWidth: 30, padding: '4px 0', fontSize: '0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', cursor: 'pointer' }}
          >
            {n}
          </button>
        ))}
      </div>
      <button
        onClick={onCancel}
        style={{ marginTop: 6, background: 'transparent', border: 'none', padding: '2px 4px', fontSize: '0.7rem', color: 'var(--color-muted)', cursor: 'pointer' }}
      >
        Cancel
      </button>
    </div>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: '0.8rem', background: 'transparent', border: 'none', cursor: 'pointer', color: danger ? 'var(--color-danger)' : 'var(--color-text)' }}
    >
      {label}
    </button>
  );
}

function ClanColumn({
  title,
  subtitle,
  priorityLabel,
  overCapacity,
  shortLineup,
  fighting,
  bench,
  currentClanId,
  positionOf,
  warSize,
}: {
  title: string;
  subtitle: string;
  priorityLabel?: string;
  overCapacity: boolean;
  shortLineup?: boolean;
  fighting: RosterPlayer[];
  bench: RosterPlayer[];
  currentClanId: string | null;
  // 1-based strength position within the WHOLE clan roster, so a bench reason stays true even when
  // the in-game lineup benched someone strong (see lib/cwl/rosterReason.ts).
  positionOf?: Map<string, number>;
  warSize?: number;
}) {
  return (
    <div className="card" style={{ padding: 'var(--space-md)', minWidth: 260, flex: '1 1 260px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-sm)' }}>
        <h4 style={{ fontSize: '0.9rem', margin: 0, display: 'flex', alignItems: 'baseline', gap: 6 }}>
          {priorityLabel && (
            <span className="text-muted" style={{ fontSize: '0.62rem', fontVariantNumeric: 'tabular-nums' }} title="Fill priority — lower is filled first">{priorityLabel}</span>
          )}
          {title}
        </h4>
        <span
          title={shortLineup ? 'Short of a full lineup — the clans above absorbed the eligible accounts' : undefined}
          style={{
            fontSize: '0.7rem',
            fontVariantNumeric: 'tabular-nums',
            color: overCapacity ? 'var(--color-danger)' : shortLineup ? 'var(--color-warning)' : 'var(--color-muted)',
            fontWeight: overCapacity || shortLineup ? 700 : 400,
          }}
        >
          {subtitle}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {fighting.map((p) => <PlayerRow key={p.allocationId} player={p} currentClanId={currentClanId} />)}
        {fighting.length === 0 && <p className="text-muted" style={{ fontSize: '0.75rem', margin: '2px 0' }}>No accounts.</p>}
      </div>
      {bench.length > 0 && (
        <>
          <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', color: 'var(--color-muted)', margin: '10px 0 4px', letterSpacing: '0.05em' }}>Bench ({bench.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: 0.75 }}>
            {bench.map((p) => (
              <PlayerRow
                key={p.allocationId}
                player={p}
                currentClanId={currentClanId}
                reason={
                  positionOf && warSize
                    ? benchReason(positionOf.get(p.allocationId) ?? bench.length, warSize).text
                    : undefined
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The whole-family roster, one column per clan IN FILL-PRIORITY ORDER so the board reads the same
 * way the engine filled it: leftmost clan is the one that took the strongest accounts, and each
 * column to its right absorbed the spill.
 */
export default function RosterBoard() {
  const players = useCWLStore((s) => s.players);
  const seasonClans = useCWLStore((s) => s.seasonClans);
  const clanName = useClanName();
  const scope = useCwlScope();

  // Scoped to one clan, only that column is shown. The unassigned pile is a family-level fact —
  // an account nobody rostered belongs to no clan — so it is kept out of the single-clan view
  // rather than repeated under every clan as if each were responsible for it.
  const visibleClans = seasonClans.filter((sc) => scope.includes(sc.clanId));
  const unassigned = scope.isFamily
    ? players.filter((p) => !p.recommendedClanId).sort(byStrength)
    : [];

  // Every excluded account carries the engine's own reason (cwl_allocations.note). Grouping them
  // means the callout says each reason once — "Family roster full — Ann, Bob, Cat" — instead of
  // repeating a sentence down a list of names.
  // The callout carries these reasons, so the rows underneath deliberately do NOT repeat them —
  // the Unassigned column would otherwise print the same sentence once per name.
  const exclusions = groupExclusions(unassigned.map((p) => ({ name: p.name, note: p.note })));

  return (
    <div>
    {exclusions.length > 0 && (
      <div
        className="card"
        style={{ padding: 'var(--space-sm) var(--space-md)', marginBottom: 'var(--space-md)', display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start', borderLeft: '3px solid var(--color-warning)' }}
      >
        <Info size={15} className="text-warning" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 2 }}>
            {unassigned.length} account{unassigned.length === 1 ? '' : 's'} left off the proposed roster
          </div>
          {exclusions.map((g) => (
            <div key={g.reason} className="text-muted" style={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--color-text)' }}>{g.names.join(', ')}</span> — {g.reason}
            </div>
          ))}
        </div>
      </div>
    )}

    <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {visibleClans.map((sc) => {
        const i = seasonClans.indexOf(sc); // fill position is family-wide, not an index into the view
        const members = players.filter((p) => p.recommendedClanId === sc.clanId).sort(byStrength);
        const fighting = members.filter((p) => !p.isBench);
        const bench = members.filter((p) => p.isBench);
        // Position is taken across the WHOLE clan roster, not within the bench list, so the reason
        // still reads correctly when the in-game lineup has benched a strong account.
        const positionOf = new Map(members.map((p, idx) => [p.allocationId, idx + 1]));
        return (
          <ClanColumn
            key={sc.clanId}
            title={clanName(sc.clanId)}
            priorityLabel={`#${i + 1}`}
            subtitle={`${fighting.length}/${sc.warSize}`}
            positionOf={positionOf}
            warSize={sc.warSize}
            overCapacity={fighting.length > sc.warSize}
            // The visible cost of the priority waterfall: a clan low in the order can be left short
            // because the clans above it filled their benches first. Flag it rather than hide it.
            shortLineup={fighting.length < sc.warSize}
            fighting={fighting}
            bench={bench}
            currentClanId={sc.clanId}
          />
        );
      })}

      {unassigned.length > 0 && (
        <ClanColumn
          title="Unassigned"
          subtitle={`${unassigned.length}`}
          overCapacity={false}
          fighting={unassigned}
          bench={[]}
          currentClanId={null}
        />
      )}

      {visibleClans.length === 0 && (
        <div className="card" style={{ padding: 'var(--space-lg)', textAlign: 'center', flex: 1 }}>
          <Users size={22} className="text-muted" style={{ marginBottom: 'var(--space-sm)' }} />
          <p className="text-muted" style={{ fontSize: '0.85rem', margin: 0 }}>
            {seasonClans.length === 0
              ? "No clans in this season's pool."
              : 'This clan is not in the season pool — switch to All Clans to see the family roster.'}
          </p>
        </div>
      )}
    </div>
    </div>
  );
}
