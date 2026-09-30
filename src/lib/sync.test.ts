/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles patch the query builder dynamically */
/**
 * Roster-sync lifecycle, run against an in-memory database and a scripted CoC API with a fake
 * clock. These exist because of the 2026-09-14 incident: across several syncs that day, every
 * family clan's active roster was rewritten with `person_id = NULL` (and `added_at` reset), which
 * orphaned 121 of 122 persons — the registry then showed almost nobody. The rows were never
 * deleted; the links were. The first describe block reproduces that.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createClanOpsDb, FakeDb } from '@/test/fakeSupabase';
import { FakeCoc, member } from '@/test/fakeCoc';

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, coc: null as any }));

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));
vi.mock('@/lib/coc-api', () => ({ fetchFromCoC: (e: string) => h.coc.fetch(e) }));
// The post-roster steps are each fail-safe and covered elsewhere; stub them so a sync test is
// only about the roster.
vi.mock('@/lib/cwl/live', () => ({ syncCwlLiveState: vi.fn(async () => null) }));
vi.mock('@/lib/cwl/roster', () => ({ detectCompletedTransfers: vi.fn(async () => null) }));
vi.mock('@/lib/war', () => ({ syncWarState: vi.fn(async () => null) }));
vi.mock('@/lib/rules/scan', () => ({ scanRuleViolations: vi.fn(async () => null) }));

import { syncClan, runFullSync } from './sync';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-09-01T12:00:00Z');
const MAIN = 'clan-main';
const FEEDER = 'clan-feeder';

function advanceDays(n: number) {
  vi.setSystemTime(new Date(Date.now() + n * DAY));
}

function account(tag: string) {
  return h.db.find('player_accounts', tag);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});

  h.db = createClanOpsDb();
  h.coc = new FakeCoc();
  h.db.seed('clans', [
    { id: MAIN, clan_tag: '#MAIN', display_name: 'Main', active: true },
    { id: FEEDER, clan_tag: '#FEED', display_name: 'Feeder', active: true },
  ]);
  h.db.seed('settings', [
    { key: 'inactive_cleanup_days', value: '30' },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Two linked members in MAIN, synced once so the DB mirrors the game. */
async function seedLinkedRoster() {
  h.db.seed('persons', [
    { id: 'p-alice', display_name: 'Alice' },
    { id: 'p-bob', display_name: 'Bob' },
  ]);
  h.coc.setRoster('#MAIN', [member('#A1'), member('#B1')]);
  h.coc.setRoster('#FEED', [member('#F1')]);
  await runFullSync();
  account('#A1')!.person_id = 'p-alice';
  account('#B1')!.person_id = 'p-bob';
}

