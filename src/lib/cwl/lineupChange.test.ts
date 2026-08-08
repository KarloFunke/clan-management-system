import { describe, it, expect } from 'vitest';
import { countSwappedPositions, diffFieldedLineups, type FieldedSlot } from './lineupChange';

const slot = (tag: string, name = tag): FieldedSlot => ({ playerTag: tag, name });

describe('diffFieldedLineups', () => {
  it('reports nothing when the lineup is unchanged', () => {
    const same = [slot('#A'), slot('#B')];
    const d = diffFieldedLineups(same, [slot('#B'), slot('#A')]);
    expect(d.changed).toBe(false);
    expect(d.swappedIn).toHaveLength(0);
    expect(d.swappedOut).toHaveLength(0);
  });

  it('names both sides of a one-for-one swap', () => {
    const d = diffFieldedLineups([slot('#A', 'Ann'), slot('#B', 'Bob')], [slot('#A', 'Ann'), slot('#C', 'Cal')]);
    expect(d.changed).toBe(true);
    expect(d.swappedIn.map((s) => s.name)).toEqual(['Cal']);
    expect(d.swappedOut.map((s) => s.name)).toEqual(['Bob']);
  });

  it('matches tags case-insensitively', () => {
    const d = diffFieldedLineups([slot('#abc')], [slot('#ABC')]);
    expect(d.changed).toBe(false);
  });

  it('ignores a map-position shuffle — order is not membership', () => {
    const before = [slot('#A'), slot('#B'), slot('#C')];
    const after = [slot('#C'), slot('#A'), slot('#B')];
    expect(diffFieldedLineups(before, after).changed).toBe(false);
  });

  it('treats a growing lineup as swaps in only', () => {
    const d = diffFieldedLineups([slot('#A')], [slot('#A'), slot('#B')]);
    expect(d.swappedIn.map((s) => s.playerTag)).toEqual(['#B']);
    expect(d.swappedOut).toHaveLength(0);
  });

  it('treats an emptied lineup as swaps out only', () => {
    const d = diffFieldedLineups([slot('#A'), slot('#B')], []);
    expect(d.swappedOut.map((s) => s.playerTag)).toEqual(['#A', '#B']);
    expect(d.swappedIn).toHaveLength(0);
  });
});

// The round card counts swaps in PLAYERS, not in recorded events — the event boundary is just how
// often the poller happened to look.
describe('countSwappedPositions', () => {
  const ev = (inTags: string[], outTags: string[]) => ({
    swappedIn: inTags.map((t) => slot(t)),
    swappedOut: outTags.map((t) => slot(t)),
    changed: true,
  });

  it('counts three players swapped in one event as three, not one', () => {
    expect(countSwappedPositions([ev(['#X', '#Y', '#Z'], ['#A', '#B', '#C'])])).toBe(3);
  });

  it('adds up players across separate events', () => {
    expect(countSwappedPositions([ev(['#X'], ['#A']), ev(['#Y'], ['#B'])])).toBe(2);
  });

  it('takes the larger side when the lineup grew or shrank', () => {
    expect(countSwappedPositions([ev(['#X', '#Y'], ['#A'])])).toBe(2);
    expect(countSwappedPositions([ev(['#X'], ['#A', '#B'])])).toBe(2);
  });

  it('cancels a player swapped out and later brought back', () => {
    // One position churned, not two — and the roster ends where it started for them.
    expect(countSwappedPositions([ev([], ['#A']), ev(['#A'], [])])).toBe(0);
  });

  it('is zero for no events', () => {
    expect(countSwappedPositions([])).toBe(0);
  });
});
