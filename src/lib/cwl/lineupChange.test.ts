import { describe, it, expect } from 'vitest';
import { diffFieldedLineups, type FieldedSlot } from './lineupChange';

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
