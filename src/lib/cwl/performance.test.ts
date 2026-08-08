import { describe, it, expect } from 'vitest';
import { computeSeasonPerformance } from './performance';
import type { CWLRound, CWLWarMember } from '@/types/database';

// Minimal round/member factories — only the fields the roll-up reads.
function round(id: string, state: string, clan_id = 'c'): CWLRound {
  return {
    id, season_id: 's', clan_id, round_number: 1, war_tag: '#w', state,
    team_size: 15, opponent_name: 'Foe', opponent_tag: '#F', our_stars: 0,
    our_destruction: 0, our_attacks_used: 0, start_time: null, end_time: null, polled_at: 'now',
  };
}
function member(round_id: string, over: Partial<CWLWarMember>): CWLWarMember {
  return {
    id: `${round_id}-${over.player_tag}`, round_id, person_id: null, player_tag: '#P',
    name: null, th_level: 15, map_position: 1, attacks_used: 0, stars: 0, destruction: 0, ...over,
  };
}

describe('computeSeasonPerformance', () => {
  it('sums stars and averages destruction over attacks used across rounds', () => {
    const rounds = [round('r1', 'warEnded'), round('r2', 'warEnded')];
    const members = [
      member('r1', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 1, stars: 3, destruction: 100 }),
      member('r2', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 1, stars: 2, destruction: 80 }),
    ];
    const { perMember } = computeSeasonPerformance(rounds, members);
    expect(perMember).toHaveLength(1);
    const ann = perMember[0];
    expect(ann.roundsPlayed).toBe(2);
    expect(ann.attacksUsed).toBe(2);
    expect(ann.totalStars).toBe(5);
    expect(ann.avgDestruction).toBeCloseTo(90);
    expect(ann.missed).toBe(0);
  });

  it('counts a missed attack only once the round has ended', () => {
    const rounds = [round('ended', 'warEnded'), round('live', 'inWar')];
    const members = [
      // Same member sits in an ended round (no attack -> missed) and a live round (not yet a miss).
      member('ended', { person_id: 'p2', player_tag: '#B', name: 'Bob', attacks_used: 0 }),
      member('live', { person_id: 'p2', player_tag: '#B', name: 'Bob', attacks_used: 0 }),
    ];
    const { perMember } = computeSeasonPerformance(rounds, members);
    const bob = perMember.find((m) => m.personId === 'p2')!;
    expect(bob.missed).toBe(1);
    expect(bob.roundsPlayed).toBe(2);
    expect(bob.attacksUsed).toBe(0);
    expect(bob.avgDestruction).toBeNull();
  });

  it('keeps a person\'s alts as separate rows', () => {
    // CWL sign-up is per account, so each alt fights its own war. Collapsing them under the person
    // produced a row true of nobody — 2 rounds and both star totals credited to one "member".
    const rounds = [round('r1', 'warEnded'), round('r2', 'warEnded')];
    const members = [
      member('r1', { person_id: 'p1', player_tag: '#MAIN', name: 'Ann', attacks_used: 1, stars: 3, destruction: 100 }),
      member('r2', { person_id: 'p1', player_tag: '#ALT', name: 'Ann Alt', attacks_used: 1, stars: 2, destruction: 80 }),
    ];
    const { perMember } = computeSeasonPerformance(rounds, members);
    expect(perMember).toHaveLength(2);
    const main = perMember.find((m) => m.playerTag === '#MAIN')!;
    const alt = perMember.find((m) => m.playerTag === '#ALT')!;
    expect(main.roundsPlayed).toBe(1);
    expect(main.totalStars).toBe(3);
    expect(alt.roundsPlayed).toBe(1);
    expect(alt.totalStars).toBe(2);
    // Still linked back to the person, just not merged into it.
    expect(alt.personId).toBe('p1');
  });

  it('groups unlinked tags separately and rolls family totals up', () => {
    const rounds = [round('r1', 'warEnded')];
    const members = [
      member('r1', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 1, stars: 3, destruction: 100 }),
      member('r1', { person_id: null, player_tag: '#guest', name: 'Guest', attacks_used: 0 }),
    ];
    const { perMember, totals } = computeSeasonPerformance(rounds, members);
    expect(perMember).toHaveLength(2);
    // Guest keyed by tag, no person link.
    const guest = perMember.find((m) => m.playerTag === '#guest')!;
    expect(guest.personId).toBeNull();
    expect(guest.missed).toBe(1);
    // Totals across both members.
    expect(totals.totalStars).toBe(3);
    expect(totals.attacksUsed).toBe(1);
    expect(totals.missed).toBe(1);
    expect(totals.avgDestruction).toBeCloseTo(100);
  });

  it('does not count a preparation round as played — being picked is not playing', () => {
    const rounds = [round('prep', 'preparation'), round('live', 'inWar')];
    const members = [
      member('prep', { person_id: 'p3', player_tag: '#C', name: 'Cal', attacks_used: 0 }),
      member('live', { person_id: 'p3', player_tag: '#C', name: 'Cal', attacks_used: 1, stars: 2, destruction: 70 }),
    ];
    const { perMember, totals } = computeSeasonPerformance(rounds, members);
    expect(perMember[0].roundsPlayed).toBe(1);
    expect(totals.roundsPlayed).toBe(1);
  });

  it('carries the highest TH seen for a member, for the TH sort', () => {
    const rounds = [round('r1', 'warEnded'), round('r2', 'warEnded')];
    const members = [
      member('r1', { person_id: 'p1', player_tag: '#A', th_level: 15 }),
      member('r2', { person_id: 'p1', player_tag: '#A', th_level: 16 }),
    ];
    const { perMember } = computeSeasonPerformance(rounds, members);
    expect(perMember[0].thLevel).toBe(16);
  });

  it('sorts members by total stars descending', () => {
    const rounds = [round('r1', 'warEnded')];
    const members = [
      member('r1', { person_id: 'low', player_tag: '#L', name: 'Low', attacks_used: 1, stars: 1, destruction: 50 }),
      member('r1', { person_id: 'high', player_tag: '#H', name: 'High', attacks_used: 1, stars: 3, destruction: 100 }),
    ];
    const { perMember } = computeSeasonPerformance(rounds, members);
    expect(perMember.map((m) => m.personId)).toEqual(['high', 'low']);
  });
});

