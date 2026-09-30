/**
 * A scriptable Clash of Clans API for sync tests. Rosters are set per clan tag; `fetchFromCoC` is
 * wired to read them, so a test can move a player between clans, drop one, or make a clan's fetch
 * fail, then run a sync and assert on the database.
 */
import type { CoCClan, CoCClanMember } from '@/lib/coc-api';

export function member(tag: string, overrides: Partial<CoCClanMember> = {}): CoCClanMember {
  return {
    tag,
    name: `Player ${tag}`,
    role: 'member',
    townHallLevel: 15,
    expLevel: 200,
    trophies: 5000,
    donations: 0,
    donationsReceived: 0,
    ...overrides,
  } as CoCClanMember;
}

export class FakeCoc {
  rosters = new Map<string, CoCClanMember[]>();
  failures = new Map<string, string>();
  calls: string[] = [];

  setRoster(clanTag: string, members: CoCClanMember[]) {
    this.rosters.set(clanTag, members);
  }

  /** Move a player between rosters, as happens when they hop clans in game. */
  move(tag: string, fromClan: string, toClan: string) {
    const from = this.rosters.get(fromClan) ?? [];
    const m = from.find((x) => x.tag === tag);
    if (!m) throw new Error(`${tag} not in ${fromClan}`);
    this.rosters.set(fromClan, from.filter((x) => x.tag !== tag));
    this.rosters.set(toClan, [...(this.rosters.get(toClan) ?? []), m]);
  }

  remove(tag: string, clanTag: string) {
    this.rosters.set(clanTag, (this.rosters.get(clanTag) ?? []).filter((x) => x.tag !== tag));
  }

  fail(clanTag: string, message = 'CoC API error: 503') {
    this.failures.set(clanTag, message);
  }

  fetch = async <T>(endpoint: string): Promise<T> => {
    this.calls.push(endpoint);
    const match = endpoint.match(/^\/clans\/([^/]+)$/);
    if (!match) throw new Error(`FakeCoc: unhandled endpoint ${endpoint}`);
    const tag = decodeURIComponent(match[1]);
    const failure = this.failures.get(tag);
    if (failure) throw new Error(failure);
    const roster = this.rosters.get(tag);
    if (!roster) throw new Error('CoC API error: 404 - notFound');
    return { tag, name: tag, memberList: roster.map((m) => ({ ...m })) } as unknown as T;
  };
}

export type { CoCClan };
