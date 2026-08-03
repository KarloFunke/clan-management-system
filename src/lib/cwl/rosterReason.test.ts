import { describe, it, expect } from 'vitest';
import { benchReason, groupExclusions, MANUAL_REMOVAL_REASON } from './rosterReason';

describe('benchReason', () => {
  it('explains a bench that follows from the ranking', () => {
    const r = benchReason(16, 15);
    expect(r.kind).toBe('below_war_size');
    expect(r.text).toContain('#16');
    expect(r.text).toContain('15');
  });

  it('does NOT claim the ranking when a strong account is benched', () => {
    // Post-signup the bench flag comes from the in-game lineup, which can sit anyone. Saying
    // "ranked below the war size" here would be a confident falsehood a leader might repeat.
    const r = benchReason(3, 15);
    expect(r.kind).toBe('chosen');
    expect(r.text).toMatch(/by choice/i);
    expect(r.text).not.toMatch(/below its war size/i);
  });

  it('treats the last lineup slot as playing, not benched-by-ranking', () => {
    expect(benchReason(15, 15).kind).toBe('chosen');
    expect(benchReason(16, 15).kind).toBe('below_war_size');
  });
});

describe('groupExclusions', () => {
  it('lists a shared reason once with every affected name under it', () => {
    const groups = groupExclusions([
      { name: 'Ann', note: 'No eligible clan in the season pool' },
      { name: 'Bob', note: 'No eligible clan in the season pool' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].names).toEqual(['Ann', 'Bob']);
  });

  it('keeps distinct reasons apart and in first-seen order', () => {
    const groups = groupExclusions([
      { name: 'Ann', note: 'Family roster full' },
      { name: 'Bob', note: 'War-ineligible — active strike' },
      { name: 'Cat', note: 'Family roster full' },
    ]);
    expect(groups.map((g) => g.reason)).toEqual(['Family roster full', 'War-ineligible — active strike']);
    expect(groups[0].names).toEqual(['Ann', 'Cat']);
    expect(groups[1].names).toEqual(['Bob']);
  });

  it('falls back to a manual-removal reason when the engine wrote no note', () => {
    // A leader's "Remove from season" is a deliberate act with no engine reasoning behind it.
    const groups = groupExclusions([{ name: 'Ann', note: null }, { name: 'Bob', note: '   ' }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe(MANUAL_REMOVAL_REASON);
    expect(groups[0].names).toEqual(['Ann', 'Bob']);
  });

  it('returns nothing when nobody is excluded', () => {
    expect(groupExclusions([])).toEqual([]);
  });
});
