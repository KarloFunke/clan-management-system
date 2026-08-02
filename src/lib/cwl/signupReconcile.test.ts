import { describe, it, expect } from 'vitest';
import { reconcileSignups, type ExistingAllocation } from './signupReconcile';

const alloc = (over: Partial<ExistingAllocation> & { id: string; playerTag: string }): ExistingAllocation => ({
  recommendedClanId: null,
  actualClanId: null,
  status: 'matches',
  isBench: false,
  ...over,
});

describe('reconcileSignups', () => {
  it('rewrites the plan to the clan the account actually signed into', () => {
    const res = reconcileSignups({
      signups: [{ clanId: 'B', members: [{ playerTag: '#AAA', name: 'A', thLevel: 16 }], lineupRevealed: false }],
      allocations: [alloc({ id: '1', playerTag: '#AAA', recommendedClanId: 'A', actualClanId: 'A', status: 'transfer_required' })],
      fieldedTags: [],
      personByTag: {},
    });
    expect(res.updates).toEqual([
      { id: '1', recommendedClanId: 'B', actualClanId: 'B', status: 'matches', isBench: false },
    ]);
  });

  it('emits nothing for a row that already matches reality', () => {
    const res = reconcileSignups({
      signups: [{ clanId: 'A', members: [{ playerTag: '#AAA', name: 'A', thLevel: 16 }], lineupRevealed: false }],
      allocations: [alloc({ id: '1', playerTag: '#aaa', recommendedClanId: 'A', actualClanId: 'A' })],
      fieldedTags: [],
      personByTag: {},
    });
    expect(res.updates).toHaveLength(0);
  });

  it('removes a rostered account that never signed up, keeping its actual clan', () => {
    const res = reconcileSignups({
      signups: [{ clanId: 'A', members: [], lineupRevealed: false }],
      allocations: [alloc({ id: '1', playerTag: '#AAA', recommendedClanId: 'A', actualClanId: 'A', isBench: true })],
      fieldedTags: [],
      personByTag: {},
    });
    expect(res.updates).toEqual([
      { id: '1', recommendedClanId: null, actualClanId: 'A', status: 'removed', isBench: false },
    ]);
  });

  it('adds an unplanned signup when the account is known, and reports it when it is not', () => {
    const res = reconcileSignups({
      signups: [{
        clanId: 'A',
        members: [
          { playerTag: '#KNOWN', name: 'K', thLevel: 15 },
          { playerTag: '#GUEST', name: 'G', thLevel: 13 },
        ],
        lineupRevealed: false,
      }],
      allocations: [],
      fieldedTags: [],
      personByTag: { '#KNOWN': 'p1' },
    });
    expect(res.inserts).toEqual([
      { playerTag: '#KNOWN', personId: 'p1', clanId: 'A', isBench: false, note: expect.any(String) },
    ]);
    expect(res.unknownSignups).toEqual([{ playerTag: '#GUEST', clanId: 'A' }]);
  });

  it('leaves the planned bench flag alone until a lineup is revealed', () => {
    const res = reconcileSignups({
      signups: [{ clanId: 'A', members: [{ playerTag: '#AAA', name: 'A', thLevel: 16 }], lineupRevealed: false }],
      allocations: [alloc({ id: '1', playerTag: '#AAA', recommendedClanId: 'A', actualClanId: 'A', isBench: true })],
      fieldedTags: [],
      personByTag: {},
    });
    expect(res.updates).toHaveLength(0);
    expect(res.perClan).toEqual([{ clanId: 'A', signedUp: 1, bench: 0 }]);
  });

  it('derives bench from the revealed lineup — a signed-up account not fielded is benched', () => {
    const res = reconcileSignups({
      signups: [{
        clanId: 'A',
        members: [
          { playerTag: '#IN', name: 'In', thLevel: 16 },
          { playerTag: '#OUT', name: 'Out', thLevel: 15 },
        ],
        lineupRevealed: true,
      }],
      allocations: [
        alloc({ id: '1', playerTag: '#IN', recommendedClanId: 'A', actualClanId: 'A', isBench: true }),
        alloc({ id: '2', playerTag: '#OUT', recommendedClanId: 'A', actualClanId: 'A', isBench: false }),
      ],
      fieldedTags: ['#in'],
      personByTag: {},
    });
    expect(res.updates).toEqual([
      { id: '1', recommendedClanId: 'A', actualClanId: 'A', status: 'matches', isBench: false },
      { id: '2', recommendedClanId: 'A', actualClanId: 'A', status: 'matches', isBench: true },
    ]);
    // The real bench can be deeper than the season's maxBench — this count is the game's, not the plan's.
    expect(res.perClan).toEqual([{ clanId: 'A', signedUp: 2, bench: 1 }]);
  });
});
