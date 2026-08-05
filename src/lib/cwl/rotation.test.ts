import { describe, it, expect } from 'vitest';
import { suggestClanRotation, roundsPlayedByAccount, performanceByAccount, TOTAL_ROUNDS } from './rotation';
import type { CWLRound, CWLWarMember } from '@/types/database';
import type { RotationPlayer } from './rotation';

// Minimal factories — only the fields the engine reads.
function player(id: string, over: Partial<RotationPlayer> = {}): RotationPlayer {
  return { playerTag: id, name: id.toUpperCase(), thLevel: 15, leagueTier: null, playedSoFar: 0, ...over };
}
function round(id: string, clan_id: string, round_number: number): CWLRound {
  return {
    id, season_id: 's', clan_id, round_number, war_tag: '#w', state: 'warEnded',
    team_size: 15, opponent_name: 'Foe', opponent_tag: '#F', our_stars: 0,
    our_destruction: 0, our_attacks_used: 0, start_time: null, end_time: null, polled_at: 'now',
  };
}
function member(round_id: string, player_tag: string, over: Partial<CWLWarMember> = {}): CWLWarMember {
  return {
    id: `${round_id}-${player_tag}`, round_id, person_id: null, player_tag,
    name: null, th_level: 15, map_position: 1, attacks_used: 1, stars: 3, destruction: 100, ...over,
  };
}

describe('suggestClanRotation', () => {
  it('rotates the bench fairly so play counts stay even (roster 4, war 3, 7 rounds)', () => {
    const roster = [player('a'), player('b'), player('c'), player('d')];
    const rot = suggestClanRotation('clan', roster, 3);
    expect(rot.noBenchNeeded).toBe(false);
    expect(rot.rounds).toHaveLength(TOTAL_ROUNDS);
    // Each round benches exactly one (roster 4 - war 3).
    for (const r of rot.rounds) {
      expect(r.playing).toHaveLength(3);
      expect(r.bench).toHaveLength(1);
    }
    // Over 7 rounds, 7 bench-slots across 4 players -> nobody sits more than twice or fewer than once.
    const bench = new Map(rot.summary.map((s) => [s.playerTag, s.benchRounds]));
    for (const b of bench.values()) {
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(2);
    }
    // Projected totals differ by at most one — the fairness guarantee.
    const totals = rot.summary.map((s) => s.projectedTotal);
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1);
  });

  it('lets the under-played catch up first using playedSoFar', () => {
    // Ann has already played 2 rounds, the rest none. With war size 2 over the remaining rounds Ann
    // should sit until the others have caught up.
    const roster = [
      player('ann', { playedSoFar: 2 }),
      player('bob', { playedSoFar: 0 }),
      player('cal', { playedSoFar: 0 }),
    ];
    const rot = suggestClanRotation('clan', roster, 2, [1, 2]); // rounds 1&2 already locked -> 5 remain
    expect(rot.remainingRoundNumbers).toEqual([3, 4, 5, 6, 7]);
    // Round 3: Bob & Cal (0 played) go in, Ann (2 played) benches.
    expect(rot.rounds[0].bench.map((s) => s.playerTag)).toEqual(['ann']);
    expect(rot.rounds[0].playing.map((s) => s.playerTag).sort()).toEqual(['bob', 'cal']);
    // By season end the three land within one war day of each other despite Ann's head start.
    const totals = rot.summary.map((s) => s.projectedTotal);
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1);
  });

  it('breaks equal-rest ties in favour of the stronger player', () => {
    // Two players, both rested, one war slot -> the higher TH plays, the weaker benches.
    const roster = [player('weak', { thLevel: 13 }), player('strong', { thLevel: 16 })];
    const rot = suggestClanRotation('clan', roster, 1, [], 1); // single round
    expect(rot.rounds[0].playing.map((s) => s.playerTag)).toEqual(['strong']);
    expect(rot.rounds[0].bench.map((s) => s.playerTag)).toEqual(['weak']);
  });

  it('flags noBenchNeeded when the roster fits the war size', () => {
    const roster = [player('a'), player('b')];
    const rot = suggestClanRotation('clan', roster, 15);
    expect(rot.noBenchNeeded).toBe(true);
    // Everyone plays every remaining round; nobody benches.
    for (const r of rot.rounds) expect(r.bench).toHaveLength(0);
    for (const s of rot.summary) expect(s.benchRounds).toBe(0);
  });

  it('skips locked rounds and only plans the remainder', () => {
    const roster = [player('a'), player('b'), player('c')];
    const rot = suggestClanRotation('clan', roster, 2, [1, 2, 3, 4, 5]);
    expect(rot.remainingRoundNumbers).toEqual([6, 7]);
    expect(rot.rounds).toHaveLength(2);
  });
});