describe('person links survive sync (2026-09-14 incident)', () => {
  it('keeps person_id and added_at across ordinary syncs', async () => {
    await seedLinkedRoster();
    const addedAt = account('#A1')!.added_at;
    advanceDays(3);
    await runFullSync();
    expect(account('#A1')).toMatchObject({ person_id: 'p-alice', status: 'active', added_at: addedAt });
    expect(account('#A1')!.last_synced_at).toBe(new Date(T0.getTime() + 3 * DAY).toISOString());
  });

  it('does not wipe person links when the existing-account lookup fails', async () => {
    await seedLinkedRoster();
    const addedAt = account('#A1')!.added_at;
    advanceDays(1);

    // The by-tag lookup of existing rows errors (a transient PostgREST/network failure). The
    // incident signature: sync carried on as if every member were brand new.
    h.db.failNext('player_accounts', 'select', 'upstream timeout', (q) => q.filters.some((f) => f.startsWith('player_tag=in')));
    await expect(syncClan(MAIN)).rejects.toThrow();

    expect(account('#A1')).toMatchObject({ person_id: 'p-alice', added_at: addedAt });
    expect(account('#B1')).toMatchObject({ person_id: 'p-bob', added_at: addedAt });
  });

  it('never clears a link even if the lookup silently misses an existing row', async () => {
    await seedLinkedRoster();
    const addedAt = account('#A1')!.added_at;
    advanceDays(1);

    // A lookup that "succeeds" with no rows (e.g. a stale replica / cache): sync must still not be
    // able to overwrite a link it didn't see.
    const realFrom = h.db.from.bind(h.db);
    let hidden = false;
    vi.spyOn(h.db, 'from').mockImplementation((table: string) => {
      const q = realFrom(table);
      if (table !== 'player_accounts' || hidden) return q;
      const realIn = q.in.bind(q);
      (q as any).in = (c: string, vs: unknown[]) => {
        if (c === 'player_tag' && !hidden) {
          hidden = true;
          return realIn(c, []);
        }
        return realIn(c, vs);
      };
      return q;
    });

    await syncClan(MAIN);
    expect(account('#A1')).toMatchObject({ person_id: 'p-alice', added_at: addedAt, status: 'active' });
    expect(account('#B1')).toMatchObject({ person_id: 'p-bob', status: 'active' });
  });

  it('refuses to apply an empty roster over a clan that has active members', async () => {
    await seedLinkedRoster();
    h.coc.setRoster('#MAIN', []);
    await expect(syncClan(MAIN)).rejects.toThrow(/empty roster/i);
    expect(account('#A1')!.status).toBe('active');
    expect(account('#B1')!.status).toBe('active');
  });

  it('a failed CoC fetch changes nothing', async () => {
    await seedLinkedRoster();
    h.coc.fail('#MAIN');
    await expect(syncClan(MAIN)).rejects.toThrow(/503/);
    expect(account('#A1')).toMatchObject({ status: 'active', person_id: 'p-alice' });
  });
});

describe('roster reconciliation', () => {
  it('inserts new members as active and unlinked', async () => {
    h.coc.setRoster('#MAIN', [member('#N1', { role: 'admin', name: 'Newbie' })]);
    const res = await syncClan(MAIN);
    expect(res).toMatchObject({ success: true, count: 1, left: 0 });
    expect(account('#N1')).toMatchObject({
      clan_id: MAIN,
      status: 'active',
      person_id: null,
      db_role: 'elder',
      in_game_name: 'Newbie',
      added_at: T0.toISOString(),
    });
  });

  it('maps in-game roles to db_role', async () => {
    h.coc.setRoster('#MAIN', [
      member('#L', { role: 'leader' }),
      member('#C', { role: 'coLeader' }),
      member('#E', { role: 'admin' }),
      member('#M', { role: 'member' }),
    ]);
    await syncClan(MAIN);
    expect(['#L', '#C', '#E', '#M'].map((t) => account(t)!.db_role)).toEqual(['leader', 'co_leader', 'elder', 'member']);
  });

  it('marks a departed member left without unlinking them', async () => {
    await seedLinkedRoster();
    h.coc.remove('#B1', '#MAIN');
    const res = await syncClan(MAIN);
    expect(res.left).toBe(1);
    expect(account('#B1')).toMatchObject({ status: 'left', person_id: 'p-bob' });
  });

  it('a member who rejoins is reactivated with their link intact', async () => {
    await seedLinkedRoster();
    h.coc.remove('#B1', '#MAIN');
    await syncClan(MAIN);
    advanceDays(5);
    h.coc.setRoster('#MAIN', [member('#A1'), member('#B1')]);
    await syncClan(MAIN);
    expect(account('#B1')).toMatchObject({ status: 'active', person_id: 'p-bob' });
  });

  it('a mover between family clans keeps their link, whatever order the clans sync in', async () => {
    await seedLinkedRoster();
    h.coc.move('#A1', '#MAIN', '#FEED');
    await runFullSync();
    expect(account('#A1')).toMatchObject({ clan_id: FEEDER, status: 'active', person_id: 'p-alice' });

    // Destination first, then source: the source's "left" update must not flip them back.
    h.coc.move('#A1', '#FEED', '#MAIN');
    await syncClan(MAIN);
    await syncClan(FEEDER);
    expect(account('#A1')).toMatchObject({ clan_id: MAIN, status: 'active', person_id: 'p-alice' });
  });
});

