import { describe, it, expect } from 'vitest';
import {
  afterRound,
  describeAvailability,
  isAvailableForRound,
  isFullSeason,
  unavailableRounds,
  untilRound,
} from './availability';

const FULL = { fromRound: null, toRound: null };

describe('isFullSeason', () => {
  it('treats the unbounded window as the whole season', () => {
    expect(isFullSeason(FULL)).toBe(true);
    expect(isFullSeason({ fromRound: 1, toRound: 3 })).toBe(false);
  });
});

describe('isAvailableForRound', () => {
  it('locks out every round for a full-season opt-out', () => {
    for (let n = 1; n <= 7; n++) expect(isAvailableForRound(FULL, n)).toBe(false);
  });

  it('opens up on the round after the window closes', () => {
    const w = untilRound(4); // back for round 4
    expect(isAvailableForRound(w, 3)).toBe(false);
    expect(isAvailableForRound(w, 4)).toBe(true);
    expect(isAvailableForRound(w, 7)).toBe(true);
  });

  it('closes after the last round the account can play', () => {
    const w = afterRound(5); // gone after round 5
    expect(isAvailableForRound(w, 5)).toBe(true);
    expect(isAvailableForRound(w, 6)).toBe(false);
  });
});

describe('unavailableRounds', () => {
  it('lists the whole season for a full opt-out', () => {
    expect(unavailableRounds(FULL)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('lists only the span for a partial one', () => {
    expect(unavailableRounds(untilRound(4))).toEqual([1, 2, 3]);
    expect(unavailableRounds(afterRound(5))).toEqual([6, 7]);
  });
});

describe('describeAvailability', () => {
  it('phrases the window the way the leader entered it', () => {
    expect(describeAvailability(untilRound(4))).toBe('Unavailable until round 4');
    expect(describeAvailability(afterRound(5))).toBe('Unavailable after round 5');
    expect(describeAvailability(FULL)).toBe('Not participating this season');
  });

  it('names a single missed round rather than printing a one-long span', () => {
    expect(describeAvailability({ fromRound: 3, toRound: 3 })).toBe('Unavailable for round 3');
  });

  it('prints an interior span literally, since neither "until" nor "after" fits', () => {
    expect(describeAvailability({ fromRound: 2, toRound: 5 })).toBe('Unavailable for rounds 2–5');
  });

  it('reads a window covering every round as a full opt-out', () => {
    // Reachable by marking someone unavailable from round 1 to 7 through the round pickers.
    expect(describeAvailability({ fromRound: 1, toRound: 7 })).toBe('Not participating this season');
  });
});

describe('window builders', () => {
  it('refuse a window that would exclude nothing', () => {
    // "Unavailable until round 1" / "after round 7" are empty spans — the account is just available,
    // and storing that would show a marker on the board standing for no lost rounds at all.
    expect(() => untilRound(1)).toThrow(RangeError);
    expect(() => afterRound(7)).toThrow(RangeError);
  });
});