describe('roundsPlayedByAccount', () => {
  it('counts distinct rounds an account was fielded in, scoped to the clan', () => {
    const rounds = [round('r1', 'A', 1), round('r2', 'A', 2), round('r3', 'B', 1)];
    const members = [
      member('r1', '#main'),
      member('r2', '#main'),
      member('r3', '#main'), // different clan -> not counted for A
      member('r1', '#other'),
    ];
    const played = roundsPlayedByAccount(rounds, members, 'A');
    expect(played.get('#main')).toBe(2);
    expect(played.get('#other')).toBe(1);
  });

  it('credits a person\'s two accounts separately', () => {
    // Both bases belong to one human but each spends its own war day, so neither halves the other's
    // fairness budget — the reason this is keyed on the tag rather than person_id.
    const rounds = [round('r1', 'A', 1), round('r2', 'A', 2)];
    const members = [
      member('r1', '#main', { person_id: 'irfan' }),
      member('r2', '#main', { person_id: 'irfan' }),
      member('r1', '#alt', { person_id: 'irfan' }),
    ];
    const played = roundsPlayedByAccount(rounds, members, 'A');
    expect(played.get('#main')).toBe(2);
    expect(played.get('#alt')).toBe(1);
  });

  it('does not double-count an account appearing twice in one round', () => {
    const rounds = [round('r1', 'A', 1)];
    const members = [member('r1', '#main'), member('r1', '#main', { id: 'dup' })];
    expect(roundsPlayedByAccount(rounds, members, 'A').get('#main')).toBe(1);
  });
});

describe('suggestClanRotation — per-round availability', () => {
  const p = (tag: string, th: number, unavailable?: number[]) => ({
    playerTag: tag,
    name: tag,
    thLevel: th,
    leagueTier: null,
    playedSoFar: 0,
    unavailableRounds: unavailable ? new Set(unavailable) : undefined,
  });

  it('never plans an account into a round it is unavailable for', () => {
    const rot = suggestClanRotation('c1', [p('#A', 16, [1, 2]), p('#B', 15), p('#C', 15)], 2);
    const r1 = rot.rounds.find((r) => r.roundNumber === 1)!;
    expect(r1.playing.map((s) => s.playerTag)).not.toContain('#A');
    expect(r1.unavailable.map((s) => s.playerTag)).toEqual(['#A']);
    // ...and is back in contention the moment the window closes.
    const r3 = rot.rounds.find((r) => r.roundNumber === 3)!;
    expect(r3.playing.map((s) => s.playerTag)).toContain('#A');
  });

  it('gives the freed slot to an available player rather than leaving it empty', () => {
    // Two slots, three accounts, one of them out for round 1 — the other two both play.
    const rot = suggestClanRotation('c1', [p('#A', 16, [1]), p('#B', 15), p('#C', 14)], 2);
    const r1 = rot.rounds.find((r) => r.roundNumber === 1)!;
    expect(r1.playing).toHaveLength(2);
    expect(r1.bench).toHaveLength(0);
  });

  it('counts an unavailable round as out, not as a bench day', () => {
    // Benching is a decision about a player who could have played; conflating the two would read as
    // the rotation treating an absent account unfairly when it never had the choice.
    const rot = suggestClanRotation('c1', [p('#A', 16, [1, 2]), p('#B', 15), p('#C', 15)], 2);
    const a = rot.summary.find((s) => s.playerTag === '#A')!;
    expect(a.unavailableRounds).toBe(2);
    expect(a.benchRounds + a.suggestedPlays + a.unavailableRounds).toBe(rot.remainingRoundNumbers.length);
  });

  it('leaves the lineup short when too many are out, rather than fielding them anyway', () => {
    const rot = suggestClanRotation('c1', [p('#A', 16, [1]), p('#B', 15, [1]), p('#C', 15)], 2);
    const r1 = rot.rounds.find((r) => r.roundNumber === 1)!;
    expect(r1.playing.map((s) => s.playerTag)).toEqual(['#C']);
    expect(r1.unavailable).toHaveLength(2);
  });
});

describe('roundsPlayedByAccount — prep day is not a played round', () => {
  it('ignores a round still in preparation', () => {
    // The lineup is published at the start of prep day, so an appearance there is being PICKED, not
    // having played. Counting it made the fairness maths think a war day had been spent.
    const rounds: CWLRound[] = [
      { ...round('r1', 'A', 1), state: 'warEnded' },
      { ...round('r2', 'A', 2), state: 'preparation' },
    ];
    const members = [member('r1', '#main'), member('r2', '#main')];
    expect(roundsPlayedByAccount(rounds, members, 'A').get('#main')).toBe(1);
  });
});