describe('inactive cleanup (fake clock)', () => {
  async function departBob() {
    await seedLinkedRoster();
    h.coc.remove('#B1', '#MAIN');
    await syncClan(MAIN);
  }

  it('keeps a departed account inside the cleanup window', async () => {
    await departBob();
    advanceDays(29);
    await syncClan(MAIN);
    expect(account('#B1')).toBeDefined();
  });

  it('deletes a departed account once the window has passed', async () => {
    await departBob();
    advanceDays(31);
    await syncClan(MAIN);
    expect(account('#B1')).toBeUndefined();
    // …but never the person: accounts go, identities stay.
    expect(h.db.find('persons', 'p-bob')).toBeDefined();
  });

  it('never deletes an account whose person holds dashboard access', async () => {
    await departBob();
    h.db.find('persons', 'p-bob')!.access_role = 'co_leader';
    advanceDays(60);
    await syncClan(MAIN);
    expect(account('#B1')).toBeDefined();
  });

  it('never deletes an account carrying a strike inside the 90-day window', async () => {
    await departBob();
    h.db.seed('strikes', [{ id: 's1', person_id: 'p-bob', player_account_tag: '#B1', issued_at: new Date().toISOString() }]);
    advanceDays(60);
    await syncClan(MAIN);
    expect(account('#B1')).toBeDefined();
    advanceDays(40); // strike is now 100 days old
    await syncClan(MAIN);
    expect(account('#B1')).toBeUndefined();
    expect(h.db.find('strikes', 's1')!.player_account_tag).toBeNull();
  });

  it('measures the window from last-seen, so a sync gap longer than the window deletes a leaver in the same pass', async () => {
    // Documents current behaviour: last_synced_at is "last seen active", and the cleanup clock
    // runs from it. If nobody syncs for 31 days, a member who left during the gap is marked left
    // and deleted by the very same sync.
    await seedLinkedRoster();
    advanceDays(31);
    h.coc.remove('#B1', '#MAIN');
    await syncClan(MAIN);
    expect(account('#B1')).toBeUndefined();
  });

  it('a legacy warning on one departed account blocks the whole cleanup batch (swallowed)', async () => {
    // Documents current behaviour, observed in production: warnings.player_account_tag is
    // NO ACTION, the cleanup deletes every candidate in one statement, and its error is only
    // logged — so one referenced account keeps every other stale account alive, forever.
    await seedLinkedRoster();
    h.coc.setRoster('#MAIN', []);
    h.coc.setRoster('#MAIN', [member('#A1')]);
    h.db.seed('warnings', [{ id: 'w1', person_id: 'p-bob', player_account_tag: '#B1' }]);
    h.db.seed('player_accounts', [{ player_tag: '#GONE', clan_id: MAIN, status: 'active' }]);
    await syncClan(MAIN); // #B1 and #GONE leave
    advanceDays(31);
    await syncClan(MAIN);
    expect(account('#B1')).toBeDefined();
    expect(account('#GONE')).toBeDefined();
    expect(h.db.log.some((l) => l.table === 'player_accounts' && l.op === 'delete' && l.error?.code === '23503')).toBe(true);
  });
});

describe('persons', () => {
  it('are never removed by any sync path', async () => {
    await seedLinkedRoster();
    h.coc.setRoster('#MAIN', [member('#X')]); // everyone we know leaves
    for (let d = 0; d < 120; d += 7) {
      advanceDays(7);
      await runFullSync();
    }
    expect(h.db.find('persons', 'p-alice')).toBeDefined();
    expect(h.db.find('persons', 'p-bob')).toBeDefined();
  });
});