// The per-clan split (the CWL board's clan scope) works by handing in only that clan's rounds, so
// the roll-up has to treat `rounds` as the scope boundary rather than as a lookup table.
describe('computeSeasonPerformance — scoped to a subset of rounds', () => {
  it('ignores member rows belonging to rounds outside the given set', () => {
    const ours = round('r-ours', 'warEnded', 'clan-a');
    // 'r-theirs' deliberately has no round in scope — only its member row exists.
    const members = [
      member('r-ours', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 1, stars: 3, destruction: 100 }),
      member('r-theirs', { person_id: 'p2', player_tag: '#B', name: 'Bob', attacks_used: 1, stars: 2, destruction: 50 }),
    ];
    // Only clan A's round is in scope, so only Ann exists and the totals are hers alone.
    const { perMember, totals } = computeSeasonPerformance([ours], members);
    expect(perMember.map((m) => m.name)).toEqual(['Ann']);
    expect(totals.totalStars).toBe(3);
    expect(totals.avgDestruction).toBeCloseTo(100);
  });

  it('splits one member who played for two clans into each clan\'s own totals', () => {
    const a = round('r-a', 'warEnded', 'clan-a');
    const b = round('r-b', 'warEnded', 'clan-b');
    const members = [
      member('r-a', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 1, stars: 3, destruction: 100 }),
      member('r-b', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 1, stars: 1, destruction: 40 }),
    ];
    expect(computeSeasonPerformance([a], members).perMember[0].totalStars).toBe(3);
    expect(computeSeasonPerformance([b], members).perMember[0].totalStars).toBe(1);
    // ...and the family view still sees the whole picture.
    expect(computeSeasonPerformance([a, b], members).perMember[0].totalStars).toBe(4);
  });

  it('returns an empty roll-up when the scope has no rounds at all', () => {
    const members = [member('r1', { player_tag: '#A', attacks_used: 1, stars: 3 })];
    const { perMember, totals } = computeSeasonPerformance([], members);
    expect(perMember).toHaveLength(0);
    expect(totals.totalStars).toBe(0);
  });
});