describe('performanceByAccount', () => {
  it('sums stars and attacks per ACCOUNT, not per person', () => {
    const rounds = [round('r1', 'A', 1)];
    const members = [
      member('r1', '#main', { person_id: 'irfan', stars: 3, attacks_used: 1 }),
      member('r1', '#alt', { person_id: 'irfan', stars: 1, attacks_used: 1 }),
    ];
    const perf = performanceByAccount(rounds, members, 'A');
    expect(perf.get('#main')!.starsSoFar).toBe(3);
    expect(perf.get('#alt')!.starsSoFar).toBe(1);
  });

  it('only counts a miss once the war has ended', () => {
    const rounds: CWLRound[] = [
      { ...round('r1', 'A', 1), state: 'warEnded' },
      { ...round('r2', 'A', 2), state: 'inWar' },
    ];
    const members = [
      member('r1', '#main', { attacks_used: 0, stars: 0 }),
      member('r2', '#main', { attacks_used: 0, stars: 0 }),
    ];
    expect(performanceByAccount(rounds, members, 'A').get('#main')!.missedAttacks).toBe(1);
  });
});

describe('suggestClanRotation — bonus condition and performance', () => {
  const p = (tag: string, over: Partial<RotationPlayer> = {}): RotationPlayer =>
    player(tag, { thLevel: 15, ...over });

  it('keeps rounds-played the primary fairness signal, above the bonus chase', () => {
    // #behind has played fewer rounds and is fully qualified; #ahead is chasing. Fairness still wins.
    const rot = suggestClanRotation(
      'c1',
      [
        p('#behind', { playedSoFar: 0, starsSoFar: 30, attacksUsed: 10 }),
        p('#ahead', { playedSoFar: 3, starsSoFar: 0, attacksUsed: 0 }),
      ],
      1,
      [],
      7,
      { minRounds: 4, minStars: 8 },
    );
    expect(rot.rounds[0].playing.map((s) => s.playerTag)).toEqual(['#behind']);
  });

  it('prefers the account still chasing the bonus when war days are equal', () => {
    const rot = suggestClanRotation(
      'c1',
      [
        p('#qualified', { playedSoFar: 2, starsSoFar: 20, attacksUsed: 7 }),
        p('#chasing', { playedSoFar: 2, starsSoFar: 2, attacksUsed: 1 }),
      ],
      1,
      [1, 2],
      7,
      { minRounds: 2, minStars: 8 },
    );
    expect(rot.rounds[0].playing.map((s) => s.playerTag)).toEqual(['#chasing']);
  });

  it('does not spend a slot on a bonus that can no longer be reached', () => {
    // Two rounds left, so at most 6 more stars — #lost needs 9 and cannot get there. The slot goes to
    // the account that still can, rather than chasing a bonus already gone.
    const rot = suggestClanRotation(
      'c1',
      [
        p('#lost', { playedSoFar: 2, starsSoFar: 0, attacksUsed: 2 }),
        p('#reachable', { playedSoFar: 2, starsSoFar: 6, attacksUsed: 3 }),
      ],
      1,
      [1, 2, 3, 4, 5],
      7,
      { minRounds: 1, minStars: 9 },
    );
    expect(rot.rounds[0].playing.map((s) => s.playerTag)).toEqual(['#reachable']);
    expect(rot.summary.find((s) => s.playerTag === '#lost')!.bonusStatus).toBe('unreachable');
  });

  it('breaks a tie on performance — a missed attack outranks a better star rate', () => {
    const rot = suggestClanRotation(
      'c1',
      [
        p('#missed', { playedSoFar: 1, starsSoFar: 9, attacksUsed: 3, missedAttacks: 1 }),
        p('#showed', { playedSoFar: 1, starsSoFar: 3, attacksUsed: 3, missedAttacks: 0 }),
      ],
      1,
      [1, 2, 3, 4, 5, 6],
      7,
      { minRounds: 0, minStars: 0 }, // no bonus pressure — isolate the performance tiebreak
    );
    expect(rot.rounds[0].playing.map((s) => s.playerTag)).toEqual(['#showed']);
  });

  it('reports the shortfall against the projected season, not against today', () => {
    const rot = suggestClanRotation(
      'c1',
      [p('#a', { playedSoFar: 0, starsSoFar: 8, attacksUsed: 3 })],
      1,
      [],
      7,
      { minRounds: 4, minStars: 8 },
    );
    const a = rot.summary[0];
    expect(a.projectedTotal).toBe(7); // the plan already fields them every round
    expect(a.roundsShort).toBe(0);
    expect(a.bonusStatus).toBe('qualified');
  });
});
