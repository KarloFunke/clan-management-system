import { describe, it, expect } from 'vitest';
import { parseCoCTime } from './cocTime';

describe('parseCoCTime', () => {
  it('expands the compact format the CoC API actually returns', () => {
    const iso = parseCoCTime('20260803T100000.000Z');
    expect(iso).toBe('2026-08-03T10:00:00.000Z');
    expect(new Date(iso!).getTime()).not.toBeNaN();
  });

  it('handles the compact format without milliseconds', () => {
    expect(parseCoCTime('20260803T100000Z')).toBe('2026-08-03T10:00:00.000Z');
  });

  it('passes an already-extended ISO string through unchanged', () => {
    expect(parseCoCTime('2026-08-03T10:00:00.000Z')).toBe('2026-08-03T10:00:00.000Z');
  });

  it('is idempotent — safe on a value that may have come from either source', () => {
    const once = parseCoCTime('20260803T100000.000Z');
    expect(parseCoCTime(once)).toBe(once);
  });

  it('returns null for absent or unparseable values rather than an Invalid Date', () => {
    expect(parseCoCTime(null)).toBeNull();
    expect(parseCoCTime(undefined)).toBeNull();
    expect(parseCoCTime('')).toBeNull();
    expect(parseCoCTime('not a time')).toBeNull();
  });
});
